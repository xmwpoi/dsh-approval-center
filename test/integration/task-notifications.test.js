/**
 * 主对话完成/错误通知集成测试（T0 契约 §3.1 触发矩阵 + §3.3 去重）。
 *
 * 走宿主真实 Cordis 派发路径（ctx.emit('session/event', …)），不直接调用插件监听器；
 * 通知 sender 是真实的 C 实现，只有 powershell.exe 被 spawn-shim 拦截（绝不弹真实 Toast）。
 *
 * 注意：FakeSessionLog.append 只写日志不发布；本文件必须显式 publishSessionEvent。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  createMockChannel,
  publishSessionEvent,
  readAuditRows,
  startHostTracked,
  toastArgsOf,
  waitForSpawns,
} from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const deltaSpawns = (before) => spawned().slice(before)

/** 取本次 delta 里的任务通知（-File 的最后一段必须精确等于 toast.ps1，
 *  这样才不会把 approval-toast.ps1 误算进来）。 */
const taskToasts = (records) => records.map((record) => {
  const a = toastArgsOf(record)
  const seg = String(a.script ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop()
  if (seg !== 'toast.ps1') return null
  // 共享 toastArgsOf 只取审批路径的旗标；任务通知的 Tag/Group/Sound 在这里补齐。
  const flag = (name) => {
    const i = record.args.indexOf(name)
    return i >= 0 ? record.args[i + 1] : undefined
  }
  return { ...a, tag: flag('-Tag'), group: flag('-Group'), sound: flag('-Sound') }
}).filter(Boolean)
/** sender 是异步等待子进程退出的：spawn 出现后要驱动 exit(0) 才会结算。 */
async function settleTaskToast(before, count) {
  await waitForSpawns(channel, before + count)
  for (let i = 0; i < count; i++) spawned()[before + i].child.emit('exit', 0)
}

describe('主会话完成通知（§3.1：completed 且观察到 step/start）', () => {
  test('turn/start → step/start → turn/end(completed)：恰 1 条任务通知', async () => {
    const host = await startHostTracked()
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await settleTaskToast(before, 1)

    const toasts = taskToasts(deltaSpawns(before))
    assert.equal(toasts.length, 1, `恰 1 条任务通知，实际 ${toasts.length}`)
    assert.equal(toasts[0].title, '本轮回复已完成')
    assert.ok(toasts[0].message.includes('任务：'), '正文含任务名')
    assert.ok(toasts[0].message.includes('Agent 已完成这一轮回复'), '成功文案')
    assert.equal(toasts[0].sound, 'silent', '默认静音')
    assert.equal(toasts[0].group, 'dsh-task', 'Group 固定 dsh-task')
    assert.match(toasts[0].tag, /^[0-9a-f]{16}$/, 'Tag 为 16 位小写 hex')
    // 隐私：正文不含回答/命令/路径
    assert.ok(!toasts[0].message.includes('D:\\'), '不得含绝对路径')
    await host.unload()
  })

  test('completed 但未观察到 step/start：不补发（热加载中途接入）', async () => {
    const host = await startHostTracked()
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(taskToasts(deltaSpawns(before)).length, 0, '无 step 不发成功通知')
    await host.unload()
  })

  test('error / blocked / max-tokens：各发一条非成功通知（不受 step 门禁约束）', async () => {
    const want = { error: '本轮执行出错', blocked: '本轮执行受阻', 'max-tokens': '本轮达到输出上限' }
    for (const [kind, title] of Object.entries(want)) {
      const host = await startHostTracked()
      const before = spawned().length
      publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
      publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind } } })
      await settleTaskToast(before, 1)
      const toasts = taskToasts(deltaSpawns(before))
      assert.equal(toasts.length, 1, `${kind} 应有 1 条通知`)
      assert.equal(toasts[0].title, title)
      assert.ok(!toasts[0].title.includes('已完成'), `${kind} 不得谎报成功`)
      assert.ok(toasts[0].message.includes('请返回 DSH 查看详情'), `${kind} 用失败正文`)
      await host.unload()
    }
  })

  test('aborted / interrupted / forked / 未知 kind：一律静默', async () => {
    const host = await startHostTracked()
    const before = spawned().length
    for (const kind of ['aborted', 'interrupted', 'forked', 'something-new']) {
      publishSessionEvent(host, { type: 'turn/start', data: { turn: 2 } })
      publishSessionEvent(host, { type: 'turn/end', data: { turn: 2, reason: { kind } } })
    }
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(taskToasts(deltaSpawns(before)).length, 0, '非成功终态与未知 kind 一律零通知')
    await host.unload()
  })
})

