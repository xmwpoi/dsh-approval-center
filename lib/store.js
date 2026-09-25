import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
/**
 * SQLite (WAL) 持久化审批记录。
 * 崩溃恢复：启动时把残留的 pending 记录标记为 timeout（fail-closed）。
 */
export class ApprovalStore {
    db;
    constructor(dataDir) {
        mkdirSync(dataDir, { recursive: true });
        this.db = new DatabaseSync(join(dataDir, 'approvals.db'));
        this.db.exec(`
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
        this.recover();
    }
    recover() {
        this.db.exec(`UPDATE approvals SET status = 'timeout' WHERE status = 'pending'`);
    }
    insert(record) {
        this.db.prepare(`INSERT INTO approvals (request_id, agent_id, tool_name, reason, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`).run(record.requestId, record.agentId, record.toolName, record.reason, record.createdAt, record.status);
    }
    settle(requestId, status) {
        this.db.prepare(`UPDATE approvals SET status = ? WHERE request_id = ?`).run(status, requestId);
    }
    close() {
        this.db.close();
    }
}
