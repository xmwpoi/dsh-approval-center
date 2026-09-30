/**
 * 最小宿主契约层：对齐 @deepseek-ai/dsh-user-approval 公开类型与 Cordis waterfall 语义，
 * 避免把整套 DSH 打进插件运行时依赖树。两版宿主（0.1.5-rc.1 / 0.1.7-rc.2）的差异
 * 只有 displayReason（0.1.7-rc.2 新增，旧版请求不含该字段时按回退规则自然降级）。
 * 证据与冻结记录：docs/compat/contract-017.md。
 */
import type { ApprovalStatus } from './store.js'

/** wire-safe 的 Agent 契约只保证 `id`；`session` 来自运行时增强（dsh-agent/lib/types/types.d.ts） */
export interface ApprovalRequestEvent {
  readonly agent: { readonly id?: string; readonly session?: { readonly id?: string } }
  readonly toolName: string
  readonly callId?: string
  readonly reason?: string
  /** 0.1.7-rc.2 新增：仅用于展示，绝不落审计（dsh-user-approval types.d.ts 原文约束） */
  readonly displayReason?: { readonly en: string; readonly [locale: string]: string }
  readonly signal?: AbortSignal
}

export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** 目标版 stopReason 封闭词汇（dsh-subagent/lib/types/types.d.ts SubagentStopReasonMap） */
export type SubagentStopReason = 'completed' | 'aborted' | 'error' | 'max-tokens' | 'refusal'

export interface SubagentRunEndInfo {
  readonly runId: string
  readonly provider: string
  readonly id: string
  readonly stopReason?: SubagentStopReason | (string & {})
}

export interface SubagentRunInfo {
  readonly runId: string
  readonly provider: string
  readonly id: string
}

/** tools 匹配：'*' 全部；'prefix*' 前缀通配；其余全等 */
export function matchTool(patterns: readonly string[], toolName: string): boolean {
  return patterns.some((p) => {
    if (p === '*') return true
    if (p.endsWith('*')) return toolName.startsWith(p.slice(0, -1))
    return p === toolName
  })
}

function firstNonEmpty(...values: ReadonlyArray<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return ''
}

/**
 * 展示原因回退链（contract-017.md §2.2 冻结）：
 * 非空 zh-CN → 非空 zh → 原始非空 reason → 非空 en → 无原因（空串）。
 * 只提供其他 locale 时按 reason/en 回退；审计库始终保存原始 reason。
 */
export function selectDisplayReason(req: ApprovalRequestEvent): string {
  const display = req.displayReason
  return firstNonEmpty(
    display?.['zh-CN'],
    display?.['zh'],
    req.reason,
    display?.['en'],
  )
}

export function agentIdOf(req: ApprovalRequestEvent): string {
  return req.agent?.id ?? req.agent?.session?.id ?? 'unknown'
}

/** 弹窗内部结果（dialog.ts DialogOutcome）→ 宿主结果 */
export type DialogOutcome =
  | 'allowed-once'
  | 'rejected'
  | 'timeout'
  | 'dismissed'
  | 'cancelled'
  | 'unavailable'

/**
 * 弹窗内部结果 → 上报宿主的结果：
 * - timeout/dismissed：未产生人类决策 → 'unavailable'（fail-closed），不谎报"用户拒绝"；
 * - 'cancelled' 专指请求方（宿主）主动撤回，不得用于超时；
 * - 超时自动批准（timeoutAction=approve）在调用方单独处理：仅真实 timeout 适用。
 */
export const HOST_OUTCOME: Record<DialogOutcome, ApprovalOutcome> = {
  'allowed-once': 'allowed-once',
  'rejected': 'rejected',
  'timeout': 'unavailable',
  'dismissed': 'unavailable',
  'cancelled': 'cancelled',
  'unavailable': 'unavailable',
}

/** 弹窗内部结果 → 审计库状态（保留精确语义） */
export const STORE_STATUS: Record<DialogOutcome, ApprovalStatus> = {
  'allowed-once': 'approved',
  'rejected': 'rejected',
  'timeout': 'timeout',
  'dismissed': 'dismissed',
  'cancelled': 'cancelled',
  'unavailable': 'unavailable',
}

/** 弹窗内部结果 → 通知中心回执文案 */
export const RESULT_LABEL: Record<DialogOutcome, string> = {
  'allowed-once': '已批准',
  'rejected': '已拒绝',
  'timeout': '超时无人应答（已自动拒绝）',
  'dismissed': '弹窗被关闭（已按拒绝处理）',
  'cancelled': '请求方已取消',
  'unavailable': '审批渠道不可用（fail-closed，已按拒绝处理）',
}

/**
 * 关闭来源消歧（contract-017.md §4.5）：queue.close() 中止的活动 worker 会以
 * 'cancelled' 结算，但那是插件自己的停机中止而非宿主撤回——宿主撤回时宿主早已
 * 自行结算 cancelled 并丢弃迟到应答（§2.3）。因此队列已关闭时到达的 'cancelled'
 * 必须改判 'unavailable'，不把插件退出谎报为宿主撤回。
 * pluginClosed 取 queue.state !== 'accepting'（close 先落 closed 再 abort，时序可靠；
 * 与宿主撤回同时发生的窄竞态窗口按关闭处理，宿主侧结果不受影响）。
 */
export function effectiveDialogOutcome(outcome: DialogOutcome, pluginClosed: boolean): DialogOutcome {
  return outcome === 'cancelled' && pluginClosed ? 'unavailable' : outcome
}

/**
 * 审批结果通知文案：必须与实际上报结果一致。审计结算失败后任何降级
 * （批准 → unavailable，§3.4）都不得再向用户展示"已批准"。
 */
export function approvalResultLabel(
  outcome: DialogOutcome,
  opts: { timeoutAction: 'reject' | 'approve'; settleFailed: boolean },
): string {
  const autoApproved = outcome === 'timeout' && opts.timeoutAction === 'approve'
  if (opts.settleFailed) {
    const base = autoApproved ? '超时无人应答（已自动批准）' : RESULT_LABEL[outcome]
    return `${base}；审计结算失败，已按渠道不可用处理`
  }
  return autoApproved ? '超时无人应答（已自动批准）' : RESULT_LABEL[outcome]
}

/** 审计状态词汇（与 store.ts ApprovalStatus 对齐的本地约束） */
export const APPROVAL_STATUSES = [
  'pending', 'approved', 'rejected', 'timeout', 'dismissed', 'cancelled', 'unavailable',
] as const

/**
 * 子代理结束文案按实际 stopReason 区分（V16）：不把 error/abort/refusal 谎报成
 * "已完成"。未知 stopReason（宿主词汇扩展时）回退到中性的"已结束"。
 */
const SUBAGENT_END_LABEL: Record<string, string> = {
  'completed': '已完成',
  'aborted': '已中止',
  'error': '运行出错',
  'max-tokens': '达到 token 上限',
  'refusal': '模型拒绝执行',
}

export function subagentEndLabel(stopReason: string | undefined): string {
  if (stopReason === undefined || stopReason === '') return '已结束'
  return SUBAGENT_END_LABEL[stopReason] ?? `已结束（${stopReason}）`
}
