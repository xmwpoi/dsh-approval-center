/**
 * T5 集成测试夹具：真实 Cordis Context + 真实 ApprovalService（fixture 精确版本）
 * + 真实插件 apply/lib + mock 通知通道（spawn-shim 拦截）+ 真实 SQLite（隔离临时目录）。
 *
 * 非交互铁律：所有 powershell.exe spawn 都被替身，绝不弹真实通知；
 * 会话日志是 dsh-session seq/eventAt/append 面的最小内存实现——ApprovalService
 * 本身、其审计与 waterfall 派发都是真实代码路径（contract-017.md §2.1/§2.3）。
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { after } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import { SessionSeq } from '@deepseek-ai/dsh-session'

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
// T7a 候选包烟测可指向干净目录安装后的入口；CI 默认测试本次构建产物。
const PLUGIN_LIB_URL = pathToFileURL(process.env.DSH_PLUGIN_ENTRY ?? join(REPO_ROOT, 'lib', 'index.js')).href

/**
 * dsh-session 的 seq/eventAt/append 最小内存实现（审计配对断言用真实事件流）。
 *
 * 宿主保证 `session.header` **始终存在**（dsh-session index.d.ts：「session.header is
 * always present」），且主/子判据只看 `header.origin`（契约 §2.4）。因此这个最小替身
 * 也必须带 header —— 缺 header 会被本插件判为「身份无法可靠确认」并按 §2.7 转交 next()。
 * origin 缺省 = root 会话；传 'subagent' 表示子代理子会话。
 */
export class FakeSessionLog {
  #events = []
  constructor({ id = 'agent-fixture', origin } = {}) {
    this.header = { id, ...(origin !== undefined ? { origin } : {}) }
  }
  get seq() { return this.#events.length }
  append(type, data) {
    this.#events.push({ type, data })
    return this.#events.length - 1
  }
  eventAt(seq) {
    const e = this.#events[Number(seq)]
    return e === undefined ? null : e
  }
  eventsOf(type) { return this.#events.filter((e) => e.type === type) }
  get all() { return [...this.#events] }
  /** 公开快照 API（契约 §2.5 标题回读用） */
  snapshotEvents(fromSeq = 0, toSeqExclusive) {
    const end = toSeqExclusive === undefined ? this.#events.length : Number(toSeqExclusive)
    return this.#events.slice(Number(fromSeq), end)
  }
}

export function approvalPairOf(session) {
  const asked = session.eventsOf('approval/asked')
  const decided = session.eventsOf('approval/decided')
  return { asked, decided }
}

/** mock 通道：每份测试文件一个；记录全部 powershell.exe spawn 供断言与驱动 */
export function createMockChannel() {
  const channel = { spawns: [], onSpawn: null }
  globalThis.__approvalMockChannel = channel
  return channel
}

export function toastArgsOf(record) {
  // spawn args: [node, -NoProfile, ..., -File, <script>, -Title, v, -Message, v, ...]
  const get = (flag) => {
    const i = record.args.indexOf(flag)
    return i >= 0 ? record.args[i + 1] : undefined
  }
  return {
    script: get('-File'),
    title: get('-Title'),
    message: get('-Message'),
    timeoutSec: get('-TimeoutSec'),
    timeoutAction: get('-TimeoutAction'),
    requestToken: get('-RequestToken'),
    cleanupToken: get('-CleanupToken'),
  }
}

export async function waitForSpawns(channel, count, { timeoutMs = 5000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (channel.spawns.length < count) {
    if (Date.now() > deadline) {
      throw new Error(`等待第 ${count} 次 spawn 超时（当前 ${channel.spawns.length} 次）`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  return channel.spawns
}

/**
 * 组装一个真实宿主：Context + ApprovalService + 插件 fiber（ctx.plugin 走真实
 * config 校验与 fiber effect 生命周期）。返回 unload() 供卸载/重载用例。
 *
 * `sessionId`/`origin` 用于构造带 `header` 的会话替身（§2.4 主/子判据）；
 * `origin: 'subagent'` 得到子代理子会话。
 */
export async function startHost({
  policy = 'ask', config = {}, dataDir: dataDirOverride,
  sessionId = 'agent-fixture', origin,
} = {}) {
  const ctx = new Context()
  const session = new FakeSessionLog({ id: sessionId, origin })
  const agent = { id: sessionId, session }
  const service = new ApprovalService(ctx, { policy })
  const dataDir = dataDirOverride ?? mkdtempSync(join(tmpdir(), `approval-t5-${randomUUID().slice(0, 8)}-`))
  const pluginMod = await import(PLUGIN_LIB_URL)
  // 显式传完整 config：等价宿主完整覆盖投影后的形态；schema 校验仍由 ctx.plugin 真实执行
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
  await fiber // fiber thenable：装载完成（含 apply 同步体与 Config 校验）
  return {
    ctx, session, agent, service, fiber, dataDir,
    unload: () => fiber.dispose(),
  }
}

/**
 * 走宿主真实 Cordis 派发路径发布一条会话事件（不直接调用插件监听器，
 * 这样 scope 过滤、监听器注册与注销都被真实执行）。
 */
export function publishSessionEvent(host, event) {
  host.ctx.emit('session/event', host.session, event)
}

/** 开启真实 turn（ApprovalService.request 的 open-turn 前置，contract §2.3） */
export function openTurn(session) { session.append('turn/start', {}) }
export function closeTurn(session) { session.append('turn/end', {}) }

export function makeReq(agent, { toolName = 'pwsh', reason, displayReason, signal, callId } = {}) {
  return {
    agent,
    toolName,
    ...(callId !== undefined ? { callId } : {}),
    ...(reason !== undefined ? { reason } : {}),
    ...(displayReason !== undefined ? { displayReason } : {}),
    ...(signal !== undefined ? { signal } : {}),
  }
}

/** 直接读隔离库（独立只读连接；列名投影为 camelCase 与插件 ApprovalRecord 对齐）。
 * 库文件不存在（懒加载、零审批）时返回 []——这本身就是"零痕迹"断言语义。 */
export function readAuditRows(dataDir) {
  const dbPath = join(dataDir, 'approvals.db')
  if (!existsSync(dbPath)) return []
  const db = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return db.prepare(`
      SELECT request_id AS requestId, agent_id AS agentId, tool_name AS toolName,
             reason, created_at AS createdAt, status
      FROM approvals ORDER BY created_at`).all()
  } finally {
    db.close()
  }
}

/** 往隔离库注入"UPDATE 一律失败"的触发器（settle 写故障注入，真实 SQLite 错误路径） */
export function injectSettleFailure(dataDir) {
  const db = new DatabaseSync(join(dataDir, 'approvals.db'))
  try {
    db.exec(`CREATE TRIGGER t5_block_settle BEFORE UPDATE ON approvals
             BEGIN SELECT RAISE(ABORT, 't5 injected settle failure'); END`)
  } finally {
    db.close()
  }
}

const cleanupDirs = []
export function trackCleanup(dir) { cleanupDirs.push(dir) }
after(() => {
  for (const dir of cleanupDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* 只清自己的临时目录 */ }
  }
})

/** startHost 的一次性包装：自动登记临时目录清理 */
export async function startHostTracked(options) {
  const host = await startHost(options)
  trackCleanup(host.dataDir)
  return host
}
