// T3 mock 单测：showApprovalToast 的退出码映射、取消、竞态与看门狗。
// 全部经由 deps 注入 fake spawn / fake clock，绝不 spawn 真实进程、
// 不注册 URI、不弹真实通知（计划书 §5：普通自动测试全部 mock）。
// 运行：node --test test/dialog.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { showApprovalToast } from '../lib/dialog.js'

/**
 * 可编程 fake child：测试用例通过 pending 的 emit 句柄在任意时刻
 * 注入 error/exit 事件，并记录 kill() 调用。
 */
function fakeSpawnFactory() {
  const children = []
  const spawn = (file, args) => {
    const listeners = { error: [], exit: [] }
    const child = {
      file,
      args,
      killed: false,
      killCount: 0,
      listeners,
      on(event, listener) {
        listeners[event]?.push(listener)
        return child
      },
      kill() {
        child.killCount++
        child.killed = true
        return true
      },
      emitError(error) {
        for (const l of listeners.error) l(error)
      },
      emitExit(code) {
        for (const l of listeners.exit) l(code)
      },
    }
    children.push(child)
    return child
  }
  return { spawn, children }
}

/** 可手动推进的 fake clock。 */
function fakeClockFactory() {
  const tasks = []
  let now = 0
  return {
    setTimer(fn, ms) {
      const task = { fn, at: now + ms, cleared: false }
      tasks.push(task)
      return task
    },
    clearTimer(task) {
      task.cleared = true
    },
    advance(ms) {
      now += ms
      for (const task of [...tasks]) {
        if (!task.cleared && task.at <= now) {
          task.cleared = true
          task.fn()
        }
      }
    },
  }
}

function makeDeps({ timeoutSec = 30, timeoutAction } = {}) {
  const f = fakeSpawnFactory()
  const c = fakeClockFactory()
  const deps = { spawn: f.spawn, setTimer: c.setTimer, clearTimer: c.clearTimer }
  const request = (signal) => ({
    title: 't',
    message: 'm',
    timeoutSec,
    timeoutAction,
    signal,
  })
  return { deps, children: f.children, clock: c, request }
}

test('D-01: exit 0 → allowed-once；exit 1 → rejected', async () => {
  for (const [code, expected] of [[0, 'allowed-once'], [1, 'rejected']]) {
    const { deps, children, request } = makeDeps()
    const { promise } = showApprovalToast(request(), deps)
    assert.equal(children.length, 1)
    children[0].emitExit(code)
    assert.equal(await promise, expected)
  }
})

test('D-02: exit 2 → timeout（无人应答，不伪造拒绝）', async () => {
  const { deps, children, request } = makeDeps()
  const { promise } = showApprovalToast(request(), deps)
  children[0].emitExit(2)
  assert.equal(await promise, 'timeout')
})

test('D-03: exit 3 / 其他 / null → unavailable（fail-closed）', async () => {
  for (const code of [3, 4, 7, 255, null]) {
    const { deps, children, request } = makeDeps()
    const { promise } = showApprovalToast(request(), deps)
    children[0].emitExit(code)
    assert.equal(await promise, 'unavailable', `code=${code}`)
  }
})

test('D-04: child error 事件 → unavailable，且看门狗被清除', async () => {
  const { deps, children, clock, request } = makeDeps()
  const { promise } = showApprovalToast(request(), deps)
  children[0].emitError(new Error('ENOENT'))
  assert.equal(await promise, 'unavailable')
  // 看门狗已清：推进时钟不得改变终态
  clock.advance(60 * 60 * 1000)
  assert.equal(await promise, 'unavailable')
})

test('D-05: spawn 同步抛出 → unavailable，异常不逃出 promise', async () => {
  const c = fakeClockFactory()
  const throwingSpawn = () => {
    throw new Error('EPERM')
  }
  const { promise } = showApprovalToast(
    { title: 't', message: 'm', timeoutSec: 30 },
    { spawn: throwingSpawn, setTimer: c.setTimer, clearTimer: c.clearTimer },
  )
  assert.equal(await promise, 'unavailable')
})

