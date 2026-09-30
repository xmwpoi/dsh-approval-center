// ISSUE-1 回归测试：映射文件统一为带 BOM 的 UTF-16 LE。
// ANSI 修复仅在本机中文代码页上有效；英文 CI runner 无法用 ANSI 表示中文路径。
// 修复后脚本以 [System.Text.Encoding]::Unicode 写映射；本测试用同一编码造夹具，
// 直调两个处理器，断言结果文件落在中文+空格映射目录内。
// 夹具全部在沙箱 LOCALAPPDATA 下，不触碰真实状态目录；不弹通知、不改注册表。
// 运行：node --test test/dialog.unicode-mapping.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
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

/**
 * 有界重试的沙箱清理。
 *
 * 为什么不能直接 `rmSync(..., { force: true })`：`force` 只忽略"不存在"，
 * **不重试**占用错误。本文件会真的拉起 `wscript.exe`（GUI 子系统）写结果文件，
 * 测试结束时刚 `kill()` 的进程可能仍持有句柄，Windows 上删除被占用目录会抛
 * EPERM/EACCES/EBUSY。实测：本地（已装 DSH 的机器）不触发，GitHub Actions 的
 * windows-latest 上稳定触发 —— 于是"断言已通过"的用例在 finally 里失败，
 * 把一次真实通过误报成红灯（CI run 36745467011）。
 *
 * 处置：短暂退避重试；最后仍失败则**不抛**（清理失败不得改写断言结论），只留告警。
 * 临时目录由 runner 回收，不泄漏到用户环境。
 */
function cleanupSandbox(root) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      rmSync(root, { recursive: true, force: true })
      return
    } catch (error) {
      const code = error?.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY' && code !== 'ENOTEMPTY') throw error
      // 同步退避是刻意的：本文件其余部分已用 Atomics.wait 做同步等待
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (attempt + 1))
    }
  }
  console.warn(`[test] 沙箱目录清理失败（被占用），交由 runner 回收: ${root}`)
}

/** 用 PowerShell 以 [System.Text.Encoding]::Unicode 写映射（与脚本一致）。
 *  中文路径经由 env 传入（UTF-16 进程环境），避免命令行编码失真。 */
function writeUnicodeMapping(env, mappingPath, mappedDir) {
  const r = spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
    '[System.IO.File]::WriteAllText($env:MAPPING_PATH, $env:MAPPED_DIR, [System.Text.Encoding]::Unicode)',
  ], { env: { ...env, MAPPING_PATH: mappingPath, MAPPED_DIR: mappedDir }, timeout: 60_000, windowsHide: true })
  assert.equal(r.status, 0, `Unicode 映射夹具写入失败: ${r.stderr}`)
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
  // Get-MarkerDir 与处理器同样按 UTF-16 LE 读映射；定向清理在中文
  // 私有 StateDir 下也应正确命中（T6 S6 只覆盖了 ASCII，未暴露此路径）。
  // 清理路径不弹通知，可安全实跑。
  const s = makeSandbox()
  const tok = '1a2b3c4d5e6f4a4b8c9d0e1f2a3b4c5d'
  try {
    writeUnicodeMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${tok}.dir`), s.mappedDir)
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
    cleanupSandbox(s.root)
  }
})

test('ISSUE-1/静态: 映射写入必须为跨代码页的 UTF-16 LE', () => {
  // 静态断言防止未来被改回依赖系统区域设置的 Encoding.Default。
  const source = readFileSync(join(SCRIPTS, 'approval-toast.ps1'), 'utf8')
  const line = source.split('\n').find((l) => l.includes('WriteAllText($mappingFile'))
  assert.ok(line, '找不到映射写入语句')
  assert.ok(line.includes('[System.Text.Encoding]::Unicode'), `映射写入未使用 UTF-16 LE: ${line.trim()}`)
  assert.ok(!/Encoding]::Default|UTF8Encoding/.test(line), `映射写入不得依赖系统代码页: ${line.trim()}`)
})

test('ISSUE-1/VBS: UTF-16 LE 映射 -> 中文+空格 StateDir 命中', async () => {
  const s = makeSandbox()
  try {
    writeUnicodeMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${ID}.dir`), s.mappedDir)
    const result = join(s.mappedDir, `${ID}.result`)
    // wscript 是 GUI 进程；同步等待其句柄在某些 runner 上会超时，
    // 此处以非交互结果文件为成功条件，并在完成后回收仍存活的进程。
    await new Promise((resolve, reject) => {
      const debugLog = join(s.root, 'wscript.debug.log')
      const child = spawn('wscript.exe', ['//B', '//Nologo', VBS, `dshapproval:approve/${ID}`], {
        env: {
          ...process.env, LOCALAPPDATA: s.localAppData,
          DSH_APPROVAL_DEBUG: '1', DSH_APPROVAL_DEBUG_LOG: debugLog,
        }, windowsHide: true, stdio: 'ignore',
      })
      let done = false
      let closed = false
      let exitCode
      let launchError
      const finish = (error) => {
        if (done) return
        done = true
        clearInterval(poll)
        clearTimeout(deadline)
        if (!closed) child.kill()
        child.unref()
        if (error) reject(error)
        else resolve()
      }
      child.on('error', (error) => { launchError = error; finish(error) })
      child.on('close', (code) => { closed = true; exitCode = code })
      const poll = setInterval(() => {
        if (!existsSync(result)) return
        try {
          if (readFileSync(result, 'utf8').startsWith('approve\n')) finish()
        } catch { /* 文件正在创建，下一轮再读 */ }
      }, 50)
      const deadline = setTimeout(() => {
        const log = existsSync(debugLog) ? readFileSync(debugLog, 'utf8') : '(no handler log)'
        finish(new Error(`中文映射目录未收到回写；wscript exit=${exitCode}, error=${launchError?.message ?? 'none'}, log=${log}`))
      }, 10_000)
    })
    assert.equal(readFileSync(result, 'utf8').split('\n')[0].trim(), 'approve')
  } finally {
    cleanupSandbox(s.root)
  }
})

test('ISSUE-1/PS 回退: UTF-16 LE 映射 -> 中文+空格 StateDir 命中', () => {
  const s = makeSandbox()
  try {
    writeUnicodeMapping({ LOCALAPPDATA: s.localAppData }, join(s.defaultDir, `${ID}.dir`), s.mappedDir)
    spawnSync('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', PS1, '-Uri', `dshapproval:approve/${ID}`,
    ], { env: { ...process.env, LOCALAPPDATA: s.localAppData }, timeout: 60_000, windowsHide: true })
    const result = join(s.mappedDir, `${ID}.result`)
    assert.equal(waitForFile(result), true, 'PS 回退处理器未命中中文映射目录')
    assert.equal(readFileSync(result, 'utf8').split('\n')[0].trim(), 'approve')
  } finally {
    cleanupSandbox(s.root)
  }
})

test('ISSUE-1/协议: 映射文件有 UTF-16 LE BOM，中文路径可无损往返', () => {
  const s = makeSandbox()
  try {
    const mapping = join(s.defaultDir, `${ID}.dir`)
    writeUnicodeMapping({ LOCALAPPDATA: s.localAppData }, mapping, s.mappedDir)
    const bytes = readFileSync(mapping)
    assert.equal(bytes[0], 0xff)
    assert.equal(bytes[1], 0xfe)
    assert.equal(bytes.subarray(2).toString('utf16le'), s.mappedDir)
  } finally {
    cleanupSandbox(s.root)
  }
})
