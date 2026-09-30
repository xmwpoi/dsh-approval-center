// T1 服务测试：去重、串行有界队列、看门狗、关闭与资源清理、失败隔离。
// 全部经注入的 fake sender / fake clock 驱动：不 spawn 进程、不弹通知、不写注册表。
// 运行：node --test test/notifications.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NotificationService, notificationTag } from '../lib/notifications.js'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'notifications.ts')

// ── 测试替身 ────────────────────────────────────────────────────────────────

/** 可手动推进的 fake clock；暴露未清理计时器数量。 */
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
 * 可编程 fake sender。默认挂起（由用例显式 settle），
 * 从而精确检验串行、看门狗与关闭路径。
 */
function fakeSender({ auto = false, result = 'submitted', ignoreAbort = false, mode = 'manual' } = {}) {
  const calls = []
  const sender = {
    calls,
    send(message, signal) {
      const record = { message, signal, abortSeen: false, settled: false }
      record.resolve = (value) => {
        if (record.settled) return
        record.settled = true
        record._res(value)
      }
      record.promise = new Promise((res) => { record._res = res })
      calls.push(record)
      signal.addEventListener('abort', () => {
        record.abortSeen = true
        if (!ignoreAbort) record.resolve('aborted')
      }, { once: true })
      if (mode === 'throw') throw new Error('sender 同步抛出')
      if (mode === 'reject') return Promise.reject(new Error('sender 异步失败'))
      if (auto) queueMicrotask(() => record.resolve(result))
      return record.promise
    },
  }
  return sender
}

async function flush(rounds = 8) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r))
}

function makeService(overrides = {}) {
  const clock = fakeClock()
  const sender = overrides.sender ?? fakeSender({ auto: true })
  const warns = []
  const service = new NotificationService({
    sender,
    clock,
    onWarn: (m) => warns.push(m),
    ...overrides,
  })
  return { service, clock, sender, warns }
}

const SID = 'session-aaaabbbb-cccc-dddd-eeee-ffffffffffff'
const SID2 = 'session-11112222-3333-4444-5555-666677778888'

/** 走一遍"主会话完整一轮"（turn/start → step/start → turn/end） */
function runTurn(service, { sessionId = SID, turn = 1, reasonKind = 'completed', origin, title } = {}) {
  service.observe({ kind: 'turn-start', sessionId, turn, origin })
  service.observe({ kind: 'step-start', sessionId, turn, origin })
  return service.observe({ kind: 'turn-end', sessionId, turn, reasonKind, origin, title })
}

// ── 子代理 / continuation 零通知 ───────────────────────────────────────────

test('NS-01: 子代理会话全终态零入队、零 sender 调用、零队列占用', async () => {
  const { service, sender, clock } = makeService()
  for (const reasonKind of ['completed', 'aborted', 'error', 'max-tokens', 'refusal', undefined]) {
    service.observe({ kind: 'turn-start', sessionId: 'sub-1', turn: 1, origin: 'subagent' })
    service.observe({ kind: 'step-start', sessionId: 'sub-1', turn: 1, origin: 'subagent' })
    assert.equal(service.observe({ kind: 'turn-end', sessionId: 'sub-1', turn: 1, reasonKind, origin: 'subagent' }), null)
  }
  await flush()
  assert.equal(sender.calls.length, 0, '子代理事件不得产生任何发送')
  assert.equal(service.pendingCount, 0, '子代理事件不得占用队列')
  assert.equal(service.dedupSize, 0, '子代理事件不得建立去重项')
  assert.equal(service.turnStateCount, 0, '子代理事件不得留下轮次状态')
  assert.equal(clock.pendingTimers, 0, '子代理事件不得创建计时器')
})

