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
