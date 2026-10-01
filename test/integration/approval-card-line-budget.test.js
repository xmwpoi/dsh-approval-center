/**
 * R8到R11的审批结构回归：固定安全信息优先，摘要提示独立attribution。
 * R10横幅已通过，但更窄的通知中心会再次裁掉末行；R11把提示移出描述。
 * 普通text与attribution分别计数，逻辑预算通过不能证明像素可见。
 * B-4仅是旧legacy的结构对照，不宣称真实屏幕完整显示。
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
  const attributions = []
  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith('TEXT> ')) texts.push(line.slice('TEXT> '.length).split(' | '))
    if (line.startsWith('ATTRIBUTION> ')) attributions.push(line.slice('ATTRIBUTION> '.length))
  }
  const okMatch = /textNodes=(\d+) actionNodes=(\d+)/.exec(stdout)
  return {
    status: r.status,
    ok: okMatch !== null,
    textNodes: okMatch ? Number(okMatch[1]) : -1,
    texts,
    attributions,
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
const BOUNDARY = cardFor('因'.repeat(20)) // R10显示预算边界，不截断

describe('审批卡结构预算与独立摘要提示（结构化 vs legacy）', () => {
  test('B-6 M7回归：截断提示是独立attribution，不占动态描述预算', () => {
    const r = validateOnly(LONG, 'structured')
    assert.equal(r.status, 0)
    assert.deepEqual(r.attributions, [SUMMARY_TRUNCATED_MARK])
    assert.equal(r.texts.length, 2, '普通文本仍为安全标题与上下文')
    assert.equal(r.descLines.length, 3, '描述只含任务/操作/原因')
    assert.equal(r.descLines.some(l => l.includes(SUMMARY_TRUNCATED_MARK)), false)
    assert.deepEqual(r.titleLines, [LONG.title, LONG.decisionSummary])
    assert.equal(r.textNodes, 3, '两个普通文本加一个attribution')
  })

  test('B-7 未截断卡片不伪造attribution；类似文字不是提示行', () => {
    const plain = validateOnly(BOUNDARY, 'structured')
    assert.equal(plain.status, 0)
    assert.deepEqual(plain.attributions, [])
    const similar = validateOnly({ ...BOUNDARY, contextSummary: `任务：x\n操作：y\n原因：${SUMMARY_TRUNCATED_MARK}附加` }, 'structured')
    assert.equal(similar.status, 0)
    assert.deepEqual(similar.attributions, [])
    assert.ok(similar.descLines[2].includes(`${SUMMARY_TRUNCATED_MARK}附加`))
  })

  test('B-8 CRLF和XML特殊字符不改变正文或独立提示', () => {
    const lines = ['任务：<修复>&测试', '操作：bash', '原因：读取<&>目录']
    const r = validateOnly({ ...LONG, contextSummary: [...lines, SUMMARY_TRUNCATED_MARK].join('\r\n') }, 'structured')
    assert.equal(r.status, 0)
    assert.deepEqual(r.descLines, lines)
    assert.deepEqual(r.attributions, [SUMMARY_TRUNCATED_MARK])
    assert.deepEqual(r.titleLines, [LONG.title, LONG.decisionSummary])
  })
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

  test('B-3 生产结构化路径：摘要提示移出描述，保留为独立attribution', () => {
    const r = validateOnly(LONG, 'structured')
    assert.deepEqual(r.attributions, [SUMMARY_TRUNCATED_MARK])
    assert.equal(r.descLines.some(l => l.includes(SUMMARY_TRUNCATED_MARK)), false)
  })

  test('B-4 legacy对照：摘要提示仍在逻辑预算内，像素可见性不外推', () => {
    const r = validateOnly(LONG, 'legacy')
    assert.equal(r.status, 0)
    assert.ok(r.descLines.length <= MAX_DESC_LINES,
      `legacy 路径应把 decision 吸收进标题，实测描述 ${r.descLines.length} 行`)
    const idx = r.descLines.findIndex((l) => l.includes(SUMMARY_TRUNCATED_MARK))
    assert.ok(idx >= 0 && idx < MAX_DESC_LINES,
      `legacy 路径摘要提示应可见，实测描述第 ${idx + 1} 行`)
    assert.ok(r.titleLines.length <= MAX_TITLE_LINES, '标题行不得超预算')
  })

  test('B-5 原因摘要含标签最多23码点，formatter截断提示仍完整', () => {
    const r = validateOnly(BOUNDARY, 'structured')
    assert.equal(r.status, 0)
    assert.ok(r.descLines.length <= MAX_DESC_LINES,
      `20 字原因时描述 ${r.descLines.length} 行（应 ≤ 4）`)
    // R9实机证明逻辑行绿不足以保证提示可见。这里只验证保守显示预算，
    // 不能把码点约束当作像素证明；新包仍须C在目标环境实机复验。
    const reasonLine = r.descLines.find((l) => l.startsWith('原因：')) ?? ''
    assert.equal(reasonLine, `原因：${'因'.repeat(20)}`)
    const longReasonLine = LONG.contextSummary.split('\n').find(l => l.startsWith('原因：'))
    assert.ok(Array.from(longReasonLine).length <= 23, '长原因含标签及省略号最多23码点')
    assert.ok(longReasonLine.endsWith('…'), '超预算原因必须带省略号')
    assert.ok(LONG.contextSummary.includes(SUMMARY_TRUNCATED_MARK), '截断必须保留详情提示')
  })
})
