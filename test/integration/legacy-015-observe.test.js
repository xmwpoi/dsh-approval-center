/**
 * 旧版回归观察（DSH 0.1.5-rc.1）——明确标注：这不是正式支持承诺。
 *
 * 派发包（agent-handoff-current.md §3）授权 B 在隔离分支补"旧版观察"用例。
 * 本文件单独成进程（node --test 每文件独立子进程），通过 createRequire 加载
 * fixture-015 的旧版包实例，与目标版 fixture（test/integration/node_modules）
 * 零模块共享，避免两套 cordis/schemastery 串扰。
 *
 * 真实：旧版 Context + ApprovalService + 插件 lib（同一构建产物）+ SQLite。
 * mock：仅 powershell.exe 异步 spawn（hooks/spawn-shim.mjs，机制同目标版）。
 *
 * 结论语义：PASS 仅证明"插件在该旧版宿主上行为未回归（观察）"；
 * 双版本正式支持仍须 contract-017.md §1 的完整验收流程，不由本文件宣布。
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { after, describe, test } from 'node:test'

const HERE = dirname(fileURLToPath(import.meta.url))
const require015 = createRequire(pathToFileURL(join(HERE, 'fixture-015', 'package.json')).href)
const { Context } = require015('@deepseek-ai/cordis')
const { ApprovalService, setApprovalPolicy } = require015('@deepseek-ai/dsh-user-approval')
const PLUGIN_LIB_URL = pathToFileURL(join(HERE, '..', '..', 'lib', 'index.js')).href

// mock 通道（与 hooks/spawn-shim.mjs 的全局约定一致）
const channel = { spawns: [], onSpawn: null }
globalThis.__approvalMockChannel = channel
const spawned = () => channel.spawns

function toastArgsOf(record) {
  const get = (flag) => {
    const i = record.args.indexOf(flag)
    return i >= 0 ? record.args[i + 1] : undefined
  }
  return { title: get('-Title'), message: get('-Message'), timeoutSec: get('-TimeoutSec') }
}

async function waitForSpawns(count, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (spawned().length < count) {
    if (Date.now() > deadline) throw new Error(`等待第 ${count} 次 spawn 超时（当前 ${spawned().length}）`)
    await new Promise((r) => setTimeout(r, 10))
  }
}

/** dsh-session seq/eventAt/append 最小内存实现（同 helpers/harness.mjs） */
class FakeSessionLog {
  #events = []
  get seq() { return this.#events.length }
  append(type, data) { this.#events.push({ type, data }); return this.#events.length - 1 }
  eventAt(seq) { return this.#events[Number(seq)] ?? null }
  eventsOf(type) { return this.#events.filter((e) => e.type === type) }
  get all() { return [...this.#events] }
}

/** 旧版宿主组装（独立于 helpers/harness.mjs：不引入任何 0.1.7 包实例） */
async function startHostLegacy({ dataDir: override } = {}) {
  const ctx = new Context()
  const session = new FakeSessionLog()
  const agent = { id: 'agent-legacy', session }
  // 旧版 effectivePolicy 直接读 this.config.policy（无 schema 默认兜底），必须显式传
  const service = new ApprovalService(ctx, { policy: 'ask' })
  const dataDir = override ?? mkdtempSync(join(tmpdir(), `approval-t5-legacy-${randomUUID().slice(0, 8)}-`))
  const pluginMod = await import(PLUGIN_LIB_URL)
  const cfg = {
    timeoutSec: 30, timeoutAction: 'reject', tools: ['*'], queueMode: 'serial',
    notifyOnSubagentEnd: false, notifyOnSubagentStart: false, notifyOnApprovalResult: false,
    dataDir,
  }
  const fiber = ctx.plugin(pluginMod, cfg)
  await fiber
  return { ctx, session, agent, service, fiber, dataDir, unload: () => fiber.dispose() }
}

function readAuditRows(dataDir) {
  const { DatabaseSync } = require015('node:sqlite')
  const { existsSync } = require015('node:fs')
  const dbPath = join(dataDir, 'approvals.db')
  if (!existsSync(dbPath)) return []
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare('SELECT tool_name AS toolName, reason, status FROM approvals ORDER BY created_at').all()
  } finally {
    db.close()
  }
}

after(() => {
  globalThis.__approvalMockChannel = undefined
})

describe('旧版 0.1.5-rc.1 回归观察（非支持承诺）', () => {
  test('匹配审批流：allowed-once + asked/decided 配对 + 审计 approved', async () => {
    const host = await startHostLegacy()
    const before = spawned().length
    host.session.append('turn/start', {})
    const pending = host.service.request({ agent: host.agent, toolName: 'pwsh', reason: 'legacy smoke' })
    await waitForSpawns(before + 1)
    spawned()[before].child.emit('exit', 0)
    const outcome = await pending
    host.session.append('turn/end', {})
    await host.unload()

    assert.equal(outcome, 'allowed-once')
    const asked = host.session.eventsOf('approval/asked')
    const decided = host.session.eventsOf('approval/decided')
    assert.equal(asked.length, 1)
    assert.equal(decided.length, 1)
    assert.equal(asked[0].data.id, decided[0].data.id)
    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'approved')
  })

  test('旧版 payload 无 displayReason：展示回退 reason，审计存原始 reason', async () => {
    const host = await startHostLegacy()
    const before = spawned().length
    host.session.append('turn/start', {})
    const pending = host.service.request({ agent: host.agent, toolName: 'pwsh', reason: 'legacy reason only' })
    await waitForSpawns(before + 1)
    const record = spawned()[before]
    record.child.emit('exit', 1)
    const outcome = await pending
    await host.unload()

    assert.equal(outcome, 'rejected')
    const args = toastArgsOf(record)
    assert.ok(args.message.includes('原因: legacy reason only'), `回退展示 reason：${args.message}`)
    assert.equal(readAuditRows(host.dataDir)[0].reason, 'legacy reason only')
  })

  test('never 策略（会话级 setApprovalPolicy）：派发前短路，插件零痕迹', async () => {
    const host = await startHostLegacy()
    host.session.append('turn/start', {})
    setApprovalPolicy(host.session, 'never')
    const spawnsBefore = spawned().length
    const outcome = await host.service.request({ agent: host.agent, toolName: 'pwsh', reason: 'never probe' })
    host.session.append('turn/end', {})
    await host.unload()

    assert.equal(outcome, 'rejected')
    assert.equal(spawned().length - spawnsBefore, 0, '旧版 never 同样在派发前拦截')
    assert.equal(readAuditRows(host.dataDir).length, 0)
  })

  test('进行中撤回：cancelled，审计 cancelled', async () => {
    const host = await startHostLegacy()
    const controller = new AbortController()
    const before = spawned().length
    host.session.append('turn/start', {})
    const pending = host.service.request({ agent: host.agent, toolName: 'pwsh', signal: controller.signal })
    await waitForSpawns(before + 1)
    const record = spawned()[before]
    controller.abort(new Error('host withdraw'))
    const outcome = await pending
    host.session.append('turn/end', {})
    await host.unload()

    assert.equal(outcome, 'cancelled')
    assert.equal(record.child.killed, true)
    const decided = host.session.eventsOf('approval/decided')
    assert.equal(decided[0].data.outcome, 'cancelled')
    assert.equal(readAuditRows(host.dataDir)[0].status, 'cancelled')
  })
})
