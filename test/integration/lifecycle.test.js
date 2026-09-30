/**
 * T5 生命周期与故障注入集成测试（真实宿主 + mock 通知通道，非交互）。
 * 真实组件：Cordis Context/plugin fiber、ApprovalService（fixture 0.1.7-rc.2）、
 * 插件 lib 构建产物、SQLite 审计库（隔离临时目录）。
 * mock 组件：仅 powershell.exe 的异步 spawn（见 hooks/spawn-shim.mjs）。
 * 期望语义：docs/compat/contract-017.md §4.5（关闭来源 → 宿主结果映射表）。
 *
 * 两条来自 352b2da 的接线回归已修复，本文件保留故障注入断言。
 *
 * 注意：async 函数 return 一个 pending promise 会把 adopt 语义带进 await，
 * helper 一律返回 { pending } 包装对象，避免测试在撤回前就阻塞在审批结算上。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, test } from 'node:test'
import {
  approvalPairOf,
  createMockChannel,
  injectSettleFailure,
  makeReq,
  openTurn,
  closeTurn,
  readAuditRows,
  startHostTracked,
  toastArgsOf,
  trackCleanup,
  waitForSpawns,
} from './helpers/harness.mjs'

const channel = createMockChannel()
const spawned = () => channel.spawns
const deltaSpawns = (before) => spawned().slice(before)

after(() => {
  globalThis.__approvalMockChannel = undefined
})

/** 开 turn → 发起审批 → 等弹窗出现（insert 已完成、store 锁已持有）。
 * 返回 { pending }；调用方随后自行 abort/exit/卸载驱动结算。 */
async function startPendingRequest(host, reqOptions = {}) {
  const before = spawned().length
  openTurn(host.session)
  const pending = host.service.request(makeReq(host.agent, reqOptions))
  await waitForSpawns(channel, before + 1)
  return { pending, record: spawned()[before], before }
}

describe('宿主撤回（req.signal abort）', () => {
  test('进行中撤回：宿主 cancelled，审计 cancelled，子进程被杀，不悬挂', async (t) => {
    const host = await startHostTracked()
    const controller = new AbortController()
    const { pending, record, before } = await startPendingRequest(host, { toolName: 'pwsh', signal: controller.signal })

    controller.abort(new Error('host withdraw'))

    const outcome = await pending
    assert.equal(outcome, 'cancelled', '宿主撤回必须返回 cancelled')
    await host.unload()

    const { asked, decided } = approvalPairOf(host.session)
    assert.equal(asked.length, 1)
    assert.equal(decided.length, 1)
    assert.equal(decided[0].data.outcome, 'cancelled')
    assert.equal(asked[0].data.id, decided[0].data.id, 'asked/decided 共享同一 id')

    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'cancelled', '审计保留精确的撤回语义')

    assert.equal(record.child.killed, true, '撤回后 mock 子进程被 kill')
    const resultToasts = deltaSpawns(before).map(toastArgsOf).filter((a) => a.title === '审批结果')
    assert.equal(resultToasts.length, 0, 'notifyOnApprovalResult 默认关，无结果回执')
  })

  test('入队前已撤回（signal.aborted）：插件立即结算，无 spawn、无审计行', async (t) => {
    const host = await startHostTracked()
    const controller = new AbortController()
    controller.abort()
    const before = spawned().length
    openTurn(host.session)
    const outcome = await host.service.request(makeReq(host.agent, { toolName: 'pwsh', signal: controller.signal }))
    assert.equal(outcome, 'cancelled')
    assert.equal(deltaSpawns(before).length, 0, '预取消不拉起 PowerShell')
    assert.equal(readAuditRows(host.dataDir).length, 0, '队列 onCancel 快速路径不写审计（未进入 processOne）')
    await host.unload()
  })
})

