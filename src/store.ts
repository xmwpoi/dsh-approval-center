import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'timeout' | 'dismissed' | 'cancelled' | 'unavailable'

export interface ApprovalRecord {
  requestId: string
  agentId: string
  toolName: string
  reason: string
  createdAt: string
  status: ApprovalStatus
}

/**
 * SQLite (WAL) 持久化审批记录。
 * 崩溃恢复：启动时把残留的 pending 记录标记为 timeout（fail-closed）。
 */
export class ApprovalStore {
  private db: DatabaseSync

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true })
    this.db = new DatabaseSync(join(dataDir, 'approvals.db'))
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
    `)
    this.recover()
  }

  private recover(): void {
    this.db.exec(`UPDATE approvals SET status = 'timeout' WHERE status = 'pending'`)
  }

  insert(record: ApprovalRecord): void {
    this.db.prepare(
      `INSERT INTO approvals (request_id, agent_id, tool_name, reason, created_at, status)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(record.requestId, record.agentId, record.toolName, record.reason, record.createdAt, record.status)
  }

  settle(requestId: string, status: ApprovalStatus): void {
    this.db.prepare(`UPDATE approvals SET status = ? WHERE request_id = ?`).run(status, requestId)
  }

  close(): void {
    this.db.close()
  }
}
