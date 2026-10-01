// R2-B 对抗性测试：A 整合树 222e38a 的通知状态机竞争、泄漏与文案复核。
// 全部 mock sender / 注入时钟：不 spawn 进程、不弹通知、不写 HKCU。
// 运行：node --test test/notifications.adversarial.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NotificationService, notificationTag } from '../lib/notifications.js'

const SID = 'session-aaaabbbb-cccc-dddd-eeee-ffffffffffff'

// ── 替身 ────────────────────────────────────────────────────────────────────

/** 可控时钟：手动推进；统计未清理计时器。 */
function fakeClock() {
  const tasks = new Set()
  let now = 0
  return {
    now: () => now,
    setTimer(fn, ms) {
      const task = { fn, at: now + ms }
      tasks.add(task)
      return task
    },
    clearTimer(task) {
      tasks.delete(task)
    },
    get pendingTimers() {
      return tasks.size
    },
    advance(ms) {
      now += ms
      for (const task of [...tasks]) {
        if (task.at <= now) {
          tasks.delete(task)
          task.fn()
        }
      }
    },
  }
}

/**
 * 可编程 sender。记录每次调用收到的 signal，并包装其 add/removeEventListener
 * 以便断言"结算后 abort 监听已被移除"。
 */
function fakeSender({ mode = 'manual', result = 'submitted', ignoreAbort = false } = {}) {
  const calls = []
  const sender = {
    calls,
    send(message, signal) {
      const record = {
        message,
        signal,
        abortSeen: false,
        listenersAdded: 0,
        listenersRemoved: 0,
        settled: false,
      }
      const origAdd = signal.addEventListener.bind(signal)
      const origRemove = signal.removeEventListener.bind(signal)
      signal.addEventListener = (...a) => { record.listenersAdded++; return origAdd(...a) }
      signal.removeEventListener = (...a) => { record.listenersRemoved++; return origRemove(...a) }
      // 契约 §4.1：sender **必须**响应 abort（kill 子进程并结算 'aborted'）。
      // ignoreAbort=true 用于模拟不合规 sender，单独验证 close 的有界收敛。
      signal.addEventListener('abort', () => {
        record.abortSeen = true
        if (!ignoreAbort) record.resolve('aborted')
      }, { once: true })
      record.resolve = (value) => {
        if (record.settled) return
        record.settled = true
        record._res(value)
      }
      record.promise = new Promise((res) => { record._res = res })
      calls.push(record)
      if (mode === 'throw') throw new Error('sender 同步抛出')
      if (mode === 'reject') return Promise.reject(new Error('sender 异步失败'))
      if (mode === 'bogus') return Promise.resolve(result) // 契约外的返回值
      if (mode === 'auto') queueMicrotask(() => record.resolve(result))
      return record.promise
    },
  }
  return sender
}

async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r))
}

function makeService(overrides = {}) {
  const clock = fakeClock()
  const sender = overrides.sender ?? fakeSender({ mode: 'auto' })
  const warns = []
  const service = new NotificationService({
    sender,
    clock,
    onWarn: (m) => warns.push(m),
    ...overrides,
  })
  return { service, clock, sender, warns }
}

function runTurn(service, { sessionId = SID, turn = 1, reasonKind = 'completed', origin, title } = {}) {
  service.observe({ kind: 'turn-start', sessionId, turn, origin })
  service.observe({ kind: 'step-start', sessionId, turn, origin })
  return service.observe({ kind: 'turn-end', sessionId, turn, reasonKind, origin, title })
}

/** 严格相等且类型为 null（`undefined !== null` 会骗过 `!== null` 判断） */
function assertNull(value, message) {
  assert.ok(value === null && typeof value === 'object', `${message}：期望 null，实得 ${String(value)}（类型 ${typeof value}）`)
}

// ══ R1 同一 tick 竞争 ═══════════════════════════════════════════════════════

test('AD-01: enqueue 与 close 在同一同步块 —— 在飞发送被 abort，不再有后续发送', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service) // send 已被同步启动（不可撤销），close 只能 abort 它
  await service.close() // 与上一次 enqueue 同一同步块内随后执行
  await flush()
  assert.equal(sender.calls.length, 1, '已启动的发送不可撤销（计数不再增长）')
  assert.equal(sender.calls[0].abortSeen, true, 'close 必须 abort 在飞发送')
  assert.equal(service.lastResult, 'aborted')
  assert.equal(clock.pendingTimers, 0)
  // close 之后任何事件都不再产生新发送
  runTurn(service, { turn: 2, reasonKind: 'error' })
  await flush()
  assert.equal(sender.calls.length, 1)
})

