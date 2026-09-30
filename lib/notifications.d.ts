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
/**
 * 通知 Group。三者必须隔离（计划 §2.4）：同一 Group 内相同 Tag 才会互相替换，
 * 跨 Group 的 Remove 互不影响，因此任务通知的清理永远不会误伤审批通知。
 */
export declare const NOTIFICATION_GROUP: {
    /** 主会话完成/错误通知（本模块） */
    readonly task: "dsh-task";
    /** 审批请求卡片（dialog.ts / approval-toast.ps1） */
    readonly approval: "dsh-approval";
    /** 旧审批结果回执（toast.ps1，保持隔离，本模块不碰） */
    readonly result: "dsh-result";
};
/** Tag 长度：16 位 ASCII 十六进制（计划 §2.4 冻结）。 */
export declare const TAG_HEX_LENGTH = 16;
/** 文本上界（计划 §2.3 冻结 60/160；审批原因上限为 B 提议值，待 A 批准）。 */
export declare const TEXT_LIMITS: {
    /** 任务名（会话标题）最大 Unicode 码点数 */
    readonly taskTitle: 60;
    /** 完成/错误通知正文最大 Unicode 码点数 */
    readonly message: 160;
    /** 审批卡片"原因"行最大 Unicode 码点数 */
    readonly approvalReason: 100;
    /**
     * 审批卡片工具名最大 Unicode 码点数。
     * 工具名会同时出现在标题与"操作"行；不设上限时一个异常长的名字能把"选择"/"等待"
     * 挤出可视区，等于隐藏风险（计划 §2.7 禁止无限正文挤掉选择含义）。
     * 宿主工具名是短标识符，40 码点对真实工具足够。
     */
    readonly approvalToolName: 40;
};
/** 截断标记（正文被截断时追加）。 */
export declare const ELLIPSIS = "\u2026";
/** 审批原因被截断时的显式提示（计划 §2.7 要求"显式标记"）。 */
export declare const REASON_TRUNCATED_MARK = "\uFF08\u5DF2\u622A\u65AD\uFF0C\u8BF7\u5728 DSH \u67E5\u770B\u5B8C\u6574\u5185\u5BB9\uFF09";
/** 宿主未提供审批原因时的占位文案（计划 §2.7 冻结）。 */
export declare const NO_REASON_TEXT = "\u5BBF\u4E3B\u672A\u63D0\u4F9B\u5BA1\u6279\u539F\u56E0";
/** 审批选择含义（计划 §2.7 冻结）。 */
export declare const APPROVAL_CHOICE_TEXT = "\u6279\u51C6=\u672C\u6B21\u5141\u8BB8\uFF1B\u62D2\u7EDD=\u4E0D\u5141\u8BB8\u6267\u884C";
/** 归一化后的宿主事件（A 的身份适配器产出；本模块不自行决定宿主事件签名）。 */
export interface TurnEventInput {
    kind: 'turn-start' | 'step-start' | 'turn-end';
    /** 宿主 session.id */
    sessionId: string;
    /** 宿主 event.data.turn */
    turn: number;
    /**
     * 宿主 session.header.origin。'subagent' → 本模块零动作（不入队、不占队列、不建进程）。
     * root 会话该字段缺省（undefined）。
     */
    origin?: string | undefined;
    /** turn/end 的 reason.kind；未知/缺省一律静默。 */
    reasonKind?: string | undefined;
    /** 会话标题（A 的适配器解析：最新 session/title → 否则省略）。本模块不读宿主标题。 */
    title?: string | undefined;
}
/** 插件内部通知消息（纯数据；不冒称宿主类型）。 */
export interface NotificationMessage {
    /** 去重 key。主通知 = `${sessionId}:${turn}` */
    key: string;
    source: 'turn';
    sessionId: string;
    /** 通知标题行 */
    title: string;
    /** 通知正文 */
    message: string;
    /** true = 不响铃（<audio silent="true"/>） */
    silent: boolean;
}
/** sender 结算结果。'submitted' 仅表示 WinRT API 已提交，**不表示用户已看到**。 */
export type SendResult = 'submitted' | 'failed' | 'aborted';
/**
 * Windows 通道抽象（C 实现）。本模块只保证：最多 1 个并发调用、超时后 abort、
 * 不重试、任何异常不逃逸。
 */
