// T4 store 测试套件：node --test test/store.test.js
// 全部使用 os.tmpdir() 下的隔离目录，不触碰任何真实审批数据库。
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { hostname } from 'node:os'
import {
  ApprovalStore,
  StoreLockError,
  StoreWriteError,
  StoreClosedError,
} from '../src/store.ts'

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS approvals (
    request_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    status TEXT NOT NULL
  );
`

let dataDir

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'approval-store-test-'))
})

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function record(overrides = {}) {
  return {
    requestId: randomUUID(),
    agentId: 'agent-test',
    toolName: 'bash',
    reason: '测试请求',
    createdAt: new Date().toISOString(),
    status: 'pending',
    ...overrides,
  }
}

function statusOf(requestId, dataDirOverride = dataDir) {
  const db = new DatabaseSync(join(dataDirOverride, 'approvals.db'))
  try {
    return db.prepare('SELECT status FROM approvals WHERE request_id = ?').get(requestId).status
  } finally {
    db.close()
  }
}

function presetRow(row) {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'approvals.db'))
  db.exec(CREATE_TABLE)
  db.prepare(
    `INSERT INTO approvals (request_id, agent_id, tool_name, reason, created_at, status)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.requestId, row.agentId ?? 'agent-pre', row.toolName ?? 'bash', row.reason ?? '', row.createdAt ?? new Date().toISOString(), row.status)
  db.close()
}

function writeLock(content) {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'approval-center.lock'), typeof content === 'string' ? content : JSON.stringify(content))
}

function deadPid() {
  const r = spawnSync(process.execPath, ['-e', ''])
  if (r.error || r.status !== 0) throw new Error('无法制造死 pid: ' + String(r.error))
  return r.pid
}

// 1. 锁冲突不改 DB：第二实例抛 StoreLockError，首实例 pending 原样保留
test('01 锁冲突：第二实例抛 StoreLockError 且不改写首实例 pending', () => {
  const store1 = new ApprovalStore(dataDir, { identity: 'first' })
  try {
    const rec = record()
    store1.insert(rec)
    assert.throws(() => new ApprovalStore(dataDir, { identity: 'second' }), StoreLockError)
    assert.equal(statusOf(rec.requestId), 'pending')
  } finally {
    store1.close()
  }
})

// 2. 活 owner 诊断：错误信息含对方 identity 与 pid
test('02 锁冲突诊断：StoreLockError 含 owner identity 和 pid', () => {
  const store1 = new ApprovalStore(dataDir, { identity: 'owner-visible' })
  try {
    try {
      new ApprovalStore(dataDir, { identity: 'second' })
      assert.fail('应当抛出 StoreLockError')
    } catch (error) {
      assert.ok(error instanceof StoreLockError)
      assert.match(error.message, /owner-visible/)
      assert.match(error.message, new RegExp(`pid=${process.pid}`))
    }
  } finally {
    store1.close()
  }
})

// 3. 死进程锁回收：owner 进程已死时新实例可打开，pending 恢复为 unavailable（非 timeout）
test('03 死进程锁回收：可打开且 pending 恢复为 unavailable', () => {
  const rec = record()
  presetRow(rec)
  writeLock({ schema: 1, identity: 'dead-owner', hostname: hostname(), pid: deadPid(), acquiredAt: new Date().toISOString(), nonce: 'stale-nonce' })
  const store2 = new ApprovalStore(dataDir, { identity: 'new-owner' })
  try {
    assert.equal(statusOf(rec.requestId), 'unavailable')
  } finally {
    store2.close()
  }
})

// 4. 跨机锁保守拒绝：无法验证 liveness，不动数据
test('04 跨机锁：保守拒绝且 DB 数据不变', () => {
  const rec = record()
  presetRow(rec)
  writeLock({ schema: 1, identity: 'remote', hostname: 'other-host', pid: 1, acquiredAt: new Date().toISOString(), nonce: 'remote-nonce' })
  assert.throws(() => new ApprovalStore(dataDir, { identity: 'local' }), StoreLockError)
  assert.equal(statusOf(rec.requestId), 'pending')
})

// 5. 损坏锁文件保守拒绝
test('05 损坏锁文件：保守拒绝且诊断含原始内容', () => {
  presetRow(record())
  writeLock('{{{ not json')
  try {
    new ApprovalStore(dataDir, { identity: 'local' })
    assert.fail('应当抛出 StoreLockError')
  } catch (error) {
    assert.ok(error instanceof StoreLockError)
    assert.match(error.message, /not json/)
  }
})