test('NS-02: continuation 复用同一 sessionId 仍零通知', async () => {
  const { service, sender } = makeService()
  for (let i = 0; i < 3; i++) {
    service.observe({ kind: 'turn-start', sessionId: 'sub-cont', turn: i, origin: 'subagent' })
    service.observe({ kind: 'turn-end', sessionId: 'sub-cont', turn: i, reasonKind: 'completed', origin: 'subagent' })
  }
  await flush()
  assert.equal(sender.calls.length, 0)
})

test('NS-03: 子代理事件不得污染同 ID 的主会话轮次状态', () => {
  const { service } = makeService()
  service.observe({ kind: 'turn-start', sessionId: SID, turn: 5 })
  // 同一 ID 被标成 subagent（理论上的复用）→ 状态必须被丢弃而不是串轮
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 5, reasonKind: 'completed', origin: 'subagent' })
  assert.equal(service.turnStateCount, 0)
})

// ── 主会话正常路径 ─────────────────────────────────────────────────────────

test('NS-04: 主会话完成一轮 → 恰好一条通知，Tag 与 key 一致', async () => {
  const { service, sender } = makeService()
  const message = runTurn(service, { title: '修复登录问题' })
  await flush()
  assert.ok(message)
  assert.equal(sender.calls.length, 1)
  const sent = sender.calls[0].message
  assert.equal(sent.title, '本轮回复已完成')
  assert.equal(notificationTag(sent.key).length, 16)
  assert.equal(sent.key, `${SID}:1`)
})

test('NS-05: 同一轮重复事件只发一次（同 key 去重）', async () => {
  const { service, sender } = makeService()
  runTurn(service)
  await flush()
  // 宿主重复发布同一轮的 turn/end
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind: 'completed' })
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind: 'completed' })
  await flush()
  assert.equal(sender.calls.length, 1, '同轮重复不得双报')
})

test('NS-06: 新一轮可再次提醒', async () => {
  const { service, sender } = makeService()
  runTurn(service, { turn: 1 })
  await flush()
  runTurn(service, { turn: 2 })
  await flush()
  runTurn(service, { turn: 3 })
  await flush()
  assert.equal(sender.calls.length, 3)
  assert.deepEqual(sender.calls.map((c) => c.message.key), [`${SID}:1`, `${SID}:2`, `${SID}:3`])
})

test('NS-07: 不同会话同一 turn 号各自提醒', async () => {
  const { service, sender } = makeService()
  runTurn(service, { sessionId: SID, turn: 1 })
  runTurn(service, { sessionId: SID2, turn: 1 })
  await flush()
  assert.equal(sender.calls.length, 2)
})

test('NS-08: 正常 turn/end 释放轮次状态（不只清去重缓存）', () => {
  const { service } = makeService()
  runTurn(service)
  assert.equal(service.turnStateCount, 0, 'turn/end 后本轮状态必须释放')
})

test('NS-09: 未观察到 step/start 的轮次不补发完成提醒', async () => {
  const { service, sender } = makeService()
  service.observe({ kind: 'turn-start', sessionId: SID, turn: 1 })
  const message = service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind: 'completed' })
  await flush()
  assert.equal(message, null)
  assert.equal(sender.calls.length, 0)
})

test('NS-10: 无 turn/start 但有 step/start（热加载中途）→ 完成可提醒', async () => {
  const { service, sender } = makeService()
  service.observe({ kind: 'step-start', sessionId: SID, turn: 9 })
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 9, reasonKind: 'completed' })
  await flush()
  assert.equal(sender.calls.length, 1)
})

test('NS-11: 未知轮次的 completed 静默，error 仍提醒', async () => {
  const { service, sender } = makeService()
  assert.equal(service.observe({ kind: 'turn-end', sessionId: SID, turn: 4, reasonKind: 'completed' }), null)
  service.observe({ kind: 'turn-end', sessionId: SID, turn: 5, reasonKind: 'error' })
  await flush()
  assert.equal(sender.calls.length, 1)
  assert.equal(sender.calls[0].message.title, '本轮执行出错')
})

