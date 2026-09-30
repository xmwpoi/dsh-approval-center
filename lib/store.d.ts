export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'dismissed' | 'cancelled' | 'unavailable';
export interface ApprovalRecord {
    requestId: string;
    agentId: string;
    toolName: string;
    reason: string;
    createdAt: string;
    status: ApprovalStatus;
}
export declare class StoreLockError extends Error {
    constructor(message: string);
}
export declare class StoreWriteError extends Error {
    constructor(message: string, cause?: unknown);
}
export declare class StoreClosedError extends Error {
    constructor(message: string);
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
export declare class ApprovalStore {
    private db;
    private readonly lockPath;
    private readonly nonce;
    private closed;
    constructor(dataDir: string, owner?: {
        identity: string;
    });
    private lockInfo;
    private acquireLock;
    /** 读取并核验冲突锁；只有确认原 owner 已消失才回收，否则抛 StoreLockError */
    private evaluateConflictingLock;
    private releaseLockQuietly;
    private recover;
    insert(record: ApprovalRecord): void;
    settle(requestId: string, status: ApprovalStatus): void;
    close(): void;
}