test('AD-02: 在飞发送期间同一同步块两次 enqueue —— 严格串行且都送达', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service, { turn: 1 }) // 在飞
  await flush()
  const m2 = runTurn(service, { turn: 2 })
  const m3 = runTurn(service, { turn: 3 })
  assert.ok(m2 && m3, '排队期两轮都应被接受')
  assert.equal(sender.calls.length, 1, '在飞时不得并发启动第二条')
  sender.calls[0].resolve('submitted')
  await flush()
  assert.equal(sender.calls.length, 2)
  sender.calls[1].resolve('submitted')
  await flush()
  assert.equal(sender.calls.length, 3)
  assert.equal(service.pendingCount, 0)
})

test('AD-03: 看门狗与 sender 结算落在同一 fake-clock tick —— 只结算一次', async () => {
  const { service, sender, clock } = makeService({
    sender: fakeSender({ mode: 'manual' }),
    watchdogMs: 1000,
  })
  runTurn(service)
  await flush()
  // 让 sender 结算与看门狗到点处于同一次 advance()
  queueMicrotask(() => sender.calls[0].resolve('submitted'))
  clock.advance(1000)
  await flush()
  assert.equal(service.lastResult, 'failed', '先到者赢：看门狗先被记录')
  assert.equal(clock.pendingTimers, 0)
  // 只有一路产生副作用：不重试
  assert.equal(sender.calls.length, 1)
})

test('AD-04: caller abort 与 sender 结算同一 tick —— 只结算一次，结果 aborted', async () => {
  const { service, sender, clock } = makeService({
    sender: fakeSender({ mode: 'manual' }),
    watchdogMs: 99_999,
  })
  runTurn(service)
  await flush()
  const record = sender.calls[0]
  queueMicrotask(() => record.resolve('submitted'))
  record.signal.dispatchEvent(new Event('abort'))
  await flush()
  assert.equal(service.lastResult, 'aborted')
  assert.equal(clock.pendingTimers, 0)
})

// ══ R2 重复终态与新 turn ════════════════════════════════════════════════════

test('AD-05: 同一 turn 重复 turn/end（含交错 step/start）只发一次', async () => {
  const { service, sender } = makeService()
  runTurn(service, { turn: 7 })
  await flush()
  // 宿主侧重复发布：即使重新发了 step/start，去重 key 仍应拦住
  service.observe({ kind: 'step-start', sessionId: SID, turn: 7 })
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 7, reasonKind: 'completed' })
  await flush()
  assert.equal(sender.calls.length, 1)
})

test('AD-06: 新 turn 可再提醒；不同会话同 turn 号互不影响', async () => {
  const { service, sender } = makeService()
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { sessionId: 'session-99998888', turn: 1 })
  await flush()
  assert.deepEqual(sender.calls.map((c) => c.message.key).sort(), [
    `${SID}:1`, `${SID}:2`, 'session-99998888:1',
  ].sort())
})

test('AD-07: 未知轮次 —— completed 静默，error 仍提醒（契约 §3.1）', async () => {
  const { service, sender } = makeService()
  assertNull(service.observe({ kind: 'turn-end', sessionId: SID, turn: 4, reasonKind: 'completed' }), '无 step 门禁应静默')
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 5, reasonKind: 'error' })
  await flush()
  assert.equal(sender.calls.length, 1)
})

test('AD-08: 同步重复 enqueue 同一 key —— 第二次被拒且不重复发送', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service, { turn: 1 }) // 在飞
  await flush()
  const again = { key: `${SID}:1`, source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }
  assert.equal(service.enqueue(again), false, '同 key 去重')
  assert.equal(sender.calls.length, 1)
})

// ══ R3 sender 异常面 ════════════════════════════════════════════════════════

test('AD-09: sender 同步抛出 —— 不逃逸、记 failed、队列继续', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'throw' }) })
  assert.doesNotThrow(() => runTurn(service, { turn: 1 }))
  await flush()
  assert.equal(service.lastResult, 'failed')
  runTurn(service, { turn: 2 }) // 队列必须继续
  await flush()
  assert.equal(sender.calls.length, 2)
})

