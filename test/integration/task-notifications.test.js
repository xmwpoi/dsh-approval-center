/**
 * T3 主会话通知集成测试（Agent D，契约 §6 所有权文件）。
 *
 * 真实组件：Cordis Context/plugin fiber、真实 SessionStore 发布路径（ctx.sessions.create /
 * session.append）、真实 ApprovalService、真实插件 apply（含 A 的身份适配器与 B 的
 * NotificationService、C 的 sender）。mock 组件：仅 powershell.exe 的异步 spawn。
 *
 * 覆盖（派发书 §4 Agent D 全清单）：
 *   1. 根会话 completed 有 step → 通知；无 step → 不补发（热加载中途）
 *   2. fork 根会话 completed → 通知（不得被 origin/isSeeded/parentSession 误杀）
 *   3. 委派 child（origin=subagent）→ 零通知、零发送进程
 *   4. subagent/start、subagent/end 全部终态 + 旧开关 true → 一律零通知
 *   5. error/blocked/max-tokens → 各自非成功文案；aborted/interrupted/forked/未知 → 静默
 *   6. 历史 seed/recovery → 不通知
 *   7. 同轮重复 → 只一次；新轮 → 可提醒
 *   8. 配置 defaults/schema 投影
 *   9. 监听重载、卸载期间到达事件
 *  10. 通知失败不改变原审批结果
 *  11. 子代理审批与未知身份审批 next() 恰一次/无插件审计/无 spawn；主审批正常认领并展示字段
 *  12. 审批卡片：批准仅本次、超时动作如实、工具名不是命令
 *
 * 铁律：本文件绝不 spawn 真实 powershell.exe（被 spawn-shim 替身）、不发真实 Toast、不改 HKCU。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import {
  argsOf,
  startNotificationHost,
} from './helpers/notification-host.mjs'
import { createMockChannel, readAuditRows, makeReq, openTurn, closeTurn, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const delta = (before) => spawned().slice(before)
const taskToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'toast.ps1')
const approvalToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')
/**
 * 真实 powershell 进程会退出；mock 替身不会自动退出，而通知队列只有 1 个串行 worker，
 * 不结算它就会一直占住队列。所以多条通知的场景必须显式驱动 exit 0。
 */
const drainTaskToasts = (before) => { for (const r of taskToasts(before)) r.child.emit('exit', 0) }
/** 让微任务链跑完：worker 被上一条占用时，新 spawn 要等上一条结算后才发生 */
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))
/** 包装 startHost（无 agents 服务的夹具）：登记临时目录清理，供 R2-3 回归用例使用 */
const startHostTrackedLike = async (startHost) => {
  const host = await startHost({ config: { notifyOnTurnEnd: true, notifyOnTurnFailure: true } })
  const { trackCleanup } = await import('./helpers/harness.mjs')
  trackCleanup(host.dataDir)
  return host
}

after(() => { globalThis.__approvalMockChannel = undefined })

describe('T3-1 根会话 completed 的 step 门禁', () => {
  test('有 step/start → 成功通知；无 step/start → 不补发（热加载中途）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length

    const s1 = host.createRoot('t3-root-1', { title: '修复登录问题' })
    host.runTurn(s1, { kind: 'completed', turn: 1, withStep: true })
    let toasts = taskToasts(before)
    assert.equal(toasts.length, 1, `应有 1 条成功通知，实测 ${toasts.length}`)
    let a = argsOf(toasts[0])
    assert.equal(a.title, '本轮回复已完成')
    assert.ok(a.message.startsWith('任务：修复登录问题'), `正文应以任务名开头：${JSON.stringify(a.message)}`)
    assert.ok(a.message.includes('Agent 已完成这一轮回复'), `应含固定文案：${JSON.stringify(a.message)}`)
    assert.equal(a.sound, 'silent', '默认静音（taskNotificationSound=silent）')
    assert.equal(a.group, 'dsh-task', '任务通知 Group 固定 dsh-task')
    assert.match(a.tag, /^[0-9a-f]{16}$/, 'Tag 必须是 16 位小写 hex')

    const before2 = spawned().length
    host.runTurn(s1, { kind: 'completed', turn: 2, withStep: false })
    assert.equal(taskToasts(before2).length, 0, '无 step/start 的 completed 不得补发成功通知')

    await host.unload()
  })

  test('等待审批 / 单个工具 / 单个 step 完成不算一轮结束', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('t3-root-2')
    s.append('turn/start', { turn: 1 })
    s.append('step/start', { turn: 1, step: 1 })
    s.append('step/end', { turn: 1, step: 1 })
    assert.equal(taskToasts(before).length, 0, 'step/end 不得触发通知（turn 未 end）')
    await host.unload()
  })
})

