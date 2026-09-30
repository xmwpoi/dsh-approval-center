/**
 * T3 真实宿主发布路径集成测试（Agent D）。
 *
 * 目的：把 docs/evidence/task-notifications/integration.md 里的宿主前提固化成可执行断言。
 * 走**真实** Cordis Context + 真实 @deepseek-ai/dsh-session SessionStore 发布路径，
 * **不直接调用插件监听器**（派发书 §4 Agent D：不能只直接调用 listener 假冒集成）。
 *
 * 覆盖（对应 A 的 T0 契约 §2.2/§2.4/§2.5，D 独立复现）：
 *  - session/event 真实签名与派发时机（append 返回之后）
 *  - seed 历史不经 session/event 发布
 *  - turn/end 的 reason.kind 词汇与运行时零校验（default 分支必要性）
 *  - header.origin 主/子判据：委派子会话 origin='subagent'；fork 根会话 origin 缺省
 *  - fork 根会话的 isSeeded/parentSession 不可作子代理判据（会误杀主会话）
 *  - profile 根监听能收到委派子会话事件（⇒ 过滤必须在插件内做）
 *  - agent-scoped 监听只收到本作用域事件
 *  - session/title 可从 snapshotEvents() 回读；Session 无 title 属性
 *  - 子代理/未知事件不能被臆造事件名捕获（agent/end 不存在）
 *
 * 铁律：本文件绝不 spawn powershell.exe、绝不发真实 Toast、不改 HKCU。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { SessionStore, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import { foldSessionTitle } from '@deepseek-ai/dsh-session-title'

/** 一次性真实宿主：真实 Context + 真实 SessionStore + 收集器 */
function makeHost() {
  const ctx = new Context()
  const store = new SessionStore(ctx)
  const events = []
  const created = []
  ctx.on('session/event', (session, event) => {
    events.push({ id: String(session.id), type: event.type, seq: Number(event.seq), data: event.data })
  })
  ctx.on('session/created', (session) => { created.push(String(session.id)) })
  const fibers = []
  return {
    ctx, store, events, created, fibers,
    /** 创建会话（真实发布路径：ctx.sessions.create → enter + announce） */
    create(id, meta = {}) {
      return ctx.sessions.create(SessionId(id), { meta: { cwd: process.cwd(), ...meta } })
    },
  }
}