test('AD-10: sender 异步 reject —— 不逃逸、记 failed、不补发错误通知', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'reject' }) })
  assert.doesNotThrow(() => runTurn(service))
  await flush()
  assert.equal(service.lastResult, 'failed')
  assert.equal(sender.calls.length, 1)
})

test('AD-11: sender 永不结算 —— watchdog 到点 abort + failed，无重试、无残留计时器', async () => {
  const { service, sender, clock } = makeService({
    sender: fakeSender({ mode: 'manual' }),
    watchdogMs: 5000,
  })
  runTurn(service)
  await flush()
  clock.advance(5000)
  await flush()
  assert.equal(sender.calls[0].abortSeen, true, 'watchdog 必须 abort 发送')
  assert.equal(service.lastResult, 'failed')
  assert.equal(sender.calls.length, 1, '不得自动重试')
  assert.equal(clock.pendingTimers, 0)
})

test('AD-12: sender 无视 abort —— close 有界收敛，计时器归零', async () => {
  const { service, clock } = makeService({
    sender: fakeSender({ mode: 'manual', ignoreAbort: true }),
    watchdogMs: 60_000,
    closeTimeoutMs: 2000,
  })
  runTurn(service)
  await flush()
  let closed = false
  const closing = service.close().then(() => { closed = true })
  await flush()
  assert.equal(closed, false)
  clock.advance(2000)
  await flush()
  await closing
  assert.equal(closed, true, 'close 必须在 closeTimeoutMs 内返回')
  assert.equal(clock.pendingTimers, 0)
})

test('AD-13: sender 返回契约外的值 —— 按 failed 处理且不得进入 lastResult', async () => {
  const { service } = makeService({ sender: fakeSender({ mode: 'bogus', result: 'pending' }) })
  runTurn(service)
  await flush()
  assert.equal(service.lastResult, 'failed', '契约外返回值必须归一为 failed')
})

// ══ R4 close ════════════════════════════════════════════════════════════════

test('AD-14: close 幂等（同步两次 + 并发 await）', async () => {
  const { service, clock } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service)
  await flush()
  const p1 = service.close()
  const p2 = service.close()
  assert.equal(p1, p2, '重复 close 必须返回同一 promise')
  await Promise.all([p1, p2])
  assert.equal(clock.pendingTimers, 0)
})

test('AD-15: 飞行中 close（sender 响应 abort）—— aborted、丢弃待发、资源归零', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { turn: 3 })
  await flush()
  assert.equal(service.pendingCount, 2)
  await service.close()
  assert.equal(sender.calls[0].abortSeen, true)
  assert.equal(service.pendingCount, 0, 'close 丢弃待发')
  assert.equal(service.turnStateCount, 0)
  assert.equal(service.dedupSize, 0)
  assert.equal(clock.pendingTimers, 0)
})

test('AD-16: close 后 observe/enqueue 一律 no-op（含子代理与 error 终态）', async () => {
  const { service, sender } = makeService()
  await service.close()
  for (const reasonKind of ['completed', 'error', 'blocked', 'max-tokens', 'aborted']) {
    assertNull(service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind }), 'close 后必须静默')
  }
  assert.equal(service.enqueue({ key: 'k', source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }), false)
  await flush()
  assert.equal(sender.calls.length, 0)
})

// ══ R5 timer / listener 释放 ════════════════════════════════════════════════

test('AD-17: 服务不在交给 sender 的 signal 上注册监听（T0 §4.1：service 持有 controller）', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service)
  await flush()
  const record = sender.calls[0]
  // listenersAdded === 1 恰好是本 fake 自己注册的 abortSeen 监听：
  // 服务侧不应在 signal 上挂监听（它直接持有 AbortController 并调用 abort()）。
  // 若未来 sendOnce 改成挂监听实现，这里会变成 2 —— 那就必须在结算时移除。
  assert.equal(record.listenersAdded, 1, '服务不得在交给 sender 的 signal 上注册监听')
  record.resolve('submitted')
  await flush()
  assert.equal(sender.calls[0].listenersRemoved, 0, '服务侧无监听，因此也不应移除 sender 自己的监听')
})

