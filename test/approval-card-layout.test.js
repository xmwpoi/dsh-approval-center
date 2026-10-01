// 审批卡片布局回归测试（C 布局补丁，第二轮派发 R2-C）。
//
// 设计依据（已核对的文档化限制，不是猜测）：
//   Microsoft "App notification content" / AdaptiveText（Win11）：
//     * ToastGeneric 最多 **3 个 <text> 元素**：1 个标题 + 2 个描述元素；
//     * 标题最多 **2 行**；两个描述元素**合计**最多 **4 行**；
//     * 超出 maxLines 的内容被省略号截断。
//   旧实现（标题 + 单个 Message text）的问题：`\n` 在单个 <text> 内不被渲染成换行
//   （node-notifier#123 同现象），五段正文糊成一行。
//   第一版补丁的问题：拆成 6 个 <text> —— 第 4 个起超出文档化元素数，属未定义行为。
//
// 本补丁的布局：把标题富余行数（2-实际标题行数）用来吸收正文，
//   使 A 现行卡片（标题 1 行 + 正文 5 行 = 6 行）**恰好**填满 2+4 的文档化预算，
//   零截断；正文仍超预算时，保留首部 + 显式截断提示 + **最后一行**
//   （A 卡片最后一行是"等待：…超时动作"，绝不隐藏）。
//
// 安全性：所有用例只走 -ValidateOnly —— 不注册 URI、不写状态文件、不调 Show()、
// 不弹任何通知、不改 HKCU。
// 运行：node --test test/approval-card-layout.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = join(REPO_ROOT, 'scripts', 'approval-toast.ps1')
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

const scriptBytes = readFileSync(SCRIPT)
const scriptText = scriptBytes.toString('utf8')

/**
 * 调用 -ValidateOnly（无副作用）。
 *
 * 参数经临时 JSON 文件传入、由 PowerShell 读取后**具名**调用：
 *  - 不用命令行拼接：正文含换行 / 引号 / & < > / PowerShell 元字符，拼进 -Command
 *    会被二次解析（实测把参数喂错、把 `$_行` 当变量解析成空串）。
 *  - 不用数组 splat：实测 `& $script @a` 按位置绑定，"-Title" 后的值喂给了 $TimeoutSec。
 *  - 必须先强制 [Console]::OutputEncoding = UTF-8：PS5.1 默认按 CP936 写 stdout，
 *    Node 按 utf8 解码会得到乱码。
 */
function validate(title, message, stateDir = '') {
  const argsFile = join(tmpdir(), `dsh-card-args-${randomUUID()}.json`)
  writeFileSync(argsFile, JSON.stringify({ title, message, stateDir }), 'utf8')
  // 必须用**具名**参数调用。实测两个坑：
  //  1) `& $script @a`（数组 splat）会按**位置**绑定，"-Title" 的值被喂给 $TimeoutSec，
  //     报 "Cannot convert ... to System.Int32"（两轮都踩过）。
  //  2) `if (…) {…}; else {…}` 中的 "; else" 会被当成独立命令，且退出码仍为 0（静默假绿）。
  const cmd = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$j = Get-Content -Raw -Encoding UTF8 $env:DSH_ARGS | ConvertFrom-Json',
    '$t = [string]($j.title)',
    '$m = [string]($j.message)',
    '$s = [string]($j.stateDir)',
    'if ($s) { & $env:DSH_SCRIPT -ValidateOnly -Title $t -Message $m -StateDir $s } else { & $env:DSH_SCRIPT -ValidateOnly -Title $t -Message $m }',
    'exit $LASTEXITCODE',
  ].join('; ')
  try {
    return spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-Command', cmd], {
      encoding: 'utf8',
      timeout: 60_000,
      windowsHide: true,
      env: { ...process.env, DSH_SCRIPT: SCRIPT, DSH_ARGS: argsFile },
    })
  } finally {
    rmSync(argsFile, { force: true })
  }
}

