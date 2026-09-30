// ISSUE-1 回归测试：映射文件编码一致性（ANSI 写 <-> ANSI 读）。
// 旧版 approval-toast.ps1 用 UTF-8 写 <id>.dir，VBS（OpenTextFile）/PS 5.1（Get-Content）
// 都默认按 ANSI 读：中文 StateDir 路径被读成乱码 -> 处理器回落默认目录 -> 审批超时。
// 修复后脚本以 [System.Text.Encoding]::Default 写映射；本测试用同一编码造夹具，
// 直调两个处理器，断言结果文件落在中文+空格映射目录内。
// 夹具全部在沙箱 LOCALAPPDATA 下，不触碰真实状态目录；不弹通知、不改注册表。
// 运行：node --test test/dialog.unicode-mapping.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
const VBS = join(SCRIPTS, 'approval-uri-handler.vbs')
const PS1 = join(SCRIPTS, 'approval-uri-handler.ps1')

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-t3-unicode-'))
  const localAppData = join(root, 'LOCALAPPDATA')
  const defaultDir = join(localAppData, 'dsh-approval-center')
  mkdirSync(defaultDir, { recursive: true })
  // 中文 + 空格目录名：正是 T6 E6 实测踩坑的形态
  const mappedDir = join(root, '审批 状态 目录')
  mkdirSync(mappedDir)
  return { root, localAppData, defaultDir, mappedDir }
}

/** 用 PowerShell 以 [System.Text.Encoding]::Default 写映射（与修复后的脚本一致）。
 *  中文路径经由 env 传入（UTF-16 进程环境），避免命令行编码失真。 */
function writeAnsiMapping(env, mappingPath, mappedDir) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    '[System.IO.File]::WriteAllText($env:MAPPING_PATH, $env:MAPPED_DIR, [System.Text.Encoding]::Default)',
  ], { env: { ...env, MAPPING_PATH: mappingPath, MAPPED_DIR: mappedDir }, timeout: 60_000, windowsHide: true })
  assert.equal(r.status, 0, `ANSI 映射夹具写入失败: ${r.stderr}`)
}

/** 旧版缺陷行为对照：UTF-8 写的映射（无 BOM）在 ANSI 读取下必然乱码回落。 */
function writeUtf8Mapping(env, mappingPath, mappedDir) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    '[System.IO.File]::WriteAllText($env:MAPPING_PATH, $env:MAPPED_DIR, (New-Object System.Text.UTF8Encoding($false)))',
  ], { env: { ...env, MAPPING_PATH: mappingPath, MAPPED_DIR: mappedDir }, timeout: 60_000, windowsHide: true })
  assert.equal(r.status, 0, `UTF-8 映射夹具写入失败: ${r.stderr}`)
}

function waitForFile(path, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return false
}

const ID = 'abc1230456789abcdef0123456789ab'

test('ISSUE-1/清理路径: 中文私有 StateDir 下 -CleanupToken 经映射命中并双清（Agent 1 发现的第二个受害者）', () => {
  // Get-MarkerDir 与处理器同样按 ANSI 读映射；映射写侧修复后，定向清理在中文
  // 私有 StateDir 下也应正确命中（T6 S6 只覆盖了 ASCII，未暴露此路径）。
  // 清理路径不弹通知，可安全实跑。
  const s = makeSandbox()
  const tok = '1a2b3c4d5e6f4a4b8c9d0e1f2a3b4c5d'
  try {
    writeAnsiMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${tok}.dir`), s.mappedDir)
    writeFileSync(join(s.mappedDir, `${tok}.pending`), '999999\n')
    writeFileSync(join(s.mappedDir, `${tok}.result`), 'approve\n')
    const r = spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', join(SCRIPTS, 'approval-toast.ps1'), '-CleanupToken', tok, '-StateDir', s.mappedDir,
    ], { env: { ...process.env, LOCALAPPDATA: s.localAppData }, encoding: 'utf8', timeout: 60_000, windowsHide: true })
    assert.equal(r.status, 0, `清理失败: ${r.stdout} ${r.stderr}`)
    assert.ok((r.stdout ?? '').includes(`CLEANED token=${tok}`))
    assert.equal(existsSync(join(s.mappedDir, `${tok}.pending`)), false, '.pending 未被定向清理')
    assert.equal(existsSync(join(s.mappedDir, `${tok}.result`)), false, '.result 未被定向清理')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('ISSUE-1/静态: approval-toast.ps1 的映射写入必须是 ANSI（Encoding.Default）', () => {
  // 修复就在写映射这一行上；静态断言防止未来被改回 UTF8Encoding（无 BOM UTF-8
  // 会被 ANSI 读取的处理器读成乱码——正是 T6 E6 实测的 bug 形态）。
  const source = readFileSync(join(SCRIPTS, 'approval-toast.ps1'), 'utf8')
  const line = source.split('\n').find((l) => l.includes('WriteAllText($mappingFile'))
  assert.ok(line, '找不到映射写入语句')
  assert.ok(line.includes('[System.Text.Encoding]::Default'), `映射写入未使用 ANSI: ${line.trim()}`)
  assert.ok(!/UTF8Encoding|New-Object System\.Text\.UTF8/.test(line), `映射写入不得为 UTF-8: ${line.trim()}`)
})

test('ISSUE-1/VBS: ANSI 映射 -> 中文+空格 StateDir 命中', () => {
  const s = makeSandbox()
  try {
    writeAnsiMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${ID}.dir`), s.mappedDir)
    spawnSync('wscript.exe', ['//B', '//Nologo', VBS, `dshapproval:approve/${ID}`], {
      env: { ...process.env, LOCALAPPDATA: s.localAppData }, timeout: 30_000, windowsHide: true,
    })
    const result = join(s.mappedDir, `${ID}.result`)
    assert.equal(waitForFile(result), true, '中文映射目录未收到回写（ISSUE-1 回归）')
    assert.equal(readFileSync(result, 'utf8').split('\n')[0].trim(), 'approve')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('ISSUE-1/PS 回退: ANSI 映射 -> 中文+空格 StateDir 命中', () => {
  const s = makeSandbox()
  try {
    writeAnsiMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${ID}.dir`), s.mappedDir)
    spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', PS1, '-Uri', `dshapproval:approve/${ID}`,
    ], { env: { ...process.env, LOCALAPPDATA: s.localAppData }, timeout: 60_000, windowsHide: true })
    const result = join(s.mappedDir, `${ID}.result`)
    assert.equal(waitForFile(result), true, 'PS 回退处理器未命中中文映射目录')
    assert.equal(readFileSync(result, 'utf8').split('\n')[0].trim(), 'approve')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})

test('ISSUE-1/对照: UTF-8 旧写法仍会回落默认目录（记录处理器既有语义，不因本修复改变）', () => {
  const s = makeSandbox()
  try {
    writeUtf8Mapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${ID}.dir`), s.mappedDir)
    spawnSync('wscript.exe', ['//B', '//Nologo', VBS, `dshapproval:approve/${ID}`], {
      env: { ...process.env, LOCALAPPDATA: s.localAppData }, timeout: 30_000, windowsHide: true,
    })
    assert.equal(waitForFile(join(s.mappedDir, `${ID}.result`), 2000), false,
      'UTF-8 映射竟被中文目录命中——处理器读取行为发生了变化，请核查')
    assert.equal(waitForFile(join(s.defaultDir, `${ID}.result`)), true,
      '回落路径也应正常回写（fail-safe 语义）')
  } finally {
    rmSync(s.root, { recursive: true, force: true })
  }
})