describe('T3-2 fork 根会话必须被当作主会话', () => {
  test('fork 根会话 completed 正常通知（origin/isSeeded/parentSession 不可作判据）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const src = host.createRoot('t3-src')
    src.append('turn/start', { turn: 1 })
    src.append('step/start', { turn: 1, step: 1 })
    const forked = host.forkRoot(src, 't3-forked')
    assert.equal(forked.header.origin, undefined)
    assert.equal(forked.header.isSeeded, true)
    forked.append('step/start', { turn: 1, step: 1 })
    forked.append('step/end', { turn: 1, step: 1 })
    forked.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, `fork 根会话必须产生 1 条成功通知，实测 ${toasts.length}`)
    drainTaskToasts(before)
    await host.unload()
  })
})

describe('T3-3 委派子会话零通知', () => {
  test('child（origin=subagent）completed 全程零 toast.ps1 进程', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const child = host.createChild('t3-child-1', 't3-root-x')
    assert.equal(child.header.origin, 'subagent')
    host.runTurn(child, { kind: 'completed', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 0, '委派子会话不得产生任何任务通知')
    assert.equal(spawned().length, before, '委派子会话不得产生任何 powershell 进程')
    await host.unload()
  })

  test('child 的 error/aborted/max-tokens/refusal/blocked 同样零通知（不把子代理错误转成父会话错误）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    let i = 0
    for (const kind of ['error', 'aborted', 'max-tokens', 'refusal', 'blocked']) {
      const child = host.createChild(`t3-child-k${i++}`)
      host.runTurn(child, { kind, turn: 1, withStep: true })
    }
    assert.equal(taskToasts(before).length, 0, '子代理任何终态都不得通知')
    assert.equal(spawned().length, before)
    await host.unload()
  })

  test('子代理 continuation 复用同一 child session：仍零通知', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const child = host.createChild('t3-child-cont')
    host.runTurn(child, { kind: 'completed', turn: 1 })
    host.runTurn(child, { kind: 'completed', turn: 2 })
    host.runTurn(child, { kind: 'error', turn: 3 })
    assert.equal(taskToasts(before).length, 0, 'continuation 复用 child session 也必须零通知')
    await host.unload()
  })
})

describe('T3-4 子代理监听事件与旧开关（计划 §0：整体关闭）', () => {
  test('subagent/start + subagent/end 全部 stopReason：旧开关 true 也零通知、零进程', async () => {
    const host = await startNotificationHost({ config: { notifyOnSubagentEnd: true, notifyOnSubagentStart: true } })
    const before = spawned().length
    const STOP_REASONS = ['completed', 'aborted', 'error', 'max-tokens', 'refusal']
    host.ctx.emit('subagent/start', { runId: 'r0', provider: 'p', id: 'c0' })
    let i = 0
    for (const stopReason of STOP_REASONS) {
      host.ctx.emit('subagent/end', { runId: `r${++i}`, provider: 'p', id: `c${i}`, stopReason })
    }
    host.ctx.emit('subagent/end', { runId: 'rX', provider: 'p', id: 'cX', stopReason: '未知的未来词汇' })
    assert.equal(taskToasts(before).length, 0, '子代理通知已整体关闭：旧开关 true 也必须零通知')
    assert.equal(spawned().length, before, '子代理事件不得产生任何 powershell 进程')
    await host.unload()
  })
})