/** 从 -ValidateOnly 输出取 TEXT> 行；脚本把每个 <text> 的内部换行显示为 " | "。 */
function textNodes(stdout) {
  return (stdout ?? '').split(/\r?\n/)
    .filter((l) => l.startsWith('TEXT> '))
    .map((l) => l.slice(6))
}

/** 把 "A | B" 形态拆回行数组（与脚本输出约定一致）。 */
function splitNode(node) {
  return node.split(' | ')
}

// ── A 现行卡片的真实形状（src/notifications.ts buildApprovalCard 的输出） ──
const A_TITLE = '需要你审批 · bash'
const A_MESSAGE = [
  '任务：修复登录问题',
  '操作：bash',
  '原因：需要执行沙箱外操作',
  '选择：批准=本次允许；拒绝=不允许执行',
  '等待：60秒；超时=自动拒绝',
].join('\n')

test('CARD-01: A 现行 5 行卡片 → 恰好 3 个 <text>（文档化上限），6 行零截断', () => {
  const r = validate(A_TITLE, A_MESSAGE)
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}\n${r.stderr}`)
  assert.match(String(r.stdout), /VALIDATE OK: textNodes=3\b/, `实际: ${r.stdout}`)
  assert.match(String(r.stdout), /actionNodes=2\b/, '批准/拒绝按钮必须保留')
  const nodes = textNodes(r.stdout)
  assert.equal(nodes.length, 3)
  // 标题 2 行：标题 + 第 1 行正文（描述预算只有 4 行，5 行正文必须借 1 行给标题）
  assert.deepEqual(splitNode(nodes[0]), [A_TITLE, '任务：修复登录问题'])
  // 描述合计 4 行，超时动作（最后一行）必须可见
  assert.deepEqual(splitNode(nodes[1]), ['操作：bash', '原因：需要执行沙箱外操作'])
  assert.deepEqual(splitNode(nodes[2]), [
    '选择：批准=本次允许；拒绝=不允许执行',
    '等待：60秒；超时=自动拒绝',
  ])
  // 全卡不含截断提示（6 行恰好填满预算）
  assert.ok(nodes.every((n) => !n.includes('已截断')), '不应出现截断提示')
})

test('CARD-02: 超预算正文（9 行）→ 保留首部 + 显式截断提示 + 最后一行（超时动作）', () => {
  const body = [
    ...Array.from({ length: 8 }, (_, i) => `正文第${i + 1}行`),
    '等待：60秒；超时=自动拒绝',
  ]
  const r = validate(A_TITLE, body.join('\n'))
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}\n${r.stderr}`)
  const nodes = textNodes(r.stdout)
  assert.equal(nodes.length, 3, '任何情况下都不得超出 3 个 <text> 元素')
  const allLines = nodes.flatMap(splitNode)
  assert.ok(allLines.some((l) => l.includes('已截断')), '必须显式标注已截断，不得静默丢内容')
  // 最后一行是超时动作 —— 派发书硬要求：不隐藏超时自动批准
  assert.equal(allLines[allLines.length - 1], '等待：60秒；超时=自动拒绝')
})

test('CARD-03: 超时自动批准（危险配置）的文案不得被截掉或改写', () => {
  const msg = [
    '任务：修复登录问题',
    '操作：bash',
    '原因：需要执行沙箱外操作',
    '选择：批准=本次允许；拒绝=不允许执行',
    '等待：60秒；超时自动批准（到点将自动放行本次操作）',
  ].join('\n')
  const r = validate(A_TITLE, msg)
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}`)
  const last = textNodes(r.stdout).flatMap(splitNode).pop()
  assert.equal(
    last,
    '等待：60秒；超时自动批准（到点将自动放行本次操作）',
    '超时自动批准的醒目文案必须完整可见',
  )
})

test('CARD-04: 1 行正文 → 1 个 <text>；空正文 → 1 个 <text>（不得产生空 <text>）', () => {
  for (const msg of ['只有一行', '']) {
    const r = validate('T', msg)
    assert.equal(r.status, 0, `msg=${JSON.stringify(msg)} status=${r.status}\n${r.stdout}`)
    const nodes = textNodes(r.stdout)
    assert.equal(nodes.length, 1, `msg=${JSON.stringify(msg)} 实际 ${nodes.length} 个节点`)
    assert.equal(splitNode(nodes[0])[0], 'T')
  }
})

test('CARD-05: 空行被丢弃，不产生空 <text>', () => {
  const r = validate('T', '第一行\n\n\n第二行\n   \n第三行')
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}`)
  // 标题 1 行 → 富余 1 行吸收正文；正文 3 行 → 剩 2 行分到 2 个描述
  const nodes = textNodes(r.stdout)
  const allLines = nodes.flatMap(splitNode)
  assert.deepEqual(allLines, ['T', '第一行', '第二行', '第三行'])
})

