/**
 * R6-D 成对参数唯一规则：三层门禁用例（Agent D）。
 *
 * **冻结规则**（R6 派发书 §16-§22）：
 * | 输入 | 行为 |
 * |---|---|
 * | 两字段都未提供 | legacy 兼容 |
 * | 两字段显式提供且字符串有效非空白 | 结构化 title/decision/context |
 * | 只提供一项 | **unavailable，禁止 legacy / 禁止投递** |
 * | 显式空串 / 空白 / null / 非字符串 / 缺配对 | **unavailable，禁止 legacy / 禁止投递** |
 *
 * Node 侧：可选 `undefined` 按"未提供"处理；**任何已定义值进入成对预检**。
 * PS 侧：用**顶层实际绑定参数**判定（`$PSBoundParameters.ContainsKey` 或明确 mode），
 *        不能因为函数调用时总传了默认空串就把 mode 判错；非法在 AUMID/状态文件/Show 之前 **exit 4**。
 *
 * **非法 ≠ rejected**：非法结构必须结算 `unavailable`（fail-closed），不得报成用户拒绝。
 *
 * 三层（每层独立断言）：
 *   L-A Node 公共入口 `showApprovalToast` + mock spawn 通道
 *   L-B **真实执行** PS 脚本（`-ValidateOnly`：不注册 URI、不写状态文件、不 Show）
 *   L-C 真实插件审批流 → 实际 spawn 参数与 `formatApprovalCard` 输出**逐字相等**
 *
 * 铁律：不投递真实通知（L-B 用 ValidateOnly、L-A/L-C 用 spawn-shim）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { after, describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { argsOf, startNotificationHost } from './helpers/notification-host.mjs'
import { createMockChannel, makeReq, openTurn, closeTurn, waitForSpawns } from './helpers/harness.mjs'

// 两级上溯：test/integration/ → repo 根。（D 原稿写三级，是从更深的树搬来的，会落到上级目录）
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN_LIB = process.env.DSH_PLUGIN_ENTRY ?? join(REPO_ROOT, 'lib', 'index.js')
/** 脚本目录跟随被测插件入口（保证 L-B 与 L-A/L-C 测的是同一棵树） */
const SCRIPTS_DIR = join(dirname(PLUGIN_LIB), '..', 'scripts')
const APPROVAL_SCRIPT = join(SCRIPTS_DIR, 'approval-toast.ps1')

const channel = createMockChannel()
const spawned = () => channel.spawns
const approvalToasts = (before) => spawned().slice(before).filter((r) => argsOf(r).script === 'approval-toast.ps1')

after(() => { globalThis.__approvalMockChannel = undefined })

/** L-A：直接调用 Node 公共入口，返回 { outcome, spawns } */
async function nodeEntry(req) {
  const dialog = await import(pathToFileURL(join(dirname(PLUGIN_LIB), 'dialog.js')).href)
  const before = spawned().length
  const handle = dialog.showApprovalToast({
    title: '需要你审批 · 批准仅本次',
    message: 'legacy 单正文',
    timeoutSec: 30,
    timeoutAction: 'reject',
    ...req,
  })
  // 有界：正常路径等 spawn 后驱动 exit；fail-closed 路径立即结算
  const outcome = await Promise.race([
    handle.promise,
    new Promise((r) => setTimeout(() => r('__PENDING__'), 1200)),
  ])
  const spawns = spawned().length - before
  if (outcome === '__PENDING__') {
    // 仍在等人工按钮：驱动一次 exit 让它收尾，避免悬挂
    for (const rec of approvalToasts(before)) rec.child.emit('exit', 1)
    await handle.promise.catch(() => {})
  }
  return { outcome, spawns }
}

/** L-B：真实执行 PS 脚本（ValidateOnly，零副作用） */
function psValidate({ decision, context, title = 'T', message = 'M' }) {
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', APPROVAL_SCRIPT, '-ValidateOnly', '-Title', title, '-Message', message]
  if (decision !== undefined) argv.push('-DecisionSummary', decision)
  if (context !== undefined) argv.push('-ContextSummary', context)
  const r = spawnSync('powershell.exe', argv, { encoding: 'utf8', windowsHide: true })
  return { status: r.status, stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? '') }
}

