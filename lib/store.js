import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, openSync, closeSync, readFileSync, writeSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
/** settle 只接受终态；'pending' 不是合法的结算目标 */
const TERMINAL_STATUSES = ['approved', 'rejected', 'timeout', 'dismissed', 'cancelled', 'unavailable'];
export class StoreLockError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StoreLockError';
    }
}
export class StoreWriteError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'StoreWriteError';
        if (cause !== undefined)
            this.cause = cause;
    }
}
export class StoreClosedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'StoreClosedError';
    }
}
/**
 * SQLite (WAL) 持久化审批记录，附同 dataDir 单活跃实例锁。
 *
 * 实例锁：打开数据库之前先在 dataDir 内创建 approval-center.lock（O_EXCL）。
 * 锁冲突时抛 StoreLockError（含对方 owner 诊断），绝不打开、更不改写他人的
 * pending 数据——独立实例必须配置独立 dataDir。
 *
 * 崩溃恢复：取得锁之后把残留的 pending 标记为 unavailable（fail-closed，
 * 含义是"实例崩溃/关闭时审批未完成决策"）；timeout 只留给真实展示超时，
 * 不把崩溃伪装成超时。
 */
export class ApprovalStore {
    db;
    lockPath;
    nonce;
    closed = false;
    constructor(dataDir, owner) {
        this.lockPath = join(dataDir, 'approval-center.lock');
        this.nonce = randomUUID();
        mkdirSync(dataDir, { recursive: true });
        // 锁必须先于数据库打开/恢复取得，否则恢复写入可能落在他人数据上
        this.acquireLock(owner?.identity ?? `${hostname()}:${process.pid}`);
        let db;
        try {
            db = new DatabaseSync(join(dataDir, 'approvals.db'));
            db.exec(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS approvals (
          request_id TEXT PRIMARY KEY,
          agent_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          status TEXT NOT NULL
        );
      `);
            this.db = db;
            this.recover();
        }
        catch (error) {
            // 打开失败时关闭已建立的句柄并释放刚取得的锁，避免留下死锁
            try {
                db?.close();
            }
            catch {
                // 句柄可能尚未建立或已损坏，忽略
            }
            this.releaseLockQuietly();
            throw error instanceof StoreWriteError ? error : new StoreWriteError(`打开审批数据库失败: ${String(error)}`, error);
        }
    }
    lockInfo(identity) {
        return {
            schema: 1,
            identity,
            hostname: hostname(),
            pid: process.pid,
            acquiredAt: new Date().toISOString(),
            nonce: this.nonce,
        };
    }
    acquireLock(identity, attempts = 2) {
        const info = this.lockInfo(identity);
        for (let i = 0; i < attempts; i++) {
            let fd;
            try {
                fd = openSync(this.lockPath, 'wx');
            }
            catch (error) {
                if (!isLockBusy(error))
                    throw new StoreWriteError(`创建实例锁失败: ${String(error)}`, error);
                this.evaluateConflictingLock();
                continue;
            }
            try {
                writeSync(fd, JSON.stringify(info, null, 2));
            }
            finally {
                closeSync(fd);
            }
            return;
        }
        throw new StoreLockError(`实例锁被其他 owner 持有且无法回收: ${this.lockPath}`);
    }
    /** 读取并核验冲突锁；只有确认原 owner 已消失才回收，否则抛 StoreLockError */
    evaluateConflictingLock() {
        let raw;
        try {
            raw = readFileSync(this.lockPath, 'utf8');
        }
        catch (error) {
            throw new StoreLockError(`实例锁存在但无法读取，保守拒绝（人工确认无活跃实例后删除 ${this.lockPath}）: ${String(error)}`);
        }
        let info;
        try {
            info = JSON.parse(raw);
        }
        catch {
            throw new StoreLockError(`实例锁内容损坏（非 JSON），保守拒绝；确认无活跃实例后手工删除 ${this.lockPath}。原始内容: ${raw.slice(0, 200)}`);
        }
        const owner = `identity=${info.identity} pid=${info.pid} host=${info.hostname} acquiredAt=${info.acquiredAt}`;
        if (info.hostname !== hostname()) {
            throw new StoreLockError(`实例锁由其他主机持有，无法验证存活，保守拒绝。owner: ${owner}。若确认该主机实例已停止，可手工删除 ${this.lockPath}`);
        }
        const liveness = checkPid(info.pid);
        if (liveness === 'alive') {
            throw new StoreLockError(`同 dataDir 已有活跃实例（同 dataDir 只允许一个插件实例；独立实例请配置独立 dataDir）。owner: ${owner}`);
        }
        if (liveness === 'unknown') {
            // pid 可能被系统重用，也可能没有权限判定——宁可拒绝也不能动未知进程的数据
            throw new StoreLockError(`实例锁 owner 进程（pid=${info.pid}）存活状态无法判定（可能 PID 重用），保守拒绝。owner: ${owner}。请人工核实该进程身份；确认无活跃实例后删除 ${this.lockPath}`);
        }
        // 原 owner 已死：回收前再核对一次锁内容未被其他实例抢先换掉
        let current;
        try {
            current = readFileSync(this.lockPath, 'utf8');
        }
        catch {
            throw new StoreLockError(`回收死锁前读取实例锁失败，保守拒绝: ${this.lockPath}`);
        }
        if (current !== raw)
            return; // 锁已被其他实例接管，下一轮按新 owner 评估
        try {
            unlinkSync(this.lockPath);
        }
        catch (error) {
            throw new StoreLockError(`回收已死 owner 的实例锁失败，保守拒绝（可人工删除 ${this.lockPath}）: ${String(error)}`);
        }
    }
    releaseLockQuietly() {
        try {
            const raw = readFileSync(this.lockPath, 'utf8');
            const info = JSON.parse(raw);
            if (info.nonce === this.nonce)
                unlinkSync(this.lockPath);
        }
        catch {
            // 释放失败留给下次打开时的死锁回收处理，不在错误路径上再抛
        }
    }
    recover() {
        // 残留 pending = 上个实例崩溃/被关闭时未完成决策的请求，按 fail-closed 记为
        // unavailable；真实超时是运行期由 dialog 结算的，这里不能替它撒谎
        this.db.exec(`UPDATE approvals SET status = 'unavailable' WHERE status = 'pending'`);
    }
    insert(record) {
        if (this.closed)
            throw new StoreClosedError('审批数据库已关闭，无法写入新记录');
        try {
            this.db.prepare(`INSERT INTO approvals (request_id, agent_id, tool_name, reason, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?)`).run(record.requestId, record.agentId, record.toolName, record.reason, record.createdAt, record.status);
        }
        catch (error) {
            throw new StoreWriteError(`写入审批记录失败 (requestId=${record.requestId}): ${String(error)}`, error);
        }
    }
    settle(requestId, status) {
        if (this.closed)
            throw new StoreClosedError(`审批数据库已关闭，无法结算 (requestId=${requestId})`);
        if (!TERMINAL_STATUSES.includes(status)) {
            throw new StoreWriteError(`settle 目标必须是终态，收到 '${status}' (requestId=${requestId})`);
        }
        // WHERE status='pending' 是终态门：重复 settle 是幂等 no-op，晚到结果改不了已结算状态
        const result = this.db.prepare(`UPDATE approvals SET status = ? WHERE request_id = ? AND status = 'pending'`).run(status, requestId);
        if (result.changes === 0) {
            const row = this.db.prepare(`SELECT status FROM approvals WHERE request_id = ?`).get(requestId);
            if (!row)
                throw new StoreWriteError(`settle 目标记录不存在 (requestId=${requestId})`);
            // 记录存在但已是终态：幂等，不覆盖、不报错
        }
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        try {
            this.db.close();
        }
        finally {
            this.releaseLockQuietly();
        }
    }
}
function isLockBusy(error) {
    return error?.code === 'EEXIST';
}
function checkPid(pid) {
    try {
        process.kill(pid, 0);
        return 'alive';
    }
    catch (error) {
        if (error?.code === 'ESRCH')
            return 'dead';
        // Windows 下 EPERM 表示进程存在但无权发信号，仍视为存活
        if (error?.code === 'EPERM')
            return 'alive';
        return 'unknown';
    }
}