// 6. 崩溃恢复语义：pending → unavailable；终态行不动
test('06 崩溃恢复：pending 变 unavailable，终态行保留', () => {
  const rows = [
    record({ status: 'pending' }),
    record({ status: 'approved' }),
    record({ status: 'rejected' }),
    record({ status: 'timeout' }),
  ]
  for (const row of rows) presetRow(row)
  const store = new ApprovalStore(dataDir, { identity: 'recovery' })
  try {
    assert.equal(statusOf(rows[0].requestId), 'unavailable')
    assert.equal(statusOf(rows[1].requestId), 'approved')
    assert.equal(statusOf(rows[2].requestId), 'rejected')
    assert.equal(statusOf(rows[3].requestId), 'timeout')
  } finally {
    store.close()
  }
})

// 7. settle 幂等：重复 settle 不报错，晚到结果不覆盖终态
test('07 settle 幂等：晚到结果不覆盖终态', () => {
  const store = new ApprovalStore(dataDir, { identity: 'settle' })
  try {
    const rec = record()
    store.insert(rec)
    store.settle(rec.requestId, 'approved')
    store.settle(rec.requestId, 'rejected') // 晚到，幂等 no-op
    assert.equal(statusOf(rec.requestId), 'approved')
  } finally {
    store.close()
  }
})

// 8. settle 非法目标与未知记录
test('08 settle 非法：pending 目标/未知 requestId 抛 StoreWriteError', () => {
  const store = new ApprovalStore(dataDir, { identity: 'settle' })
  try {
    const rec = record()
    store.insert(rec)
    assert.throws(() => store.settle(rec.requestId, 'pending'), StoreWriteError)
    assert.throws(() => store.settle(randomUUID(), 'approved'), StoreWriteError)
    assert.equal(statusOf(rec.requestId), 'pending')
  } finally {
    store.close()
  }
})

// 9. insert 重复 requestId 失败且可诊断
test('09 insert 重复 requestId 抛 StoreWriteError', () => {
  const store = new ApprovalStore(dataDir, { identity: 'insert' })
  try {
    const rec = record()
    store.insert(rec)
    assert.throws(() => store.insert(record({ requestId: rec.requestId })), StoreWriteError)
  } finally {
    store.close()
  }
})

// 10. 旧版库兼容读取：同 schema 预置数据，新版打开不破坏终态行
test('10 旧库兼容：旧版写入的数据新版可读', () => {
  const legacy = [
    record({ agentId: 'legacy-agent', status: 'approved', reason: '旧版已批准' }),
    record({ agentId: 'legacy-agent', status: 'rejected', reason: '旧版已拒绝' }),
    record({ agentId: 'legacy-agent', status: 'pending', reason: '旧版遗留 pending' }),
  ]
  for (const row of legacy) presetRow(row)
  const store = new ApprovalStore(dataDir, { identity: 'upgrade' })
  try {
    assert.equal(statusOf(legacy[0].requestId), 'approved')
    assert.equal(statusOf(legacy[1].requestId), 'rejected')
    assert.equal(statusOf(legacy[2].requestId), 'unavailable')
  } finally {
    store.close()
  }
})

// 11. close 释放锁：close 后同 dataDir 可再开
test('11 close 释放锁：之后同 dataDir 可再打开', () => {
  const store1 = new ApprovalStore(dataDir, { identity: 'first' })
  const rec = record()
  store1.insert(rec)
  store1.close()
  const store2 = new ApprovalStore(dataDir, { identity: 'second' })
  try {
    assert.equal(statusOf(rec.requestId), 'unavailable') // store1 关闭遗留 pending 按崩溃语义恢复
  } finally {
    store2.close()
  }
})

// 12. close 后访问抛 StoreClosedError；close 重复调用是 no-op
test('12 close 后访问：insert/settle 抛 StoreClosedError，close 幂等', () => {
  const store = new ApprovalStore(dataDir, { identity: 'close' })
  const rec = record()
  store.insert(rec)
  store.close()
  assert.throws(() => store.insert(record()), StoreClosedError)
  assert.throws(() => store.settle(rec.requestId, 'approved'), StoreClosedError)
  store.close() // no-op
})

// 13. 锁文件内容与释放
test('13 锁文件：打开时存在且含 owner 字段，close 后删除', () => {
  const store = new ApprovalStore(dataDir, { identity: 'lockfile' })
  try {
    const lockPath = join(dataDir, 'approval-center.lock')
    assert.equal(existsSync(lockPath), true)
    const info = JSON.parse(readFileSync(lockPath, 'utf8'))
    assert.equal(info.identity, 'lockfile')
    assert.equal(info.hostname, hostname())
    assert.equal(info.pid, process.pid)
    assert.ok(info.acquiredAt)
    assert.ok(info.nonce)
    store.close()
    assert.equal(existsSync(lockPath), false)
  } finally {
    store.close() // 双保险幂等
  }
})

// 14. 打开失败不留死锁：DB 损坏时锁被释放
test('14 打开失败：DB 打不开时释放锁，下次可重试', () => {
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(dataDir, 'approvals.db'), 'this is not a database')
  assert.throws(() => new ApprovalStore(dataDir, { identity: 'broken-db' }))
  assert.equal(existsSync(join(dataDir, 'approval-center.lock')), false)
})
