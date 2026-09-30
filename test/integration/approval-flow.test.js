/**
 * T5 审批流集成测试（真实宿主 + mock 通知通道，非交互）。
 * 真实组件：Cordis Context/plugin fiber、ApprovalService（fixture 0.1.7-rc.2）、
 * 插件 lib 构建产物、SQLite 审计库（隔离临时目录）。
 * mock 组件：仅 powershell.exe 的异步 spawn（见 hooks/spawn-shim.mjs）。
 * 期望语义：docs/compat/contract-017.md §2.1/§2.2/§4.5。
 *
 * 通道计数是进程级累计的：所有断言一律用差值（spawnsBefore），不做全量等值。
 */
import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import {
  approvalPairOf,
  createMockChannel,
  makeReq,
  openTurn,
  closeTurn,
  readAuditRows,
  startHostTracked,
  toastArgsOf,
  waitForSpawns,
} from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const deltaSpawns = (before) => spawned().slice(before)

after(() => {
  globalThis.__approvalMockChannel = undefined
})

/** 开 turn → 发起审批 → 等弹窗 → 驱动退出码 → 收结果（返回 outcome 与本次审批的 spawn 记录） */
async function runApproval(host, reqOptions, exitCode, { skipTurnClose = false } = {}) {
  const before = spawned().length
  openTurn(host.session)
  const pending = host.service.request(makeReq(host.agent, reqOptions))
  await waitForSpawns(channel, before + 1)
  const record = spawned()[before]
  record.child.emit('exit', exitCode)
  const outcome = await pending
  if (!skipTurnClose) closeTurn(host.session)
  return { outcome, record, before }
}

describe('阻断用例 1：open turn 内匹配审批的完整流', () => {
  test('prepend 只认领一次；asked/decided 成对且 turn 包围；审计 approved', async (t) => {
    const host = await startHostTracked()
    const { outcome, before } = await runApproval(host, { toolName: 'pwsh', reason: '需要执行 shell' }, 0)
    await host.unload()

    assert.equal(outcome, 'allowed-once')

    // 审计配对：asked/decided 各恰 1 条、同 id、顺序正确、被 turn 包围
    const { asked, decided } = approvalPairOf(host.session)
    assert.equal(asked.length, 1)
    assert.equal(decided.length, 1)
    assert.equal(asked[0].data.id, decided[0].data.id, 'asked/decided 共享同一 ApprovalRequestId')
    assert.equal(decided[0].data.outcome, 'allowed-once')
    const seqs = host.session.all.map((e) => e.type)
    assert.ok(seqs.indexOf('turn/start') < seqs.indexOf('approval/asked'), 'asked 在 turn/start 之后')
    assert.ok(seqs.indexOf('approval/decided') < seqs.indexOf('turn/end'), 'decided 在 turn/end 之前')

    // prepend 只认领一次：本次请求恰 1 次 spawn（无二次询问、无 Web 转问）
    assert.equal(deltaSpawns(before).length, 1)

    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'approved')
    assert.equal(rows[0].toolName, 'pwsh')
  })

  test('插件先于下游应答者：匹配时下游 next 不被调用', async (t) => {
    const host = await startHostTracked()
    let downCalls = 0
    host.ctx.on('approval/request', async () => {
      downCalls++
      return 'rejected'
    })
    const { outcome } = await runApproval(host, { toolName: 'pwsh' }, 1) // 拒绝按钮
    await host.unload()
    assert.equal(outcome, 'rejected')
    assert.equal(downCalls, 0, '插件认领后不得转问下游')
    assert.equal(readAuditRows(host.dataDir)[0].status, 'rejected')
  })
})

describe('阻断用例 2：不匹配转交与 never 策略', () => {
  test('tools 不匹配：next 恰一次交下游，插件零 spawn 零记录', async (t) => {
    const host = await startHostTracked({ config: { tools: ['bash*'] } })
    const before = spawned().length
    let downCalls = 0
    host.ctx.on('approval/request', async () => {
      downCalls++
      return 'allowed-once'
    })
    openTurn(host.session)
    const outcome = await host.service.request(makeReq(host.agent, { toolName: 'pwsh' }))
    closeTurn(host.session)
    await host.unload()

    assert.equal(outcome, 'allowed-once', '宿主收到下游应答')
    assert.equal(downCalls, 1, 'next() 恰好一次，不重复询问')
    assert.equal(deltaSpawns(before).length, 0, '不匹配不弹审批')
    assert.equal(readAuditRows(host.dataDir).length, 0, '不匹配不写审计')
  })

  test('policy=never：宿主派发前短路，插件零痕迹', async (t) => {
    const host = await startHostTracked({ policy: 'never' })
    const before = spawned().length
    openTurn(host.session)
    const outcome = await host.service.request(makeReq(host.agent, { toolName: 'pwsh' }))
    closeTurn(host.session)
    await host.unload()

    assert.equal(outcome, 'rejected', 'never 策略由宿主直接拒绝')
    assert.equal(deltaSpawns(before).length, 0, '插件收不到请求，无 Toast')
    assert.equal(readAuditRows(host.dataDir).length, 0, '插件无审计记录')
    const { decided } = approvalPairOf(host.session)
    assert.equal(decided[0]?.data.outcome, 'rejected', '宿主审计仍记录 rejected（宿主侧行为）')
  })
})