export interface NotificationSender {
    send(message: NotificationMessage, signal: AbortSignal): Promise<SendResult>;
}
/** 可注入时钟（单测不依赖真实计时器）。 */
export interface Clock {
    now(): number;
    setTimer(fn: () => void, ms: number): unknown;
    clearTimer(handle: unknown): void;
}
export interface NotificationServiceOptions {
    sender: NotificationSender;
    clock?: Clock;
    /** 待发队列上限，溢出丢弃最新。默认 100（计划 §2.4）。 */
    maxPending?: number;
    /** 单条发送看门狗，超时 abort 并结算 failed。默认 10000ms（计划 §2.4）。 */
    watchdogMs?: number;
    /** 去重 TTL。默认 24h（计划 §2.4）。 */
    dedupTtlMs?: number;
    /** 去重容量上限。默认 4096（计划 §2.4）。 */
    dedupCapacity?: number;
    /** close() 等待活动发送的有界时间。默认 12000ms（计划 §2.4）。 */
    closeTimeoutMs?: number;
    /** 轮次状态容量上限，防止未见 turn/end 的会话无限增长。默认 256。 */
    turnStateCapacity?: number;
    /** 默认静音（计划 §2.6 taskNotificationSound='silent'）。 */
    silent?: boolean;
    /** 是否展示会话标题；false 时仅显示短 ID（计划 §2.6 taskNotificationShowTitle）。 */
    showTitle?: boolean;
    /** 告警出口（默认 console.warn）。 */
    onWarn?: (message: string) => void;
}
/** 主审批卡片（纯函数产物；由 A 的接线送进 showApprovalToast 的 title/message）。 */
export interface ApprovalCard {
    title: string;
    message: string;
}
export interface ApprovalCardInput {
    /** 宿主工具名。工具名**不是**命令——本函数不会伪造命令行。 */
    toolName: string;
    /** 会话标题（A 的适配器解析）；缺省或 showTitle=false 时回退短 ID。 */
    title?: string | undefined;
    sessionId?: string | undefined;
    /** 宿主原始 reason（审计用；仅当 displayReason 无可用文案时展示）。 */
    reason?: string | undefined;
    /** 宿主 displayReason（仅展示，绝不落审计）。 */
    displayReason?: {
        readonly en: string;
        readonly [locale: string]: string;
    } | undefined;
    timeoutSec: number;
    timeoutAction: 'reject' | 'approve';
    showTitle?: boolean;
}
/**
 * 归一化控制字符与换行（计划 §2.3）。
 *
 * 删除：C0 控制符（保留 \n）、DEL、C1 控制符、零宽空格、BOM/ZWNBSP，
 *       以及 bidi 嵌入/覆盖/隔离符 U+202A–U+202E、U+2066–U+2069
 *       （这些字符可以在通知里把正文重排成与真实内容相反的观感，属通知欺骗向量）。
 * 保留：U+200C ZWNJ 与 U+200D ZWJ —— 删掉 ZWJ 会把 emoji 家族/连字拆散。
 * 归一：CRLF/CR → LF；U+2028/U+2029（行/段分隔符）→ LF；连续 3+ 换行折叠为 2；行尾空白去掉。
 */
export declare function normalizeText(input: string): string;
/** 单行字段（标题、工具名）用：把所有空白折叠成单个空格。 */
export declare function normalizeInline(input: string): string;
/**
 * 按 **Unicode 码点** 截断，绝不切坏代理对（计划 §2.3）。
 * 截断时结果总长度（含省略号）不超过 maxCodePoints。
 */