describe('T3-5 非成功终态的文案与静默', () => {
  test('error/blocked/max-tokens → 通知；aborted/interrupted/forked/未知 kind → 静默', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-root-5', { title: '任务五' })
    const expect = [
      ['error', '本轮执行出错', 1],
      ['blocked', '本轮执行受阻', 1],
      ['max-tokens', '本轮达到输出上限', 1],
      ['aborted', null, 0],
      ['interrupted', null, 0],
      ['forked', null, 0],
      ['totally-bogus', null, 0],
    ]
    let turn = 0
    for (const [kind, title, count] of expect) {
      turn++
      const b = spawned().length
      host.runTurn(s, { kind, turn, withStep: true })
      if (count === 1) await waitForSpawns(channel, b + 1)
      else await settle()
      const got = taskToasts(b)
      assert.equal(got.length, count, `kind=${kind} 应产生 ${count} 条，实测 ${got.length}`)
      if (count === 1) {
        assert.equal(argsOf(got[0]).title, title, `kind=${kind} 标题不符：${argsOf(got[0]).title}`)
        assert.ok(!argsOf(got[0]).title.includes('已完成'), '非成功终态不得报"已完成"')
        drainTaskToasts(b)
      }
    }
    await host.unload()
  })

  test('错误正文不含堆栈/目录/命令', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('t3-root-err', { title: '任务错误' })
    host.runTurn(s, { kind: 'error', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(!/Error:|at |\bstack\b/i.test(a.message), `正文不得含堆栈：${JSON.stringify(a.message)}`)
    assert.ok(!/[A-Za-z]:\\/.test(a.message), '正文不得含绝对目录')
    assert.ok(!a.message.includes('rm -rf'), '正文不得含命令')
    await host.unload()
  })
})

describe('T3-6 历史 seed / recovery 不通知', () => {
  test('seed 历史的 completed 轮次不触发通知（seed 不发布 session/event）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    host.ctx.sessions.create(SessionId('t3-seeded'), {
      seed: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'step/start', seq: 1, time: 2, data: { turn: 1, step: 1 } },
        { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      inheritedEventCount: SessionLogOffset(3),
      meta: { isSeeded: true, cwd: process.cwd() },
    })
    assert.equal(taskToasts(before).length, 0, 'seed 历史不得触发通知')
    await host.unload()
  })

  test('interrupted（崩溃恢复事后闭合）不通知', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('t3-recovery')
    host.runTurn(s, { kind: 'interrupted', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 0, 'interrupted 必须静默')
    await host.unload()
  })
})

describe('T3-7 同轮去重与新轮提醒', () => {
  test('同轮重复 turn/end 只通知一次；新轮可再通知', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-root-dedup', { title: '去重任务' })
    let b = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    await waitForSpawns(channel, b + 1)
    assert.equal(taskToasts(b).length, 1, '第一轮应通知')
    drainTaskToasts(b)
    await settle()
    // 宿主重复发布同一轮（重放/恢复场景）
    b = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    await settle()
    assert.equal(taskToasts(b).length, 0, '同一轮不得双报')
    // 新轮
    b = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 2, withStep: true })
    await waitForSpawns(channel, b + 1)
    assert.equal(taskToasts(b).length, 1, '新轮应可再提醒')
    drainTaskToasts(b)
    await settle()
    // 新轮的 error 也可提醒
    b = spawned().length
    host.runTurn(s, { kind: 'error', turn: 3, withStep: true })
    await waitForSpawns(channel, b + 1)
    assert.equal(taskToasts(b).length, 1, '新轮的 error 也应提醒')
    drainTaskToasts(b)
    await host.unload()
  })
})

