// T3：-CleanupToken 定向清理入口的真实执行测试（受控，无通知弹出）。
// 清理路径只做：文件删除 + History.Remove(tag,group,appId)——tag 不存在时
// WinRT 静默返回（脚本文件头实测表），因此本测试不会在操作中心产生/删除任何
// 可见通知，也绝不触碰真实 %LOCALAPPDATA%（-StateDir 全程指向临时目录）。
// 运行：node --test test/dialog.cleanup.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'approval-toast.ps1')

function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-t3-cleanup-'))
  return { dir, token: 'c1e4a6f8a0b2' }
}

function runCleanup(stateDir, token) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', SCRIPT, '-CleanupToken', token, '-StateDir', stateDir,
  ], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
}

test('CL-01: 清理入口删除本人状态文件并 exit 0（无残留通知时也是成功）', () => {
  const { dir, token } = makeSandbox()
  try {
    writeFileSync(join(dir, `${token}.pending`), '999999\n')
    writeFileSync(join(dir, `${token}.result`), 'approve\n')
    const r = runCleanup(dir, token)
    assert.equal(r.status, 0, `stdout=${r.stdout} stderr=${r.stderr}`)
    assert.ok((r.stdout ?? '').includes(`CLEANED token=${token}`))
    assert.equal(existsSync(join(dir, `${token}.pending`)), false)
    assert.equal(existsSync(join(dir, `${token}.result`)), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CL-02: 幂等——重复调用（目标已不存在）仍 exit 0', () => {
  const { dir, token } = makeSandbox()
  try {
    assert.equal(runCleanup(dir, token).status, 0)
    assert.equal(runCleanup(dir, token).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CL-03: token 格式非法 → exit 4（调用方 bug 必须可见）', () => {
  const { dir } = makeSandbox()
  try {
    const r = runCleanup(dir, '../evil')
    assert.equal(r.status, 4)
    assert.ok((r.stdout ?? '').includes('CLEANUP FAILED'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('CL-04: 只清本人——同目录其他审批的状态文件不受影响', () => {
  const { dir, token } = makeSandbox()
  const other = 'aaaa1111bbbb2222'
  try {
    writeFileSync(join(dir, `${token}.pending`), '999999\n')
    writeFileSync(join(dir, `${other}.pending`), '999999\n')
    assert.equal(runCleanup(dir, token).status, 0)
    assert.equal(existsSync(join(dir, `${token}.pending`)), false)
    assert.equal(existsSync(join(dir, `${other}.pending`)), true, '其他审批的标记不得被误删')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