describe('插件卸载 / 重载（V14）', () => {
  test('卸载时有活动请求：宿主结果为 unavailable（契约 §4.5），req.signal 未撤回', async (t) => {
    const host = await startHostTracked()
    const { pending, before } = await startPendingRequest(host, { toolName: 'pwsh', reason: 'no withdraw here' })
    // req.signal 未提供（未撤回）：下面的终止来自插件卸载
    const disposePromise = host.unload()
    const outcome = await pending
    await disposePromise

    const rows = readAuditRows(host.dataDir)
    // 契约 §4.5：插件卸载/关闭 → 宿主 unavailable + 审计 unavailable。
    assert.equal(outcome, 'unavailable', '插件卸载导致的终止不得上报为宿主撤回（cancelled）')
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'unavailable', '审计同样不得记为 cancelled（那是宿主撤回的语义）')
    closeTurn(host.session)
  })

  test('卸载时有排队请求：排队项按 unavailable 结算，卸载返回后无悬挂', async (t) => {
    const host = await startHostTracked()
    const first = await startPendingRequest(host, { toolName: 'pwsh' })
    // serial 队列：第一个未结算，第二个必然排队
    openTurn(host.session)
    const second = host.service.request(makeReq(host.agent, { toolName: 'pwsh' }))

    const disposePromise = host.unload()
    const secondOutcome = await second
    assert.equal(secondOutcome, 'unavailable', '排队项在关闭时按 onClose→unavailable 结算')
    await disposePromise
    await first.pending.catch(() => {}) // 第一条走 unload-cancelled 路径（见上一个用例），不在此断言其值

    // 排队项不应有审计行（insert 只在 processOne 内执行，排队项从未运行）
    const rows = readAuditRows(host.dataDir)
    assert.equal(rows.length, 1, '排队项未 insert，仅活动请求有审计行')
    closeTurn(host.session)
  })

  test('卸载后请求：监听已注销，宿主默认兜底 unavailable，无 spawn', async (t) => {
    const host = await startHostTracked()
    const before = spawned().length
    await host.unload()
    openTurn(host.session)
    const outcome = await host.service.request(makeReq(host.agent, { toolName: 'pwsh' }))
    assert.equal(outcome, 'unavailable', '插件卸载后 waterfall 落到宿主默认应答')
    assert.equal(deltaSpawns(before).length, 0)
  })

  test('重载后仅一个应答者：新请求只产生一次 spawn 且走新实例', async (t) => {
    const host = await startHostTracked()
    await host.unload()
    const spawnsBefore = spawned().length
    // 同一 ctx 重挂载（等价宿主 HMR/重载），复用同一 dataDir 验证旧数据仍可读
    const second = await startHostTracked({ dataDir: host.dataDir })
    const { pending, record } = await startPendingRequest(second, { toolName: 'pwsh' })
    record.child.emit('exit', 1)
    const outcome = await pending
    assert.equal(outcome, 'rejected')
    assert.equal(deltaSpawns(spawnsBefore).length, 1, '重载后旧监听不得残留（否则 spawn 次数 > 1）')

    const rows = readAuditRows(second.dataDir)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].status, 'rejected')
    await second.unload()
    closeTurn(second.session)
  })

  test('卸载触发定向清理：活动请求被终止时按 requestToken 清理本人资源', async (t) => {
    const host = await startHostTracked()
    const { before } = await startPendingRequest(host, { toolName: 'pwsh' })
    const token = toastArgsOf(spawned()[before]).requestToken
    assert.match(token ?? '', /^[0-9a-f]{32}$/, 'requestToken 是 32 位 hex（requestId 去连字符派生）')

    await host.unload()

    const cleanups = deltaSpawns(before).map(toastArgsOf).filter((a) => a.cleanupToken !== undefined)
    assert.ok(cleanups.length >= 1, '卸载路径应调用 cleanupRequest 定向清理')
    assert.ok(cleanups.some((a) => a.cleanupToken === token), '清理 token 与审批 token 一致（定向，不清他人）')
    // fire-and-forget 限制（派发包第 6 条）：清理进程是否真正完成由 T6 实机验证
  })
})

describe('存储故障注入（V15 自动层）', () => {
  test('insert 失败（dataDir 是文件）：返回 unavailable，不弹审批，不崩溃', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'approval-t5-file-'))
    trackCleanup(dir)
    const notADir = join(dir, 'not-a-dir')
    writeFileSync(notADir, 'x')
    const host = await startHostTracked({ dataDir: notADir })
    const before = spawned().length
    openTurn(host.session)
    const outcome = await host.service.request(makeReq(host.agent, { toolName: 'pwsh' }))
    assert.equal(outcome, 'unavailable', '审计写入失败不弹审批（契约 §4.4）')
    assert.equal(deltaSpawns(before).length, 0)
    await host.unload()
  })

  test('同 dataDir 第二实例：锁冲突→unavailable，首实例 pending 不被修改', async (t) => {
    const host1 = await startHostTracked()
    const first = await startPendingRequest(host1, { toolName: 'pwsh' }) // 首实例持锁且有一条 pending
    const beforeRows = readAuditRows(host1.dataDir)
    assert.equal(beforeRows.length, 1)
    assert.equal(beforeRows[0].status, 'pending')

    const host2 = await startHostTracked({ dataDir: host1.dataDir })
    const before = spawned().length
    openTurn(host2.session)
    const outcome2 = await host2.service.request(makeReq(host2.agent, { toolName: 'pwsh' }))
    assert.equal(outcome2, 'unavailable', '第二实例锁冲突按渠道不可用 fail-closed')
    assert.equal(deltaSpawns(before).length, 0, '第二实例不得弹审批')

    const afterRows = readAuditRows(host1.dataDir)
    assert.deepEqual(afterRows.map((r) => r.status), beforeRows.map((r) => r.status), '首实例 pending 未被第二实例碰过')

    // 收尾：放行首实例请求并卸载两实例
    first.record.child.emit('exit', 0)
    assert.equal(await first.pending, 'allowed-once')
    await host1.unload()
    await host2.unload()
    closeTurn(host1.session)
    closeTurn(host2.session)
  })

  test('settle 失败 + Toast 批准：不放行，文案不得显示已批准', async (t) => {
    const host = await startHostTracked({ config: { notifyOnApprovalResult: true } })
    const { pending, before } = await startPendingRequest(host, { toolName: 'pwsh' })
    // 审批行已 insert；注入"所有 UPDATE 失败"的真实 SQLite 错误路径
    injectSettleFailure(host.dataDir)

    spawned()[before].child.emit('exit', 0) // 用户点了批准
    const outcome = await pending
    await host.unload()

    assert.equal(outcome, 'unavailable', '批准无法落审计时必须改判 unavailable（计划书 §3.4）')
    const rows = readAuditRows(host.dataDir)
    assert.equal(rows[0].status, 'pending', '结算失败：审计行不得伪装成 approved')

    const receipt = deltaSpawns(before).map(toastArgsOf).find((a) => a.title === '审批结果')
    assert.ok(receipt, '开启 notifyOnApprovalResult 后应有结果回执')
    assert.ok(!receipt.message.includes('已批准'), `回执文案不得显示"已批准"，实际：${receipt.message}`)
    closeTurn(host.session)
  })
})