test('D-06: signal 已中止 → cancelled，且完全不 spawn', async () => {
  const { deps, children } = makeDeps()
  const controller = new AbortController()
  controller.abort()
  const { promise } = showApprovalToast(
    { title: 't', message: 'm', timeoutSec: 30, signal: controller.signal },
    deps,
  )
  assert.equal(await promise, 'cancelled')
  assert.equal(children.length, 0)
})

test('D-07: 展示中 abort → kill 被调用、settled 为 cancelled', async () => {
  const { deps, children, request } = makeDeps()
  const controller = new AbortController()
  const { promise } = showApprovalToast(request(controller.signal), deps)
  controller.abort()
  assert.equal(await promise, 'cancelled')
  assert.equal(children[0].killCount, 1)
})

test('D-08a: abort 后晚到 exit，终态不被覆盖', async () => {
  const { deps, children, request } = makeDeps()
  const controller = new AbortController()
  const { promise } = showApprovalToast(request(controller.signal), deps)
  controller.abort()
  children[0].emitExit(0) // 晚到的"批准"
  assert.equal(await promise, 'cancelled')
})

test('D-08b: exit 后晚到 abort，终态不被覆盖', async () => {
  const { deps, children, request } = makeDeps()
  const controller = new AbortController()
  const { promise } = showApprovalToast(request(controller.signal), deps)
  children[0].emitExit(1)
  controller.abort() // 晚到的取消
  assert.equal(await promise, 'rejected')
  assert.equal(children[0].killCount, 0) // 已结算的 abort 不再杀进程
})

test('D-08c: watchdog 后晚到 exit，终态不被覆盖', async () => {
  const { deps, children, clock, request } = makeDeps({ timeoutSec: 10 })
  const { promise } = showApprovalToast(request(), deps)
  clock.advance(10 * 1000 + 15_000) // 触发看门狗
  children[0].emitExit(0) // 晚到的"批准"
  assert.equal(await promise, 'unavailable')
  assert.equal(children[0].killCount, 1)
})

test('D-09: 看门狗在 timeoutSec+15s 强杀并返回 unavailable', async () => {
  const { deps, children, clock, request } = makeDeps({ timeoutSec: 10 })
  const { promise } = showApprovalToast(request(), deps)
  clock.advance(10 * 1000 + 14_999)
  assert.equal(children[0].killCount, 0)
  clock.advance(1)
  assert.equal(children[0].killCount, 1)
  assert.equal(await promise, 'unavailable')
})

test('D-10: 20 个并发请求互不串号、全部结算', async () => {
  const f = fakeSpawnFactory()
  const c = fakeClockFactory()
  const deps = { spawn: f.spawn, setTimer: c.setTimer, clearTimer: c.clearTimer }
  const outcomes = [0, 1, 2, 3]
  const handles = []
  for (let i = 0; i < 20; i++) {
    handles.push({ i, promise: showApprovalToast({ title: 't', message: 'm', timeoutSec: 30 }, deps).promise })
  }
  assert.equal(f.children.length, 20)
  // 每个 child 收到属于自己的退出码：偶数序号给 0/1，奇数给 2/3
  f.children.forEach((child, idx) => child.emitExit(outcomes[idx % outcomes.length]))
  const results = await Promise.all(handles.map((h) => h.promise))
  for (let i = 0; i < 20; i++) {
    const expected = ['allowed-once', 'rejected', 'timeout', 'unavailable'][i % 4]
    assert.equal(results[i], expected, `req #${i}`)
  }
})

test('D-11: abort 监听在结算后被移除（不泄漏）', async () => {
  const { deps, children, request } = makeDeps()
  const controller = new AbortController()
  const { promise } = showApprovalToast(request(controller.signal), deps)
  // node 的 AbortSignal listener 移除后 abort 不会再触发
  children[0].emitExit(0)
  await promise
  // 若监听未移除，这里会触发 child.kill（无害）但更关键是语义泄漏；
  // 通过 signal 的 listener 计数验证（Node 24 支持 getEventListeners）。
  const { getEventListeners } = await import('node:events')
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})
