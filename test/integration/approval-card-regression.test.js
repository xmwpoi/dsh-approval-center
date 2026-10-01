/**
 * R5-D 审批卡片结构回归：C 的 R4 实机 FAIL 样本（长原因吞掉选择/等待）的自动层固化。
 *
 * **边界（R5-D 第 54 条明确要求如实报告）**：
 *   本文件断言的是 **message 字符串的结构完整性**——即长原因经 Node 侧截断后，
 *   "选择：批准=本次允许；拒绝=不允许执行" 与 "等待：<n>秒；超时=<动作>" 仍**出现在字符串里**。
 *   这**不证明** Windows 渲染层不吞行（C 的 R4 L4/L4b/L7 FAIL 是像素层事实，
 *   修复依赖 R5 的布局方案：固定安全信息优先 + 3 个 <text>）。静态结构回归 ≠ 像素验证。
 *
 * 样本来源：C 的 `r4-windows-results.md` §3（L4：200 字符原因 FAIL；L4b：100 码点截断后仍 FAIL）。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel, makeReq, openTurn, closeTurn, waitForSpawns } from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const approvalToasts = (before) => spawned().slice(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')

after(() => { globalThis.__approvalMockChannel = undefined })

/** 走真实审批路径，返回卡片 message */
async function cardOf(host, session, reason) {
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
  const message = argsOf(rec).message
  rec.child.emit('exit', 1)   // 拒绝，尽快结算
  await pending
  closeTurn(session)
  return message
}

describe('R5-S 审批卡片结构回归（C 实机 FAIL 样本固化；静态，不覆盖像素渲染）', () => {
  const cases = [
    ['32 中文字符', '需'.repeat(32)],
    ['100 中文字符（Node 侧截断阈值）', '因'.repeat(100)],
    ['200 中文字符（C 的 L4 原始样本）', '长'.repeat(200)],
  ]

  for (const [label, reason] of cases) {
    test(`原因 ${label}：message 仍含 选择/等待/批准仅本次（结构完整）`, async () => {
      const host = await startNotificationHost()
      const s = host.createRoot('r5-card')
      const message = await cardOf(host, s, reason)
      assert.ok(message.includes('选择：批准=本次允许；拒绝=不允许执行'), `选择行必须在：${JSON.stringify(message)}`)
      assert.ok(message.includes('等待：30秒'), '等待行必须在')
      assert.ok(message.includes('超时=自动拒绝'), '超时动作必须在')
      assert.ok(!/永久授权/.test(message), '不得描述为永久授权')
      await host.unload()
    })
  }

  test('R5-S2 无原因 → 占位文案；不伪造命令', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('r5-card-noreason')
    const message = await cardOf(host, s, undefined)
    assert.ok(message.includes('宿主未提供审批原因'), '原因缺失必须如实占位')
    assert.ok(!message.includes('rm -rf'), '不得伪造命令')
    await host.unload()
  })

  test('R5-S3 timeoutAction=approve → 醒目自动批准文案（不得伪装拒绝）', async () => {
    const host = await startNotificationHost({ config: { timeoutAction: 'approve' } })
    const s = host.createRoot('r5-card-appr')
    const message = await cardOf(host, s, '需要执行'.repeat(20))
    assert.ok(message.includes('自动批准'), 'approve 必须明确写自动批准')
    assert.ok(!message.includes('超时=自动拒绝'), 'approve 不得沿用拒绝文案')
    await host.unload()
  })
})
