/**
 * R6-D 审批卡片结构回归（重写为 R5/R6 结构化契约）。
 *
 * C 的 R4 实机 FAIL 样本（长原因吞掉选择/等待）在此固化为**结构**断言：
 * 旧布局把"选择/等待"挤在动态正文里，长原因会把它们推出横幅；
 * R5/R6 布局把**固定安全信息**（拒绝含义 + 真实超时动作）放进独立的
 * decisionSummary，排在最前且不参与截断 —— 因此**任何** reason 长度下
 * 安全信息都必须完整。
 *
 * **边界（继承 R5-D 的诚实声明，仍有效）**：
 *   本文件断言的是 **message 字符串的结构完整性**，**不证明** Windows 渲染层不吞行。
 *   静态结构回归 ≠ 像素验证；像素验证归 C 的新包实机（r5/r6 候选渲染）。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel, makeReq, openTurn, closeTurn, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const approvalToasts = (before) => spawned().slice(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')

after(() => { globalThis.__approvalMockChannel = undefined })

/** 走真实审批路径，返回卡片参数（title/message/decision/context/原始 spawn args） */
async function cardOf(host, session, reason, { timeoutAction } = {}) {
  const before = spawned().length
  openTurn(session)
  const pending = host.ctx.waterfall(
    (await import('@deepseek-ai/dsh-scope')).scopeTarget(session, session),
    'approval/request',
    makeReq({ id: String(session.id), session }, { toolName: 'bash', reason }),
    () => Promise.resolve('unavailable'),
  )
  await waitForSpawns(channel, before + 1)
  const rec = approvalToasts(before)[0]
  assert.ok(rec, '审批应被认领')
  const a = argsOf(rec)
  const flag = (name) => { const i = rec.args.indexOf(name); return i >= 0 ? rec.args[i + 1] : undefined }
  const structured = {
    decisionSummary: flag('-DecisionSummary'),
    contextSummary: flag('-ContextSummary'),
  }
  rec.child.emit('exit', 1)   // 拒绝，尽快结算
  await pending
  closeTurn(session)
  return { ...a, ...structured, args: rec.args }
}

describe('R6-S 审批卡片结构回归（R5/R6 结构化契约；静态，不覆盖像素渲染）', () => {
  const cases = [
    ['32 中文字符', '需'.repeat(32)],
    ['100 中文字符（Node 侧截断阈值）', '因'.repeat(100)],
    ['200 中文字符（C 的 L4 原始样本）', '长'.repeat(200)],
  ]

  for (const [label, reason] of cases) {
    test(`原因 ${label}：安全信息（decision）完整且排最前，context 独立携带任务/操作/原因`, async () => {
      const host = await startNotificationHost()
      const s = host.createRoot('r6-card')
      const card = await cardOf(host, s, reason)

      // 结构化参数必须**成对**出现（R6 §1：合法主审批不得落 legacy）
      assert.ok(card.decisionSummary !== undefined, '必须传 -DecisionSummary（不得落 legacy）')
      assert.ok(card.contextSummary !== undefined, '必须传 -ContextSummary（不得落 legacy）')

      // 固定安全标题：不含工具名、不含长文本
      assert.equal(card.title, '需要你审批 · 批准仅本次', 'R5 固定安全标题')

      // decision = 固定安全信息，**不因 reason 变长而被截断/挤掉**
      assert.ok(card.decisionSummary.startsWith('拒绝不执行；'), `decision 必须完整：${JSON.stringify(card.decisionSummary)}`)
      assert.ok(card.decisionSummary.includes('30秒后自动拒绝'), `真实超时动作必须在：${JSON.stringify(card.decisionSummary)}`)

      // context = 动态摘要（任务/操作/原因），reason 长度只影响 context 自身
      assert.ok(card.contextSummary.includes('任务：'), `任务行必须在：${JSON.stringify(card.contextSummary)}`)
      assert.ok(card.contextSummary.includes('操作：bash'), `操作行必须在：${JSON.stringify(card.contextSummary)}`)
      assert.ok(card.contextSummary.includes('原因：'), `原因行必须在：${JSON.stringify(card.contextSummary)}`)

      // message 兼容字段：安全信息仍排最前（防止下游仍按整段正文处理）
      assert.ok(card.message.startsWith(card.decisionSummary + '\n'), 'message 必须以 decision 开头（安全信息优先）')

      // 隐私/授权语义
      assert.ok(!/永久授权/.test(card.message), '不得描述为永久授权')
      assert.ok(!/rm -rf/.test(card.message), '不得伪造命令')
      await host.unload()
    })
  }

  test('R6-S2 无原因 → 占位文案；不伪造命令', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('r6-card-noreason')
    const card = await cardOf(host, s, undefined)
    assert.ok(card.contextSummary.includes('宿主未提供审批原因'), '原因缺失必须如实占位')
    assert.ok(!card.message.includes('rm -rf'), '不得伪造命令')
    await host.unload()
  })

  test('R6-S3 timeoutAction=approve → decision 如实写自动批准（不得伪装拒绝）', async () => {
    const host = await startNotificationHost({ config: { timeoutAction: 'approve' } })
    const s = host.createRoot('r6-card-appr')
    const card = await cardOf(host, s, '需要执行'.repeat(20))
    assert.ok(card.decisionSummary.includes('自动批准'), `approve 必须明确写自动批准：${JSON.stringify(card.decisionSummary)}`)
    assert.ok(!card.decisionSummary.includes('自动拒绝'), 'approve 不得沿用拒绝文案')
    assert.ok(card.message.startsWith(card.decisionSummary + '\n'), '安全信息仍排最前')
    await host.unload()
  })
})
