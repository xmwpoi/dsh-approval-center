/**
 * R8-D 阻塞项复现：**结构化审批卡超出脚本自身文档化的描述行预算**。
 *
 * 背景（R8 派发书 §17/§29/§37）：
 *   A 契约要求"原因被截断时显式标记"，派发书进一步要求该提示**可见**。
 *   实测（`F-R-1000-banner.png`，输入**逐字来自生产 formatter**）：提示不可见。
 *   本文件把"不可见"从截图解释升级为**机械可核的结构事实**。
 *
 * 事实链（全部作用于**解包候选**，不投递、不写 HKCU、不建状态目录）：
 *   1) `scripts/approval-toast.ps1` 自带文档化上限（L313-315）：
 *      标题 ≤ 2 行、两个描述 `<text>` **合计** ≤ 4 行（ToastGeneric 文档限制）。
 *   2) 结构化路径（成对 `-DecisionSummary`/`-ContextSummary`）只做三 `<text>` 拼装
 *      （L367-388）：`<text>title</text><text>decision</text><text>context</text>`，
 *      不套用任何预算检查 ⇒ 描述行 = 1 + context 行数。
 *   3) 生产 formatter 在原因被截断时输出 **4 行** context（任务/操作/原因/摘要提示）
 *      ⇒ 描述行 = **5 > 4**，摘要提示位于第 5 行。
 *   4) legacy 路径（只传 `-Message`）对**同一份内容**做预算吸收（L409-446）：
 *      把 decision 挪进标题的第二行，描述恰好 4 行，提示位于第 4 行 ⇒ 可见。
 *      ⇒ 修复方向已有脚本内先例；这是**结构化路径漏用预算逻辑**，不是 Windows 的锅。
 *
 * 预期：B-2/B-3 **当前必然失败**（即本缺陷的复现）；B-1/B-4 是基线/对照，应通过。
 * 一旦 A 让结构化路径复用同一预算逻辑（把 decision 行挪进标题元素或做保留首尾的截断），
 * 本文件应转绿——它就是该修复的验收测试。
 *
 * 铁律：只跑 `-ValidateOnly`（不注册 URI、不写状态文件、不 Show、不弹通知）。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 两级上溯：test/integration/ → repo 根。（D 原稿三级上溯是从更深的树搬来的，会落到上级目录）
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLUGIN_LIB = process.env.DSH_PLUGIN_ENTRY ?? join(REPO_ROOT, 'lib', 'index.js')
const LIB_DIR = dirname(PLUGIN_LIB)
const APPROVAL_SCRIPT = join(LIB_DIR, '..', 'scripts', 'approval-toast.ps1')

/** 脚本自身文档化的 ToastGeneric 上限（与本测试同源复述，漂移即失败） */
const MAX_TITLE_LINES = 2
const MAX_DESC_LINES = 4

const { formatApprovalCard, SUMMARY_TRUNCATED_MARK } =
  await import(pathToFileURL(join(LIB_DIR, 'notifications.js')).href)

/** powershell.exe 5.1 重定向输出用**控制台代码页**（本机 936=GBK）；UTF-8 失败则退回 GBK */
function decodeConsole(buf) {
  if (buf === null || buf === undefined) return ''
  const utf8 = buf.toString('utf8')
  if (!utf8.includes('\uFFFD')) return utf8
  try { return new TextDecoder('gbk').decode(buf) } catch { return utf8 }
}

/** 跑 `-ValidateOnly` 并解析出 `<text>` 结构（零副作用） */
function validateOnly(card, mode) {
  const args = mode === 'structured'
    ? ['-DecisionSummary', card.decisionSummary, '-ContextSummary', card.contextSummary]
    : ['-Message', `${card.decisionSummary}\n${card.contextSummary}`]
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', APPROVAL_SCRIPT, '-ValidateOnly', '-Title', card.title, ...args],
    { windowsHide: true })
  const stdout = decodeConsole(r.stdout)
  const texts = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('TEXT> ')) texts.push(line.slice('TEXT> '.length).split(' | '))
  }
  const okMatch = /textNodes=(\d+) actionNodes=(\d+)/.exec(stdout)
  return {
    status: r.status,
    ok: okMatch !== null,
    textNodes: okMatch ? Number(okMatch[1]) : -1,
    texts,
    titleLines: texts[0] ?? [],
    descLines: texts.slice(1).flat(),
    raw: stdout.trim(),
  }
}