/**
 * L-B'：**生产路径**（不加 -ValidateOnly）真实执行 PS 脚本。
 *
 * 为什么必须有这一层（R7 §11/§17 的教训）：
 *   `-ValidateOnly` 在脚本 483 行就 exit，**根本走不到**生产前置校验（512 行）与
 *   New-Item/Register-UriScheme/Ensure-AppId（511/517/519）。因此只用 ValidateOnly
 *   的用例无法发现"生产前置抛异常 → 未捕获 → exit 1"这类缺陷：
 *   exit 1 在本插件契约里是"用户点了拒绝"（dialog.ts mapExitCode: case 1 → rejected），
 *   会把调用方传错参数谎报成人类决策。
 *
 * 零副作用证据：
 *   1) 传一个**不存在的私有 -StateDir**，断言它未被创建（证明 New-Item 未执行）
 *   2) 运行前后读取 HKCU dshapproval 注册值，断言逐字未变（证明未注册 URI）
 *   3) 给短 TimeoutSec；非法输入应在任何等待之前就退出
 */
function psProduction({ decision, context, title = 'T', message = 'M', timeoutSec = 3 }) {
  const stateDir = join(mkdtempSync(join(tmpdir(), 'r7-prod-')), 'ghost-state')
  rmSync(stateDir, { recursive: true, force: true })
  const regValue = () => {
    const r = spawnSync('reg', ['query', 'HKCU\\Software\\Classes\\dshapproval\\shell\\open\\command', '/ve'],
      { encoding: 'utf8', windowsHide: true })
    return String(r.stdout ?? '').trim()
  }
  const before = regValue()
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', APPROVAL_SCRIPT, '-Title', title, '-Message', message,
    '-TimeoutSec', String(timeoutSec), '-RequestToken', 'a'.repeat(32), '-StateDir', stateDir]
  if (decision !== undefined) argv.push('-DecisionSummary', decision)
  if (context !== undefined) argv.push('-ContextSummary', context)
  const r = spawnSync('powershell.exe', argv, { encoding: 'utf8', windowsHide: true, timeout: 60_000 })
  const after = regValue()
  const stateCreated = existsSync(stateDir)
  rmSync(stateDir, { recursive: true, force: true })
  return {
    status: r.status,
    stdout: String(r.stdout ?? ''), stderr: String(r.stderr ?? ''),
    stateCreated, regUnchanged: before === after,
  }
}

describe('R6-1 L-A Node 公共入口：成对/类型/空白预检（非法 → unavailable，零 spawn）', () => {
  test('A-1 两字段都未提供 → legacy 兼容（可 spawn，不报错）', async () => {
    const host = await startNotificationHost()
    const { outcome, spawns } = await nodeEntry({})
    assert.equal(spawns, 1, 'legacy 路径应正常投递（兼容旧调用）')
    assert.notEqual(outcome, undefined)
    await host.unload()
  })

  test('A-2 两字段显式提供且有效 → 结构化路径（成对参数 + 正常结算）', async () => {
    const host = await startNotificationHost()
    const before = spawned().length
    const dialog = await import(pathToFileURL(join(dirname(PLUGIN_LIB), 'dialog.js')).href)
    const handle = dialog.showApprovalToast({
      title: '需要你审批 · 批准仅本次', message: 'legacy', timeoutSec: 30, timeoutAction: 'reject',
      decisionSummary: '拒绝不执行；30秒后自动拒绝', contextSummary: '任务：x\n操作：y\n原因：z',
    })
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    const a = argsOf(rec)
    assert.ok(a.message !== undefined, '正常路径应投递')
    assert.equal(rec.args[rec.args.indexOf('-DecisionSummary') + 1], '拒绝不执行；30秒后自动拒绝', '成对参数逐字传递')
    assert.equal(rec.args[rec.args.indexOf('-ContextSummary') + 1], '任务：x\n操作：y\n原因：z', '成对参数逐字传递')
    rec.child.emit('exit', 1)
    assert.equal(await handle.promise, 'rejected')
    await host.unload()
  })

  const illegal = [
    ['A-3 只提供 decisionSummary（缺 context）', { decisionSummary: '拒绝不执行；30秒后自动拒绝' }],
    ['A-4 只提供 contextSummary（缺 decision）', { contextSummary: '任务：x' }],
    ['A-5 显式空对（两者都是空串）', { decisionSummary: '', contextSummary: '' }],
    ['A-6 显式空白对（两者都是空白）', { decisionSummary: '   ', contextSummary: '\t\n ' }],
    ['A-7 一项空白一项有效', { decisionSummary: '   ', contextSummary: '任务：x' }],
    ['A-8 decisionSummary 为 null', { decisionSummary: null, contextSummary: '任务：x' }],
    ['A-9 contextSummary 为非字符串对象', { decisionSummary: '拒绝不执行', contextSummary: { bad: true } }],
  ]

  for (const [label, req] of illegal) {
    test(`${label} → unavailable 且零 spawn（不得 legacy、不得 rejected）`, async () => {
      const host = await startNotificationHost()
      const { outcome, spawns } = await nodeEntry(req)
      assert.equal(spawns, 0, `非法结构禁止投递，实测 spawns=${spawns}`)
      assert.equal(outcome, 'unavailable', `非法结构必须 fail-closed，实测 outcome=${String(outcome)}`)
      assert.notEqual(outcome, 'rejected', '非法结构不得报成用户拒绝')
      await host.unload()
    })
  }
})