test('NS-12: 静默终态不消耗队列也不建发送', async () => {
  const { service, sender, clock } = makeService()
  for (const reasonKind of ['aborted', 'interrupted', 'forked', 'unknown-kind']) {
    runTurn(service, { turn: 1, reasonKind })
  }
  await flush()
  assert.equal(sender.calls.length, 0)
  assert.equal(service.pendingCount, 0)
  assert.equal(clock.pendingTimers, 0)
})

// ── 串行与有界队列 ─────────────────────────────────────────────────────────

test('NS-13: 严格串行——同一时刻只有一次 sender 调用', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { turn: 3 })
  await flush()
  assert.equal(sender.calls.length, 1, '未结算前不得开始下一条')
  assert.equal(service.pendingCount, 2)
  sender.calls[0].resolve('submitted')
  await flush()
  assert.equal(sender.calls.length, 2)
  assert.equal(service.pendingCount, 1)
  sender.calls[1].resolve('submitted')
  sender.calls[2]?.resolve?.('submitted')
  await flush()
  assert.equal(sender.calls.length, 3)
  assert.equal(service.pendingCount, 0)
})

test('NS-14: 队列上限——溢出丢弃最新且限频告警一次', async () => {
  const { service, sender, warns } = makeService({ sender: fakeSender({ mode: 'manual' }), maxPending: 2 })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { turn: 3 })
  runTurn(service, { turn: 4 })
  await flush()
  // 1 条在发送 + 2 条待发 = 3 条被接受；turn 4 被丢弃
  assert.equal(sender.calls.length, 1)
  assert.equal(service.pendingCount, 2)
  assert.equal(warns.filter((w) => w.includes('通知队列已满')).length, 1, '溢出告警必须限频')
})

test('NS-15: 溢出丢弃不消耗去重名额，也不重试', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'manual' }), maxPending: 1 })
  runTurn(service, { turn: 1 }) // 立即被 worker 取走 → 正在发送，不占待发位
  await flush()
  assert.equal(service.pendingCount, 0)
  runTurn(service, { turn: 2, reasonKind: 'error' }) // 占满唯一的待发位
  assert.equal(service.pendingCount, 1)
  assert.equal(service.dedupSize, 2)
  // 待发位已满 → 丢弃最新，且不得消耗去重名额
  assert.equal(service.observe({ kind: 'turn-end', sessionId: SID, turn: 3, reasonKind: 'error' }), null)
  assert.equal(service.pendingCount, 1)
  assert.equal(service.dedupSize, 2, '被队列容量拒绝的 key 不得进入去重缓存')
  // 排空后同一轮再次到达可被接受：证明丢弃路径没有污染去重缓存
  sender.calls[0].resolve('submitted')
  await flush()
  sender.calls[1].resolve('submitted')
  await flush()
  assert.equal(service.pendingCount, 0)
  assert.ok(
    service.observe({ kind: 'turn-end', sessionId: SID, turn: 3, reasonKind: 'error' }) !== null,
    '被容量丢弃的 key 不得进入去重缓存',
  )
})

// ── 去重缓存容量与 TTL ─────────────────────────────────────────────────────

test('NS-16: 去重容量上限触发淘汰，接受非永久 exactly-once', async () => {
  const { service, sender } = makeService({ dedupCapacity: 2 })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { turn: 3 })
  await flush()
  assert.equal(sender.calls.length, 3)
  assert.ok(service.dedupSize <= 2, `去重缓存不得超过容量，实际 ${service.dedupSize}`)
  // 最早被淘汰的 key 允许再次入队（best-effort 语义）
  assert.equal(service.enqueue({ key: `${SID}:1`, source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }), true)
})

