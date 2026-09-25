import { showApprovalToast } from '../lib/dialog.js'

const timeoutSec = Number(process.argv[2] ?? 60)

/** 审批结果 → 上报 harness 的结果（与 src/index.ts 的 HOST_OUTCOME 一致）。 */
const HOST_OUTCOME = {
  'allowed-once': 'allowed-once',
  'rejected': 'rejected',
  'timeout': 'unavailable',
  'dismissed': 'unavailable',
  'cancelled': 'cancelled',
  'unavailable': 'unavailable',
}

console.log(`[test] 投递通知中心审批，窗口 ${timeoutSec}s`)
console.log('[test] 通知会一直停留直到你处理它（scenario=reminder）；请点击「批准」或「拒绝」')

const { promise } = showApprovalToast({
  title: '审批请求 · pwsh',
  message: '代理: test001\n操作: pwsh\n原因: 集成测试，请在通知上点击「批准」或「拒绝」',
  timeoutSec,
  timeoutAction: 'reject',
})

const outcome = await promise
console.log(`[test] 审批结果 = ${outcome} → harness = ${HOST_OUTCOME[outcome]}`)
console.log('[test] 预期对照：点批准→allowed-once；点拒绝→rejected；')
console.log('             什么都不点→timeout；投递失败→unavailable')
// 批准/拒绝是"有人应答"，其余都算这一轮没有结论：用退出码区分，便于脚本化
process.exit(outcome === 'allowed-once' || outcome === 'rejected' ? 0 : 1)
