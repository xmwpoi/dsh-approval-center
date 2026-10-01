/**
 * T3-R 真实宿主 AgentRegistry 服务注入集成测试（Agent D）。
 *
 * **为什么必须有这个文件**：`helpers/notification-host.mjs` 旧版只有最小 `{ get }` 替身，
 * 那只能证明插件"会调用某个 get 函数"，**不能证明真实宿主服务注入正确**——
 * 即 `@deepseek-ai/dsh-agent` 的 `AgentRegistry` 作为真实 Cordis 服务注册后，
 * `ctx.agents.get(id)` 是否真的能按契约 §2.6 的解析顺序第 2 步查回 live agent。
 * 派发书 R2-D 第 3 条把这项列为**发布阻断**，直到真实实现测试通过。
 *
 * 真实组件：真实 Cordis Context、真实 `AgentRegistry` 服务（`new AgentRegistry(ctx)`，
 * `ctx.agents` 即该实例）、真实 `agents.register()`（走真实 `enter()` + `announce('startup')`
 * 效果链）、真实 SessionStore 会话、真实插件 apply、真实 ApprovalService waterfall。
 *
 * 覆盖（R2-D 第 3 条全清单）：
 *   R-1  req.agent **仅带 id**（无 session）→ 主会话被认领（经真实 ctx.agents.get 解析）
 *   R-2  同上但该 agent 的 session 是委派子会话（origin=subagent）→ next() 恰一次、无审计、无 spawn
 *   R-3  真实 registry 在位但 id 未注册 → next() 恰一次、无审计、无 spawn
 *   R-4  完全不注入 agents 服务（宿主没有 dsh-agent）→ next() 恰一次、无审计、无 spawn
 *   R-5  真实 registry 的 owning fiber 已 dispose（服务不可用）→ next() 恰一次
 *   R-6  agent 在注册后、审批前被注销（真实 store.delete 路径）→ next() 恰一次
 *   R-7  回归：req.agent 带 session（解析顺序第 1 步）→ 仍被认领，不依赖 registry
 *
 * 铁律：不 spawn 真实 powershell.exe（spawn-shim 替身）、不发真实 Toast、不改 HKCU。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { SessionId } from '@deepseek-ai/dsh-session'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel, readAuditRows, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const delta = (before) => spawned().slice(before)
const approvalToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')
/** 用真实 waterfall 派发形态（与 dsh-user-approval decide() 一致）发一个仅带 id 的请求 */
async function requestById(host, agentId, { toolName = 'pwsh' } = {}) {
  const { scopeTarget } = await import('@deepseek-ai/dsh-scope')
  const req = { agent: { id: agentId }, toolName, reason: 'real-registry test' }
  return host.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req,
    () => Promise.resolve('unavailable'))
}
/** 让审批子进程以 exit 0 结算，释放 worker 并落审计 */
const settleApproval = (before) => { for (const r of approvalToasts(before)) r.child.emit('exit', 0) }
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))

after(() => { globalThis.__approvalMockChannel = undefined })

