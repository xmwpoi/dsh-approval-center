/**
 * 审批队列调度器。
 * serial 模式：串行弹窗，逐条审阅（防误点，推荐）。
 * parallel 模式：每个请求独立弹窗，窗口并列；但**并发数有上限**（信号量背压）。
 *
 * 为什么 parallel 也要背压：每个审批 = 一个 PowerShell worker 进程 + 一个顶层窗口，
 * 不设上限时 N 个并发提权 = N 个进程，只受 timeoutSec 约束。上限默认 3：
 * 够"多代理并行时同时看到几件事"，又不至于把屏幕和进程表打爆。
 */
export declare class ApprovalQueue<TReq, TRes> {
    private readonly handler;
    private readonly mode;
    private chain;
    private running;
    private readonly waiting;
    private readonly maxConcurrent;
    constructor(handler: (req: TReq) => Promise<TRes>, mode: 'serial' | 'parallel', maxConcurrent?: number);
    submit(req: TReq): Promise<TRes>;
    /** 信号量：不超过 maxConcurrent 个 handler 同时在跑，多余的排队等令牌。 */
    private runBounded;
}
