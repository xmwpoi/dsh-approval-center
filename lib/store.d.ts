export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'dismissed' | 'cancelled' | 'unavailable';
export interface ApprovalRecord {
    requestId: string;
    agentId: string;
    toolName: string;
    reason: string;
    createdAt: string;
    status: ApprovalStatus;
}
/**
 * SQLite (WAL) 持久化审批记录。
 * 崩溃恢复：启动时把残留的 pending 记录标记为 timeout（fail-closed）。
 */
export declare class ApprovalStore {
    private db;
    constructor(dataDir: string);
    private recover;
    insert(record: ApprovalRecord): void;
    settle(requestId: string, status: ApprovalStatus): void;
    close(): void;
}