describe('去重与子代理过滤（§3.3/§3.1）', () => {
  test('同一轮重复 turn/end：只提醒一次；新一轮可再次提醒', async () => {
    const host = await startHostTracked()
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await settleTaskToast(before, 1)
    assert.equal(taskToasts(deltaSpawns(before)).length, 1, '同轮重复只提醒一次')

    const mid = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 2 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 2, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await settleTaskToast(mid, 1)
    assert.equal(taskToasts(deltaSpawns(mid)).length, 1, '新一轮可再次提醒')
    await host.unload()
  })

  test('subagent 会话（origin=subagent）：任何终态零通知、零进程、零审计', async () => {
    const host = await startHostTracked({ sessionId: 'child-1', origin: 'subagent' })
    const before = spawned().length
    for (const kind of ['completed', 'error', 'blocked', 'max-tokens']) {
      publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
      publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
      publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind } } })
    }
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(deltaSpawns(before).length, 0, '子代理事件不得产生任何 PowerShell 进程')
    assert.equal(readAuditRows(host.dataDir).length, 0, '子代理通知不写审计')
    await host.unload()
  })

  test('旧开关 notifyOnSubagentStart/End=true：强制无效（不能只改默认值）', async () => {
    const host = await startHostTracked({ config: { notifyOnSubagentEnd: true, notifyOnSubagentStart: true } })
    const before = spawned().length
    host.ctx.emit('subagent/end', { runId: 'r', provider: 'p', id: 'c', stopReason: 'completed' })
    host.ctx.emit('subagent/start', { runId: 'r', provider: 'p', id: 'c' })
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(deltaSpawns(before).length, 0, '弃用开关即使为 true 也零通知')
    await host.unload()
  })
})

describe('配置门与生命周期（§4.5 / §3.3 close）', () => {
  test('notifyOnTurnEnd=false：completed 静默，但 error 仍通知', async () => {
    const host = await startHostTracked({ config: { notifyOnTurnEnd: false } })
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(taskToasts(deltaSpawns(before)).length, 0, '关闭成功通知后 completed 静默')

    const mid = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 2 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } })
    await settleTaskToast(mid, 1)
    assert.equal(taskToasts(deltaSpawns(mid)).length, 1, 'notifyOnTurnFailure 默认开，error 仍通知')
    await host.unload()
  })

  test('卸载后到达的事件：零通知、无悬挂', async () => {
    const host = await startHostTracked()
    await host.unload()
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((r) => setTimeout(r, 40))
    assert.equal(deltaSpawns(before).length, 0, '卸载后监听已注销，零通知')
  })

  test('标题回读：session/title 事件更新任务名；taskNotificationShowTitle=false 只显示短 ID', async () => {
    const host = await startHostTracked()
    publishSessionEvent(host, { type: 'session/title', data: { title: '修复登录问题' } })
    const before = spawned().length
    publishSessionEvent(host, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await settleTaskToast(before, 1)
    const toasts = taskToasts(deltaSpawns(before))
    assert.equal(toasts.length, 1)
    assert.ok(toasts[0].message.includes('任务：修复登录问题'), `应显示标题，实际：${toasts[0].message}`)
    await host.unload()

    const host2 = await startHostTracked({ config: { taskNotificationShowTitle: false } })
    publishSessionEvent(host2, { type: 'session/title', data: { title: '修复登录问题' } })
    const before2 = spawned().length
    publishSessionEvent(host2, { type: 'turn/start', data: { turn: 1 } })
    publishSessionEvent(host2, { type: 'step/start', data: { turn: 1, step: 1 } })
    publishSessionEvent(host2, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await settleTaskToast(before2, 1)
    const t2 = taskToasts(deltaSpawns(before2))
    assert.equal(t2.length, 1)
    assert.ok(t2[0].message.includes('任务：会话 '), `关闭标题后只显示短 ID：${t2[0].message}`)
    assert.ok(!t2[0].message.includes('修复登录问题'), '不得泄漏标题')
    await host2.unload()
  })
})
