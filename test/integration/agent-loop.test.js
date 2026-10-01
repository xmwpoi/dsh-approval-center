/**
 * R5-D 真实 agent-loop 集成测试（Agent D）。
 *
 * **证据层级（R5-D 第 56/62 条明确要求分层）**：
 *   本文件的每一例都是 **真实 agent-loop**：turn/start、step/start、assistant/message、
 *   turn/end 全部由真实 `@deepseek-ai/dsh-agent-loop` 产出，模型侧用**确定性 adapter**
 *   （真实 `LlmAdapter` 契约 + 真实 `ctx.llm.registerAdapter`）。
 *   sender 仍为 mock（spawn-shim）。**这不是生产模型体验已验**，也不是通道级实机；
 *   它证明的是"真实 loop → 插件 session/event → 通知"这条路径。
 *
 * 覆盖：
 *   L-1 真实完成一轮 → 插件发成功通知（turn/end completed + step 门禁满足）
 *   L-2 adapter 抛错 → 真实 error 终态（loop 产出 turn/end error）→ 插件发错误通知
 *   L-3 用户取消 → aborted → 插件静默
 *   L-4 回归：同一树里审批照常工作（身份门/审计不回归）
 *
 * 铁律：不 spawn 真实 powershell.exe（spawn-shim）、不发真实 Toast、不改 HKCU、
 *       不外呼、不用生产凭据；**绝不手工 append turn/end 冒充 loop**。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { startLoopHost, waitForEvent } from './helpers/deterministic-loop.mjs'
import { argsOf } from './helpers/notification-host.mjs'
import { createMockChannel, readAuditRows, makeReq, openTurn, closeTurn, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const delta = (before) => spawned().slice(before)
const taskToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'toast.ps1')
const approvalToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')
const drainTaskToasts = (before) => { for (const r of taskToasts(before)) r.child.emit('exit', 0) }
const drain = drainTaskToasts
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))

after(() => { globalThis.__approvalMockChannel = undefined })

describe('R5-L 真实 agent-loop（确定性模型）→ 插件通知', () => {
  test('L-1 真实完成一轮 → turn/end completed（loop 产出）→ 成功通知', async () => {
    const host = await startLoopHost({
      script: () => ({ text: '本轮任务已完成。' }),
    })
    const before = spawned().length
    const agent = await host.createMain('r5-l1-main')

    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'please do the task' }], source: { kind: 'user' } }))

    const turnEnd = await waitForEvent(host.events, (e) => e.id === 'r5-l1-main' && e.type === 'turn/end')
    assert.equal(turnEnd.data?.reason?.kind, 'completed', `真实 loop 应产出 completed，实测 ${JSON.stringify(turnEnd.data?.reason)}`)
    assert.equal(host.adapter.callCount, 1, '确定性 adapter 应被真实调用 1 次')

    // 插件经真实 session/event 观察到 completed，且该轮有 step/start → 成功通知
    await waitForSpawns(channel, before + 1)
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, `应有 1 条成功通知，实测 ${toasts.length}`)
    const a = argsOf(toasts[0])
    assert.equal(a.title, '本轮回复已完成')
    assert.equal(a.sound, 'silent', '默认静音')
    assert.equal(a.group, 'dsh-task', 'Group 固定 dsh-task')
    assert.match(a.tag, /^[0-9a-f]{16}$/)
    drain(before)
    await host.unload()
    host.cleanup()
  })

  test('L-2 adapter 抛错 → 真实 error 终态（loop 产出 turn/end error）→ 错误通知', async () => {
    const host = await startLoopHost({
      script: () => { throw new Error('deterministic model failure') },
    })
    const before = spawned().length
    const agent = await host.createMain('r5-l2-main')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'do it' }], source: { kind: 'user' } }))

    const turnEnd = await waitForEvent(host.events, (e) => e.id === 'r5-l2-main' && e.type === 'turn/end')
    assert.equal(turnEnd.data?.reason?.kind, 'error', `模型失败必须走真实 error 终态（loop 产出），实测 ${JSON.stringify(turnEnd.data?.reason)}`)
    assert.ok(turnEnd.data?.reason?.error, 'error 终态应携带 LlmFailure')

    // 插件经真实 session/event 观察到 error → 错误通知（error 不受 step 门禁约束）
    await waitForSpawns(channel, before + 1)
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, 'error 应产生 1 条错误通知')
    const a = argsOf(toasts[0])
    assert.equal(a.title, '本轮执行出错', '错误通知标题')
    assert.ok(!a.message.includes('deterministic model failure'), '原始错误信息不得进通知正文')
    drain(before)
    await host.unload()
    host.cleanup()
  })

  test('L-3 用户取消 → 真实 aborted 终态 → 插件静默', async () => {
    const host = await startLoopHost({
      script: () => ({ text: 'slow response' }),
    })
    const before = spawned().length
    const agent = await host.createMain('r5-l3-main')
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'long task' }], source: { kind: 'user' } }))

    // 等 turn/start 出现（真实 turn 已开），再取消
    await waitForEvent(host.events, (e) => e.id === 'r5-l3-main' && e.type === 'turn/start')
    agent.cancel({ kind: 'user' })

    const turnEnd = await waitForEvent(host.events, (e) => e.id === 'r5-l3-main' && e.type === 'turn/end')
    assert.equal(turnEnd.data?.reason?.kind, 'aborted', `取消应产出真实 aborted，实测 ${JSON.stringify(turnEnd.data?.reason)}`)

    await settle()
    assert.equal(taskToasts(before).length, 0, 'aborted 必须静默（用户取消不通知）')
    assert.equal(spawned().length, before, 'aborted 不得产生任何 powershell 进程')
    await host.unload()
    host.cleanup()
  })

  test('L-4 回归：同一树里审批照常工作（身份门/审计不回归）', async () => {
    const host = await startLoopHost({ script: () => ({ text: 'ok' }) })
    const s = await host.createMain('r5-l4-main')
    const before = spawned().length

    // 审批路径（同一宿主、同一 ctx）
    openTurn(s.session ?? s)
    const pending = host.ctx.waterfall(
      (await import('@deepseek-ai/dsh-scope')).scopeTarget(s, s),
      'approval/request',
      makeReq({ id: s.id, session: s.session ?? s }, { toolName: 'pwsh', reason: 'x' }),
      () => Promise.resolve('unavailable'),
    )
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, '真实 loop 宿主里审批必须照常认领')
    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once')
    closeTurn(s.session ?? s)

    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.filter((r) => r.status === 'approved').length, 1, '审计不回归')

    // 再走一轮真实完成，确认两条路径共存
    agent_followup(s, 'another turn')
    const turnEnd = await waitForEvent(host.events, (e) => e.id === 'r5-l4-main' && e.type === 'turn/end' && e.data?.reason?.kind === 'completed')
    assert.ok(turnEnd, '审批后真实 loop 仍可完成一轮')
    drain(0)
    await host.unload()
    host.cleanup()
  })
})

/** 用 agent id 找回 agent 并提交输入（真实 loop 入口） */
async function agent_followup(sessionOrAgent, text) {
  const agent = sessionOrAgent
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
}