export declare function truncateText(input: string, maxCodePoints: number): {
    text: string;
    truncated: boolean;
};
/** 归一化 + 单行化 + 截断（标题类字段一步到位）。 */
export declare function normalizeAndTruncateInline(input: string, maxCodePoints: number): string;
/**
 * 去重 key → 16 位 ASCII 十六进制 Tag（计划 §2.4）。
 * 哈希而非明文：Tag 会出现在通知中心的持久记录里，不能泄露 sessionId/turn。
 */
export declare function notificationTag(key: string): string;
/** 短 ID：与会话标题回退保持一致（8 字符）。 */
export declare function shortSessionId(sessionId: string): string;
/** 任务名：showTitle 且标题非空 → 截断后的标题；否则 `会话 <短ID>`（计划 §2.3/§2.6）。 */
export declare function taskDisplayName(sessionId: string | undefined, title: string | undefined, showTitle: boolean): string;
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
export declare function buildTurnNotification(input: {
    sessionId: string;
    turn: number;
    reasonKind: string | undefined;
    sawStep: boolean;
    title?: string | undefined;
    silent: boolean;
    showTitle: boolean;
    origin?: string | undefined;
}): NotificationMessage | null;
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
export declare function formatApprovalCard(input: ApprovalCardInput): ApprovalCard;
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
export declare class NotificationService {
    private state;
    private readonly pending;
    private readonly turns;
    private readonly dedup;
    private readonly clock;
    private readonly sender;
    private readonly maxPending;
    private readonly watchdogMs;
    private readonly closeTimeoutMs;
    private readonly turnStateCapacity;
    private readonly silent;
    private readonly showTitle;
    private readonly onWarn;
    private sending;
    private activeAbort;
    private activeTimer;
    /** 活动发送的幂等结算入口；close 超时时用它强制收敛，避免留下看门狗计时器 */
    private activeFinish;
    private closeTimer;
    private closeWaiters;
    private closePromise;
    private lastWarnAt;
    private readonly warnIntervalMs;
    /** 最近一次 sender 结算结果（诊断/测试用）。 */
    lastResult: SendResult | undefined;
    /** 已投递给 sender 的条数（测试用；不代表用户看到）。 */
    sentCount: number;
    constructor(options: NotificationServiceOptions);
    get lifecycle(): 'accepting' | 'closed';
    /** 待发条数（不含正在发送的那条）。 */
    get pendingCount(): number;
    /** 去重缓存条数（测试容量/TTL 淘汰用）。 */
    get dedupSize(): number;
    /** 当前跟踪的轮次状态条数（测试资源清理用）。 */
    get turnStateCount(): number;
    /**
     * 消费归一化宿主事件。返回实际入队的消息；未入队（子代理/静默终态/重复/已关闭/溢出）返回 null。
     *
     * 子代理事件在**入队之前**被过滤：不占队列位、不建去重项、不产生任何发送进程。
     */
    observe(event: TurnEventInput): NotificationMessage | null;
    /**
     * 入队一条通知。返回是否被接受。
     * 顺序：状态门 → 容量门 → 去重门。容量拒绝不消耗去重名额（本轮没通知成功，
     * 但也不重试——turn/end 只发布一次）。
     */
    enqueue(message: NotificationMessage): boolean;
    /**
     * 关闭：立即停止接受 → 丢弃待发 → 中止活动发送 → 有界等待（closeTimeoutMs）。
     * 幂等；不删除已经显示的通知历史，不触碰审批资源。close 后 enqueue/observe 一律 no-op。
     *
     * 有界收敛是硬要求：sender 无视 abort 时（例如卡在 WinRT 调用里），
     * closeTimeoutMs 到点强制结算活动发送。否则 pump 永不退出，看门狗计时器会
     * 残留到 watchdogMs 之后——close() 必须让所有 timer 归零。
     */
    close(): Promise<void>;
    private setTurnState;
    private pump;
    /** 单次发送：看门狗、abort、异常全部收敛为一次幂等结算。 */
    private sendOnce;
    /** 等待 pump 退出。超时收敛由 close() 设置的 closeTimer 负责（见 close 注释）。 */
    private awaitIdle;
    private releaseCloseWaiters;
    private warn;
    private warnRateLimited;
}