test('AD-18: 连续 20 轮成功发送 —— 零计时器残留、零轮次状态残留', async () => {
  const { service, clock } = makeService()
  for (let i = 1; i <= 20; i++) runTurn(service, { turn: i })
  await flush()
  assert.equal(service.turnStateCount, 0, 'turn/end 必须释放轮次状态')
  assert.equal(clock.pendingTimers, 0)
})

test('AD-19: 轮次状态表有界（未见 turn/end 的会话不无限增长）', () => {
  const { service } = makeService({ turnStateCapacity: 3 })
  for (let i = 0; i < 50; i++) service.observe({ kind: 'turn-start', sessionId: `s-${i}`, turn: 1 })
  assert.ok(service.turnStateCount <= 3, `实得 ${service.turnStateCount}`)
})

// ══ R6 TTL 与容量 ═══════════════════════════════════════════════════════════

test('AD-20: TTL 过期后同 key 可再次入队（best-effort 语义），未到期则拒绝', async () => {
  const { service, clock } = makeService({ dedupTtlMs: 1000 })
  const message = { key: 'k', source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }
  assert.equal(service.enqueue(message), true)
  assert.equal(service.enqueue(message), false)
  clock.advance(999)
  assert.equal(service.enqueue(message), false)
  clock.advance(2)
  assert.equal(service.enqueue(message), true)
})

test('AD-21: 容量上限淘汰最旧条目 —— 淘汰后同 key 可再入队', async () => {
  const { service } = makeService({ dedupCapacity: 2 })
  for (const key of ['a', 'b', 'c']) {
    service.enqueue({ key, source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true })
  }
  assert.ok(service.dedupSize <= 2)
  assert.equal(service.enqueue({ key: 'a', source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }), true, 'a 已被淘汰')
})

// ══ R7 容量语义：等待 100 + 在飞 1 ═════════════════════════════════════════

test('AD-22: maxPending=100 的精确语义 —— 1 在飞 + 100 等待，第 102 条被拒', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }), maxPending: 100 })
  runTurn(service, { turn: 0 }) // 立即取走 → 在飞
  await flush()
  assert.equal(sender.calls.length, 1)
  assert.equal(service.pendingCount, 0)
  for (let i = 1; i <= 100; i++) {
    runTurn(service, { turn: i, reasonKind: 'error' })
  }
  assert.equal(service.pendingCount, 100, '恰好 100 条等待')
  // 第 102 条（101 个等待之外）必须被拒
  assertNull(service.observe({ kind: 'turn-end', sessionId: SID, turn: 500, reasonKind: 'error' }), '溢出必须拒绝')
  assert.equal(service.pendingCount, 100)
})

test('AD-23: 溢出丢弃不改任何其他状态 —— 不消耗去重名额、不抛异常、限频告警一次', async () => {
  const { service, warns } = makeService({ sender: fakeSender({ mode: 'manual' }), maxPending: 1 })
  runTurn(service, { turn: 1 })
  await flush()
  runTurn(service, { turn: 2, reasonKind: 'error' })
  const before = service.dedupSize
  assert.doesNotThrow(() => {
    for (let i = 3; i <= 20; i++) {
      service.observe({ kind: 'turn-end', sessionId: SID, turn: i, reasonKind: 'error' })
    }
  })
  assert.equal(service.dedupSize, before, '溢出拒绝不得消耗去重名额')
  assert.equal(warns.filter((w) => w.includes('通知队列已满')).length, 1, '限频：只告警一次')
})

// ══ R8 子代理零入队 ═════════════════════════════════════════════════════════

test('AD-24: 子代理全终态 + continuation —— 零入队、零进程、零去重、零计时器', async () => {
  const { service, sender, clock } = makeService()
  for (const reasonKind of ['completed', 'aborted', 'error', 'max-tokens', 'refusal', 'blocked', undefined]) {
    service.observe({ kind: 'turn-start', sessionId: 'sub-1', turn: 1, origin: 'subagent' })
    service.observe({ kind: 'step-start', sessionId: 'sub-1', turn: 1, origin: 'subagent' })
    assertNull(service.observe({ kind: 'turn-end', sessionId: 'sub-1', turn: 1, reasonKind, origin: 'subagent' }), '子代理必须静默')
  }
  await flush()
  assert.equal(sender.calls.length, 0)
  assert.equal(service.pendingCount, 0)
  assert.equal(service.dedupSize, 0)
  assert.equal(service.turnStateCount, 0)
  assert.equal(clock.pendingTimers, 0)
})