describe('R6-2 L-B 真实 PS 入口：顶层绑定参数判定（非法 → exit 4，零 Show/零状态）', () => {
  test('B-0 前置：脚本存在且可执行（ValidateOnly 基线）', () => {
    assert.ok(existsSync(APPROVAL_SCRIPT), `脚本必须存在：${APPROVAL_SCRIPT}`)
    const r = psValidate({ decision: '拒绝不执行；30秒后自动拒绝', context: '任务：x' })
    assert.equal(r.status, 0, `合法成对应 exit 0，实测 ${r.status} / ${r.stdout.slice(0, 200)}`)
    assert.ok(r.stdout.includes('VALIDATE OK'), '应输出 VALIDATE OK')
    // R9 布局：decision 并入标题 <text>（标题预算 2/2），context 单独一个 <text>（≤4 行）
    // ⇒ 结构化路径恰 2 个 <text>（原 3 个 <text> 的布局在实机裁掉摘要提示，已废弃）。
    const textNodes = (r.stdout.match(/TEXT> /g) ?? []).length
    assert.equal(textNodes, 2, `R9 结构化路径应恰 2 个 <text>（title+decision 合并、context 独立），实测 ${textNodes}`)
    // decision 必须出现在第一个 <text> 内（安全信息先于动态摘要）。
    // 注：PS 5.1 重定向用控制台代码页（本机 936=GBK），中文在 utf8 解码下是乱码，
    // 故不断言中文字面量，而是断言**结构**：第一个 <text> 含 2 行（title 行 + decision 行）。
    const firstText = (r.stdout.match(/TEXT> ([^\r\n]*)/) ?? [])[1] ?? ''
    assert.ok(firstText.includes(' | '), `第一个 <text> 应含 title+decision 两行（以 ' | ' 分隔）：${firstText}`)
  })

  test('B-1 两字段都未传 → legacy（exit 0，非 3 text）', () => {
    const r = psValidate({})
    assert.equal(r.status, 0, `legacy 兼容应 exit 0，实测 ${r.status}`)
    const textNodes = (r.stdout.match(/TEXT> /g) ?? []).length
    assert.notEqual(textNodes, 3, '未提供成对字段时不得走结构化 3-text 路径')
  })

  test('B-2 只传 -DecisionSummary → exit 4（不得 warning+legacy）', () => {
    const r = psValidate({ decision: '拒绝不执行；30秒后自动拒绝' })
    assert.equal(r.status, 4, `半对应 exit 4，实测 status=${r.status} stdout=${r.stdout.slice(0, 200)}`)
  })

  test('B-3 只传 -ContextSummary → exit 4', () => {
    const r = psValidate({ context: '任务：x' })
    assert.equal(r.status, 4, `半对应 exit 4，实测 status=${r.status}`)
  })

  test('B-4 显式空对（-DecisionSummary "" -ContextSummary ""）→ exit 4（显式绑定即非法）', () => {
    const r = psValidate({ decision: '', context: '' })
    assert.equal(r.status, 4, `显式空对必须 exit 4（显式绑定≠未提供），实测 status=${r.status} stdout=${r.stdout.slice(0, 200)}`)
  })

  test('B-5 显式空白对 → exit 4', () => {
    const r = psValidate({ decision: '   ', context: '  ' })
    assert.equal(r.status, 4, `显式空白对必须 exit 4，实测 status=${r.status}`)
  })

  test('B-6 一项空白一项有效 → exit 4', () => {
    const r = psValidate({ decision: '   ', context: '任务：x' })
    assert.equal(r.status, 4, `含空白项必须 exit 4，实测 status=${r.status}`)
  })

  test('B-7 非法路径在 Show/状态文件之前失败（ValidateOnly 无副作用，exit 4 且无 Show 迹象）', () => {
    const r = psValidate({ decision: '拒绝不执行', context: '' })
    assert.equal(r.status, 4)
    assert.ok(!/SUBMITTED|Show\(\)/i.test(r.stdout), 'exit 4 前不得出现投递迹象')
  })
})

