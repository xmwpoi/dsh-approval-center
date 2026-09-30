/**
 * T1 主会话通知服务：完成/错误文案、主审批卡片纯函数、去重、串行有界发送队列与资源清理。
 *
 * 边界（本模块不做的事）：
 * - 不监听宿主事件。宿主 `session/event` 的解析与主/子身份判定由 A 的身份适配器完成，
 *   本模块只消费归一化后的 {@link TurnEventInput}（见 §"冻结接口"）。
 * - 不借用审批队列（计划 §2.4）：审批串行/并发由 queue.ts 负责，本模块自带 1 个发送 worker。
 * - 不 spawn 任何进程：Windows 通道由 C 的 sender 实现（dialog.ts），本模块只依赖
 *   {@link NotificationSender} 接口，因此全部单测可在无 Windows 通知的机器上运行。
 * - 不改变审批结果、模型结果或 SQLite 审批记录：任何通知异常都在本模块内被吞掉并记录日志。
 *
 * 宿主事实来源（只读核实，非猜测）：
 *   docs/compat/evidence/t1-host-session-contract.md
 *   - `session/event` 监听器第一参即 Session 对象；`session.header.origin === 'subagent'` 是
 *     唯一的子代理分类字段（root 会话该字段缺省，不存在 'root'/'main' 字面量）。
 *   - `turn/end.data.reason` 必填，`reason.kind` 封闭词汇：completed / aborted / blocked /
 *     error / max-tokens / interrupted / forked（TurnEndReasonMap 可被插件合并扩展，
 *     故 switch 必须带 default 分支保守静默）。
 *   - `turn/end` 不含堆栈：error 变体只带 `{ message, code }`，且 message 是 errorChain 摘要。
 *     本模块从不读取 reason 的任何字段，只读 `kind`——隐私边界由结构保证，不靠过滤。
 *   - `session/title` 事件的 data 是 `{ title: string, ... }`；`session.title` 属性不存在，
 *     标题由 A 的适配器解析后经 `title` 字段传入。
 */

import { createHash } from 'node:crypto'
import { selectDisplayReason } from './host-contract.js'

// ────────────────────────────────────────────────────────────────────────────
// 冻结常量
// ────────────────────────────────────────────────────────────────────────────

/**
 * 通知 Group。三者必须隔离（计划 §2.4）：同一 Group 内相同 Tag 才会互相替换，
 * 跨 Group 的 Remove 互不影响，因此任务通知的清理永远不会误伤审批通知。
 */
export const NOTIFICATION_GROUP = {
  /** 主会话完成/错误通知（本模块） */
  task: 'dsh-task',
  /** 审批请求卡片（dialog.ts / approval-toast.ps1） */
  approval: 'dsh-approval',
  /** 旧审批结果回执（toast.ps1，保持隔离，本模块不碰） */
  result: 'dsh-result',
} as const

/** Tag 长度：16 位 ASCII 十六进制（计划 §2.4 冻结）。 */
export const TAG_HEX_LENGTH = 16

/** 文本上界（计划 §2.3 冻结 60/160；审批原因上限为 B 提议值，待 A 批准）。 */
export const TEXT_LIMITS = {
  /** 任务名（会话标题）最大 Unicode 码点数 */
  taskTitle: 60,
  /** 完成/错误通知正文最大 Unicode 码点数 */
  message: 160,
  /** 审批卡片"原因"行最大 Unicode 码点数 */
  approvalReason: 100,
  /**
   * 审批卡片工具名最大 Unicode 码点数。
   * 工具名会同时出现在标题与"操作"行；不设上限时一个异常长的名字能把"选择"/"等待"
   * 挤出可视区，等于隐藏风险（计划 §2.7 禁止无限正文挤掉选择含义）。
   * 宿主工具名是短标识符，40 码点对真实工具足够。
   */
  approvalToolName: 40,
} as const