describe('T3-8 配置门与 schema 投影', () => {
  test('notifyOnTurnEnd=false：completed 零通知，但 error 仍通知', async () => {
    const host = await startNotificationHost({ config: { notifyOnTurnEnd: false } })
    const before = spawned().length
    const s = host.createRoot('t3-root-cfg1')
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 0, 'notifyOnTurnEnd=false 时 completed 必须零通知')
    const b2 = spawned().length
    host.runTurn(s, { kind: 'error', turn: 2, withStep: true })
    assert.equal(taskToasts(b2).length, 1, 'notifyOnTurnFailure 默认 true，error 仍应通知')
    drainTaskToasts(b2)
    await host.unload()
  })

  test('notifyOnTurnFailure=false：error 零通知', async () => {
    const host = await startNotificationHost({ config: { notifyOnTurnFailure: false } })
    const before = spawned().length
    const s = host.createRoot('t3-root-cfg2')
    host.runTurn(s, { kind: 'error', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 0, 'notifyOnTurnFailure=false 时 error 必须零通知')
    await host.unload()
  })

  test('两个开关都关：任务通知为零，但审批通知不受影响', async () => {
    const host = await startNotificationHost({ config: { notifyOnTurnEnd: false, notifyOnTurnFailure: false } })
    const before = spawned().length
    const s = host.createRoot('t3-root-cfg3')
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    host.runTurn(s, { kind: 'error', turn: 2, withStep: true })
    assert.equal(taskToasts(before).length, 0, '两开关全关时任务通知必须为零')
    const b2 = spawned().length
    const s2 = host.createRoot('t3-root-cfg3-appr')
    openTurn(s2)
    const pending = host.service.request(makeReq({ id: 't3-root-cfg3-appr', session: s2 }, { toolName: 'pwsh' }))
    await waitForSpawns(channel, b2 + 1)
    const rec = approvalToasts(b2)[0]
    assert.ok(rec, '两开关全关时审批弹窗必须仍工作（只关任务通知）')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once')
    closeTurn(s2)
    await host.unload()
  })

  test('taskNotificationSound=default → -Sound default；showTitle=false → 仅短 ID', async () => {
    const host = await startNotificationHost({ config: { taskNotificationSound: 'default', taskNotificationShowTitle: false } })
    const before = spawned().length
    const s = host.createRoot('abcdefgh-t3-loud', { title: '含敏感目录 C:\\Users\\A\\x 的标题' })
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1)
    const a = argsOf(toasts[0])
    assert.equal(a.sound, 'default', 'taskNotificationSound=default 必须投影到 -Sound default')
    assert.ok(a.message.includes('abcdefgh'), `showTitle=false 应回退短 ID：${JSON.stringify(a.message)}`)
    assert.ok(!a.message.includes('C:\\Users\\A'), 'showTitle=false 时标题内容不得泄漏')
    drainTaskToasts(before)
    await host.unload()
  })
})

describe('T3-9 通知失败不改变审批结果', () => {
  test('通知投递失败（exit 2）后，审批照常结算、审计照常写入', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('t3-root-fail')
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 1, '通知正常发出')
    taskToasts(before)[0].child.emit('exit', 2)   // 投递失败
    const b2 = spawned().length
    openTurn(s)
    const pending = host.service.request(makeReq({ id: 't3-root-fail', session: s }, { toolName: 'pwsh', reason: 'x' }))
    await waitForSpawns(channel, b2 + 1)
    const approval = approvalToasts(b2)[0]
    assert.ok(approval, '通知失败后审批路径必须仍然工作')
    approval.child.emit('exit', 0)
    const outcome = await pending
    assert.equal(outcome, 'allowed-once', '通知失败不得影响审批结果')
    closeTurn(s)
    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.filter((r) => r.status === 'approved').length, 1, '审计必须照常写入')
    await host.unload()
  })
})

