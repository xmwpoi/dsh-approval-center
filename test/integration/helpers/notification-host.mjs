/**
 * T3 主会话通知集成宿主（Agent D）。
 *
 * 与 approval-flow 的 harness 差异：这里用**真实 @deepseek-ai/dsh-session SessionStore**
 * 发布路径（ctx.sessions.create / session.append），而不是 FakeSessionLog——
 * 派发书 §4 Agent D 要求"用真实 Cordis/Session 发布路径和 mock sender 检验作用域，
 * 不能只直接调用 listener 假冒集成"。
 *
 * powershell.exe 的 spawn 由 hooks/spawn-shim.mjs 全局拦截（真实 ApprovalService、
 * 真实插件 apply、真实 NotificationService、真实 sender 全部走真实代码路径，
 * 只有进程创建被替身），因此这是端到端集成而非单元测试。
 */
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-session-title'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PLUGIN_LIB_URL = pathToFileURL(process.env.DSH_PLUGIN_ENTRY ?? join(REPO_ROOT, 'lib', 'index.js')).href

const cleanupDirs = []
after(() => {
  for (const dir of cleanupDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 只清自己的临时目录 */ }
  }
})

export function trackCleanup(dir) { cleanupDirs.push(dir) }

/**
 * 组装真实宿主：Context + SessionStore + ApprovalService + 插件 fiber。
 * 返回 createRoot/createChild/forkRoot 与 publish 断言所需的一切。
 *
 * `registry` 选项控制宿主 AgentRegistry 的注入形态（契约 §2.6 解析第 2 步）：
 *   - 'stub'（默认，兼容既有用例）：最小 `{ get }` 替身 —— **不能**证明真实服务注入
 *   - 'real'：真实 `@deepseek-ai/dsh-agent` AgentRegistry 服务（真实 Cordis 服务注册/依赖注入），
 *     配合返回的 `registerAgent()` 把已构造 agent 记入真实 store
 *   - 'none'：完全不注入 agents 服务 —— 触发插件 `safeAgentLookup` 的"服务不可用"路径
 */
export async function startNotificationHost({
  config = {}, policy = 'ask', dataDir: dataDirOverride, agents = new Map(),
  registry = 'stub',
} = {}) {
  const ctx = new Context()
  // 真实 SessionStore：必须在 ctx 上实例化服务，ctx.sessions 才可用
  const store = new SessionStore(ctx)
  const dataDir = dataDirOverride ?? mkdtempSync(join(tmpdir(), `notif-t3-${randomUUID().slice(0, 8)}-`))
  trackCleanup(dataDir)

  // 宿主 AgentRegistry（契约 §2.6 解析顺序第 2 步）
  let agentRegistry
  if (registry === 'real') {
    // 真实服务：真实 Cordis 服务注册与依赖注入，ctx.agents 即 AgentRegistry 实例
    agentRegistry = new AgentRegistry(ctx)
  } else if (registry === 'stub') {
    ctx.agents = { get: (id) => agents.get(id) }
  } // 'none'：什么都不装，ctx.agents 缺失

  const service = new ApprovalService(ctx, { policy })
  const pluginMod = await import(PLUGIN_LIB_URL)
  const cfg = {
    timeoutSec: 30,
    timeoutAction: 'reject',
    tools: ['*'],
    queueMode: 'serial',
    notifyOnTurnEnd: true,
    notifyOnTurnFailure: true,
    taskNotificationSound: 'silent',
    taskNotificationShowTitle: true,
    notifyOnSubagentEnd: false,
    notifyOnSubagentStart: false,
    notifyOnApprovalResult: false,
    dataDir,
    ...config,
  }
  const fiber = ctx.plugin(pluginMod, cfg)
  await fiber

  const unloaded = []
  return {
    ctx, store, agentRegistry, service, fiber, dataDir, cfg,
    unload: async () => { await fiber.dispose(); unloaded.push(1) },
    /** 把已构造 agent 记入真实 AgentRegistry（仅 registry='real' 时可用）；须 await 返回的 effect */
    registerAgent: (agent) => agentRegistry.register(agent),
    /** 根（主）会话 */
    createRoot(id, { title } = {}) {
      const s = ctx.sessions.create(SessionId(id), { meta: { cwd: process.cwd() } })
      if (title !== undefined) s.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
      return s
    },
    /** 委派子会话（origin=subagent） */
    createChild(id, parent) {
      return ctx.sessions.create(SessionId(id), {
        meta: { cwd: process.cwd(), origin: 'subagent', delegationDepth: 1, ...(parent ? { parentSession: SessionId(parent) } : {}) },
      })
    },
    /** fork 根会话（origin 缺省、isSeeded=true）——必须被当作主会话 */
    forkRoot(source, id) {
      return ctx.sessions.fork(source, undefined, id ? SessionId(id) : undefined)
    },
    /** 完整走完一轮：turn/start → step/start → step/end → turn/end */
    runTurn(session, { kind = 'completed', turn = 1, withStep = true } = {}) {
      session.append('turn/start', { turn })
      if (withStep) {
        session.append('step/start', { turn, step: 1 })
        session.append('step/end', { turn, step: 1 })
      }
      session.append('turn/end', {
        turn,
        reason: kind === 'aborted' ? { kind, reason: { kind: 'user' } } : { kind },
      })
    },
  }
}

/** 从 spawn 记录提取参数（与 harness.toastArgsOf 兼容，另取 Tag/Group/Sound/脚本名） */
export function argsOf(record) {
  const get = (flag) => {
    const i = record.args.indexOf(flag)
    return i >= 0 ? record.args[i + 1] : undefined
  }
  const script = get('-File') ?? ''
  return {
    script: script.split(/[\\/]/).pop(),
    title: get('-Title'),
    message: get('-Message'),
    tag: get('-Tag'),
    group: get('-Group'),
    sound: get('-Sound'),
    requestToken: get('-RequestToken'),
  }
}

export { SessionLogOffset }
