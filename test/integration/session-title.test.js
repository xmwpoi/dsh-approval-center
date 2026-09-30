/**
 * T3-T 标题读取、回退与缓存清理集成测试（Agent D）。
 *
 * 背景与证据（R2-D 第 4 条）：
 *   目标版 `@deepseek-ai/dsh-session@0.1.7-rc.2` 对同步事件读取的原文（lib/types/index.d.ts:186-189）：
 *     @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.
 *     See the [Agent Note](.../2026-09-09-deprecate-synchronous-session-event-reads.md).
 *   同样标记的还有 `eventAt()` 与 `ownEvents()`。
 *   受支持且**无**弃用标记的公开读取：`SessionTitleService.get(session)`
 *   （dsh-session-title/lib/types/index.d.ts:123，返回 SessionTitleSnapshot 含 `title`）。
 *   ⚠ API 选择（snapshotEvents 例外 vs 改走 sessionTitle 服务 vs 只做短 ID 回退）
 *     属 **A 的契约修订**，D 不擅自定；本文件只固化**可观察行为**，两种实现下都应成立。
 *
 * 覆盖（R2-D 第 4 条全清单）：
 *   T-1 冷读：seed 里已有标题、无实时 title 事件 → 通知仍带该标题
 *   T-2 完全无标题 → 短 ID 回退
 *   T-3 标题为空白/不可用 → 短 ID 回退（不得把空白当标题）
 *   T-4 session/disposed 后同 id 重建（无标题）→ 不得泄漏旧标题（缓存必须清理）
 *   T-5 缓存容量淘汰后行为仍正确（冷读重取，不得出现错标题/串标题）
 *   T-6 监听卸载/重载：titleCache 清理，新实例同 id 无标题 → 短 ID（无陈旧标题）
 *   T-7 回归：带标题的委派子会话仍零通知 —— 标题路径不得绕过主/子身份门
 *
 * 铁律：不 spawn 真实 powershell.exe、不发真实 Toast、不改 HKCU；
 *       任何用例都不得为了绿而放宽 origin === 'subagent' 判据。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const taskToasts = (before) => spawned().slice(before).filter((r) => argsOf(r).script === 'toast.ps1')
const drain = (before) => { for (const r of taskToasts(before)) r.child.emit('exit', 0) }
const settle = () => new Promise((r) => setImmediate(() => setImmediate(r)))

after(() => { globalThis.__approvalMockChannel = undefined })

describe('T3-T 标题读取、回退与缓存清理', () => {
  test('T-1 冷读受限（R3 裁决）：标题只在 seed 历史 → 短 ID 回退，不补读历史', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    // 冷会话：标题在 seed 里，本进程从未发布过 session/title
    const s = host.ctx.sessions.create(SessionId('t1-cold'), {
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
    // R3 裁决（派发 §13 / 契约 §2.5）：snapshotEvents() 已被宿主标记
    // deprecated "new calls are prohibited"，插件不得新增调用 → 冷读路径已删除，
    // 标题只来自实时 session/title 事件流，"冷标题显示短 ID" 是**已接受限制**。
    // 本用例由 D 原先的"冷读应取 seed 标题"改为断言裁决后行为；
    // 保留 D 的语义：seed 事件不发布（host-publication A2）、且不得泄漏进通知。
    assert.ok(
      !a.message.includes('seed里的旧标题'),
      `seed 历史标题不得被冷读出来：${JSON.stringify(a.message)}`,
    )
    assert.ok(a.message.includes('任务：会话 t1-cold'), `应回退短 ID：${JSON.stringify(a.message)}`)
    drain(before)
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

  test('T-3 标题事件为空白文本 → 短 ID 回退（不得把空白当标题）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const s = host.createRoot('abcdef12-t3-blank')
    // 宿主自身会拒绝空标题（SessionTitleInvalidError），但插件必须对
    // "取到的标题归一化后为空" 也有防御 —— 这里用带不可见字符的标题近似：
    // 归一化后为空白/控制字符 → 必须回退短 ID，而不是显示一串乱码。
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
    // 第一段：带标题的会话，随后 dispose（真实 session/disposed 路径）
    let first
    const f1 = host.ctx.plugin((inner) => {
      first = inner.sessions.create(SessionId('t4-dup'), { meta: { cwd: process.cwd() } })
      first.append('session/title', { title: '旧标题会话', messageSeqs: [], source: { kind: 'user' } })
      // 注意：这里不能 return 任何值 —— cordis 会把返回值当 effect（实测 "Invalid effect"）
    })
    await f1
    assert.ok(first, '第一段会话已创建')
    await f1.dispose()   // 触发 session/disposed → 插件必须清掉 titleCache 里的 't4-dup'
    await settle()

    // 第二段：同 id 重建，**不带**标题
    const s2 = host.createRoot('t4-dup')
    assert.notEqual(s2, first)
    const before = spawned().length
    host.runTurn(s2, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(
      !a.message.includes('旧标题会话'),
      `同 id 重建后不得泄漏旧标题：${JSON.stringify(a.message)}`,
    )
    assert.ok(a.message.includes('任务：会话 t4-dup'), `应回退短 ID：${JSON.stringify(a.message)}`)
    drain(before)
    await host.unload()
  })

  test('T-5 缓存容量淘汰后：仍缓存者显示标题，被淘汰者短 ID 回退，绝不串标题', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    // 制造 300 个带独立标题的会话（超过 A 的 TITLE_CACHE_MAX=256）
    const N = 300
    const MAX = 256          // src/index.ts TITLE_CACHE_MAX；本用例把该上界钉进契约
    const evicted = N - MAX  // 插入序最早的 44 个会被容量淘汰
    const sessions = []
    for (let i = 0; i < N; i++) {
      const s = host.createRoot(`t5-cap-${i}`, { title: `容量标题${i}` })
      sessions.push(s)
    }
    // 逐个走一轮并驱动结算：仍在缓存 → 自己的标题；已被淘汰 → 短 ID 回退。
    // 用**首行精确相等**判定（子串包含会把 "容量标题100" 误判成含 "容量标题1"），
    // 精确相等天然保证不串别的会话的标题（D 的"不串标题"语义保留）。
    for (let i = 0; i < N; i++) {
      const b = spawned().length
      host.runTurn(sessions[i], { kind: 'completed', turn: 1, withStep: true })
      const toasts = taskToasts(b)
      assert.equal(toasts.length, 1, `会话 ${i} 应通知`)
      const a = argsOf(toasts[0])
      const firstLine = a.message.split('\n')[0]
      if (i < evicted) {
        assert.equal(
          firstLine, `任务：会话 ${`t5-cap-${i}`.slice(0, 8)}`,
          `会话 ${i} 标题应已被容量淘汰并短 ID 回退：${JSON.stringify(a.message)}`,
        )
      } else {
        assert.equal(
          firstLine, `任务：容量标题${i}`,
          `会话 ${i} 标题应仍在缓存且不得串位：${JSON.stringify(a.message)}`,
        )
      }
      drain(b)
      await settle()   // worker 串行：必须让上一条结算完成后，下一条 spawn 才会发生
    }
    await host.unload()
  })

  test('T-6 卸载/重载：titleCache 清理，新实例同 id 无标题 → 短 ID（无陈旧标题）', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('t6-reload', { title: '重载前标题' })
    host.runTurn(s, { kind: 'completed', turn: 1, withStep: true })
    drain(0)
    await host.unload()   // 插件 effect 会 titleCache.clear()

    const host2 = await startNotificationHost()
    const before = spawned().length
    const s2 = host2.createRoot('t6-reload')   // 同 id，但新实例、无标题事件
    host2.runTurn(s2, { kind: 'completed', turn: 1, withStep: true })
    const a = argsOf(taskToasts(before)[0])
    assert.ok(
      !a.message.includes('重载前标题'),
      `重载后不得沿用上一实例的标题：${JSON.stringify(a.message)}`,
    )
    // 短 ID 取前 8 位：'t6-reload' → 't6-reloa'
    assert.ok(a.message.includes('任务：会话 t6-reloa'), `应回退短 ID：${JSON.stringify(a.message)}`)
    drain(before)
    await host2.unload()
  })

  test('T-7 回归：带标题的委派子会话仍零通知 —— 标题路径不得绕过主/子身份门', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const child = host.createChild('t7-child')
    // 子代理也有标题（真实场景：委派时继承/生成标题）
    child.append('session/title', { title: '子代理的标题', messageSeqs: [], source: { kind: 'fallback' } })
    host.runTurn(child, { kind: 'completed', turn: 1, withStep: true })
    host.runTurn(child, { kind: 'error', turn: 2, withStep: true })
    assert.equal(taskToasts(before).length, 0, '带标题的子会话仍必须零通知（身份门不得被标题路径绕过）')
    assert.equal(spawned().length, before, '不得产生任何 powershell 进程')
    await host.unload()
  })
})
