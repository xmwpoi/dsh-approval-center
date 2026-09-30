// T2 测试：队列生命周期。运行：node --test test/queue.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ApprovalQueue } from '../lib/queue.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

/** 可控 handler：每个请求挂在一个手工 deferred 上，记录启动顺序 */
function controllableHandler() {
  const started = []
  const pending = new Map()
  return {
    started,
    call(req) {
      started.push(req.id)
      const d = deferred()
      pending.set(req.id, d)
      return d.promise
    },
    settle(id, value) {
      const d = pending.get(id)
      if (d) { pending.delete(id); d.resolve(value) }
    },
    fail(id, err) {
      const d = pending.get(id)
      if (d) { pending.delete(id); d.reject(err) }
    },
  }
}

/** 等待 handler 真正启动（避免 fixed-tick 时序脆弱）：仅对会被启动的请求使用 */
async function waitForStarted(h, id) {
  for (let i = 0; i < 200 && !h.started.includes(id); i++) {
    await new Promise((r) => setImmediate(r))
  }
  assert.ok(h.started.includes(id), `handler for ${id} never started; started=${JSON.stringify(h.started)}`)
}

test('serial：严格 FIFO，一次一个', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const pa = q.submit({ id: 'a' })
  const pb = q.submit({ id: 'b' })
  const pc = q.submit({ id: 'c' })
  await waitForStarted(h, 'a')
  assert.deepEqual(h.started, ['a'])
  h.settle('a', 'va')
  assert.equal(await pa, 'va')
  await waitForStarted(h, 'b')
  assert.deepEqual(h.started, ['a', 'b'])
  h.settle('b', 'vb')
  await waitForStarted(h, 'c')
  h.settle('c', 'vc')
  assert.deepEqual(await Promise.all([pa, pb, pc]), ['va', 'vb', 'vc'])
})

test('parallel：并发上限 3，完成一个补位一个', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'parallel', 3)
  const ps = Array.from({ length: 5 }, (_, i) => q.submit({ id: `p${i}` }))
  await waitForStarted(h, 'p2')
  assert.deepEqual(h.started, ['p0', 'p1', 'p2'])
  h.settle('p0', 'v0')
  await waitForStarted(h, 'p3')
  assert.deepEqual(h.started, ['p0', 'p1', 'p2', 'p3'])
  h.settle('p1', 'v1')
  await waitForStarted(h, 'p4')
  // 注意：settle 只对已启动的请求生效；p2 在此期间一直占用槽位，队列清空后释放
  h.settle('p2', 'v2')
  h.settle('p3', 'v3')
  h.settle('p4', 'v4')
  const vs = await Promise.all(ps)
  assert.deepEqual(vs, ['v0', 'v1', 'v2', 'v3', 'v4'])
})

test('入队前已中止的 signal → onCancel，handler 不启动', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const ac = new AbortController()
  ac.abort()
  const p = q.submit({ id: 'x' }, ac.signal)
  assert.equal(await p, 'cancelled')
  await new Promise((r) => setImmediate(r))
  assert.equal(h.started.length, 0)
})

test('排队中取消 → onCancel，handler 不启动，不占位', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const first = q.submit({ id: 'first' })
  await waitForStarted(h, 'first')
  const ac = new AbortController()
  const second = q.submit({ id: 'second' }, ac.signal)
  const third = q.submit({ id: 'third' })
  ac.abort()
  assert.equal(await second, 'cancelled')
  h.settle('first', 'vf')
  assert.equal(await first, 'vf')
  await waitForStarted(h, 'third')
  assert.deepEqual(h.started, ['first', 'third'])
  h.settle('third', 'vt')
  assert.equal(await third, 'vt')
})