test('NS-17: TTL 到期后同一 key 可再次入队，未到期则拒绝', async () => {
  const { service, clock } = makeService({ dedupTtlMs: 1000 })
  const message = { key: 'k1', source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }
  assert.equal(service.enqueue(message), true)
  assert.equal(service.enqueue(message), false, 'TTL 内必须去重')
  clock.advance(999)
  assert.equal(service.enqueue(message), false)
  clock.advance(2)
  assert.equal(service.enqueue(message), true, 'TTL 到期后允许重新入队')
})

test('NS-18: 去重键不含明文且 tag 稳定', () => {
  assert.equal(notificationTag(`${SID}:1`), notificationTag(`${SID}:1`))
  assert.notEqual(notificationTag(`${SID}:1`), notificationTag(`${SID}:2`))
})

// ── 失败隔离 ───────────────────────────────────────────────────────────────

test('NS-19: sender 异步失败被吞掉，队列继续处理后续条目', async () => {
  const { service, sender, warns } = makeService({ sender: fakeSender({ mode: 'reject' }) })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  await flush()
  assert.equal(sender.calls.length, 2, '一次失败不得中断队列')
  assert.equal(service.lastResult, 'failed')
  assert.ok(warns.some((w) => w.includes('通知发送失败')))
})

test('NS-20: sender 同步抛出被吞掉，不逃进宿主事件回调', async () => {
  const { service, warns } = makeService({ sender: fakeSender({ mode: 'throw' }) })
  assert.doesNotThrow(() => runTurn(service))
  await flush()
  assert.equal(service.lastResult, 'failed')
  assert.ok(warns.some((w) => w.includes('同步失败')))
})

test('NS-21: 发送失败不产生第二次通知（不递归弹窗）', async () => {
  const { service, sender } = makeService({ sender: fakeSender({ mode: 'reject' }) })
  runTurn(service)
  await flush()
  assert.equal(sender.calls.length, 1, '失败路径不得补发错误通知')
})

// ── 看门狗与竞态 ───────────────────────────────────────────────────────────

test('NS-22: 看门狗超时 → abort + 结算 failed + 不重试 + 无残留计时器', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }), watchdogMs: 5000 })
  runTurn(service, { turn: 1 })
  await flush()
  assert.equal(clock.pendingTimers, 1, '发送中应有 1 个看门狗计时器')
  clock.advance(5000)
  await flush()
  assert.equal(sender.calls[0].abortSeen, true, '超时必须 abort 发送')
  assert.equal(service.lastResult, 'failed')
  assert.equal(sender.calls.length, 1, '超时不得自动重试')
  assert.equal(clock.pendingTimers, 0, '看门狗计时器必须清理')
})

test('NS-23: 看门狗后 sender 迟到结算不覆盖已定结果（只结算一次）', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }), watchdogMs: 100 })
  runTurn(service)
  await flush()
  clock.advance(100)
  await flush()
  assert.equal(service.lastResult, 'failed')
  sender.calls[0].resolve('submitted') // 迟到
  await flush()
  assert.equal(service.lastResult, 'failed', '迟到结果不得覆盖')
})

test('NS-24: abort 先于结算 → 结果为 aborted', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }), watchdogMs: 99999 })
  runTurn(service)
  await flush()
  sender.calls[0].signal.dispatchEvent(new Event('abort'))
  await flush()
  assert.equal(service.lastResult, 'aborted')
  assert.equal(clock.pendingTimers, 0)
})

test('NS-25: 正常结算清理看门狗计时器', async () => {
  const { service, clock } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service)
  await flush()
  assert.equal(clock.pendingTimers, 1)
  // 通过 fakeSender 的 abort 通道以外的方式结算：直接走 auto sender
  const { service: s2, clock: c2 } = makeService()
  runTurn(s2)
  await flush()
  assert.equal(c2.pendingTimers, 0, '成功结算后不得留下计时器')
  assert.equal(service.lastResult, undefined)
})

// ── 关闭与资源清理 ─────────────────────────────────────────────────────────