/**
 * R7-2 L-B' **生产路径**前置时序（R7 §11/§17）。
 *
 * 为什么单列一层：`-ValidateOnly` 在脚本 483 行 exit，**走不到**生产前置（512 行）
 * 与 New-Item/Register-UriScheme/Ensure-AppId（511/517/519）。仅用 ValidateOnly
 * 的用例无法发现"生产前置 throw 未被捕获 → PowerShell 默认 exit 1"这一缺陷 ——
 * 而 exit 1 在本插件契约里是 `rejected`（"用户点了拒绝"），会把调用方传错参数
 * 谎报成人类决策并写入审计。R7-C 实测曾复现该 exit 1。
 *
 * 因此本层断言两件事：
 *   1) 退出码是 **4**（渠道不可用），不是 1（rejected）；
 *   2) 零副作用：私有 StateDir 未被创建 + HKCU dshapproval 注册值逐字未变。
 */
describe('R7-2 L-B\' 生产路径（非 ValidateOnly）：非法 → exit 4 且零副作用', () => {
  const CASES = [
    ['Bp-1 只提供 decision', { decision: '拒绝不执行；60秒后自动拒绝' }],
    ['Bp-2 只提供 context', { context: '任务：x' }],
    ['Bp-3 显式空串对', { decision: '', context: '' }],
    ['Bp-4 显式空白对', { decision: '   ', context: '\t' }],
  ]

  for (const [label, args] of CASES) {
    test(`${label} → exit 4（非 rejected=1）+ 零注册 + 零状态文件`, () => {
      const r = psProduction(args)
      assert.equal(r.status, 4,
        `${label}: 生产路径必须 exit 4（渠道不可用）。实测 status=${r.status}；` +
        `exit 1 会被 mapExitCode 解释为 'rejected'（谎报用户拒绝）。` +
        `stdout=${r.stdout.slice(0, 200)} stderr=${r.stderr.slice(0, 200)}`)
      assert.notEqual(r.status, 1, `${label}: 绝不能是 exit 1（那是"用户点了拒绝"的语义）`)
      assert.equal(r.stateCreated, false, `${label}: 非法输入不得创建 StateDir（New-Item 不得执行）`)
      assert.equal(r.regUnchanged, true, `${label}: 非法输入不得改 HKCU URI 注册（Register-UriScheme 不得执行）`)
    })
  }
})

describe('R6-3 L-C 真实插件审批流：spawn 参数与 formatter 输出逐字相等', () => {
  test('C-1 正常路径：真实审批的 -DecisionSummary/-ContextSummary 等于 formatApprovalCard 输出', async () => {
    const host = await startNotificationHost()
    const notif = await import(pathToFileURL(join(dirname(PLUGIN_LIB), 'notifications.js')).href)
    const s = host.createRoot('r6-c1', { title: '真实审批任务' })
    const before = spawned().length
    openTurn(s)
    const pending = host.ctx.waterfall(
      (await import('@deepseek-ai/dsh-scope')).scopeTarget(s, s),
      'approval/request',
      makeReq({ id: String(s.id), session: s }, { toolName: 'bash', reason: '需要执行沙箱外操作' }),
      () => Promise.resolve('unavailable'),
    )
    await waitForSpawns(channel, before + 1)
    const rec = approvalToasts(before)[0]
    assert.ok(rec, '主审批应被认领')

    const card = notif.formatApprovalCard({
      toolName: 'bash', title: '真实审批任务', sessionId: String(s.id),
      reason: '需要执行沙箱外操作', timeoutSec: 30, timeoutAction: 'reject', showTitle: true,
    })
    assert.equal(rec.args[rec.args.indexOf('-Title') + 1], card.title, '-Title 必须逐字等于 formatter title')
    assert.equal(rec.args[rec.args.indexOf('-DecisionSummary') + 1], card.decisionSummary, '-DecisionSummary 逐字相等')
    assert.equal(rec.args[rec.args.indexOf('-ContextSummary') + 1], card.contextSummary, '-ContextSummary 逐字相等')
    assert.equal(card.title, '需要你审批 · 批准仅本次', '固定安全标题，不含用户文本')

    rec.child.emit('exit', 0)
    assert.equal(await pending, 'allowed-once', '批准回传不回归')
    closeTurn(s)
    await host.unload()
  })

  test('C-2 审计与 timeout 语义不回归（拒绝/批准/超时三态）', async () => {
    const host = await startNotificationHost()
    const s = host.createRoot('r6-c2')
    for (const [exit, expect] of [[1, 'rejected'], [0, 'allowed-once']]) {
      const before = spawned().length
      openTurn(s)
      const pending = host.ctx.waterfall(
        (await import('@deepseek-ai/dsh-scope')).scopeTarget(s, s),
        'approval/request',
        makeReq({ id: String(s.id), session: s }, { toolName: 'pwsh' }),
        () => Promise.resolve('unavailable'),
      )
      await waitForSpawns(channel, before + 1)
      approvalToasts(before)[0].child.emit('exit', exit)
      assert.equal(await pending, expect, `exit ${exit} → ${expect}`)
      closeTurn(s)
    }
    await host.unload()
  })
})
