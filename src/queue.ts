/**
 * 审批队列调度器。
 * serial 模式：串行弹窗，逐条审阅（防误点，推荐）。
 * parallel 模式：每个请求独立弹窗，窗口并列；但**并发数有上限**（信号量背压）。
 *
 * 为什么 parallel 也要背压：每个审批 = 一个 PowerShell worker 进程 + 一个顶层窗口，
 * 不设上限时 N 个并发提权 = N 个进程，只受 timeoutSec 约束。上限默认 3：
 * 够"多代理并行时同时看到几件事"，又不至于把屏幕和进程表打爆。
 */
export class ApprovalQueue<TReq, TRes> {
  private chain: Promise<unknown> = Promise.resolve()
  private running = 0
  private readonly waiting: Array<() => void> = []
  private readonly maxConcurrent: number

  constructor(
    private readonly handler: (req: TReq) => Promise<TRes>,
    private readonly mode: 'serial' | 'parallel',
    maxConcurrent = 3,
  ) {
    // 钳到 >=1：maxConcurrent <= 0 时 runBounded 永远拿不到令牌（没有名额可释放），
    // 所有请求会永久挂起。当前没有把它暴露成配置项的入口，这里只做兜底。
    this.maxConcurrent = Math.max(1, Math.trunc(maxConcurrent) || 1)
  }

  submit(req: TReq): Promise<TRes> {
    if (this.mode === 'parallel') return this.runBounded(req)
    const result = this.chain.then(() => this.handler(req))
    // 队列链自身不因单个请求失败而断裂
    this.chain = result.catch(() => undefined)
    return result
  }

  /** 信号量：不超过 maxConcurrent 个 handler 同时在跑，多余的排队等令牌。 */
  private async runBounded(req: TReq): Promise<TRes> {
    if (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiting.push(resolve))
    }
    this.running++
    try {
      return await this.handler(req)
    } finally {
      this.running--
      // 先释放令牌再唤醒：被唤醒者在微任务里恢复时名额一定可用
      this.waiting.shift()?.()
    }
  }
}