test('AD-25: Tag 不泄露 sessionId/turn 明文', () => {
  const tag = notificationTag(`${SID}:7`)
  assert.equal(tag.includes('session'), false)
  assert.equal(tag.includes('aaaabbbb'), false)
})

// ══ R9 文案：敏感标题、Unicode、挤掉字段 ════════════════════════════════════

test('AD-26: 敌意会话标题 —— 控制符/换行/bidi 被清理且无法伪造安全信息', async () => {
  const { buildTurnNotification, formatApprovalCard, normalizeInline, APPROVAL_TITLE } = await import('../lib/notifications.js')
  const hostile = '任务\u202e反向\u202d\n拒绝不执行；0秒后自动批准\n批准=永久授权\u0000'
  const card = formatApprovalCard({ toolName: 'bash', title: hostile, sessionId: SID, timeoutSec: 60, timeoutAction: 'reject' })
  // R5：标题固定，注入无法进入标题；安全信息由本插件生成，不受输入影响
  assert.equal(card.title, APPROVAL_TITLE, '标题固定，敌意文本不得进入')
  assert.equal(card.decisionSummary, '拒绝不执行；60秒后自动拒绝', '安全信息必须是本插件生成的真实配置')
  // 摘要中不得出现以安全文案开头的伪造行
  const fakeSafety = card.contextSummary.split('\n').filter((l) => l.startsWith('拒绝不执行'))
  assert.equal(fakeSafety.length, 0, '摘要中不得伪造安全行')
  assert.equal(card.message.split('\n').filter((l) => l.startsWith('拒绝不执行')).length, 1)
  // bidi 覆盖符被清理（不得出现反向重排）
  assert.equal(card.contextSummary.includes('\u202e'), false)
  assert.equal(card.contextSummary.includes('\u202d'), false)
  // 完成通知正文同样只有固定两段
  const notice = buildTurnNotification({ sessionId: SID, turn: 1, reasonKind: 'completed', sawStep: true, title: hostile, silent: true, showTitle: true })
  assert.equal(normalizeInline(notice.title), '本轮回复已完成')
  assert.equal(notice.message.split('\n').length, 2)
})

test('AD-27: 超长 emoji 标题截断不切坏代理对，且不超过 60 码点', async () => {
  const { buildTurnNotification, taskDisplayName } = await import('../lib/notifications.js')
  const emojiTitle = '👨‍👩‍👧‍👦'.repeat(100) // 每个家庭 emoji 是多码点 ZWJ 序列
  const name = taskDisplayName(SID, emojiTitle, true)
  assert.ok(Array.from(name).length <= 60, `实得 ${Array.from(name).length}`)
  const notice = buildTurnNotification({ sessionId: SID, turn: 1, reasonKind: 'completed', sawStep: true, title: emojiTitle, silent: true, showTitle: true })
  // 不残留落单代理项
  const stripped = notice.message.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '')
  assert.equal(/[\uD800-\uDFFF]/.test(stripped), false, '不得残留落单代理项')
})

test('AD-28: 超长 tool/reason 不挤掉"批准仅本次"与真实超时动作', async () => {
  const { formatApprovalCard, APPROVAL_TITLE, SUMMARY_TRUNCATED_MARK } = await import('../lib/notifications.js')
  const card = formatApprovalCard({
    toolName: 'x'.repeat(10_000),
    title: 't'.repeat(10_000),
    sessionId: SID,
    reason: 'r'.repeat(10_000),
    timeoutSec: 60,
    timeoutAction: 'approve',
  })
  // R5：安全信息在独立字段，动态长文本结构上不可能挤掉它
  assert.equal(card.title, APPROVAL_TITLE, '标题固定含"批准仅本次"')
  assert.ok(card.title.includes('批准仅本次'))
  assert.equal(card.decisionSummary, '拒绝不执行；60秒后自动批准', 'approve 必须如实写自动批准')
  assert.equal(card.message.split('\n')[0], card.decisionSummary, '安全信息必须排在最前')
  // 审批对象仍可识别
  assert.ok(card.contextSummary.includes('任务：'), '任务不得完全丢失')
  assert.ok(card.contextSummary.includes('操作：'), '操作不得完全丢失')
  // 截断必须显式提示
  assert.ok(card.contextSummary.includes(SUMMARY_TRUNCATED_MARK), '超长摘要必须显式标记')
})

