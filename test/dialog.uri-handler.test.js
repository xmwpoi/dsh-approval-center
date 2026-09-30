// T3：URI 处理器（VBS 主路径 + PowerShell 回退）的真实执行测试。
// 两个处理器只做一件事：解析 dshapproval:<decision>/<id> 并把决定写进状态文件。
// 通过覆盖子进程的 LOCALAPPDATA 把全部读写沙箱进临时目录——不触碰真实状态目录、
// 不注册 URI、不弹通知。这同时覆盖 V17 前置的"处理器在干净环境可用"。
// 运行：node --test test/dialog.uri-handler.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from 'node:fs'
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

function runVbs(env, uri, resultPath) {
  // wscript.exe 是 GUI 进程。spawnSync 在某些 runner 上会一直等 GUI 进程句柄，
  // 即使处理器已写好结果；异步监听文件，并在测试结束时回收进程。
  return new Promise((resolve, reject) => {
    const logPath = join(dirname(env.LOCALAPPDATA), 'wscript.debug.log')
    const child = spawn('wscript.exe', ['//B', '//Nologo', VBS, uri], {
      env: { ...env, DSH_APPROVAL_DEBUG: '1', DSH_APPROVAL_DEBUG_LOG: logPath },
      windowsHide: true,
      stdio: 'ignore',
    })
    let closed = false
    let exitCode
    let launchError
    let done = false
    const diagnostic = () => {
      const log = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '(no handler log)'
      return `uri=${uri}; exit=${exitCode}; error=${launchError?.message ?? 'none'}; log=${log}`
    }
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
    child.on('error', (error) => { launchError = error; finish(new Error(diagnostic())) })
    child.on('close', (code) => {
      closed = true
      exitCode = code
      // 负向用例必须等处理器退出，否则可能在写文件前误判为拒绝。
      if (!resultPath) {
        if (!existsSync(logPath) || !readFileSync(logPath, 'utf8').includes('accepted=False')) {
          finish(new Error(`处理器未证明已拒绝非法 URI：${diagnostic()}`))
        } else finish()
      }
    })
    const poll = setInterval(() => {
      if (!resultPath || !existsSync(resultPath)) return
      try {
        const decision = uri.split(':')[1].split('/')[0]
        if (readFileSync(resultPath, 'utf8').startsWith(`${decision}\n`)) finish()
      } catch { /* 文件正在创建，下一轮再读 */ }
    }, 50)
    const deadline = setTimeout(() => finish(new Error(`wscript 未在 10 秒内完成：${diagnostic()}`)), 10_000)
  })
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

  test(`U-${variant}/01: approve 决定写入默认状态目录`, async () => {
    const s = makeSandbox()
    try {
      const result = join(s.defaultDir, `${ID}.result`)
      await run(s.env, `dshapproval:approve/${ID}`, result)
      assert.equal(waitForFile(result), true, '结果文件未出现')
      const content = readFirstLine(result)
      assert.equal(content, 'approve')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/02: reject 决定写入默认状态目录`, async () => {
    const s = makeSandbox()
    try {
      const result = join(s.defaultDir, `${ID}.result`)
      await run(s.env, `dshapproval:reject/${ID}`, result)
      assert.equal(waitForFile(result), true)
      assert.equal(readFirstLine(result), 'reject')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/03: 非法 id（路径穿越/非 hex）→ 不写任何文件`, async () => {
    for (const bad of ['../../evil', 'zzzz', `${'a'.repeat(65)}`, `${ID}%00`]) {
      const s = makeSandbox()
      try {
        await run(s.env, `dshapproval:approve/${bad}`)
        assert.equal(existsSync(s.defaultDir), false, `id=${bad} 竟然产生了状态目录内容`)
        if (existsSync(s.defaultDir)) {
          assert.deepEqual(readdirSync(s.defaultDir), [], `id=${bad} 留下了文件`)
        }
      } finally {
        rmSync(s.root, { recursive: true, force: true })
      }
    }
  })

  test(`U-${variant}/04: 非法 decision → 不写任何文件`, async () => {
    const s = makeSandbox()
    try {
      await run(s.env, `dshapproval:maybe/${ID}`)
      assert.equal(existsSync(s.defaultDir), false)
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/05: 合法映射 <id>.dir → 结果写进映射目录`, async () => {
    const s = makeSandbox()
    try {
      const mapped = join(s.root, 'mapped-state')
      mkdirSync(mapped)
      mkdirSync(s.defaultDir)
      writeFileSync(join(s.defaultDir, `${ID}.dir`), `\uFEFF${mapped}`, 'utf16le')
      const result = join(mapped, `${ID}.result`)
      await run(s.env, `dshapproval:approve/${ID}`, result)
      assert.equal(waitForFile(result), true, '映射目录里没有结果文件')
      assert.equal(readFirstLine(result), 'approve')
    } finally {
      rmSync(s.root, { recursive: true, force: true })
    }
  })

  test(`U-${variant}/06: 相对路径映射不可信 → 回落默认目录`, async () => {
    const s = makeSandbox()
    try {
      mkdirSync(s.defaultDir)
      writeFileSync(join(s.defaultDir, `${ID}.dir`), '\uFEFFrelative\\path', 'utf16le')
      const result = join(s.defaultDir, `${ID}.result`)
      await run(s.env, `dshapproval:reject/${ID}`, result)
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
