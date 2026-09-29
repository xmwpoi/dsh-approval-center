// T1 专属测试：host-contract 契约层（A 独占）。
// 运行：node --test test/host-contract.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HOST_OUTCOME,
  RESULT_LABEL,
  STORE_STATUS,
  APPROVAL_STATUSES,
  agentIdOf,
  matchTool,
  selectDisplayReason,
  subagentEndLabel,
} from '../lib/host-contract.js'

test('matchTool：* 匹配全部', () => {
  assert.equal(matchTool(['*'], 'bash'), true)
  assert.equal(matchTool(['*'], 'anything_else'), true)
})

test('matchTool：前缀通配与全等', () => {
  assert.equal(matchTool(['bash*'], 'bash_persistent'), true)
  assert.equal(matchTool(['bash*'], 'ash'), false)
  assert.equal(matchTool(['bash'], 'bash'), true)
  assert.equal(matchTool(['bash'], 'bash_persistent'), false)
  assert.equal(matchTool([], 'bash'), false)
})

test('matchTool：空工具名不误匹配前缀', () => {
  assert.equal(matchTool(['bash*'], ''), false)
})

test('selectDisplayReason：zh-CN 优先', () => {
  const r = selectDisplayReason({
    agent: {},
    toolName: 'bash',
    reason: 'original',
    displayReason: { en: 'english', 'zh-CN': '中文简体', zh: '中文' },
  })
  assert.equal(r, '中文简体')
})

test('selectDisplayReason：zh-CN 缺失回退 zh', () => {
  const r = selectDisplayReason({ agent: {}, toolName: 't', reason: 'original', displayReason: { zh: '中文', en: 'english' } })
  assert.equal(r, '中文')
})

test('selectDisplayReason：无 locale 字段回退原始 reason（0.1.5 旧版请求形状）', () => {
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't', reason: 'original' }), 'original')
})

test('selectDisplayReason：locale 全空回退 reason，再回退 en', () => {
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't', reason: 'original', displayReason: { 'zh-CN': '', 'zh': ' ', en: 'english' } }), 'original')
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't', displayReason: { 'zh-CN': '', en: 'english' } }), 'english')
})

test('selectDisplayReason：全空 → 空串（无原因文案）', () => {
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't', reason: '', displayReason: { en: '' } }), '')
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't' }), '')
})

test('selectDisplayReason：纯空白视为空（trim 判定）', () => {
  assert.equal(selectDisplayReason({ agent: {}, toolName: 't', reason: '  ', displayReason: { 'zh-CN': '  ' } }), '')
})

test('agentIdOf：优先 agent.id，回退 session.id，兜底 unknown', () => {
  assert.equal(agentIdOf({ agent: { id: 'a1' } }), 'a1')
  assert.equal(agentIdOf({ agent: { session: { id: 's1' } } }), 's1')
  assert.equal(agentIdOf({ agent: {} }), 'unknown')
})

test('结果映射表：fail-closed 铁律', () => {
  // 超时/无人应答/故障绝不映射为 rejected（不谎报用户决策）或 allowed-once（不放行）
  assert.equal(HOST_OUTCOME.timeout, 'unavailable')
  assert.equal(HOST_OUTCOME.dismissed, 'unavailable')
  assert.equal(HOST_OUTCOME.unavailable, 'unavailable')
  assert.equal(HOST_OUTCOME.cancelled, 'cancelled')
  assert.equal(HOST_OUTCOME['allowed-once'], 'allowed-once')
  assert.equal(HOST_OUTCOME.rejected, 'rejected')
})

test('审计状态映射：保留精确语义', () => {
  assert.equal(STORE_STATUS.timeout, 'timeout')
  assert.equal(STORE_STATUS.dismissed, 'dismissed')
  assert.equal(STORE_STATUS.cancelled, 'cancelled')
  assert.equal(STORE_STATUS.unavailable, 'unavailable')
  assert.equal(STORE_STATUS['allowed-once'], 'approved')
  assert.equal(STORE_STATUS.rejected, 'rejected')
})

test('回执文案与审计语义一致', () => {
  assert.match(RESULT_LABEL.timeout, /超时/)
  assert.match(RESULT_LABEL.unavailable, /不可用/)
  assert.equal(RESULT_LABEL.rejected, '已拒绝')
})

test('审计状态词汇封闭（七值）', () => {
  assert.deepEqual([...APPROVAL_STATUSES], ['pending', 'approved', 'rejected', 'timeout', 'dismissed', 'cancelled', 'unavailable'])
})

test('subagentEndLabel：按 stopReason 区分，不把失败说成完成', () => {
  assert.equal(subagentEndLabel('completed'), '已完成')
  assert.equal(subagentEndLabel('aborted'), '已中止')
  assert.equal(subagentEndLabel('error'), '运行出错')
  assert.equal(subagentEndLabel('max-tokens'), '达到 token 上限')
  assert.equal(subagentEndLabel('refusal'), '模型拒绝执行')
})

test('subagentEndLabel：缺失与未知 stopReason 的回退', () => {
  assert.equal(subagentEndLabel(undefined), '已结束')
  assert.equal(subagentEndLabel(''), '已结束')
  assert.equal(subagentEndLabel('some-new-reason'), '已结束（some-new-reason）')
})
