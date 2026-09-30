// T3 静态门禁测试：BOM/ASCII 规则与 PowerShell 5.1 语法解析。
// 只读仓库真实脚本 + 临时目录负例夹具；唯一的外部进程是 powershell.exe
// 的 Parser::ParseFile（非交互、无通知、无 URI 注册）。
// 运行：node --test test/dialog.scripts.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertScriptsUsable, APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT, APPROVAL_URI_HANDLER_VBS } from '../lib/dialog.js'

const REPO_SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf])

function makeTempDir(label) {
  return mkdtempSync(join(tmpdir(), `dsh-t3-${label}-`))
}

// 真实脚本必含中文（默认 Title '审批请求'），所以 ps1 必须带 BOM —— 这条断言
// 同时守住"有人把 BOM 去掉"的打包事故。vbs 必须纯 ASCII。
test('S-01: 仓库真实脚本满足 BOM/ASCII 规则', () => {
  assert.doesNotThrow(() =>
    assertScriptsUsable([APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT, APPROVAL_URI_HANDLER_VBS]),
  )
})

test('S-02a: 缺少脚本 → 抛错', () => {
  const dir = makeTempDir('missing')
  try {
    assert.throws(() => assertScriptsUsable(['no-such-script.ps1'], dir), /缺少脚本/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S-02b: 空脚本 → 抛错', () => {
  const dir = makeTempDir('empty')
  try {
    writeFileSync(join(dir, 'empty.ps1'), Buffer.alloc(0))
    assert.throws(() => assertScriptsUsable(['empty.ps1'], dir), /脚本为空/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S-02c: ps1 含非 ASCII 且无 BOM → 抛错（PS5.1 会按 ANSI 误读成"用户拒绝"）', () => {
  const dir = makeTempDir('nobom')
  try {
    writeFileSync(join(dir, 'zh.ps1'), Buffer.from('# 中文注释\nexit 0\n', 'utf8'))
    assert.throws(() => assertScriptsUsable(['zh.ps1'], dir), /BOM/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S-02d: ps1 含非 ASCII 且带 UTF-8 BOM → 通过字节检查', () => {
  const dir = makeTempDir('bom')
  try {
    writeFileSync(join(dir, 'zh-bom.ps1'), Buffer.concat([UTF8_BOM, Buffer.from('# 中文注释\nexit 0\n', 'utf8')]))
    assert.doesNotThrow(() => assertScriptsUsable(['zh-bom.ps1'], dir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S-02e: vbs 含非 ASCII → 抛错（wscript 按 ANSI 误读）', () => {
  const dir = makeTempDir('vbszh')
  try {
    writeFileSync(join(dir, 'zh.vbs'), Buffer.from("' 注释\nWScript.Quit 0\n", 'utf8'))
    assert.throws(() => assertScriptsUsable(['zh.vbs'], dir), /纯 ASCII/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('S-03+S-04: PowerShell 5.1 Parser 通过真实脚本，且接受中文+空格路径', () => {
  // 用真实脚本复制到「中文 + 空格」目录，验证解析门禁对这类路径不误报（V17 前置）。
  const dir = makeTempDir('path')
  const zhDir = join(dir, '审批 中 心')
  mkdirSync(zhDir)
  try {
    for (const f of [APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT]) copyFileSync(join(REPO_SCRIPTS, f), join(zhDir, f))
    assert.doesNotThrow(() => assertScriptsUsable([APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT], zhDir))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