test('NS-26: close 后 enqueue/observe 一律不接收', async () => {
  const { service, sender } = makeService()
  await service.close()
  assert.equal(service.lifecycle, 'closed')
  assert.equal(service.enqueue({ key: 'x', source: 'turn', sessionId: SID, title: 't', message: 'm', silent: true }), false)
  assert.equal(service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind: 'error' }), null)
  await flush()
  assert.equal(sender.calls.length, 0)
})

test('NS-27: close 丢弃待发、中止活动发送、释放全部资源', async () => {
  const { service, sender, clock } = makeService({ sender: fakeSender({ mode: 'manual' }) })
  runTurn(service, { turn: 1 })
  runTurn(service, { turn: 2 })
  runTurn(service, { turn: 3 })
  await flush()
  assert.equal(service.pendingCount, 2)
  await service.close()
  assert.equal(service.pendingCount, 0, 'close 必须丢弃待发')
  assert.equal(sender.calls[0].abortSeen, true, 'close 必须中止活动发送')
  assert.equal(service.turnStateCount, 0)
  assert.equal(service.dedupSize, 0)
  assert.equal(clock.pendingTimers, 0, 'close 后不得有残留计时器')
})

test('NS-28: close 幂等，可重复 await', async () => {
  const { service } = makeService()
  runTurn(service)
  await service.close()
  await service.close()
  assert.equal(service.lifecycle, 'closed')
})

test('NS-29: 忽略 abort 的 sender 不阻塞 close——有界超时后放弃等待', async () => {
  const { service, clock } = makeService({
    sender: fakeSender({ mode: 'manual', ignoreAbort: true }),
    closeTimeoutMs: 3000,
  })
  runTurn(service)
  await flush()
  let closed = false
  const closing = service.close().then(() => { closed = true })
  await flush()
  assert.equal(closed, false, '不得无限等待')
  clock.advance(3000)
  await flush()
  await closing
  assert.equal(closed, true)
  assert.equal(clock.pendingTimers, 0, 'close 超时计时器必须清理')
})

test('NS-30: 空队列 close 立即完成且不创建计时器', async () => {
  const { service, clock } = makeService()
  await service.close()
  assert.equal(clock.pendingTimers, 0)
})

test('NS-31: 轮次状态有容量上界（未见 turn/end 的会话不得无限增长）', () => {
  const { service } = makeService({ turnStateCapacity: 2 })
  for (let i = 0; i < 10; i++) {
    service.observe({ kind: 'turn-start', sessionId: `s-${i}`, turn: 1 })
  }
  assert.equal(service.turnStateCount, 2, '轮次状态必须有界')
})

test('NS-32: 通知失败/成功都不改变服务对外可观察契约（无异常逃逸）', async () => {
  const { service } = makeService({ sender: fakeSender({ mode: 'reject' }) })
  assert.doesNotThrow(() => {
    runTurn(service)
    service.observe({ kind: 'turn-end', sessionId: SID, turn: 1, reasonKind: 'completed' })
  })
  await flush()
  await assert.doesNotReject(() => service.close())
})

// ── 静态边界 ───────────────────────────────────────────────────────────────

test('NS-33: 模块不 spawn 进程（通知进程只可能由 C 的 sender 实现产生）', () => {
  const source = readFileSync(SRC, 'utf8')
  assert.equal(source.includes('child_process'), false, '本模块不得引入 child_process')
  assert.equal(/powershell/i.test(source), false, '本模块不得直接调用 powershell')
  // 只允许作为"不得 spawn"的注释/断言文本出现，不得出现真正的调用形式
  assert.equal(/\bspawn\s*\(/.test(source), false, '本模块不得调用 spawn()')
  assert.equal(/node:child_process|require\(['"]child_process/.test(source), false)
})

test('NS-34: 不借用审批队列模块（通知与审批解耦）', () => {
  const source = readFileSync(SRC, 'utf8')
  assert.equal(source.includes('./queue.js'), false, '通知不得复用审批队列')
})
