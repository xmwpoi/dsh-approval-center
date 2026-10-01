/**
 * T3-T 标题读取、回退与缓存清理集成测试（Agent D，R3 按契约裁决改写）。
 *
 * **R3 契约裁决（取代 R1/R2 的两种实现均可过写法）**：
 *   标题方案 = **事件缓存 + 短 ID 回退**；**冷 seed 不读 title**；收到实时 `session/title` 后再更新；
 *   审批卡片与完成/错误通知**共用同一缓存与隐私设置**。
 *   依据：宿主 `@deepseek-ai/dsh-session@0.1.7-rc.2` 已把同步事件读取标记为
 *   `@deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.`
 *   （`lib/types/index.d.ts:186-189`，`eventAt()`/`ownEvents()` 同）。因此插件**不得新增**
 *   `snapshotEvents()` 调用，冷标题显示短 ID 是**已接受限制**（R3 派发书 §复查事实与裁决）。
 *
 * ⚠ 本文件**刻意不写"两种实现都能过"的宽松断言**：冷 seed 场景必须**明确期望短 ID**，
 *   否则就掩盖了"是否偷偷新增了被禁止的 snapshotEvents 调用"。
 *
 * 覆盖：
 *   T-1 冷 seed 里的标题**不得**被读取 → 期望短 ID（契约裁决的反向断言）
 *   T-1b 收到实时 title 后 → 标题更新；且审批卡片与完成通知**共用**该缓存
 *   T-2 完全无标题 → 短 ID 回退
 *   T-3 标题为空白/欺骗字符 → 短 ID 回退
 *   T-4 session/disposed 后同 id 重建（无标题）→ 不得泄漏旧标题
 *   T-5 缓存容量淘汰后行为仍正确（不串标题）
 *   T-6 监听卸载/重载 → titleCache 清理，无陈旧标题
 *   T-7 回归：带标题的委派子会话仍零通知 —— 标题路径不得绕过主/子身份门
 *
 * 铁律：不 spawn 真实 powershell.exe、不发真实 Toast、不改 HKCU；
 *       任何用例都不得为绿而放宽 `origin === 'subagent'` 判据。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const delta = (before) => spawned().slice(before)
const taskToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'toast.ps1')
const approvalToasts = (before) => delta(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')
const drain = (before) => { for (const r of taskToasts(before)) r.child.emit('exit', 0) }
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))

after(() => { globalThis.__approvalMockChannel = undefined })

describe('T3-T 标题：事件缓存 + 短 ID 回退（R3 契约裁决）', () => {
  test('T-1 冷 seed 里的标题不得被读取 → 必须回退短 ID（拒绝 snapshotEvents 冷读）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    // 标题只存在于 seed 历史；本进程从未发布过 session/title 事件。
    // 契约裁决：插件不得用 snapshotEvents() 冷读，因此这里**必须**是短 ID。
    const s = host.ctx.sessions.create(SessionId('abcdefgh-t1-cold'), {
      seed: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'session/title', seq: 1, time: 2, data: { title: 'seed里的旧标题', messageSeqs: [], source: { kind: 'user' } } },
        { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      inheritedEventCount: SessionLogOffset(3),
      meta: { isSeeded: true, cwd: process.cwd() },
    })
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const toasts = taskToasts(before)
    assert.equal(toasts.length, 1, 'completed 有 step 应通知')
    const a = argsOf(toasts[0])
    assert.ok(
      !a.message.includes('seed里的旧标题'),
      `契约禁止 snapshotEvents 冷读：seed 标题不得出现，实测 ${JSON.stringify(a.message)}`,
    )
    assert.ok(
      a.message.includes('任务：会话 abcdefgh'),
      `冷 seed 必须回退短 ID，实测 ${JSON.stringify(a.message)}`,
    )
    drain(before)
    await host.unload()
  })

  test('T-1b 收到实时 title 后更新；审批卡片与完成通知共用同一缓存与隐私设置', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t1b-shared')   // createRoot 会追加真实 session/title 事件
    // ① 先发实时 title → 完成通知应带上它
    s.append('session/title', { title: '共享标题', messageSeqs: [], source: { kind: 'user' } })
    const b1 = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const t1 = argsOf(taskToasts(b1)[0])
    assert.ok(t1.message.includes('任务：共享标题'), `实时 title 后完成通知应更新：${JSON.stringify(t1.message)}`)

    // ② 同一会话的审批卡片必须共用同一缓存（不得各读一处）
    const b2 = spawned().length
    s.append('turn/start', { turn: 2 })
    const pending = host.ctx.waterfall(
      (await import('@deepseek-ai/dsh-scope')).scopeTarget(s, s),
      'approval/request',
      { agent: { id: s.id, session: s }, toolName: 'pwsh', reason: 'x' },
      () => Promise.resolve('unavailable'),
    )
    await waitForSpawns(channel, b2 + 1)
    const card = argsOf(approvalToasts(b2)[0])
    assert.ok(card.message.includes('任务：共享标题'), `审批卡片必须共用缓存：${JSON.stringify(card.message)}`)
    approvalToasts(b2)[0].child.emit('exit', 0)
    await pending
    s.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    drain(b1)
    drain(b2)
    await host.unload()
  })

  test('T-1c showTitle=false 时完成通知与审批卡片**同时**只用短 ID（共用隐私设置）', async () => {
    const host = await startNotificationHost({ config: { taskNotificationShowTitle: false } })
    const s = host.createRoot('abcdefgh-t1c', { title: '不该泄漏的标题' })
    const b1 = spawned().length
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const t1 = argsOf(taskToasts(b1)[0])
    assert.ok(t1.message.includes('任务：会话 abcdefgh'), `完成通知应短 ID：${JSON.stringify(t1.message)}`)
    assert.ok(!t1.message.includes('不该泄漏的标题'), '完成通知不得泄漏标题')

    const b2 = spawned().length
    s.append('turn/start', { turn: 2 })
    const pending = host.ctx.waterfall(
      (await import('@deepseek-ai/dsh-scope')).scopeTarget(s, s),
      'approval/request',
      { agent: { id: s.id, session: s }, toolName: 'pwsh', reason: 'x' },
      () => Promise.resolve('unavailable'),
    )
    await waitForSpawns(channel, b2 + 1)
    const card = argsOf(approvalToasts(b2)[0])
    assert.ok(card.message.includes('任务：会话 abcdefgh'), `审批卡片应短 ID：${JSON.stringify(card.message)}`)
    assert.ok(!card.message.includes('不该泄漏的标题'), '审批卡片不得泄漏标题（共用隐私设置）')
    approvalToasts(b2)[0].child.emit('exit', 0)
    await pending
    s.append('turn/end', { turn: 2, reason: { kind: 'completed' } })
    drain(b1)
    drain(b2)
    await host.unload()
  })

  test('T-2 会话完全无标题 → 短 ID 回退', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('abcdefgh-t2-notitle')
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(a.message.includes('任务：会话 abcdefgh'), `无标题应回退短 ID：${JSON.stringify(a.message)}`)
    drain(before)
    await host.unload()
  })

  test('T-3 标题为空白/欺骗字符 → 短 ID 回退（不得把空白当标题）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('abcdef12-t3-blank')
    s.append('session/title', { title: ' \u200b\u202e \t ', messageSeqs: [], source: { kind: 'user' } })
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    const titlePart = a.message.split('\n')[0]
    assert.ok(
      titlePart.includes('会话 abcdef12') || titlePart.trim() === '任务：',
      `空白/欺骗字符标题必须回退短 ID，实测：${JSON.stringify(titlePart)}`,
    )
    drain(before)
    await host.unload()
  })

  test('T-4 session/disposed 后同 id 重建（无标题）→ 不得泄漏旧标题', async () => {
    const host = await startNotificationHost()
    let first
    const f1 = host.ctx.plugin((inner) => {
      first = inner.sessions.create(SessionId('t4-dup'), { meta: { cwd: process.cwd() } })
      first.append('session/title', { title: '旧标题会话', messageSeqs: [], source: { kind: 'user' } })
      // 不能 return 任何值 —— cordis 会把返回值当 effect（实测 "Invalid effect"）
    })
    await f1
    assert.ok(first, '第一段会话已创建')
    await f1.dispose()   // 触发 session/disposed → 插件必须清掉 titleCache 的 't4-dup'
    await settle()

    const s2 = host.createRoot('t4-dup')
    assert.notEqual(s2, first)
    const before = spawned().length
    host.runTurn(s2, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(!a.message.includes('旧标题会话'), `同 id 重建后不得泄漏旧标题：${JSON.stringify(a.message)}`)
    assert.ok(a.message.includes('任务：会话 t4-dup'), `应回退短 ID：${JSON.stringify(a.message)}`)
    drain(before)
    await host.unload()
  })

  test('T-5 缓存容量上界：淘汰者回退短 ID、保留者仍是自己的标题（不串位、不陈旧）', async () => {
    const host = await startNotificationHost()
    // A 的 TITLE_CACHE_MAX = 256；造 300 个带实时 title 的会话触发容量淘汰。
    // 契约裁决下淘汰的行为是**已接受**的：该会话回退短 ID，而**不是**显示别人的标题。
    const sessions = []
    for (let i = 0; i < 300; i++) sessions.push(host.createRoot(`t5-cap-${i}`, { title: `容量标题${i}` }))

    /** 探测一个会话：返回它本轮通知的 message */
    const probe = async (idx) => {
      const b = spawned().length
      host.runTurn(sessions[idx], { kind: 'completed', turn: 1, withStep: true })
      const toasts = taskToasts(b)
      assert.equal(toasts.length, 1, `会话 ${idx} 应通知`)
      const msg = argsOf(toasts[0]).message
      drain(b)
      await settle()   // worker 串行
      return msg
    }

    // ① 最早创建的会话（必被淘汰）→ 必须回退自己的短 ID，且不得显示任何"容量标题N"
    const evicted = await probe(0)
    assert.ok(
      evicted.includes('任务：会话 t5-cap-0'),
      `被淘汰会话必须回退自己的短 ID：${JSON.stringify(evicted)}`,
    )
    assert.ok(!/容量标题\d+/.test(evicted), `被淘汰会话不得显示任何缓存标题：${JSON.stringify(evicted)}`)

    // ② 最近创建的会话（必被保留）→ 必须是自己的标题
    const kept = await probe(299)
    assert.ok(kept.includes('任务：容量标题299'), `保留会话应是自己的标题：${JSON.stringify(kept)}`)

    // ③ 中段抽样：不得出现"张冠李戴"
    const mid = await probe(299 - 100)
    assert.ok(
      mid.includes(`任务：容量标题${299 - 100}`),
      `中段会话标题不得串位：${JSON.stringify(mid)}`,
    )
    await host.unload()
  })

  test('T-6 卸载/重载：titleCache 清理，新实例同 id 无实时 title → 短 ID（无陈旧标题）', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t6-reload', { title: '重载前标题' })
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    drain(0)
    await host.unload()   // 插件 effect 会 titleCache.clear()

    const host2 = await startNotificationHost()
    const before = spawned().length
    const s2 = host2.createRoot('t6-reload')   // 同 id，新实例，无实时 title
    host2.runTurn(s2, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(!a.message.includes('重载前标题'), `重载后不得沿用上一实例的标题：${JSON.stringify(a.message)}`)
    assert.ok(a.message.includes('任务：会话 t6-reloa'), `应回退短 ID（前 8 位）：${JSON.stringify(a.message)}`)
    drain(before)
    await host2.unload()
  })

  test('T-7 回归：带标题的委派子会话仍零通知 —— 标题路径不得绕过主/子身份门', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const child = host.createChild('t7-child')
    child.append('session/title', { title: '子代理的标题', messageSeqs: [], source: { kind: 'fallback' } })
    host.runTurn(child, { kind: 'completed', turn: 1, withStep: true })
    host.runTurn(child, { kind: 'error', turn: 2, withStep: true })
    assert.equal(taskToasts(before).length, 0, '带标题的子会话仍必须零通知（身份门不得被标题路径绕过）')
    assert.equal(spawned().length, before, '不得产生任何 powershell 进程')
    await host.unload()
  })
})
