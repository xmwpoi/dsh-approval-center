/** tools 匹配：'*' 全部；'prefix*' 前缀通配；其余全等 */
export function matchTool(patterns, toolName) {
    return patterns.some((p) => {
        if (p === '*')
            return true;
        if (p.endsWith('*'))
            return toolName.startsWith(p.slice(0, -1));
        return p === toolName;
    });
}
function firstNonEmpty(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim() !== '')
            return value;
    }
    return '';
}
/**
 * 展示原因回退链（contract-017.md §2.2 冻结）：
 * 非空 zh-CN → 非空 zh → 原始非空 reason → 非空 en → 无原因（空串）。
 * 只提供其他 locale 时按 reason/en 回退；审计库始终保存原始 reason。
 */
export function selectDisplayReason(req) {
    const display = req.displayReason;
    return firstNonEmpty(display?.['zh-CN'], display?.['zh'], req.reason, display?.['en']);
}
export function agentIdOf(req) {
    return req.agent?.id ?? req.agent?.session?.id ?? 'unknown';
}
/**
 * 弹窗内部结果 → 上报宿主的结果：
 * - timeout/dismissed：未产生人类决策 → 'unavailable'（fail-closed），不谎报"用户拒绝"；
 * - 'cancelled' 专指请求方（宿主）主动撤回，不得用于超时；
 * - 超时自动批准（timeoutAction=approve）在调用方单独处理：仅真实 timeout 适用。
 */
export const HOST_OUTCOME = {
    'allowed-once': 'allowed-once',
    'rejected': 'rejected',
    'timeout': 'unavailable',
    'dismissed': 'unavailable',
    'cancelled': 'cancelled',
    'unavailable': 'unavailable',
};
/** 弹窗内部结果 → 审计库状态（保留精确语义） */
export const STORE_STATUS = {
    'allowed-once': 'approved',
    'rejected': 'rejected',
    'timeout': 'timeout',
    'dismissed': 'dismissed',
    'cancelled': 'cancelled',
    'unavailable': 'unavailable',
};
/** 弹窗内部结果 → 通知中心回执文案 */
export const RESULT_LABEL = {
    'allowed-once': '已批准',
    'rejected': '已拒绝',
    'timeout': '超时无人应答（已自动拒绝）',
    'dismissed': '弹窗被关闭（已按拒绝处理）',
    'cancelled': '请求方已取消',
    'unavailable': '审批渠道不可用（fail-closed，已按拒绝处理）',
};
/**
 * 关闭来源消歧（contract-017.md §4.5）：queue.close() 中止的活动 worker 会以
 * 'cancelled' 结算，但那是插件自己的停机中止而非宿主撤回——宿主撤回时宿主早已
 * 自行结算 cancelled 并丢弃迟到应答（§2.3）。因此队列已关闭时到达的 'cancelled'
 * 必须改判 'unavailable'，不把插件退出谎报为宿主撤回。
 * pluginClosed 取 queue.state !== 'accepting'（close 先落 closed 再 abort，时序可靠；
 * 与宿主撤回同时发生的窄竞态窗口按关闭处理，宿主侧结果不受影响）。
 */
export function effectiveDialogOutcome(outcome, pluginClosed) {
    return outcome === 'cancelled' && pluginClosed ? 'unavailable' : outcome;
}
/**
 * 审批结果通知文案：必须与实际上报结果一致。审计结算失败后任何降级
 * （批准 → unavailable，§3.4）都不得再向用户展示"已批准"。
 */
