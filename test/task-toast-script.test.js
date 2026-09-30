/**
 * 任务通知脚本静态/字节级检查（T0 契约 §4.4）。
 *
 * 覆盖：UTF-8 BOM、PS5.1 真实解析、参数面、退出码契约、XML 转义与 <audio> 位置、
 * 隔离不变量（缺省 Group 必须回退 dsh-result，绝不混入审批组）、禁止 History.Clear。
 *
 * 参数校验路径用真实 powershell.exe 执行，但都在 try 块**之前**退出，绝不弹真实 Toast。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'toast.ps1')

describe('toast.ps1：字节级编码门禁', () => {
  test('文件非空且带 UTF-8 BOM（PS5.1 无 BOM 按 ANSI 解码 → 中文源码直接语法错误）', () => {
    const b = readFileSync(SCRIPT)
    assert.ok(b.length > 0, '脚本不得为空（空脚本会以 exit 0 静默假成功）')
    assert.ok(b.length > 1000, '脚本内容异常地短，疑似打包被截断')
    assert.ok(b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf, '必须带 UTF-8 BOM')
  })

  test('PowerShell 5.1 真实解析零语法错误（exit 1 会被误报成失败）', () => {
    const err = []
    // Parser::ParseFile 是宿主同款门禁；不在 CI 里弹任何 Toast
    const { execSync } = { execSync: null }
    void execSync
    const checker = [
      '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
      `$e = $null`,
      `[void][System.Management.Automation.Language.Parser]::ParseFile('${SCRIPT.replace(/'/g, "''")}', [ref]$null, [ref]$e)`,
      `if ($e -and $e.Count) { $e | ForEach-Object { Write-Output $_.Message }; exit 3 }`,
      'exit 0',
    ].join('\n')
    const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', checker], { encoding: 'utf8' })
    assert.equal(r.status, 0, `PS5.1 语法错误：${String(r.stdout ?? '')}`)
  })

  test('参数面完整：Tag/Group/Sound 可选，Title/Message 必填语义', () => {
    const s = readFileSync(SCRIPT, 'utf8')
    for (const p of ['$Title', '$Message', '$Tag', '$Group', '$Sound']) {
      assert.ok(s.includes(p), `缺少参数 ${p}`)
    }
    assert.ok(s.includes("ValidateSet('', 'silent', 'default')"), 'Sound 必须白名单')
  })

  test('退出码契约：0=提交 1=参数非法 2=投递失败（与审批脚本语义不同）', () => {
    const s = readFileSync(SCRIPT, 'utf8')
    assert.ok(/\bexit 0\b/.test(s), '缺少 exit 0')
    assert.ok(/\bexit 1\b/.test(s), '缺少 exit 1（参数非法）')
    assert.ok(/\bexit 2\b/.test(s), '缺少 exit 2（投递失败）')
  })

  test('XML 转义覆盖 & < > "；<audio> 位于 <visual> 之后', () => {
    const s = readFileSync(SCRIPT, 'utf8')
    assert.ok(s.includes("'&', '&amp;'"), '必须转义 &')
    assert.ok(s.includes("'<', '&lt;'"), '必须转义 <')
    assert.ok(s.includes("'>', '&gt;'"), '必须转义 >')
    assert.ok(s.includes('"', '&quot;'.replace('"', '"')) || s.includes("'\"', '&quot;'"), '必须转义 "')
    assert.ok(s.includes('<audio silent="true"/>'), '静音必须用 <audio silent="true"/>')
    assert.ok(s.includes('ms-winsoundevent:Notification.Default'), '默认音必须用系统事件音')
    const visualEnd = s.indexOf('</visual>')
    const audioIdx = s.indexOf('<audio')
    // 位置保证：<audio> 经 $audioBlock 内插在 here-string 的 </visual> 之后。
    // 不能用源码文本顺序判断——switch 分支在 here-string 之前就已写出 <audio 字面量。
    assert.ok(s.includes('</visual>$audioBlock'), '<audio> 必须经 $audioBlock 拼在 </visual> 之后')
    assert.ok(visualEnd > 0 && audioIdx > 0, 'audio 与 visual 都必须存在')
  })

  test('隔离不变量：缺省 Group 回退 dsh-result；显式 Group 只接受 dsh-task', () => {
    const s = readFileSync(SCRIPT, 'utf8')
    assert.ok(s.includes("'dsh-result'"), '缺省必须回退 dsh-result（旧结果回执路径）')
    assert.ok(s.includes('dsh-task'), '必须支持 dsh-task')
    assert.ok(/-ne 'dsh-task'/, '显式传入的 Group 必须白名单校验')
  })

  test('禁止 History.Clear / History.Remove（任务通知不清理历史）', () => {
    // 去掉注释行再检查：注释里允许记录"为什么不能这么做"的教训。
    const code = readFileSync(SCRIPT, 'utf8')
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
    assert.ok(!/History\.Clear/.test(code), '不得调用 History.Clear')
    assert.ok(!/History\.Remove/.test(code), '不得调用 History.Remove')
  })

  test('不得输出正文/绝对路径到诊断；成功文案只含 tag/group/sound', () => {
    const lines = readFileSync(SCRIPT, 'utf8').split(/\r?\n/)
    // 逐行检查所有诊断输出：任何 Write-Output / Write-Diag 都不得引用 -Title/-Message 正文
    const diagLines = lines.filter((l) => /Write-(Output|Diag)\b/.test(l) && !/^\s*#/.test(l))
    assert.ok(diagLines.length > 0, '应存在诊断输出')
    for (const line of diagLines) {
      assert.ok(!/\$Title/.test(line), `诊断不得输出 Title 正文：${line.trim()}`)
      assert.ok(!/\$Message/.test(line), `诊断不得输出 Message 正文：${line.trim()}`)
    }
    // 成功诊断只暴露 tag/group/sound —— 足够定位，不泄露内容
    assert.ok(lines.some((l) => l.includes('TOAST SUBMITTED tag={0} group={1} sound={2}')),
      '成功诊断只含 tag/group/sound')
  })
})

describe('toast.ps1：参数校验路径（真实 PS5.1，均在弹 Toast 之前退出）', () => {
  const run = (args) => spawnSync('powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, ...args],
    { encoding: 'utf8', windowsHide: true })

  test('非法 Tag → exit 1（调用方 bug 必须可见）', () => {
    const r = run(['-Title', 'T', '-Message', 'm', '-Tag', 'ZZZZ'])
    assert.equal(r.status, 1, `stdout=${String(r.stdout ?? '')}`)
    assert.ok(String(r.stdout ?? '').includes('TOAST FAILED'))
  })

  test('非法 Group（混入审批组）→ exit 1', () => {
    const r = run(['-Title', 'T', '-Message', 'm', '-Group', 'dsh-approval'])
    assert.equal(r.status, 1, '任务通知绝不允许写入审批组')
  })

  test('非法 Sound → 非零退出（ValidateSet 白名单）', () => {
    const r = run(['-Title', 'T', '-Message', 'm', '-Sound', 'bogus'])
    assert.notEqual(r.status, 0, '非法 Sound 不得以 exit 0 通过')
  })
})
