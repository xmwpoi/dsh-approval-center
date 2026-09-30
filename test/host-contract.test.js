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
  approvalResultLabel,
  effectiveDialogOutcome,
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

test('effectiveDialogOutcome：队列已关闭时的 cancelled 改判 unavailable（不谎报宿主撤回）', () => {
  // 插件 close() 中止的活动 worker：cancelled → unavailable
  assert.equal(effectiveDialogOutcome('cancelled', true), 'unavailable')
  // 队列未关闭（accepting）：真实的宿主撤回保持 cancelled
  assert.equal(effectiveDialogOutcome('cancelled', false), 'cancelled')
})

test('effectiveDialogOutcome：关闭期其他结果不受影响（真实用户决策不抹除）', () => {
  assert.equal(effectiveDialogOutcome('allowed-once', true), 'allowed-once')
  assert.equal(effectiveDialogOutcome('rejected', true), 'rejected')
  assert.equal(effectiveDialogOutcome('timeout', true), 'timeout')
  assert.equal(effectiveDialogOutcome('unavailable', true), 'unavailable')
  assert.equal(effectiveDialogOutcome('allowed-once', false), 'allowed-once')
})

test('approvalResultLabel：审计结算失败后不得展示"已批准"', () => {
  const label = approvalResultLabel('allowed-once', { timeoutAction: 'reject', settleFailed: true })
  assert.match(label, /审计结算失败/)
  assert.doesNotMatch(label, /^已批准$/)
  // 超时自动批准路径同样不得在结算失败后展示为已放行
  const label2 = approvalResultLabel('timeout', { timeoutAction: 'approve', settleFailed: true })
  assert.match(label2, /超时无人应答（已自动批准）/)
  assert.match(label2, /审计结算失败/)
})

test('approvalResultLabel：结算失败的非放行结果附带失败说明，语义保留', () => {
  assert.match(approvalResultLabel('rejected', { timeoutAction: 'reject', settleFailed: true }), /已拒绝/)
  assert.match(approvalResultLabel('cancelled', { timeoutAction: 'reject', settleFailed: true }), /请求方已取消/)
  assert.match(approvalResultLabel('timeout', { timeoutAction: 'reject', settleFailed: true }), /超时无人应答（已自动拒绝）/)
})

test('approvalResultLabel：正常路径文案不变', () => {
  assert.equal(approvalResultLabel('allowed-once', { timeoutAction: 'reject', settleFailed: false }), '已批准')
  assert.equal(approvalResultLabel('rejected', { timeoutAction: 'reject', settleFailed: false }), '已拒绝')
  assert.equal(approvalResultLabel('timeout', { timeoutAction: 'reject', settleFailed: false }), '超时无人应答（已自动拒绝）')
  assert.equal(approvalResultLabel('timeout', { timeoutAction: 'approve', settleFailed: false }), '超时无人应答（已自动批准）')
})
