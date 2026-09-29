// T3：URI 处理器（VBS 主路径 + PowerShell 回退）的真实执行测试。
// 两个处理器只做一件事：解析 dshapproval:<decision>/<id> 并把决定写进状态文件。
// 通过覆盖子进程的 LOCALAPPDATA 把全部读写沙箱进临时目录——不触碰真实状态目录、
// 不注册 URI、不弹通知。这同时覆盖 V17 前置的"处理器在干净环境可用"。
// 运行：node --test test/dialog.uri-handler.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')
const VBS = join(SCRIPTS, 'approval-uri-handler.vbs')
const PS1 = join(SCRIPTS, 'approval-uri-handler.ps1')

function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-t3-uri-'))
  const localAppData = join(root, 'LOCALAPPDATA')
  mkdirSync(localAppData)
  const defaultDir = join(localAppData, 'dsh-approval-center')
  const env = { ...process.env, LOCALAPPDATA: localAppData }
  return { root, localAppData, defaultDir, env }
}

function runVbs(env, uri) {
  return spawnSync('wscript.exe', ['//B', '//Nologo', VBS, uri], { env, timeout: 30_000, windowsHide: true })
}

function runPs(env, uri) {
  return spawnSync('powershell.exe', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', PS1, '-Uri', uri,
  ], { env, timeout: 60_000, windowsHide: true, encoding: 'utf8' })
}

/** 处理器是异步 GUI 进程（wscript）/独立 PS，轮询等待结果文件出现。 */
function waitForFile(path, ms = 8000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (existsSync(path)) return true
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
  }
  return false
}

const ID = 'abc123def456'

function suite(variant, run) {
  const label = variant === 'vbs' ? 'VBS 主路径' : 'PS 回退'

  test(`U-${variant}/01: approve 决定写入默认状态目录`, () => {
    const s = makeSandbox()
    try {
      run(s.env, `dshapproval:approve/${ID}`)
      const result = join(s.defaultDir, `${ID}.result`)
      assert.equal(waitForFile(result), true, '结果文件未出现')
      const content = readFirstLine(result)
      assert.equal(content, 'approve')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/02: reject 决定写入默认状态目录`, () => {
    const s = makeSandbox()
    try {
      run(s.env, `dshapproval:reject/${ID}`)
      const result = join(s.defaultDir, `${ID}.result`)
      assert.equal(waitForFile(result), true)
      assert.equal(readFirstLine(result), 'reject')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/03: 非法 id（路径穿越/非 hex）→ 不写任何文件`, () => {
    for (const bad of ['../../evil', 'zzzz', `${'a'.repeat(65)}`, `${ID}%00`]) {
      const s = makeSandbox()
      try {
        run(s.env, `dshapproval:approve/${bad}`)
        // 给足时间确认没有文件出现（成功路径 <1s）
        assert.equal(waitForFile(s.defaultDir, 1500), false, `id=${bad} 竟然产生了状态目录内容`)
        if (existsSync(s.defaultDir)) {
          assert.deepEqual(readdirSync(s.defaultDir), [], `id=${bad} 留下了文件`)
        }
      } finally {
        rmSync(s.root, { recursive: true, force: true })
      }
    }
  })

  test(`U-${variant}/04: 非法 decision → 不写任何文件`, () => {
    const s = makeSandbox()
    try {
      run(s.env, `dshapproval:maybe/${ID}`)
      assert.equal(waitForFile(s.defaultDir, 1500), false)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/05: 合法映射 <id>.dir → 结果写进映射目录`, () => {
    const s = makeSandbox()
    try {
      const mapped = join(s.root, 'mapped-state')
      mkdirSync(mapped)
      mkdirSync(s.defaultDir)
      writeFileSync(join(s.defaultDir, `${ID}.dir`), mapped, 'utf8')
      run(s.env, `dshapproval:approve/${ID}`)
      const result = join(mapped, `${ID}.result`)
      assert.equal(waitForFile(result), true, '映射目录里没有结果文件')
      assert.equal(readFirstLine(result), 'approve')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/06: 相对路径映射不可信 → 回落默认目录`, () => {
    const s = makeSandbox()
    try {
      mkdirSync(s.defaultDir)
      writeFileSync(join(s.defaultDir, `${ID}.dir`), 'relative\\path', 'utf8')
      run(s.env, `dshapproval:reject/${ID}`)
      const result = join(s.defaultDir, `${ID}.result`)
      assert.equal(waitForFile(result), true, '默认目录里没有结果文件')
      assert.equal(readFirstLine(result), 'reject')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })
}

function readFirstLine(path) {
  return readFileSyncText(path).split('\n')[0].trim()
}

import { readFileSync as readFileSyncRaw } from 'node:fs'
function readFileSyncText(path) {
  return readFileSyncRaw(path, 'utf8')
}

suite('vbs', runVbs)
suite('ps', runPs)
