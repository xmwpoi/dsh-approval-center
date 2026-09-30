/**
 * 任务通知 sender 单测（T0 契约 §4.3，mock spawn，绝不拉起真实进程）。
 *
 * 覆盖：参数数组构造（绝不拼 Shell 字符串）、Tag/Group/silent 三项 spawn 前校验、
 * 四路结算竞争只结算一次（exit/error/abort/watchdog）、看门狗、abort→kill、
 * spawn 同步抛出、管道受限消费。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, test } from 'node:test'
import { createTaskNotificationSender, RESULT_TOAST_SCRIPT } from '../lib/dialog.js'

/** 可驱动的 mock child：记录注册的监听器，测试手动触发。 */
function makeChild() {
  const listeners = { error: [], exit: [] }
  const dataListeners = []
  const child = {
    stdout: { on: (event, listener) => { if (event === 'data') dataListeners.push(listener) } },
    stderr: { on: () => {} },
    on: (event, listener) => { listeners[event]?.push(listener) },
    kill: () => { child.killed = true; return true },
    killed: false,
  }
  return {
    child,
    emitExit: (code) => listeners.exit.forEach((fn) => fn(code)),
    emitError: (error) => listeners.error.forEach((fn) => fn(error)),
    emitData: (chunk) => dataListeners.forEach((fn) => fn(chunk)),
  }
}

function harness({ settleOnSpawn } = {}) {
  const calls = []
  const timers = []
  let childHandle
  const deps = {
    spawn: (file, args, options) => {
      const h = makeChild()
      childHandle = h
      calls.push({ file, args, options })
      if (settleOnSpawn) h.emitExit(settleOnSpawn)
      return h.child
    },
    setTimer: (fn) => { const t = { fn }; timers.push(t); return t },
    clearTimer: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1) },
  }
  return { deps, calls, timers, get child() { return childHandle } }
}

const MSG = (overrides = {}) => ({
  key: 'sess-1:3',
  source: 'turn',
  sessionId: 'sess-1',
  title: '本轮回复已完成',
  message: '任务：demo\nAgent 已完成这一轮回复，请返回 DSH 查看。',
  silent: true,
  ...overrides,
})

describe('任务通知 sender：参数构造与 spawn 前校验', () => {
  test('参数数组启动隐藏 PS5.1：含 Title/Message/Tag/Group/Sound，绝不拼 Shell 字符串', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
    h.child.emitExit(0) // 结算，否则 promise 永不 resolve（watchdog 是 mock 计时器）
    await p
    assert.equal(h.calls.length, 1, '恰好一次 spawn')
    const { file, args, options } = h.calls[0]
    assert.equal(file, 'powershell.exe')
    assert.ok(Array.isArray(args), '必须是参数数组（拒绝拼接 Shell 字符串）')
    assert.ok(options.windowsHide, '必须隐藏窗口')
    assert.equal(options.stdio, 'pipe', '必须用管道受限收集诊断')
    assert.ok(args.includes('-NoProfile') && args.includes('-WindowStyle'), '必须 -NoProfile + Hidden')
    const fileIdx = args.indexOf('-File')
    assert.ok(fileIdx >= 0 && args[fileIdx + 1].endsWith(RESULT_TOAST_SCRIPT), '指向 toast.ps1')
    const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
    assert.equal(flag('-Title'), '本轮回复已完成')
    assert.ok(flag('-Message').includes('任务：demo'))
    assert.equal(flag('-Group'), 'dsh-task', '任务通知固定 dsh-task（与审批/旧结果隔离）')
    assert.equal(flag('-Sound'), 'silent', '默认静音')
    const expected = createHash('sha256').update('sess-1:3', 'utf8').digest('hex').slice(0, 16)
    assert.equal(flag('-Tag'), expected, 'Tag = sha256(key) 前 16 位小写 hex')
    assert.match(flag('-Tag'), /^[0-9a-f]{16}$/)
  })

  test('silent=false 时 -Sound default（可配置系统默认提示音）', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG({ silent: false }), new AbortController().signal)
    h.child.emitExit(0)
    await p
    const args = h.calls[0].args
    assert.equal(args[args.indexOf('-Sound') + 1], 'default')
  })

  test('key 为空串：spawn 前 fail-closed，不拉起任何进程', async () => {
    const h = harness()
    const r = await createTaskNotificationSender(h.deps).send(MSG({ key: '' }), new AbortController().signal)
    assert.equal(r, 'failed')
    assert.equal(h.calls.length, 0, '非法 key 不得 spawn')
  })

  test('silent 非布尔：spawn 前 fail-closed（不猜测用户意图）', async () => {
    const h = harness()
    const r = await createTaskNotificationSender(h.deps).send(MSG({ silent: 'yes' }), new AbortController().signal)
    assert.equal(r, 'failed')
    assert.equal(h.calls.length, 0)
  })
})