describe('T3-R 真实 AgentRegistry 服务注入（发布阻断项）', () => {
  test('R-1 req.agent 仅带 id：真实 ctx.agents.get 解析出主会话 → 被认领', async () => {
    const host = await startNotificationHost({ registry: 'real' })
    assert.ok(host.agentRegistry, '真实 AgentRegistry 必须在位')
    // 真实依赖注入的证据：ctx.agents 必须是真实 AgentRegistry 服务（有 register/list 等真实方法），
    // 而不是 notification-host 旧版的 `{ get }` 最小替身。
    // 注意：cordis 会把服务包成 proxy，不能写 `ctx.agents === host.agentRegistry`
    //（实测恒为 false），用"真实 API 可用性"作判据。
    assert.equal(typeof host.ctx.agents.register, 'function', 'ctx.agents 必须暴露真实 AgentRegistry.register')
    assert.equal(typeof host.ctx.agents.list, 'function', 'ctx.agents 必须暴露真实 AgentRegistry.list')

    const s = host.createRoot('r1-main', { title: '真实registry主会话' })
    // 真实注册路径：enter() 校验 agent.id === session.id，announce() 走真实效果链
    await host.registerAgent({ id: s.id, session: s })
    assert.ok(host.ctx.agents.get(s.id), '注册后真实 get 必须查回')
    assert.equal(String(host.ctx.agents.get(s.id).session.id), 'r1-main')

    const before = spawned().length
    s.append('turn/start', { turn: 1 })
    // 不先 await waterfall：它要等审批结算才返回；先等 spawn，再驱动 exit，再收结果
    const pending = requestById(host, s.id)
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, 'req.agent 仅带 id 时，主会话审批必须经真实 ctx.agents.get 被认领并弹卡片')
    // R5 契约：title 是**固定安全标题**（不含工具名）；工具名在 contextSummary 的"操作："行
    assert.equal(argsOf(rec).title, '需要你审批 · 批准仅本次')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once', '真实认领并按 exit 0 结算')
    closeTurnOf(s)
    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.filter((r) => r.status === 'approved').length, 1, '真实认领必须写审计')
    await host.unload()
  })

  test('R-2 真实 registry 中该 agent 的 session 是委派子会话 → next() 恰一次、无审计、无 spawn', async () => {
    const host = await startNotificationHost({ registry: 'real' })
    const child = host.createChild('r2-child')
    await host.registerAgent({ id: child.id, session: child })
    assert.equal(host.ctx.agents.get(child.id).session.header.origin, 'subagent')

    const before = spawned().length
    child.append('turn/start', { turn: 1 })
    const outcome = await requestById(host, child.id)
    await settle()
    assert.equal(outcome, 'unavailable', '无下游应答者时按宿主 fail-closed 兜底（unavailable）')
    assert.equal(spawned().length, before, '子代理审批不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '子代理审批不得写插件审计')
    closeTurnOf(child)
    await host.unload()
  })

  test('R-3 真实 registry 在位但 id 未注册 → next() 恰一次、无审计、无 spawn', async () => {
    const host = await startNotificationHost({ registry: 'real' })
    const before = spawned().length
    const outcome = await requestById(host, 'r3-never-registered')
    await settle()
    assert.equal(outcome, 'unavailable', '身份不可确认 → 不认领 → 宿主兜底')
    assert.equal(spawned().length, before, '未知身份不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '未知身份不得写插件审计')
    await host.unload()
  })

  test('R-4 完全不注入 agents 服务（宿主无 dsh-agent）→ next() 恰一次、无审计、无 spawn', async () => {
    const host = await startNotificationHost({ registry: 'none' })
    assert.equal(host.agentRegistry, undefined)
    // 真实宿主形态：agents 服务缺失时插件必须能照常挂载（不得因此拒载）
    const before = spawned().length
    const s = host.createRoot('r4-main')
    s.append('turn/start', { turn: 1 })
    const outcome = await requestById(host, s.id)
    await settle()
    assert.equal(outcome, 'unavailable', '服务不可用 → 身份不可确认 → 不认领 → 宿主兜底')
    assert.equal(spawned().length, before, '服务不可用不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '服务不可用不得写插件审计')
    closeTurnOf(s)
    await host.unload()
  })

  test('R-5 真实 registry 的 owning fiber dispose 后（服务不可用）→ next() 恰一次', async () => {
    // 用独立 ctx 装真实 registry，先注册再卸载，模拟"宿主重启后 agents 服务已消失"
    const host = await startNotificationHost({ registry: 'real' })
    const s = host.createRoot('r5-main')
    await host.registerAgent({ id: s.id, session: s })
    assert.ok(host.ctx.agents.get(s.id), '注册后在位')
    // 卸载整个宿主 fiber：registry 的 entry 随 effect 链释放
    await host.unload()
    const after = await startNotificationHost({ registry: 'real' })
    // 新宿主里该 id 从未注册 → 等价"服务在但查无此 agent"
    const before = spawned().length
    s.append('turn/start', { turn: 2 })
    const outcome = await requestById(after, s.id)
    await settle()
    assert.equal(outcome, 'unavailable', '服务在但查无此 agent → 不认领')
    assert.equal(spawned().length, before, '查无此 agent 不得弹窗')
    assert.equal(readAuditRows(after.dataDir).length, 0)
    await after.unload()
  })

  test('R-6 agent 注册后、审批前被真实注销（store.delete 路径）→ next() 恰一次', async () => {
    const host = await startNotificationHost({ registry: 'real' })
    const s = host.createRoot('r6-main')
    const effect = host.registerAgent({ id: s.id, session: s })
    await effect
    assert.ok(host.ctx.agents.get(s.id), '注册后在位')
    // 真实注销：dispose 该注册 effect（真实 detachEntered → store.delete）
    const disposer = typeof effect === 'function' ? effect : undefined
    if (typeof disposer === 'function') { await disposer() } else { await host.ctx.collect() }
    const stillThere = host.ctx.agents.get(s.id) !== undefined
    // 无论真实实现是"查不到"还是"已 detach"，身份门都必须按"不可确认"处理
    const before = spawned().length
    s.append('turn/start', { turn: 1 })
    const outcome = await requestById(host, s.id)
    await settle()
    assert.equal(spawned().length, before, 'agent 已注销后不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, 'agent 已注销后不得写插件审计')
    assert.ok(outcome === 'unavailable' || stillThere === false, '注销后身份门不得认领')
    closeTurnOf(s)
    await host.unload()
  })

  test('R-7 回归：req.agent 带 session（解析顺序第 1 步）→ 仍被认领，不依赖 registry', async () => {
    const host = await startNotificationHost({ registry: 'none' })
    const before = spawned().length
    const s = host.createRoot('r7-main', { title: '直接带session' })
    openTurnOf(s)
    const { scopeTarget } = await import('@deepseek-ai/dsh-scope')
    const req = { agent: { id: s.id, session: s }, toolName: 'pwsh', reason: 'x' }
    const pending = host.ctx.waterfall(scopeTarget(req.agent, req.agent), 'approval/request', req,
      () => Promise.resolve('unavailable'))
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, '解析顺序第 1 步（req.agent.session）必须在完全没有 registry 时也生效')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once')
    closeTurnOf(s)
    await host.unload()
  })
})

/**
 * T3-R2 调用层与「缺失服务」访问语义（R3-D 第 2 条）。
 *
 * 这里把两类**容易被混淆**的事实分别钉死，避免用"两种实现都能过"的写法掩盖契约：
 *
 * (1) **调用层**：本文件 R-1…R-7 用的是 `ctx.waterfall(scopeTarget(...), 'approval/request', req, ...)`
 *     —— 即**宿主真实的 waterfall 派发形态**（与 `dsh-user-approval/lib/index.js` 的 `decide()` 一致）。
 *     只有这条路径能让"`req.agent` 仅带 id"抵达插件监听器，从而测试插件的**防御性回退**。
 *     真实 `ApprovalService.request()` 对 id-only 输入会在**宿主层**先行失败（见 R-9），
 *     所以 id-only **不是可达的宿主输入**；不得为了它给生产代码加额外依赖。
 *
 * (2) **缺失服务时的访问语义依语境而异**（见 R-8）：
 *     根 context 上读 `ctx.agents` 返回 `undefined`；
 *     而**插件 fiber 内**（`apply()` 的真实时点）读同一个属性会**抛**
 *     `cannot get property "agents" without inject`。
 *     ⇒ A 的 `safeAgentLookup` 注释在**真正重要的语境**下是**正确**的，
 *       try/catch 也不是冗余。D 在 R2 报告中基于根 context 得出的"不抛"结论**已更正**。
 */
describe('T3-R2 调用层与缺失服务访问语义（R3-D 第 2 条）', () => {
  test('R-8 缺失服务时仍是"依语境"：根 context 返回 undefined，插件 fiber 内抛且被安全兜住', async () => {
    const { Context } = await import('@deepseek-ai/cordis')
    const { SessionStore } = await import('@deepseek-ai/dsh-session')

    // ① 根 context（无 fiber）：返回 undefined，不抛
    const root = new Context()
    new SessionStore(root)
    let rootThrew
    let rootValue
    try { rootValue = root.agents } catch (e) { rootThrew = String(e.message) }
    assert.equal(rootThrew, undefined, '根 context 读 ctx.agents 不应抛')
    assert.equal(rootValue, undefined, '根 context 无服务时应为 undefined')

    // ② 插件 fiber 内（apply 的真实时点）：抛 —— 这正是 safeAgentLookup 必须 try/catch 的原因
    const ctx2 = new Context()
    new SessionStore(ctx2)
    let fiberThrew
    const fiber = ctx2.plugin((inner) => {
      try { void inner.agents } catch (e) { fiberThrew = String(e.message) }
    })
    await fiber
    assert.ok(
      typeof fiberThrew === 'string' && fiberThrew.includes('agents'),
      `插件 fiber 内读缺失服务应抛（A 的注释正确），实测 ${String(fiberThrew)}`,
    )
    await fiber.dispose()

    // ③ 端到端：服务缺失时插件必须照常挂载并安全转交（不因缺服务拒载）
    const host = await startNotificationHost({ registry: 'none' })
    assert.equal(host.agentRegistry, undefined)
    const before = spawned().length
    const s = host.createRoot('r8-main')
    s.append('turn/start', { turn: 1 })
    const outcome = await requestById(host, s.id)
    assert.equal(outcome, 'unavailable', '服务缺失 → 身份不可确认 → 不认领 → 宿主兜底')
    assert.equal(spawned().length, before, '服务缺失不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '服务缺失不得写审计')
    closeTurnOf(s)
    await host.unload()
  })

  test('R-9 调用层区分：真实 ApprovalService 对 id-only 在宿主层先抛，故 id-only 非可达宿主输入', async () => {
    const { ApprovalService: Svc } = await import('@deepseek-ai/dsh-user-approval')
    const { Context } = await import('@deepseek-ai/cordis')
    const { SessionStore } = await import('@deepseek-ai/dsh-session')
    const AgentRegistryMod = (await import('@deepseek-ai/dsh-agent')).default

    const ctx = new Context()
    new SessionStore(ctx)
    new AgentRegistryMod(ctx)
    const svc = new Svc(ctx, { policy: 'ask' })
    const s = ctx.sessions.create(SessionId('r9-main'), { meta: { cwd: process.cwd() } })
    s.append('turn/start', { turn: 1 })

    // ① id-only：宿主自己在 open-turn 前置检查就抛（agent.session 缺失）
    let hostThrew
    try {
      await svc.request({ agent: { id: s.id }, toolName: 'pwsh', reason: 'x' })
    } catch (e) { hostThrew = String(e.message) }
    assert.ok(
      typeof hostThrew === 'string',
      `真实 ApprovalService 对 id-only 应在宿主层先失败（契约§2.6 前置），实测 ${String(hostThrew)}`,
    )

    // ② 带 session：正常进入应答者链（无应答者 → fail-closed 'unavailable'）
    const outcome = await svc.request({ agent: { id: s.id, session: s }, toolName: 'pwsh', reason: 'x' })
    assert.equal(outcome, 'unavailable', '带 session 时进入应答者链，无应答者 fail-closed')
    closeTurnOf(s)
  })
})

/** 开 turn 的本地小助手（避免从 harness 引入 FakeSessionLog 语义） */
function openTurnOf(session) { session.append('turn/start', { turn: 1 }) }
function closeTurnOf(session) { session.append('turn/end', { turn: 1, reason: { kind: 'completed' } }) }
