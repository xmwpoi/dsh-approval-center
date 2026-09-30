/**
 * 审批队列调度器（契约：docs/compat/contract-017.md §4.2）。
 * serial 模式：串行弹窗，逐条审阅（防误点，推荐）。
 * parallel 模式：每个请求独立弹窗，窗口并列；并发数有上限（信号量背压，默认 3）。
 *
 * 结果映射不进队列：onCancel()/onClose() 由调用方提供（队列保持泛型，
 * Windows/Dialog 实现一概不在此模块）。
 */
export type QueueState = 'accepting' | 'closing' | 'closed';
export interface QueueCallbacks<TReq, TRes> {
    /** 执行阶段；signal 是请求 signal 与队列关闭信号的组合 */
    run(req: TReq, signal: AbortSignal): Promise<TRes>;
    /** 入队前已中止 / 排队中被撤回时的结算值 */
    onCancel(): TRes;
    /** 关闭后（或 close() 时仍在排队）的结算值 */
    onClose(): TRes;
}
export declare class ApprovalQueue<TReq, TRes> {
    private readonly cb;
    private readonly mode;
    private _state;
    private readonly queued;
    private running;
    private pumping;
    /** close() 时中止：组合进活动条目的 signal，请求 handler 尽快结算 */
    private readonly closeController;
    private closeWaiters;
    private closePromise;
    private readonly limit;
    constructor(cb: QueueCallbacks<TReq, TRes>, mode: 'serial' | 'parallel', maxConcurrent?: number);
    get state(): QueueState;
    submit(req: TReq, signal?: AbortSignal): Promise<TRes>;
    /**
     * 关闭：停接单 → 用 onClose() 结算排队项 → 中止活动 worker 的组合 signal 并等待其结算。
     * 幂等；close() 后 submit 也以 onClose() 结算。handler 必须响应 signal 或自行结算，
     * 否则 close() 的等待不会完成（"所有 Promise 最终结算"是 handler 侧契约）。
     */
    close(): Promise<void>;
    private pump;
    private startEntry;
    /** 结算必须幂等：取消/关闭/异常/正常完成会竞争同一条目 */
    private settleEntry;
    private settleEntryError;
}