const cardFor = (reason, title = '修复登录问题') => formatApprovalCard({
  toolName: 'bash', title, sessionId: 'session-r8-budget',
  reason, timeoutSec: 60, timeoutAction: 'reject', showTitle: true,
})

const LONG = cardFor('原因说明内容测试'.repeat(125))   // 1000 字 → formatter 截断并加提示
const BOUNDARY = cardFor('需要执行沙箱外操作'.repeat(4)) // 36 字 = 上限，不截断

describe('R8-D 审批卡描述行预算（结构化 vs legacy）', () => {
  test('B-0 前置：包内脚本与 formatter 均可加载，ValidateOnly 基线可用', () => {
    assert.ok(existsSync(APPROVAL_SCRIPT), `找不到 ${APPROVAL_SCRIPT}`)
    const r = validateOnly(BOUNDARY, 'legacy')
    assert.equal(r.status, 0, `ValidateOnly 应 exit 0，实测 ${r.status}\n${r.raw}`)
    assert.ok(r.ok, 'ValidateOnly 应打印 VALIDATE OK')
    assert.equal(r.textNodes, 3, '应为 1 标题 + 2 描述 共 3 个 <text>')
  })

  test('B-1 基线：1000 字原因在 formatter 层确实产出摘要提示', () => {
    assert.ok(LONG.contextSummary.includes(SUMMARY_TRUNCATED_MARK),
      'formatter 输出必须含摘要提示（若此项失败，缺陷在 formatter 而非布局）')
    assert.equal(LONG.contextSummary.split('\n').length, 4, '应为 任务/操作/原因/提示 共 4 行')
  })

  test('B-2 生产结构化路径：描述行合计必须 ≤ 4（脚本自身文档化预算）', () => {
    const r = validateOnly(LONG, 'structured')
    assert.equal(r.status, 0)
    assert.ok(r.descLines.length <= MAX_DESC_LINES,
      `结构化路径描述行 ${r.descLines.length} 行 > 文档化上限 ${MAX_DESC_LINES} 行，`
      + '尾部（含摘要提示）会被 Windows 裁掉\n描述行：\n' + r.descLines.map((l, i) => `  ${i + 1}. ${l}`).join('\n'))
  })

  test('B-3 生产结构化路径：摘要提示必须落在前 4 行描述内（用户可见）', () => {
    const r = validateOnly(LONG, 'structured')
    const idx = r.descLines.findIndex((l) => l.includes(SUMMARY_TRUNCATED_MARK))
    assert.notEqual(idx, -1, '描述里必须带摘要提示')
    assert.ok(idx < MAX_DESC_LINES,
      `摘要提示位于描述第 ${idx + 1} 行，超出可见预算 ${MAX_DESC_LINES} 行 → 实机不可见`)
  })

  test('B-4 对照（修复方向先例）：同一份内容走 legacy 路径在预算内且提示可见', () => {
    const r = validateOnly(LONG, 'legacy')
    assert.equal(r.status, 0)
    assert.ok(r.descLines.length <= MAX_DESC_LINES,
      `legacy 路径应把 decision 吸收进标题，实测描述 ${r.descLines.length} 行`)
    const idx = r.descLines.findIndex((l) => l.includes(SUMMARY_TRUNCATED_MARK))
    assert.ok(idx >= 0 && idx < MAX_DESC_LINES,
      `legacy 路径摘要提示应可见，实测描述第 ${idx + 1} 行`)
    assert.ok(r.titleLines.length <= MAX_TITLE_LINES, '标题行不得超预算')
  })

  test('B-5 边界：36 字（未截断）原因的结构化路径在逻辑行预算内（记录折行余量风险）', () => {
    const r = validateOnly(BOUNDARY, 'structured')
    assert.equal(r.status, 0)
    assert.ok(r.descLines.length <= MAX_DESC_LINES,
      `36 字原因时描述 ${r.descLines.length} 行（应 ≤ 4）`)
    // 注意：逻辑行在预算内 ≠ 渲染行在预算内。原因行含前缀共 39 码点，实机横幅一行约放
    // 22-24 个中文字符（见 M4-reason32-crop.png），折行产生的第 2 渲染行会挤掉预算外的行。
    // 因此修复必须留出余量（B-4 的 legacy 布局正好余 1 行），不能只把逻辑行压到 4。
    const reasonLine = r.descLines.find((l) => l.startsWith('原因：')) ?? ''
    assert.ok(Array.from(reasonLine).length >= 36,
      '原因行应保留 formatter 的 36 码点上限内容（供渲染折行余量核对）')
  })
})