/** 截断标记（正文被截断时追加）。 */
export const ELLIPSIS = '…'
/** 审批原因被截断时的显式提示（计划 §2.7 要求"显式标记"）。 */
export const REASON_TRUNCATED_MARK = '（已截断，请在 DSH 查看完整内容）'
/** 宿主未提供审批原因时的占位文案（计划 §2.7 冻结）。 */
export const NO_REASON_TEXT = '宿主未提供审批原因'
/** 审批选择含义（计划 §2.7 冻结）。 */
export const APPROVAL_CHOICE_TEXT = '批准=本次允许；拒绝=不允许执行'

/** turn/end 终态 → 通知标题与正文；不在此表的 kind 一律静默。 */
const TURN_NOTICE: Record<string, { readonly title: string; readonly body: string }> = {
  completed: { title: '本轮回复已完成', body: 'Agent 已完成这一轮回复，请返回 DSH 查看。' },
  error: { title: '本轮执行出错', body: '本轮执行失败，请返回 DSH 查看详情。' },
  blocked: { title: '本轮执行受阻', body: '本轮执行受阻，请返回 DSH 查看详情。' },
  'max-tokens': { title: '本轮达到输出上限', body: '本轮达到输出上限，请返回 DSH 查看详情。' },
}

/** 用户取消、历史修复、fork seed：一律静默（计划 §2.1）。 */
const SILENT_TURN_KINDS = new Set(['aborted', 'interrupted', 'forked'])

/** 只有 completed 受 "本轮须观察到 step/start" 门禁约束（见 observe() 注释）。 */
const STEP_GATED_KINDS = new Set(['completed'])

// ────────────────────────────────────────────────────────────────────────────
// 冻结接口
// ────────────────────────────────────────────────────────────────────────────

/** 归一化后的宿主事件（A 的身份适配器产出；本模块不自行决定宿主事件签名）。 */
export interface TurnEventInput {
  kind: 'turn-start' | 'step-start' | 'turn-end'
  /** 宿主 session.id */
  sessionId: string
  /** 宿主 event.data.turn */
  turn: number
  /**
   * 宿主 session.header.origin。'subagent' → 本模块零动作（不入队、不占队列、不建进程）。
   * root 会话该字段缺省（undefined）。
   */
  origin?: string | undefined
  /** turn/end 的 reason.kind；未知/缺省一律静默。 */
  reasonKind?: string | undefined
  /** 会话标题（A 的适配器解析：最新 session/title → 否则省略）。本模块不读宿主标题。 */
  title?: string | undefined
}

/** 插件内部通知消息（纯数据；不冒称宿主类型）。 */
export interface NotificationMessage {
  /** 去重 key。主通知 = `${sessionId}:${turn}` */
  key: string
  source: 'turn'
  sessionId: string
  /** 通知标题行 */
  title: string
  /** 通知正文 */
  message: string
  /** true = 不响铃（<audio silent="true"/>） */
  silent: boolean
}

/** sender 结算结果。'submitted' 仅表示 WinRT API 已提交，**不表示用户已看到**。 */
export type SendResult = 'submitted' | 'failed' | 'aborted'

/**
 * Windows 通道抽象（C 实现）。本模块只保证：最多 1 个并发调用、超时后 abort、
 * 不重试、任何异常不逃逸。
 */
export interface NotificationSender {
  send(message: NotificationMessage, signal: AbortSignal): Promise<SendResult>
}

