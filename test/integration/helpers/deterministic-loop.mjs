/**
 * R5-D 确定性真实 agent-loop 夹具（仅测试域，不属于插件运行时依赖）。
 *
 * 目的：用**真实的** `@deepseek-ai/dsh-agent-loop` 驱动主会话，LLM 用**确定性 adapter**
 * （实现真实 `LlmAdapter` 契约、经真实 `ctx.llm.registerAdapter` 注册），
 * 从而在不外呼、不用生产 key 的前提下获得"真实 loop → 插件 session/event → 通知"的端到端证据。
 *
 * 与冒充的区别：本夹具**绝不**手工 `session.append('turn/end', ...)`；
 * turn/start、step/start、assistant/message、turn/end 全部由真实 loop 产出。
 *
 * 装配顺序（实测有依赖）：
 *   SessionStore → AgentRegistry → LlmRuntime → SystemPrompt → ToolRuntime
 *   → SessionProjectionRegistry → 插件 fiber → AgentLoop
 *   （SystemPrompt 必须先于 ToolRuntime，后者在构造期读 `ctx.systemPrompt`。）
 *
 * 资源：所有 fiber 在 `dispose()` 中有界回收；临时目录登记进 harness 的 after 清理。
 */
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import { LlmRuntime, LlmAdapter } from '@deepseek-ai/dsh-llm'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PLUGIN_LIB_URL = pathToFileURL(process.env.DSH_PLUGIN_ENTRY ?? join(REPO_ROOT, 'lib', 'index.js')).href

const PROVIDER = 'deterministic-test'
const MODEL = 'deterministic-model'

/**
 * 确定性 adapter：实现真实 `LlmAdapter` 契约的最小子集。
 * `script({ messages, options })` 每次调用返回 `{ text }`（正常完成）或 `throw`（模型失败）。
 */
class DeterministicAdapter extends LlmAdapter {
  #script
  #calls = 0
  constructor(script) { super(); this.#script = script }
  get callCount() { return this.#calls }
  providerInfo(p) { return { id: p, name: 'Deterministic test adapter' } }
  providerRetryPolicy() { return undefined }
  imageRequestPricing() { return undefined }
  async listModels() { return [{ id: MODEL, name: MODEL }] }
  async resolveModel(p, m) { return { provider: p, id: m, name: m, context: { contextWindow: 8192 } } }
  async prepareCall(p, m, s) { return { model: await this.resolveModel(p, m, s), stream: (o) => this.stream(o) } }
  async *stream(o) {
    this.#calls++
    const out = this.#script?.({ messages: o.messages, options: o }) ?? { text: 'done.' }
    if (out?.throw) throw out.throw
    const text = out?.text ?? 'done.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: 'stop' }
  }
}

/**
 * 装配"真实宿主 + 真实 agent-loop + 确定性模型"。
 * @param script - adapter 脚本；每轮模型调用调用一次。
 */
export async function startLoopHost({ script, config = {}, dataDir: dataDirOverride } = {}) {
  const ctx = new Context()
  const dataDir = dataDirOverride ?? mkdtempSync(join(tmpdir(), `r5-loop-${randomUUID().slice(0, 8)}-`))

  // 6 服务（顺序：systemPrompt 先于 tools）
  new SessionStore(ctx)
  new AgentRegistry(ctx)
  new LlmRuntime(ctx)
  new SystemPrompt(ctx, {})
  new ToolRuntime(ctx, {})
  new SessionProjectionRegistry(ctx)
  const adapter = new DeterministicAdapter(script)
  const llm = ctx.llm
  const registration = llm.registerAdapter([PROVIDER], adapter)

  // 插件（真实接线，mock 通道由 spawn-shim 提供）
  const pluginMod = await import(PLUGIN_LIB_URL)
  const cfg = {
    timeoutSec: 30, timeoutAction: 'reject', tools: ['*'], queueMode: 'serial',
    notifyOnTurnEnd: true, notifyOnTurnFailure: true, taskNotificationSound: 'silent',
    taskNotificationShowTitle: true, notifyOnSubagentEnd: false, notifyOnSubagentStart: false,
    notifyOnApprovalResult: false, dataDir,
    ...config,
  }
  const fiber = ctx.plugin(pluginMod, cfg)
  await fiber

  // 真实 agent-loop（最后装载；inject agents/sessions/llm/tools/systemPrompt/sessionProjections）
  const loopFiber = ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 1 })
  await loopFiber
  const loop = ctx.agentLoop

  const events = []
  ctx.on('session/event', (s, e) => { events.push({ id: String(s.id), type: e.type, data: e.data }) })

  return {
    ctx, adapter, registration, loop, events, dataDir, cfg,
    PROVIDER, MODEL,
    /** 创建主会话 agent（真实 loop.create） */
    createMain: (id) => loop.create(SessionId(id), { provider: PROVIDER, model: MODEL }, { cwd: process.cwd() }),
    unload: async () => {
      await loopFiber.dispose()
      await fiber.dispose()
    },
    cleanup: () => { try { rmSync(dataDir, { recursive: true, force: true }) } catch { /* runner 回收 */ } },
  }
}

/** 有界等待某个事件出现（默认 20s），避免测试悬挂 */
export async function waitForEvent(events, predicate, { timeoutMs = 20_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = events.find(predicate)
    if (found) return found
    await new Promise((r) => setImmediate(r))
  }
  throw new Error('等待事件超时（' + timeoutMs + 'ms）')
}