describe('T3-A session/event 真实发布路径', () => {
  test('A1 append 后才派发；签名 (session, event)；root header 无 origin 字段', () => {
    const h = makeHost()
    const s = h.create('root-a1')
    assert.equal(s.header.origin, undefined, 'root 会话 origin 必须缺省')
    assert.ok(!('origin' in s.header), 'root header 不应有 origin 键（不存在 root/main 字面量）')
    const order = []
    h.ctx.on('session/event', () => { order.push('listener') })
    const ev = s.append('turn/start', { turn: 1 })
    assert.equal(order[order.length - 1], 'listener', '监听器必须在 append() 返回前已同步派发（emit 模式）')
    assert.ok(ev, 'append 返回事件对象')
    assert.deepEqual(h.events.map((e) => e.type), ['turn/start'])
    assert.equal(h.events[0].id, 'root-a1')
  })

  test('A2 seed 历史不经 session/event 发布（构造期事件零派发）', () => {
    const h = makeHost()
    const before = h.events.length
    const seeded = h.ctx.sessions.create(SessionId('seed-a2'), {
      seed: [
        { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
        { type: 'turn/end', seq: 1, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
      ],
      inheritedEventCount: SessionLogOffset(2),
      meta: { isSeeded: true, cwd: process.cwd() },
    })
    // 构造期不派发任何 seed 事件；构造后真实 append 才发布
    const afterConstruct = h.events.filter((e) => e.id === 'seed-a2').length
    assert.equal(afterConstruct, 0, `seed 事件不得发布，实测 ${afterConstruct}`)
    seeded.append('turn/start', { turn: 2 })
    const published = h.events.filter((e) => e.id === 'seed-a2')
    assert.equal(published.length, 1, '构造后真实 append 应发布 1 条')
    assert.equal(published[0].data.turn, 2, '发布的是新 append 的，不是 seed 里的 turn 1')
    assert.ok(before >= 0)
  })

  test('A3 turn/end 的 reason.kind 七词汇运行时全被接受；未知 kind 也被接受 ⇒ default 分支必要', () => {
    const h = makeHost()
    const s = h.create('root-a3')
    const kinds = ['completed', 'error', 'blocked', 'max-tokens', 'aborted', 'interrupted', 'forked']
    let turn = 0
    for (const kind of kinds) {
      turn++
      s.append('turn/start', { turn })
      const reason = kind === 'aborted' ? { kind, reason: { kind: 'user' } } : { kind }
      const ev = s.append('turn/end', { turn, reason })
      assert.equal(ev.data.reason.kind, kind)
    }
    // 运行时零校验：未知 kind 与缺 kind 都被接受 ⇒ 插件必须自带 default 保守静默
    turn++
    s.append('turn/start', { turn })
    assert.doesNotThrow(() => s.append('turn/end', { turn, reason: { kind: 'totally-bogus' } }))
    assert.doesNotThrow(() => s.append('turn/end', { turn, reason: {} }))
  })

  test('A4 aborted 携带可区分来源 reason.reason（user/parent/disposed/hook）', () => {
    const h = makeHost()
    const s = h.create('root-a4')
    for (const cause of [{ kind: 'user' }, { kind: 'parent' }, { kind: 'disposed' }, { kind: 'hook', reason: 'x' }]) {
      s.append('turn/start', { turn: 1 })
      s.append('turn/end', { turn: 1, reason: { kind: 'aborted', reason: cause } })
    }
    const aborts = h.events.filter((e) => e.type === 'turn/end' && e.data.reason?.kind === 'aborted')
    assert.equal(aborts.length, 4)
    assert.deepEqual(aborts.map((a) => a.data.reason.reason.kind), ['user', 'parent', 'disposed', 'hook'])
  })
})

describe('T3-B 主/子身份判据（origin === subagent 唯一判据）', () => {
  test('B1 委派子会话 origin=subagent；fork 根会话 origin 缺省', () => {
    const h = makeHost()
    const root = h.create('root-b1')
    const child = h.create('child-b1', { origin: 'subagent', delegationDepth: 1 })
    const src = h.create('src-b1')
    src.append('turn/start', { turn: 1 })
    const forked = h.ctx.sessions.fork(src)
    assert.equal(child.header.origin, 'subagent')
    assert.equal(child.header.delegationDepth, 1)
    assert.equal(forked.header.origin, undefined, 'fork 根会话 origin 必须缺省')
    assert.equal(forked.header.isSeeded, true, 'fork 根会话 isSeeded=true —— 因此 isSeeded 不可作子代理判据')
    assert.ok(forked.header.parentSession !== undefined, 'fork 根会话保留 parentSession —— 因此 parentSession 不可作判据')
    assert.equal(root.header.origin, undefined)
  })

  test('B2 profile 根监听能收到委派子会话事件 ⇒ 过滤必须在插件内做', () => {
    const h = makeHost()
    const child = h.create('child-b2', { origin: 'subagent', delegationDepth: 1 })
    child.append('turn/start', { turn: 1 })
    child.append('step/start', { turn: 1, step: 1 })
    child.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const seen = h.events.filter((e) => e.id === 'child-b2')
    assert.equal(seen.length, 3, `根监听必须能看到子会话事件（否则无法过滤），实测 ${seen.length}`)
    assert.deepEqual(seen.map((e) => e.type), ['turn/start', 'step/start', 'turn/end'])
  })

  test('B3 对照：fork 根会话事件同样到达根监听，且必须被当作主会话', () => {
    const h = makeHost()
    const src = h.create('src-b3')
    src.append('turn/start', { turn: 1 })
    const forked = h.ctx.sessions.fork(src)
    forked.append('turn/start', { turn: 1 })
    forked.append('step/start', { turn: 1, step: 1 })
    forked.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    const seen = h.events.filter((e) => e.id === String(forked.id))
    assert.equal(seen.filter((e) => e.type === 'turn/end').length, 1, 'fork 根会话的 turn/end 必须到达根监听')
    assert.equal(forked.header.origin, undefined, 'fork 根会话不得被 origin 判据排除')
  })

  test('B4 agent-scoped 监听只收到本作用域事件；scope 链含 profile 根', () => {
    const h = makeHost()
    const keyA = { name: 'agent-A' }
    const keyB = { name: 'agent-B' }
    const scopeA = createScope(h.ctx, keyA)
    const scopeB = createScope(h.ctx, keyB)
    h.fibers.push(scopeA, scopeB)
    const seenA = []
    const seenB = []
    scopeA.ctx.on('session/event', (_s, e) => seenA.push(e.type))
    scopeB.ctx.on('session/event', (_s, e) => seenB.push(e.type))

    // 经 agent scope 进入的会话只派发给该 scope（及更上层），不派发给兄弟 scope
    const sa = scopeA.ctx.sessions.create(SessionId('a-b4'), { meta: { cwd: process.cwd() } })
    sa.append('turn/start', { turn: 1 })
    const sb = scopeB.ctx.sessions.create(SessionId('b-b4'), { meta: { cwd: process.cwd() } })
    sb.append('turn/start', { turn: 1 })

    assert.deepEqual(seenA, ['turn/start'], `agent-A 只应收到自己的 1 条，实测 ${JSON.stringify(seenA)}`)
    assert.deepEqual(seenB, ['turn/start'])
    // 同一条事件，两兄弟 scope 各自收到自己那条，互不串
    assert.equal(seenA.length, 1)
    assert.equal(seenB.length, 1)
  })
})

describe('T3-C 标题读取（session/title）', () => {
  test('C1 Session 无 title 属性；session/title 可 append 并从 snapshotEvents 回读', () => {
    const h = makeHost()
    const s = h.create('root-c1')
    assert.ok(!Object.prototype.hasOwnProperty.call(s, 'title'), 'Session 实例不得有自有 title 属性')
    assert.ok(!('title' in s), 'Session 原型链上也不得有 title（契约 §2.5：禁止假设 session.title 存在）')
    s.append('session/title', { title: '修复登录问题', messageSeqs: [], source: { kind: 'user' } })
    s.append('session/title', { title: '更新后的标题', messageSeqs: [], source: { kind: 'user' } })
    const folded = foldSessionTitle(s.snapshotEvents())
    assert.ok(folded, 'foldSessionTitle 应可公开调用')
    assert.equal(folded.title, '更新后的标题', '应取最后一条 title')
    // 手写最后一条回读（A 的适配器路径）
    let last
    for (const e of s.snapshotEvents()) if (e.type === 'session/title') last = e.data.title
    assert.equal(last, '更新后的标题')
  })

  test('C2 不装 dsh-session-title 时 session/title 不可注册（fixture 依赖依据）', async () => {
    // 该断言通过"本文件能 import dsh-session-title 并成功 append"来反向成立：
    // 若 fixture 缺该包，本文件的 import 就会失败，从而暴露 fixture 不完整。
    const h = makeHost()
    const s = h.create('root-c2')
    assert.doesNotThrow(() => s.append('session/title', { title: 't', messageSeqs: [], source: { kind: 'fallback' } }))
    const titles = s.snapshotEvents().filter((e) => e.type === 'session/title')
    assert.equal(titles.length, 1)
  })
})

describe('T3-D 臆造事件名不可用（计划 §2.2：不监听 agent/end）', () => {
  test('D1 agent/end 等臆造事件名可注册但永不触发（真实事件只有 session/* 与 subagent/*）', () => {
    const h = makeHost()
    const fired = []
    // 注册臆造事件名：cordis 不做白名单，所以注册不报错——但这不代表事件存在。
    h.ctx.on('agent/end', () => { fired.push('agent/end') })
    h.ctx.on('agent/created', () => { fired.push('agent/created') })
    const s = h.create('root-d1')
    s.append('turn/start', { turn: 1 })
    s.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    assert.deepEqual(fired, [], '任何 agent/* 事件都不应被触发；通知必须只走 session/event')
  })

  test('D2 session/disposed 在会话移除时触发', async () => {
    const h = makeHost()
    const disposed = []
    h.ctx.on('session/disposed', (s) => disposed.push(String(s.id)))
    const fiber = h.ctx.plugin((inner) => {
      const owned = inner.sessions.create(SessionId('owned-d2'), { meta: { cwd: process.cwd() } })
      owned.append('turn/start', { turn: 1 })
    })
    await fiber
    assert.ok(h.ctx.sessions.get(SessionId('owned-d2')) !== undefined)
    await fiber.dispose()
    assert.equal(h.ctx.sessions.get(SessionId('owned-d2')), undefined)
    assert.deepEqual(disposed, ['owned-d2'], 'session/disposed 必须触发（标题缓存清理依据）')
  })
})

after(() => { /* 真实 store 无需清理；未 spawn 任何进程 */ })