/** 可注入时钟（单测不依赖真实计时器）。 */
export interface Clock {
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export interface NotificationServiceOptions {
  sender: NotificationSender
  clock?: Clock
  /** 待发队列上限，溢出丢弃最新。默认 100（计划 §2.4）。 */
  maxPending?: number
  /** 单条发送看门狗，超时 abort 并结算 failed。默认 10000ms（计划 §2.4）。 */
  watchdogMs?: number
  /** 去重 TTL。默认 24h（计划 §2.4）。 */
  dedupTtlMs?: number
  /** 去重容量上限。默认 4096（计划 §2.4）。 */
  dedupCapacity?: number
  /** close() 等待活动发送的有界时间。默认 12000ms（计划 §2.4）。 */
  closeTimeoutMs?: number
  /** 轮次状态容量上限，防止未见 turn/end 的会话无限增长。默认 256。 */
  turnStateCapacity?: number
  /** 默认静音（计划 §2.6 taskNotificationSound='silent'）。 */
  silent?: boolean
  /** 是否展示会话标题；false 时仅显示短 ID（计划 §2.6 taskNotificationShowTitle）。 */
  showTitle?: boolean
  /** 告警出口（默认 console.warn）。 */
  onWarn?: (message: string) => void
}

/** 主审批卡片（纯函数产物；由 A 的接线送进 showApprovalToast 的 title/message）。 */
export interface ApprovalCard {
  title: string
  message: string
}

export interface ApprovalCardInput {
  /** 宿主工具名。工具名**不是**命令——本函数不会伪造命令行。 */
  toolName: string
  /** 会话标题（A 的适配器解析）；缺省或 showTitle=false 时回退短 ID。 */
  title?: string | undefined
  sessionId?: string | undefined
  /** 宿主原始 reason（审计用；仅当 displayReason 无可用文案时展示）。 */
  reason?: string | undefined
  /** 宿主 displayReason（仅展示，绝不落审计）。 */
  displayReason?: { readonly en: string; readonly [locale: string]: string } | undefined
  timeoutSec: number
  timeoutAction: 'reject' | 'approve'
  showTitle?: boolean
}

// ────────────────────────────────────────────────────────────────────────────
// 纯函数：文本归一化、截断、Tag
// ────────────────────────────────────────────────────────────────────────────

/**
 * 归一化控制字符与换行（计划 §2.3）。
 *
 * 删除：C0 控制符（保留 \n）、DEL、C1 控制符、零宽空格、BOM/ZWNBSP，
 *       以及 bidi 嵌入/覆盖/隔离符 U+202A–U+202E、U+2066–U+2069
 *       （这些字符可以在通知里把正文重排成与真实内容相反的观感，属通知欺骗向量）。
 * 保留：U+200C ZWNJ 与 U+200D ZWJ —— 删掉 ZWJ 会把 emoji 家族/连字拆散。
 * 归一：CRLF/CR → LF；U+2028/U+2029（行/段分隔符）→ LF；连续 3+ 换行折叠为 2；行尾空白去掉。
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    .replace(/[\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 单行字段（标题、工具名）用：把所有空白折叠成单个空格。 */
export function normalizeInline(input: string): string {
  return normalizeText(input).replace(/\s+/g, ' ').trim()
}

/**
 * 按 **Unicode 码点** 截断，绝不切坏代理对（计划 §2.3）。
 * 截断时结果总长度（含省略号）不超过 maxCodePoints。
 */
export function truncateText(input: string, maxCodePoints: number): { text: string; truncated: boolean } {
  const limit = Math.max(0, Math.trunc(maxCodePoints))
  const codePoints = Array.from(input)
  if (codePoints.length <= limit) return { text: input, truncated: false }
  if (limit === 0) return { text: ELLIPSIS, truncated: true }
  return { text: codePoints.slice(0, limit - 1).join('') + ELLIPSIS, truncated: true }
}

/** 归一化 + 单行化 + 截断（标题类字段一步到位）。 */
export function normalizeAndTruncateInline(input: string, maxCodePoints: number): string {
  return truncateText(normalizeInline(input), maxCodePoints).text
}

/**
 * 去重 key → 16 位 ASCII 十六进制 Tag（计划 §2.4）。
 * 哈希而非明文：Tag 会出现在通知中心的持久记录里，不能泄露 sessionId/turn。
 */
export function notificationTag(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, TAG_HEX_LENGTH)
}

/** 短 ID：与会话标题回退保持一致（8 字符）。 */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId
}

/** 任务名：showTitle 且标题非空 → 截断后的标题；否则 `会话 <短ID>`（计划 §2.3/§2.6）。 */
export function taskDisplayName(
  sessionId: string | undefined,
  title: string | undefined,
  showTitle: boolean,
): string {
  if (showTitle && typeof title === 'string' && normalizeInline(title) !== '') {
    return normalizeAndTruncateInline(title, TEXT_LIMITS.taskTitle)
  }
  return `会话 ${shortSessionId(sessionId ?? 'unknown')}`
}