test('AD-29: 错误通知正文恒为冻结文案，不携带任何堆栈形态的内容', async () => {
  const { buildTurnNotification } = await import('../lib/notifications.js')
  const notice = buildTurnNotification({
    sessionId: SID,
    turn: 1,
    reasonKind: 'error',
    sawStep: false,
    title: 'at Object.<anonymous> (C:\\evil\\stack.ts:1:1)',
    silent: true,
    showTitle: false,
  })
  assert.equal(notice.message, `任务：会话 ${SID.slice(0, 8)}\n本轮执行失败，请返回 DSH 查看详情。`)
  assert.equal(notice.message.includes('at Object'), false)
})

// ══ R10 形状防御（冻结签名 observe(): NotificationMessage | null）══════════

test('AD-30: 未知 kind 必须返回 null 而不是 undefined（T0 §4.1 冻结签名）', async () => {
  const { service } = makeService()
  // TurnEndReasonMap 可被插件扩展；适配器可能转发未知 kind
  assertNull(service.observe({ kind: 'step-end', sessionId: SID, turn: 1 }), '未知 kind 不得隐式返回 undefined')
  assertNull(service.observe({ kind: 'turn/end', sessionId: SID, turn: 1 }), '斜杠形式同样要拦')
  // 且不得在轮次表里留下痕迹
  assert.equal(service.turnStateCount, 0)
})

test('AD-31: 缺失/非法 sessionId 必须返回 null 且不建 undefined 键', async () => {
  const { service } = makeService()
  assertNull(service.observe({ kind: 'turn-start', turn: 1 }), '缺 sessionId')
  assertNull(service.observe({ kind: 'turn-start', sessionId: '', turn: 1 }), '空 sessionId')
  assertNull(service.observe({ kind: 'turn-end', sessionId: 42, turn: 1, reasonKind: 'error' }), '非字符串 sessionId')
  assert.equal(service.turnStateCount, 0, '不得在 Map 里建 undefined/42 键')
})

// ══ R11 告警卫生 ═══════════════════════════════════════════════════════════

test('AD-32: 告警不得输出 key 明文（sessionId 属于不应持久化的标识）', async () => {
  const { service, sender, warns } = makeService({ sender: fakeSender({ mode: 'manual' }), maxPending: 1 })
  runTurn(service, { turn: 1 })
  await flush()
  runTurn(service, { turn: 2, reasonKind: 'error' }) // 占满待发
  for (let i = 3; i <= 5; i++) {
    service.observe({ kind: 'turn-end', sessionId: SID, turn: i, reasonKind: 'error' })
  }
  const overflowWarns = warns.filter((w) => w.includes('通知队列已满'))
  assert.equal(overflowWarns.length, 1)
  assert.equal(overflowWarns[0].includes(SID), false, '告警不得带 sessionId 明文')
})

// ══ R4-B 更正补充（AD-33）════════════════════════════════════════════════════
// B 在 r4-b-mapping-correction.md 用变异测试发现：NS-38 的"告警文案"守护
// **未被 AD-13 继承**——只删掉告警调用、保留 `lastResult = 'failed'` 时，
// AD 套件 32/32 全绿（净丢失）。本用例补上该守护：断言告警**确实产生**、
// 含 tag 哈希、且**不含** key 明文；同时断言不重试。
test('AD-33: 契约外 sender 结果必须产生告警（含 tag，不含 key 明文）—— NS-38 的告警守护', async () => {
  const { service, sender, warns } = makeService({
    sender: fakeSender({ mode: 'bogus', result: 'pending' }),
  })
  runTurn(service)
  await flush()

  assert.equal(service.lastResult, 'failed', '仍须归一为 failed')
  const contractWarns = warns.filter((w) => w.includes('契约外'))
  assert.equal(contractWarns.length, 1, '契约外结果必须产生恰好一条告警（删掉告警调用即红）')
  assert.ok(
    /tag=[0-9a-f]{16}/.test(contractWarns[0]),
    `告警必须带 16 位 tag 便于定位：${contractWarns[0]}`,
  )
  assert.equal(contractWarns[0].includes(SID), false, '告警不得泄漏 key 明文（含 sessionId）')
  assert.equal(sender.calls.length, 1, '不得因契约外结果自动重试')
})