export function approvalResultLabel(outcome, opts) {
    const autoApproved = outcome === 'timeout' && opts.timeoutAction === 'approve';
    if (opts.settleFailed) {
        if (outcome === 'allowed-once' || autoApproved) {
            return '审计结算失败，已按渠道不可用处理';
        }
        return `${RESULT_LABEL[outcome]}；审计结算失败，已按渠道不可用处理`;
    }
    return autoApproved ? '超时无人应答（已自动批准）' : RESULT_LABEL[outcome];
}
/** 审计状态词汇（与 store.ts ApprovalStatus 对齐的本地约束） */
export const APPROVAL_STATUSES = [
    'pending', 'approved', 'rejected', 'timeout', 'dismissed', 'cancelled', 'unavailable',
];
/**
 * 子代理结束文案按实际 stopReason 区分（V16）：不把 error/abort/refusal 谎报成
 * "已完成"。未知 stopReason（宿主词汇扩展时）回退到中性的"已结束"。
 */
const SUBAGENT_END_LABEL = {
    'completed': '已完成',
    'aborted': '已中止',
    'error': '运行出错',
    'max-tokens': '达到 token 上限',
    'refusal': '模型拒绝执行',
};
export function subagentEndLabel(stopReason) {
    if (stopReason === undefined || stopReason === '')
        return '已结束';
    return SUBAGENT_END_LABEL[stopReason] ?? `已结束（${stopReason}）`;
}
/**
 * 主/子身份判据（契约 §2.4 冻结）：`header.origin === 'subagent'` 是**唯一**判据。
 *
 * 为什么不看别的字段（逐条否决，均有宿主原文依据）：
 * - `parentSession`：注释原文是 "The session this one was forked from (seed lineage)"，
 *   **fork 也会保留父关系**，用它会把 fork 根会话误判成子代理。
 * - `delegationDepth`：注释原文说明它是 "recursion budget"（递归预算），不是主分类。
 * - `isSeeded`：fork seed 为 true，但 fork 根会话仍是主会话。
 *
 * root 会话该字段**缺省**（undefined）；宿主**不存在** 'root'/'main' 字面量，
 * 所以判据必须是"等于 'subagent'"，绝不能写成"等于 'root'"。
 */
export function classifySessionOrigin(header) {
    if (header === undefined)
        return 'unknown';
    return header.origin === 'subagent' ? 'subagent' : 'root';
}
/**
 * 审批请求 → 真实 Session 解析（契约 §2.6 冻结顺序）。
 *
 *   1) `req.agent.session`（运行时增强存在时最直接）
 *   2) `lookup(req.agent.id)?.session`（宿主公开查询 API 查回）
 *   3) 都拿不到 → undefined（身份无法确认）
 *
 * `req.agent` 的 wire-safe 公开面**只有 `id`**（dsh-agent 的 `Agent` 接口只声明
 * `readonly id`），`session` 属运行时增强，**不能假定请求对象上带着它**。
 *
 * 返回 undefined 的语义是"本插件不得认领"：调用方必须 `next()` 恰一次交宿主其他
 * 应答者，**绝不**静默自动批准或拒绝，也不得创建审批记录或弹窗。
 */
export function resolveRequestSession(req, lookup) {
    const direct = req?.agent?.session;
    if (direct !== undefined)
        return direct;
    const id = req?.agent?.id;
    if (typeof id !== 'string' || id === '' || lookup === undefined)
        return undefined;
    try {
        return lookup(id)?.session;
    }
    catch {
        // 查询面抛异常（服务已 dispose 等）不得让审批请求崩在 waterfall 里：
        // 按身份不可确认处理，交下一个应答者。
        return undefined;
    }
}
/**
 * 从事件流取**最后一条** `session/title` 的 title（契约 §2.5 冻结读取顺序）。
 *
 * 宿主 `Session` **没有** `title` 属性（只有 `header`，且 SessionHeader 不含 title），
 * 标题只能从事件流取。首次遇到某会话时用公开 `session.snapshotEvents()` 回读。
 * 找不到、标题非字符串、或归一化后为空 → undefined（调用方回退 `会话 <短ID>`）。
 */
export function latestTitleFromEvents(events) {
    if (!Array.isArray(events))
        return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i];
        if (event?.type !== 'session/title')
            continue;
        const title = event.data?.['title'];
        if (typeof title === 'string' && title.trim() !== '')
            return title;
    }
    return undefined;
}