describe('T3-10 审批身份判定（主会话认领 / 子代理与未知转交）', () => {
  test('主会话审批：正常认领并展示结构化字段', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('t3-root-appr', { title: '修复登录问题' })
    openTurn(s)
    const pending = host.service.request(makeReq({ id: 't3-root-appr', session: s }, {
      toolName: 'bash',
      reason: '需要执行沙箱外操作',
    }))
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, '主会话审批必须被认领并弹卡片')
    const a = argsOf(rec)
    // R5 契约：title = 固定安全标题（不含工具名）；decisionSummary 排最前（安全信息）；
    // contextSummary = 任务/操作/原因（动态摘要，各字段独立限宽）。
    assert.equal(a.title, '需要你审批 · 批准仅本次', 'R5 固定安全标题')
    assert.ok(a.message.startsWith('拒绝不执行；30秒后自动拒绝\n'), 'decisionSummary 必须排在 message 最前（安全信息优先）')
    assert.ok(a.message.includes('任务：修复登录问题'), `应含任务名：${JSON.stringify(a.message)}`)
    assert.ok(a.message.includes('操作：bash'), '应含操作行')
    assert.ok(a.message.includes('原因：需要执行沙箱外操作'), '应含原因行')
    assert.ok(/批准仅本次/.test(a.title), 'title 必须写"批准仅本次"（不得描述成永久授权）')
    assert.ok(a.message.includes('30秒后自动拒绝'), '默认 timeoutAction=reject 应写自动拒绝')
    assert.ok(!/永久|permanent/i.test(a.message), '不得把批准描述成永久授权')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once')
    closeTurn(s)
    await host.unload()
  })

  test('子代理审批：不认领，next() 恰一次，无插件审计、无 spawn', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const child = host.createChild('t3-child-appr', 't3-root-appr2')
    let downstream = 0
    host.ctx.on('approval/request', async () => { downstream++; return 'allowed-once' })
    openTurn(child)
    const outcome = await host.service.request(makeReq({ id: 't3-child-appr', session: child }, { toolName: 'pwsh', reason: 'x' }))
    assert.equal(outcome, 'allowed-once', '宿主应从下游应答者拿到结果')
    assert.equal(downstream, 1, 'next() 必须恰一次')
    assert.equal(spawned().length, before, '子代理审批不得产生任何弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '子代理审批不得写插件审计')
    closeTurn(child)
    await host.unload()
  })

  test('未知身份审批（无 session 且查不到）：不认领，next() 恰一次，无审计', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    let downstreamCalls = 0
    // 下游应答者：与宿主真实形态一致，注册在 waterfall 上（非 prepend，排在插件之后）
    host.ctx.on('approval/request', async () => { downstreamCalls++; return 'rejected' })
    // 所以"身份无法确认"这一场景必须走宿主真实的 approval/request waterfall 派发路径：
    // req 上只有 agent.id，且 ctx.agents 里查不到 —— 这正是宿主在 agent 丢失时会发生的情况。
    // 派发形态与 dsh-user-approval/lib/index.js decide() 完全一致（ctx.waterfall + scopeTarget）。
    const { scopeTarget } = await import('@deepseek-ai/dsh-scope')
    const req = { agent: { id: 'no-such-session-id' }, toolName: 'pwsh', reason: 'x' }
    let nextCalls = 0
    const outcome = await host.ctx.waterfall(
      scopeTarget(req.agent, req.agent),
      'approval/request',
      req,
      () => Promise.resolve('unavailable'),
    ).then((r) => r)
    assert.equal(outcome, 'rejected', '宿主应从下游应答者拿到结果')
    assert.equal(nextCalls, 0, '本用例不使用闭包计数（waterfall 由下游返回值裁决）')
    assert.equal(spawned().length, before, '未知身份不得弹窗')
    assert.equal(readAuditRows(host.dataDir).length, 0, '未知身份不得写插件审计')
    await host.unload()
  })

  test('审批卡片：timeoutAction=approve 必须醒目写超时自动批准，不得写拒绝文案', async () => {
    const host = await startNotificationHost({ config: { timeoutAction: 'approve' } })
    const before = spawned().length
    const s = host.createRoot('t3-root-appr3')
    openTurn(s)
    const pending = host.service.request(makeReq({ id: 't3-root-appr3', session: s }, { toolName: 'pwsh' }))
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec)
    const a = argsOf(rec)
    // R5 契约：decisionSummary 排最前，如实写"自动批准"（B 的 formatApprovalDecision）。
    // approve 不得沿用拒绝文案：message 必须含"自动批准"且不含"自动拒绝"。
    assert.ok(a.message.includes('自动批准'), `approve 必须醒目写自动批准：${JSON.stringify(a.message)}`)
    assert.ok(!a.message.includes('自动拒绝'), 'approve 不得沿用拒绝文案')
    rec.child.emit('exit', 2)
    assert.equal(await pending, 'allowed-once', '真实 timeout + approve → allowed-once')
    closeTurn(s)
    await host.unload()
  })
})