describe('任务通知 sender：四路结算竞争（只结算一次，先到先得）', () => {
  test('exit 0 → submitted；非零 → failed（1=参数非法 2=投递失败）', async () => {
    for (const [code, want] of [[0, 'submitted'], [1, 'failed'], [2, 'failed'], [3, 'failed'], [null, 'failed']]) {
      const h = harness()
      const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
      h.child.emitExit(code)
      assert.equal(await p, want, `exit ${code} → ${want}`)
    }
  })

  test('error 事件 → failed（缺 powershell.exe / 被拦截）', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
    h.child.emitError(new Error('ENOENT'))
    assert.equal(await p, 'failed')
  })

  test('watchdog 超时：kill 并 failed，timer 被清理', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
    assert.equal(h.timers.length, 1, '注册了一个看门狗')
    h.timers[0].fn()
    assert.equal(await p, 'failed')
    assert.equal(h.child.child.killed, true, '超时必须强杀子进程')
    assert.equal(h.timers.length, 0, '看门狗已清理')
  })

  test('caller abort：kill 并 aborted', async () => {
    const h = harness()
    const ac = new AbortController()
    const p = createTaskNotificationSender(h.deps).send(MSG(), ac.signal)
    ac.abort()
    assert.equal(await p, 'aborted')
    assert.equal(h.child.child.killed, true)
  })

  test('signal 已中止：直接 aborted，不 spawn', async () => {
    const h = harness()
    const ac = new AbortController()
    ac.abort()
    const r = await createTaskNotificationSender(h.deps).send(MSG(), ac.signal)
    assert.equal(r, 'aborted')
    assert.equal(h.calls.length, 0)
  })

  test('exit 与 watchdog 竞争：先到者胜，且不误杀已结算路径', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
    h.child.emitExit(0)
    assert.equal(await p, 'submitted')
    // 晚到的 watchdog 触发不得改变结果（settled 已为 true）
    h.timers.forEach((t) => t.fn())
    assert.equal(h.child.child.killed, false, '已正常结算后不再强杀')
  })

  test('spawn 同步抛出（受限沙箱 EPERM）：failed，异常不逃逸', async () => {
    const deps = {
      spawn: () => { throw new Error('EPERM') },
      setTimer: (fn) => ({ fn }),
      clearTimer: () => {},
    }
    const r = await createTaskNotificationSender(deps).send(MSG(), new AbortController().signal)
    assert.equal(r, 'failed')
  })

  test('管道被消费：诊断受限收集，不无界累积', async () => {
    const h = harness()
    const p = createTaskNotificationSender(h.deps).send(MSG(), new AbortController().signal)
    // 大量写入诊断（>4096 上限），不应阻塞
    for (let i = 0; i < 100; i++) h.child.emitData(Buffer.alloc(200, 0x41))
    h.child.emitExit(0)
    assert.equal(await p, 'submitted')
  })
})