// ────────────────────────────────────────────────────────────────────────────
// 纯函数：主会话完成/错误文案
// ────────────────────────────────────────────────────────────────────────────

/**
 * 构造主会话完成/错误通知；不需要通知时返回 null。
 *
 * 门禁（计划 §2.1/§2.2）：
 * - `completed` 且该轮**观察到** step/start → 成功通知；未观察到则不补发（热加载中途）。
 * - `error` / `blocked` / `max-tokens` → 各自的非成功文案（不受 step 门禁约束）。
 * - `aborted` / `interrupted` / `forked` / 未知 kind / 缺省 kind → null。
 * - `origin === 'subagent'` → null（子代理事件在入队前被过滤）。
 *
 * 隐私（计划 §2.3）：正文只含任务名与固定文案；从不包含回答、命令、提示词、凭据、
 * 绝对目录或原始错误堆栈。
 */
export function buildTurnNotification(input: {
  sessionId: string
  turn: number
  reasonKind: string | undefined
  sawStep: boolean
  title?: string | undefined
  silent: boolean
  showTitle: boolean
  origin?: string | undefined
}): NotificationMessage | null {
  if (input.origin === 'subagent') return null
  const kind = input.reasonKind
  if (kind === undefined || SILENT_TURN_KINDS.has(kind)) return null
  const notice = TURN_NOTICE[kind]
  if (notice === undefined) return null // 未知 kind（宿主词汇扩展）：保守静默
  if (STEP_GATED_KINDS.has(kind) && !input.sawStep) return null

  const taskName = taskDisplayName(input.sessionId, input.title, input.showTitle)
  const body = truncateText(normalizeInline(notice.body), TEXT_LIMITS.message).text
  return {
    key: `${input.sessionId}:${input.turn}`,
    source: 'turn',
    sessionId: input.sessionId,
    title: normalizeInline(notice.title),
    message: `任务：${taskName}\n${body}`,
    silent: input.silent,
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 纯函数：主审批卡片文案
// ────────────────────────────────────────────────────────────────────────────

/**
 * 主审批卡片（计划 §2.7）。结构化多行 ToastGeneric 文本：
 *
 * ```
 * 需要你审批 · <工具名>
 * 任务：<标题或会话短ID>
 * 操作：<宿主工具名>
 * 原因：<displayReason zh-CN→zh→reason→en 回退，缺失时占位>
 * 选择：批准=本次允许；拒绝=不允许执行
 * 等待：<timeoutSec>秒；超时=<按实际配置>
 * ```
 *
 * 硬约束：
 * - 原因回退链复用 host-contract 的冻结实现（单一事实来源，不重复实现）。
 * - 工具名不是命令：只展示宿主给出的工具名，绝不拼接未核实的命令/参数。
 * - 批准仅本次有效（"批准=本次允许"），不得描述成永久授权。
 * - timeoutAction=approve 时写"超时自动批准"并显式标注自动放行，绝不沿用默认拒绝文案。
 * - 原因截断时追加显式标记。
 */
export function formatApprovalCard(input: ApprovalCardInput): ApprovalCard {
  const showTitle = input.showTitle ?? true
  // 工具名截断：见 TEXT_LIMITS.approvalToolName 的说明（防止挤掉选择/等待行）
  const toolName = normalizeAndTruncateInline(input.toolName ?? '', TEXT_LIMITS.approvalToolName) || '未知工具'
  const taskName = taskDisplayName(input.sessionId, input.title, showTitle)

  // 复用冻结回退链：非空 zh-CN → 非空 zh → 原始非空 reason → 非空 en → 空串
  const resolved = selectDisplayReason({
    agent: {},
    toolName,
    reason: input.reason,
    displayReason: input.displayReason,
  })
  let reasonText: string
  if (normalizeInline(resolved) === '') {
    reasonText = NO_REASON_TEXT
  } else {
    const cut = truncateText(normalizeInline(resolved), TEXT_LIMITS.approvalReason)
    reasonText = cut.truncated ? cut.text + REASON_TRUNCATED_MARK : cut.text
  }

  const waitLine =
    input.timeoutAction === 'approve'
      ? `等待：${input.timeoutSec}秒；超时自动批准（到点将自动放行本次操作）`
      : `等待：${input.timeoutSec}秒；超时=自动拒绝`

  return {
    title: `需要你审批 · ${toolName}`,
    message: [
      `任务：${taskName}`,
      `操作：${toolName}`,
      `原因：${reasonText}`,
      `选择：${APPROVAL_CHOICE_TEXT}`,
      waitLine,
    ].join('\n'),
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 内部：TTL + 容量去重缓存
// ────────────────────────────────────────────────────────────────────────────

/**
 * 有界 TTL 去重缓存（计划 §2.4）。
 * 不提供永久 exactly-once：容量/TTL 淘汰后同一 key 可能再次入队。
 * 不新增 SQLite 表、不承诺跨进程严格去重。
 */
class DedupCache {
  private readonly seen = new Map<string, number>()

  constructor(private readonly ttlMs: number, private readonly capacity: number) {}

  /** true = 首次见到（可入队）；false = TTL 内重复。 */
  claim(key: string, now: number): boolean {
    this.evictExpired(now)
    if (this.seen.has(key)) return false
    if (this.seen.size >= this.capacity) {
      // Map 保持插入序：最早插入的即最旧
      const oldest = this.seen.keys().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    this.seen.set(key, now + this.ttlMs)
    return true
  }

  get size(): number {
    return this.seen.size
  }

  clear(): void {
    this.seen.clear()
  }

  private evictExpired(now: number): void {
    for (const [key, expiresAt] of this.seen) {
      if (expiresAt <= now) this.seen.delete(key)
      else break // 插入序即到期序（TTL 固定），后面的都未过期
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// NotificationService
// ────────────────────────────────────────────────────────────────────────────

interface TurnState {
  turn: number
  sawStep: boolean
}

const defaultClock: Clock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/**
 * 主会话通知服务（计划 §2.4）。
 *
 * 生命周期：
 * ```
 * const svc = new NotificationService({ sender, silent, showTitle })
 * svc.observe({ kind: 'turn-start',  sessionId, turn, origin })   // 适配器转发
 * svc.observe({ kind: 'step-start',  sessionId, turn, origin })
 * svc.observe({ kind: 'turn-end',    sessionId, turn, origin, reasonKind, title })
 * await svc.close()                                              // 卸载时，有界
 * ```
 *
 * 队列语义：1 个 worker 串行发送；待发上限 100（溢出丢弃最新并限频告警）；
 * 单条 watchdog 10s（超时 abort 并结算 failed）；**不自动重试**（WinRT 已接收而
 * 进程超时的情形无法证明未发送，重试可能重复响铃）。
 */
export class NotificationService {
  private state: 'accepting' | 'closed' = 'accepting'
  private readonly pending: NotificationMessage[] = []
  private readonly turns = new Map<string, TurnState>()
  private readonly dedup: DedupCache
  private readonly clock: Clock
  private readonly sender: NotificationSender
  private readonly maxPending: number
  private readonly watchdogMs: number
  private readonly closeTimeoutMs: number
  private readonly turnStateCapacity: number
  private readonly silent: boolean
  private readonly showTitle: boolean
  private readonly onWarn: (message: string) => void

  private sending = false
  private activeAbort: AbortController | undefined
  private activeTimer: unknown
  /** 活动发送的幂等结算入口；close 超时时用它强制收敛，避免留下看门狗计时器 */
  private activeFinish: ((result: SendResult) => void) | undefined
  private closeTimer: unknown
  private closeWaiters: Array<() => void> = []
  private closePromise: Promise<void> | undefined
  private lastWarnAt = Number.NEGATIVE_INFINITY
  private readonly warnIntervalMs = 60_000

  /** 最近一次 sender 结算结果（诊断/测试用）。 */
  lastResult: SendResult | undefined
  /** 已投递给 sender 的条数（测试用；不代表用户看到）。 */
  sentCount = 0

  constructor(options: NotificationServiceOptions) {
    this.sender = options.sender
    this.clock = options.clock ?? defaultClock
    this.maxPending = Math.max(1, Math.trunc(options.maxPending ?? 100))
    this.watchdogMs = Math.max(1, Math.trunc(options.watchdogMs ?? 10_000))
    this.closeTimeoutMs = Math.max(1, Math.trunc(options.closeTimeoutMs ?? 12_000))
    this.turnStateCapacity = Math.max(1, Math.trunc(options.turnStateCapacity ?? 256))
    this.dedup = new DedupCache(
      options.dedupTtlMs ?? 24 * 60 * 60 * 1000,
      Math.max(1, Math.trunc(options.dedupCapacity ?? 4096)),
    )
    this.silent = options.silent ?? true
    this.showTitle = options.showTitle ?? true
    this.onWarn = options.onWarn ?? ((message: string) => console.warn(message))
  }

  get lifecycle(): 'accepting' | 'closed' {
    return this.state
  }

  /** 待发条数（不含正在发送的那条）。 */
  get pendingCount(): number {
    return this.pending.length
  }

  /** 去重缓存条数（测试容量/TTL 淘汰用）。 */
  get dedupSize(): number {
    return this.dedup.size
  }

  /** 当前跟踪的轮次状态条数（测试资源清理用）。 */
  get turnStateCount(): number {
    return this.turns.size
  }

  /**
   * 消费归一化宿主事件。返回实际入队的消息；未入队（子代理/静默终态/重复/已关闭/溢出）返回 null。
   *
   * 子代理事件在**入队之前**被过滤：不占队列位、不建去重项、不产生任何发送进程。
   */
  observe(event: TurnEventInput): NotificationMessage | null {
    if (this.state !== 'accepting') return null
    // 子代理 / 委派子会话：本插件一律不通知（计划 §2.1/§2.2）。
    // 顺手丢弃可能存在的轮次状态，避免 continuation 复用 sessionId 时串轮。
    if (event.origin === 'subagent') {
      this.turns.delete(event.sessionId)
      return null
    }

    switch (event.kind) {
      case 'turn-start':
        this.setTurnState(event.sessionId, { turn: event.turn, sawStep: false })
        return null

      case 'step-start':
        // 无论是否先见到 turn/start 都记为"观察到 step"——热加载中途接入时
        // 这仍是宿主真实发布过的 step/start。
        this.setTurnState(event.sessionId, { turn: event.turn, sawStep: true })
        return null

      case 'turn-end': {
        const state = this.turns.get(event.sessionId)
        const sawStep = state !== undefined && state.turn === event.turn && state.sawStep
        // 正常 turn/end 即释放本轮状态（不只在通知去重缓存里留痕）
        this.turns.delete(event.sessionId)
        const message = buildTurnNotification({
          sessionId: event.sessionId,
          turn: event.turn,
          reasonKind: event.reasonKind,
          sawStep,
          title: event.title,
          silent: this.silent,
          showTitle: this.showTitle,
        })
        if (message === null) return null
        return this.enqueue(message) ? message : null
      }
    }
  }

  /**
   * 入队一条通知。返回是否被接受。
   * 顺序：状态门 → 容量门 → 去重门。容量拒绝不消耗去重名额（本轮没通知成功，
   * 但也不重试——turn/end 只发布一次）。
   */
  enqueue(message: NotificationMessage): boolean {
    if (this.state !== 'accepting') return false
    if (this.pending.length >= this.maxPending) {
      this.warnRateLimited(
        `通知队列已满（上限 ${this.maxPending}），丢弃最新一条（key=${message.key}）；不重试`,
      )
      return false
    }
    if (!this.dedup.claim(message.key, this.clock.now())) return false
    this.pending.push(message)
    void this.pump()
    return true
  }

  /**
   * 关闭：立即停止接受 → 丢弃待发 → 中止活动发送 → 有界等待（closeTimeoutMs）。
   * 幂等；不删除已经显示的通知历史，不触碰审批资源。close 后 enqueue/observe 一律 no-op。
   *
   * 有界收敛是硬要求：sender 无视 abort 时（例如卡在 WinRT 调用里），
   * closeTimeoutMs 到点强制结算活动发送。否则 pump 永不退出，看门狗计时器会
   * 残留到 watchdogMs 之后——close() 必须让所有 timer 归零。
   */
  close(): Promise<void> {
    if (this.state === 'accepting') {
      this.state = 'closed'
      this.pending.length = 0
      this.turns.clear()
      this.dedup.clear()
      this.activeAbort?.abort()
      if (this.activeFinish !== undefined) {
        this.closeTimer = this.clock.setTimer(() => {
          this.closeTimer = undefined
          this.warn(`关闭等待超过 ${this.closeTimeoutMs}ms，强制结算活动发送（sender 未响应 abort）`)
          this.activeFinish?.('aborted')
        }, this.closeTimeoutMs)
      }
    }
    this.closePromise ??= this.awaitIdle()
    return this.closePromise
  }

  // ── 内部 ──────────────────────────────────────────────────────────────────

  private setTurnState(sessionId: string, next: TurnState): void {
    // 容量兜底：未见 turn/end 的会话不得无限增长（计划 §4 要求的容量约束）
    if (!this.turns.has(sessionId) && this.turns.size >= this.turnStateCapacity) {
      const oldest = this.turns.keys().next().value
      if (oldest !== undefined) this.turns.delete(oldest)
    }
    this.turns.set(sessionId, next)
  }

  private async pump(): Promise<void> {
    if (this.sending) return
    this.sending = true
    try {
      while (this.state === 'accepting' && this.pending.length > 0) {
        await this.sendOnce(this.pending.shift()!)
      }
    } finally {
      this.sending = false
      this.releaseCloseWaiters()
    }
  }

  /** 单次发送：看门狗、abort、异常全部收敛为一次幂等结算。 */
  private sendOnce(message: NotificationMessage): Promise<void> {
    return new Promise<void>((resolve) => {
      const controller = new AbortController()
      this.activeAbort = controller
      let settled = false

      const finish = (result: SendResult): void => {
        if (settled) return
        settled = true
        if (this.activeTimer !== undefined) {
          this.clock.clearTimer(this.activeTimer)
          this.activeTimer = undefined
        }
        this.activeAbort = undefined
        this.activeFinish = undefined
        this.lastResult = result
        resolve()
      }
      this.activeFinish = finish

      this.activeTimer = this.clock.setTimer(() => {
        this.activeTimer = undefined
        // WinRT 可能已接收：不能据此断言未发送，因此不重试
        this.warn(`通知发送超过 ${this.watchdogMs}ms 未结算，已中止（不重试，避免重复响铃）`)
        controller.abort()
        finish('failed')
      }, this.watchdogMs)

      let promise: Promise<SendResult>
      try {
        this.sentCount++
        promise = this.sender.send(message, controller.signal)
      } catch (error) {
        // sender 同步抛出不得逃进宿主事件回调
        this.warn(`通知发送同步失败（key=${message.key}）: ${String(error)}`)
        finish('failed')
        return
      }
      Promise.resolve(promise).then(
        (result) => finish(result),
        (error) => {
          this.warn(`通知发送失败（key=${message.key}）: ${String(error)}`)
          finish('failed')
        },
      )
    })
  }

  /** 等待 pump 退出。超时收敛由 close() 设置的 closeTimer 负责（见 close 注释）。 */
  private awaitIdle(): Promise<void> {
    if (!this.sending) return Promise.resolve()
    return new Promise<void>((resolve) => {
      this.closeWaiters.push(resolve)
    })
  }

  private releaseCloseWaiters(): void {
    if (this.closeTimer !== undefined) {
      this.clock.clearTimer(this.closeTimer)
      this.closeTimer = undefined
    }
    for (const waiter of this.closeWaiters.splice(0)) waiter()
  }

  private warn(message: string): void {
    this.onWarn(`[dsh-approval-center] ${message}`)
  }

  private warnRateLimited(message: string): void {
    const now = this.clock.now()
    if (now - this.lastWarnAt < this.warnIntervalMs) return
    this.lastWarnAt = now
    this.warn(message)
  }
}
