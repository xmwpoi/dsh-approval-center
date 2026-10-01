/**
 * R6 §1 唯一规则门（Agent A）：成对/类型/空白预检在 **三层** 一致。
 *
 * | 输入                                 | 行为 |
 * | 两字段都未提供（undefined）           | legacy 兼容 |
 * | 两字段显式提供且非空白字符串           | 结构化 title/decision/context |
 * | 只提供一项 / 空串 / 空白 / null / 非串 | unavailable，禁止 legacy/投递 |
 *
 * 层 1（本文件）：Node showApprovalToast 预检 —— 非法 resolve 'unavailable' 且**零 spawn**；
 *   legacy 照常 spawn；有效对以**独立 PS 参数**传递。
 * 层 2（task-toast-script / 真实 PS）：脚本侧 fail-loud（exit 4 = unavailable，非 exit 1=拒绝）。
 * 层 3（集成 approval-flow）：真实插件 spawn 参数逐字含 -DecisionSummary/-ContextSummary。
 *
 * 铁律：非法**不等于** rejected（exit 1 是"用户点了拒绝"——把调用方 bug 谎报成人类决策
 * 正是本插件历史上修过的最严重缺陷）。unavailable = exit 4 = "本渠道未产生决策"。
 */
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { showApprovalToast } from '../lib/dialog.js'

/** 可驱动的 mock spawn：记录参数并允许测试手动结算。 */
function harness() {
  const spawns = []
  const deps = {
    spawn: (file, args) => {
      const child = {
        stdout: { on: () => {} },
        stderr: { on: () => {} },
        on: (event, listener) => { child[`on_${event}`] = listener },
        kill: () => { child.killed = true },
      }
      spawns.push({ file, args, child })
      return child
    },
    setTimer: (fn) => ({ fn }),
    clearTimer: () => {},
  }
  return { deps, spawns }
}

const REQ = (overrides = {}) => ({
  title: 'T',
  message: 'm',
  timeoutSec: 5,
  ...overrides,
})

describe('R6 §1 唯一规则：Node 预检（非法 → unavailable，零 spawn）', () => {
  const ILLEGAL = [
    ['空对（显式空串）', '', ''],
    ['空白 decision', '   ', 'ctx'],
    ['空白 context', 'dec', '   '],
    ['两侧都空白', ' ', '  '],
    ['单侧 decision', 'dec', undefined],
    ['单侧 context', undefined, 'ctx'],
    ['null decision', null, 'ctx'],
    ['null context', 'dec', null],
    ['两侧都 null', null, null],
    ['非字符串 decision', 123, 'ctx'],
    ['非字符串两侧', {}, []],
  ]

  for (const [label, d, c] of ILLEGAL) {
    test(`非法：${label} → unavailable 且零 spawn`, async () => {
      const h = harness()
      const h2 = showApprovalToast(REQ({ decisionSummary: d, contextSummary: c }), h.deps)
      const r = await h2.promise
      assert.equal(r, 'unavailable', `${label} 必须按渠道不可用处理（exit 4 语义），不得投递`)
      assert.equal(h.spawns.length, 0, `${label} 不得拉起任何进程`)
    })
  }

  test('legacy：两字段都未提供（undefined）→ 照常 spawn（显式兼容路径）', async () => {
    const h = harness()
    const h2 = showApprovalToast(REQ(), h.deps)
    void h2.promise
    assert.equal(h.spawns.length, 1, 'legacy 兼容路径照常投递')
    assert.equal(h.spawns[0].args.includes('-DecisionSummary'), false, 'legacy 不带结构化参数')
  })

  test('有效对：以独立 PS 参数 -DecisionSummary/-ContextSummary 传递', async () => {
    const h = harness()
    const decision = '拒绝不执行；30秒后自动拒绝'
    const context = '任务：修复登录问题\n操作：bash'
    const h2 = showApprovalToast(REQ({ decisionSummary: decision, contextSummary: context }), h.deps)
    void h2.promise
    const args = h.spawns[0].args
    const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
    assert.equal(flag('-DecisionSummary'), decision, 'decisionSummary 必须独立传参')
    assert.equal(flag('-ContextSummary'), context, 'contextSummary 必须独立传参')
  })

  test('undefined 与缺失等价：不传字段 = 不传 undefined 字段（legacy）', async () => {
    const h = harness()
    showApprovalToast(REQ({ decisionSummary: undefined, contextSummary: undefined }), h.deps)
    assert.equal(h.spawns.length, 1)
    assert.equal(h.spawns[0].args.includes('-DecisionSummary'), false)
  })
})