describe('displayReason 展示与审计分离（V13）', () => {
  test('zh-CN 优先展示；审计库保存原始 reason', async (t) => {
    const host = await startHostTracked()
    const { record } = await runApproval(host, {
      toolName: 'pwsh',
      reason: 'rm -rf build',
      displayReason: { en: 'delete build output', 'zh-CN': '删除构建产物' },
    }, 0)
    await host.unload()
    const args = toastArgsOf(record)
    assert.ok(args.message.includes('删除构建产物'), `展示应取 zh-CN：${args.message}`)
    assert.ok(!args.message.includes('delete build output'), '不应展示 en（zh-CN 存在时）')
    assert.equal(readAuditRows(host.dataDir)[0].reason, 'rm -rf build', '审计保存原始 reason，不是本地化文本')
  })

  test('只有 en 时回退展示 en；只有 reason 时展示 reason', async (t) => {
    const hostEn = await startHostTracked()
    const en = await runApproval(hostEn, {
      toolName: 'pwsh',
      displayReason: { en: 'delete build output' },
    }, 0)
    await hostEn.unload()
    assert.ok(toastArgsOf(en.record).message.includes('delete build output'))

    const hostPlain = await startHostTracked()
    const plain = await runApproval(hostPlain, { toolName: 'pwsh', reason: '手工原因' }, 0)
    await hostPlain.unload()
    assert.ok(toastArgsOf(plain.record).message.includes('原因: 手工原因'))
  })
})

describe('超时与退出码映射（V02/V03/V04/V05）', () => {
  test('exit 2 + 默认 reject：宿主 unavailable，审计 timeout', async (t) => {
    const host = await startHostTracked()
    const { outcome } = await runApproval(host, { toolName: 'pwsh' }, 2)
    await host.unload()
    assert.equal(outcome, 'unavailable', '无人应答 fail-closed，不谎报拒绝')
    assert.equal(readAuditRows(host.dataDir)[0].status, 'timeout')
  })

  test('exit 2 + timeoutAction=approve：宿主 allowed-once，审计仍 timeout', async (t) => {
    const host = await startHostTracked({ config: { timeoutAction: 'approve' } })
    const { outcome } = await runApproval(host, { toolName: 'pwsh' }, 2)
    await host.unload()
    assert.equal(outcome, 'allowed-once', '仅真实 timeout 允许自动批准')
    assert.equal(readAuditRows(host.dataDir)[0].status, 'timeout', '审计保留 timeout 精确语义')
  })

  test('exit 3 / exit 4（通道故障）：unavailable，不因任何配置放行', async (t) => {
    for (const code of [3, 4]) {
      const host = await startHostTracked({ config: { timeoutAction: 'approve' } })
      const { outcome } = await runApproval(host, { toolName: 'pwsh' }, code)
      await host.unload()
      assert.equal(outcome, 'unavailable', `exit ${code} 必须 fail-closed，即使 timeoutAction=approve`)
      assert.equal(readAuditRows(host.dataDir)[0].status, 'unavailable')
    }
  })

  test('timeoutSec 默认值 30 经 schema 投影到弹窗参数（V19 自动层）', async (t) => {
    const host = await startHostTracked() // 不传 timeoutSec，验证 Config 默认投影
    const { record } = await runApproval(host, { toolName: 'pwsh' }, 0)
    await host.unload()
    assert.equal(toastArgsOf(record).timeoutSec, '30', 'schema 默认 30 投影到 -TimeoutSec')
  })
})

describe('子代理结束文案（V16 自动层）', () => {
  test('stopReason 区分文案：error 不报"已完成"，completed 报"已完成"', async (t) => {
    const host = await startHostTracked({ config: { notifyOnSubagentEnd: true } })
    const before = spawned().length
    host.ctx.emit('subagent/end', { runId: 'r1', provider: 'p', id: 'c1', stopReason: 'error' })
    host.ctx.emit('subagent/end', { runId: 'r2', provider: 'p', id: 'c2', stopReason: 'completed' })
    assert.equal(deltaSpawns(before).length, 2, '两条通知均已投递')
    await host.unload()

    const toasts = deltaSpawns(before).map(toastArgsOf)
    const errToast = toasts.find((a) => a.message.includes('c1'))
    const okToast = toasts.find((a) => a.message.includes('c2'))
    assert.ok(errToast, 'error 结束应有通知')
    assert.ok(errToast.title.includes('运行出错'), `error 文案：${errToast.title}`)
    assert.ok(!errToast.title.includes('已完成'), '不得把 error 谎报为已完成')
    assert.ok(okToast.title.includes('已完成'), `completed 文案：${okToast.title}`)
  })
})