test('CARD-06: XML 特殊字符被转义（& < > "），标题与正文都覆盖', () => {
  const r = validate('a<b>&"c', 'x<y>&z')
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}`)
  const allLines = textNodes(r.stdout).flatMap(splitNode)
  // InnerText 是反解析后的值：能原样读回即证明转义正确、XML 未被破坏
  assert.deepEqual(allLines, ['a<b>&"c', 'x<y>&z'])
})

test('CARD-07: 标题自身超过 2 行 → 提示**替换**第 2 行（标题预算 2 行不可超）', () => {
  const r = validate('标题一\n标题二\n标题三\n标题四', '正文')
  assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}`)
  const nodes = textNodes(r.stdout)
  // 标题占满 2 行 → 无富余，1 行正文留在第 2 个 <text>
  assert.equal(nodes.length, 2, `实际: ${JSON.stringify(nodes)}`)
  const lines = splitNode(nodes[0])
  assert.equal(lines.length, 2, `标题必须恰为 2 行，实际: ${JSON.stringify(lines)}`)
  assert.equal(lines[0], '标题一')
  assert.match(lines[1], /标题过长/, '截断提示必须替换第 2 行，而不是追加成第 3 行')
  assert.deepEqual(splitNode(nodes[1]), ['正文'])
})

test('CARD-08: -ValidateOnly 无副作用 —— 不创建 StateDir、不写状态文件', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'dsh-card-ghost-'))
  const ghost = join(sandbox, 'state-dir')
  try {
    const r = validate('T', 'M', ghost)
    assert.equal(r.status, 0, `status=${r.status}\n${r.stdout}`)
    assert.equal(existsSync(ghost), false, '-ValidateOnly 不得创建 StateDir')
  } finally {
    rmSync(sandbox, { recursive: true, force: true })
  }
})

test('CARD-09: 静态 —— 脚本为 UTF-8 BOM + CRLF，且布局约束在源码层钉住', () => {
  assert.deepEqual(scriptBytes.subarray(0, 3), UTF8_BOM, 'ps1 必须带 UTF-8 BOM（PS5.1 无 BOM 按 CP936 解码中文即语法错误）')
  assert.ok(!/(?<!\r)\n/.test(scriptText), '必须全 CRLF（.gitattributes eol=crlf），不得混入孤立 LF')
  // 不得再把多行正文塞进单个 <text>
  assert.ok(!/<text>\$\(Escape-Xml \$Message\)<\/text>/.test(scriptText), '正文不得直接写入单个 <text>')
  // 文档化上限必须显式出现在源码里（防止将来被"顺手"改大）
  assert.match(scriptText, /\$maxTextElements\s*=\s*3/)
  assert.match(scriptText, /\$maxTitleLines\s*=\s*2/)
  assert.match(scriptText, /\$maxDescLinesTotal\s*=\s*4/)
  // 协议 / 退出码 / 按钮语义不得被布局改动波及
  assert.ok(scriptText.includes('activationType="protocol"'))
  assert.ok(scriptText.includes("arguments=\"$scheme`:approve/"))
  assert.ok(scriptText.includes("arguments=\"$scheme`:reject/"))
  assert.ok(!scriptText.includes('__ID__'), '不得用字符串替换占位符（会替换正文里的同名文本）')
})