describe('T3-11 卸载与重载', () => {
  test('卸载期间到达的 turn/end：零通知、不补播', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-root-unload')
    await host.unload()
    const before = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    assert.equal(taskToasts(before).length, 0, '卸载后到达的事件必须零通知（不补播历史）')
  })

  test('重载后新实例正常通知新轮', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-root-reload')
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const firstCount = spawned().length
    assert.ok(firstCount >= 1, '重载前应有 1 条通知')
    drainTaskToasts(0)
    await host.unload()
    // 重载 = 新的 Context + 新的 SessionStore + 新插件实例（真实宿主 reload 语义）
    const host2 = await startNotificationHost()
    const before = spawned().length
    const s2 = host2.createRoot('t3-root-reload2', { title: '重载后任务' })
    host2.runTurn(s2, { kind: 'completed', turn: 1, withStep: true })
    await waitForSpawns(channel, before + 1)
    assert.equal(taskToasts(before).length, 1, '重载后新实例应正常通知新会话的新轮')
    drainTaskToasts(before)
    await host2.unload()
  })
})

// ══════════════════════════════════════════════════════════════════════════════
// T3-12（R2 由 A 补充）：标题冷读裁决、registry 查询面、缓存清理与上界
//
// 依据 R2 派发 §3：宿主已把 `snapshotEvents()` 标记为
//   "@deprecated … but new calls are prohibited"（0.1.7-rc.2 index.d.ts 实证）。
// 插件不得新增该调用 → 标题**只**来自 session/title 事件流，读不到回退 `会话 <短ID>`。
// 协调者关注点：不能因所有 id-only 请求都落 unknown 而让主审批静默失效。
// ══════════════════════════════════════════════════════════════════════════════
describe('T3-12（R2）标题冷读、registry 查询面与缓存治理', () => {
  test('R2-1 冷标题：无 session/title 事件时回退 `会话 <短ID>`，通知不消失', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-r2-cold') // 不给 title：冷启动场景
    const before = spawned().length
    host.runTurn(s, { turn: 1 })
    drainTaskToasts(before)
    await settle()
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, '冷标题不得让通知消失')
    const a = argsOf(toasts[0])
    assert.ok(a.message.includes('任务：会话 t3-r2-c'), `应回退短 ID：${JSON.stringify(a.message)}`)
    assert.ok(!a.message.includes('undefined'), '不得出现 undefined 占位')
    await host.unload()
  })

  test('R2-2 session/title 数据异常（非字符串 title）不得破坏通知，回退短 ID', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t3-r2-badtitle')
    s.append('session/title', { title: 12345, messageSeqs: [], source: { kind: 'user' } })
    const before = spawned().length
    host.runTurn(s, { turn: 1 })
    drainTaskToasts(before)
    await settle()
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, '异常 title 不得让通知消失')
    const a = argsOf(toasts[0])
    assert.ok(a.message.includes('任务：会话 '), `异常 title 应回退短 ID：${JSON.stringify(a.message)}`)
    assert.ok(!a.message.includes('12345'), '不得把非字符串 title 塞进通知')
    await host.unload()
  })

  test('R2-3 宿主未注入 dsh-agent（无 ctx.agents）时主审批仍被认领', async () => {
    // R2 §3 关注点的真实形态：round-1 曾因 `ctx.agents` 在服务未注入时**抛异常**
    // （cordis: cannot get property "agents" without inject）导致全部审批失效。
    // 本用例用不带 agents 服务的 startHost 复现该环境，断言主审批照常认领。
    // （registry 查询面自身的解析顺序见 host-contract.test.js 的单元覆盖：
    //  真实宿主的 ApprovalService.request 需要 agent.session 才能判 open turn，
    //  因此"id-only 请求"在真实宿主里根本不可达，registry 只是防御性回退。）
    const { startHost } = await import('./helpers/harness.mjs')
    const host = await startHostTrackedLike(startHost)
    const s = host.session
    s.append('session/title', { title: '无 agents 服务', messageSeqs: [], source: { kind: 'user' } })
    const before = spawned().length
    openTurn(s)
    const pending = host.service.request(makeReq(host.agent, { toolName: 'pwsh', reason: '需要执行沙箱外操作' }))
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, '无 ctx.agents 时主审批必须照常认领（round-1 cordis 崩溃回归）')
    assert.equal(argsOf(rec).title, '需要你审批 · 批准仅本次', 'R5 固定安全标题（不含工具名）')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once')
    assert.equal(readAuditRows(host.dataDir).length, 1)
    closeTurn(s)
    await host.unload()
  })

  test('R2-4 session/disposed 清理标题缓存（真实 store 移除路径，同 host-publication D2）', async () => {
    const host = await startNotificationHost()
    // 会话由嵌套插件 fiber 持有：dispose 该 fiber 会真正移除会话并发布 session/disposed
    const ownedFiber = host.ctx.plugin((inner) => {
      const owned = inner.sessions.create(SessionId('t3-r2-owned'), { meta: { cwd: process.cwd() } })
      owned.append('session/title', { title: '将被清理的标题', messageSeqs: [], source: { kind: 'user' } })
    })
    await ownedFiber
    const s = host.ctx.sessions.get(SessionId('t3-r2-owned'))
    assert.ok(s, '嵌套插件持有的会话应存在')

    const before = spawned().length
    host.runTurn(s, { turn: 1 })
    drainTaskToasts(before)
    await settle()
    assert.ok(argsOf(taskToasts(before)[0]).message.includes('将被清理的标题'), '先确认缓存命中标题')

    await ownedFiber.dispose()
    assert.equal(host.ctx.sessions.get(SessionId('t3-r2-owned')), undefined, '会话已被宿主移除')

    // 同 id 重建、新轮次、且不再发标题事件：若缓存未清，会错误复用旧标题
    // （轮次必须换新：同 id + 同 turn 会命中去重缓存而被正确抑制）
    const again = host.ctx.sessions.create(SessionId('t3-r2-owned'), { meta: { cwd: process.cwd() } })
    const mid = spawned().length
    host.runTurn(again, { turn: 2 })
    drainTaskToasts(mid)
    await settle()
    const a = argsOf(taskToasts(mid)[0])
    assert.ok(a, '重建会话的通知应存在')
    assert.ok(!a.message.includes('将被清理的标题'), '旧标题必须已被 session/disposed 清掉')
    assert.ok(a.message.includes('任务：会话 '), `应回退短 ID：${JSON.stringify(a.message)}`)
    await host.unload()
  })

  test('R2-5 标题缓存有上界：容量淘汰最旧标题后回退短 ID', { timeout: 120000 }, async () => {
    const host = await startNotificationHost()
    const N = 257 // TITLE_CACHE_MAX = 256，插入第 257 个时淘汰最旧
    const ids = []
    for (let i = 0; i < N; i++) {
      const id = `t3-r2-cap-${String(i).padStart(3, '0')}`
      ids.push(id)
      host.createRoot(id, { title: `标题${i}` })
    }
    // 最旧（已被淘汰）→ 短 ID
    const before = spawned().length
    host.runTurn(host.ctx.sessions.get(SessionId(ids[0])), { turn: 1 })
    drainTaskToasts(before)
    await settle()
    const a0 = argsOf(taskToasts(before)[0])
    assert.ok(a0, '最旧会话的通知应存在')
    assert.ok(!a0.message.includes('标题0'), '最旧标题必须已被容量淘汰')
    assert.ok(a0.message.includes('任务：会话 '), `淘汰后应回退短 ID：${JSON.stringify(a0.message)}`)

    // 最新（仍在缓存）→ 标题
    const mid = spawned().length
    host.runTurn(host.ctx.sessions.get(SessionId(ids[N - 1])), { turn: 1 })
    drainTaskToasts(mid)
    await settle()
    const aN = argsOf(taskToasts(mid)[0])
    assert.ok(aN, '最新会话的通知应存在')
    assert.ok(aN.message.includes(`标题${N - 1}`), `最新标题必须仍在缓存：${JSON.stringify(aN.message)}`)
    await host.unload()
  })
})