test('执行中取消：组合 signal 中止并传给 handler', async () => {
  let seenSignal
  const q = new ApprovalQueue({
    run: async (req, signal) => {
      seenSignal = signal
      return new Promise((resolve) => {
        signal.addEventListener('abort', () => resolve(`aborted:${req.id}`), { once: true })
      })
    },
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, 'serial')
  const ac = new AbortController()
  const p = q.submit({ id: 'live' }, ac.signal)
  await new Promise((r) => setImmediate(r))
  assert.equal(seenSignal.aborted, false)
  ac.abort()
  assert.equal(await p, 'aborted:live')
  assert.equal(seenSignal.aborted, true)
})

test('close：排队项 onClose、活动项组合 signal 中止、close 等待活动项结算', async () => {
  let liveSignal
  const q = new ApprovalQueue({
    run: (req, signal) => {
      if (req.id === 'live') {
        liveSignal = signal
        return new Promise((resolve) => signal.addEventListener('abort', () => resolve('stopped'), { once: true }))
      }
      return new Promise(() => {})
    },
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, 'serial')
  const live = q.submit({ id: 'live' })
  const queued1 = q.submit({ id: 'q1' })
  const queued2 = q.submit({ id: 'q2' })
  await new Promise((r) => setImmediate(r))
  assert.equal(liveSignal.aborted, false)

  const closing = q.close()
  assert.equal(await queued1, 'unavailable')
  assert.equal(await queued2, 'unavailable')
  assert.equal(liveSignal.aborted, true)
  assert.equal(await live, 'stopped')
  await closing
  assert.equal(q.state, 'closed')
})

test('close 幂等；close 后 submit 用 onClose 结算', async () => {
  const q = new ApprovalQueue({ run: async () => 'ok', onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const c1 = q.close()
  const c2 = q.close()
  assert.equal(c1, c2)
  await c1
  assert.equal(await q.submit({ id: 'late' }), 'unavailable')
  assert.equal(q.state, 'closed')
})

test('无关闭等待需求时 close 立即完成', async () => {
  const q = new ApprovalQueue({ run: async () => 'ok', onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'parallel', 3)
  await q.close()
  assert.equal(q.state, 'closed')
})

test('handler 抛异常：该请求 reject，队列不断裂，后续照常', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const bad = q.submit({ id: 'bad' })
  const good = q.submit({ id: 'good' })
  await waitForStarted(h, 'bad')
  h.fail('bad', new Error('boom'))
  await assert.rejects(bad, /boom/)
  await waitForStarted(h, 'good')
  h.settle('good', 'vg')
  assert.equal(await good, 'vg')
})

test('handler 同步抛出：转为 rejection，容量释放', async () => {
  let n = 0
  const q = new ApprovalQueue({
    run: (req) => {
      n++
      if (req.id === 'sync-throw') throw new Error('sync')
      return Promise.resolve('ok')
    },
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, 'serial')
  const bad = q.submit({ id: 'sync-throw' })
  await assert.rejects(bad, /sync/)
  assert.equal(await q.submit({ id: 'next' }), 'ok')
  assert.equal(n, 2)
})

test('20 请求压力（serial）：无丢单、无串单、全部结算', async () => {
  const q = new ApprovalQueue({ run: async (req) => `v:${req.id}`, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const ps = Array.from({ length: 20 }, (_, i) => q.submit({ id: `s${i}` }).then((v) => [i, v]))
  const out = await Promise.all(ps)
  assert.equal(out.length, 20)
  out.forEach(([i, v]) => assert.equal(v, `v:s${i}`))
  assert.equal(q.state, 'accepting')
})

test('20 请求压力（parallel=3）：全部结算，峰值并发不超过 3', async () => {
  let active = 0
  let peak = 0
  const q = new ApprovalQueue({
    run: async (req) => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 1 + (req.id % 3)))
      active--
      return `v:${req.id}`
    },
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, 'parallel', 3)
  const ps = Array.from({ length: 20 }, (_, i) => q.submit({ id: i }))
  const vs = await Promise.all(ps)
  assert.equal(vs.length, 20)
  assert.ok(peak <= 3, `peak=${peak}`)
})

test('混合取消与完成（parallel=3）：无悬挂、容量全部释放', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'parallel', 3)
  const acs = Array.from({ length: 8 }, () => new AbortController())
  const ps = acs.map((ac, i) => q.submit({ id: `m${i}` }, ac.signal))
  await waitForStarted(h, 'm2')
  assert.deepEqual(h.started, ['m0', 'm1', 'm2'])
  // 取消三个排队项：不启动、立即结算
  acs[3].abort(); acs[5].abort(); acs[7].abort()
  assert.equal(await ps[3], 'cancelled')
  assert.equal(await ps[5], 'cancelled')
  assert.equal(await ps[7], 'cancelled')
  // 完成两个活动项，释放的槽位被 m4/m6 占据
  h.settle('m1', 'v1')
  h.settle('m2', 'v2')
  await waitForStarted(h, 'm6')
  assert.deepEqual(h.started, ['m0', 'm1', 'm2', 'm4', 'm6'])
  h.settle('m0', 'v0')
  h.settle('m4', 'v4')
  h.settle('m6', 'v6')
  const vs = await Promise.all(ps)
  assert.deepEqual(vs.map((v, i) => (i === 3 || i === 5 || i === 7) ? (v === 'cancelled' ? 'C' : `BAD:${v}`) : v),
    ['v0', 'v1', 'v2', 'C', 'v4', 'C', 'v6', 'C'])
  // 容量释放后新请求可启动
  const extra = q.submit({ id: 'extra' })
  await waitForStarted(h, 'extra')
  h.settle('extra', 've')
  assert.equal(await extra, 've')
})

test('close 与 submit 竞争：排队项 onClose、活动项响应中止信号', async () => {
  let liveSignal
  const q = new ApprovalQueue({
    run: (req, signal) => {
      liveSignal = signal
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve('stopped'), { once: true }))
    },
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, 'serial')
  const pending = q.submit({ id: 'pending' })
  const late = q.submit({ id: 'late' })
  await new Promise((r) => setImmediate(r))
  const closing = q.close()
  assert.equal(await late, 'unavailable')
  assert.equal(liveSignal.aborted, true)
  assert.equal(await pending, 'stopped')
  await closing
  assert.equal(q.state, 'closed')
})

test('排队项取消后队列状态与后续请求正常', async () => {
  const h = controllableHandler()
  const q = new ApprovalQueue({ run: h.call, onCancel: () => 'cancelled', onClose: () => 'unavailable' }, 'serial')
  const ac = new AbortController()
  const busy = q.submit({ id: 'busy' })
  await waitForStarted(h, 'busy')
  const cancelled = q.submit({ id: 'victim' }, ac.signal)
  ac.abort()
  assert.equal(await cancelled, 'cancelled')
  assert.equal(q.state, 'accepting')
  h.settle('busy', 'vb')
  assert.equal(await busy, 'vb')
  const after = q.submit({ id: 'after' })
  await waitForStarted(h, 'after')
  h.settle('after', 'va')
  assert.equal(await after, 'va')
})
