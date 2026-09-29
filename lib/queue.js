export class ApprovalQueue {
    cb;
    mode;
    _state = 'accepting';
    queued = [];
    running = 0;
    pumping = false;
    /** close() 时中止：组合进活动条目的 signal，请求 handler 尽快结算 */
    closeController = new AbortController();
    closeWaiters = [];
    closePromise;
    limit;
    constructor(cb, mode, maxConcurrent = 3) {
        this.cb = cb;
        this.mode = mode;
        // 钳到 >=1：maxConcurrent <= 0 时没有名额可释放，所有请求会永久挂起
        this.limit = mode === 'serial' ? 1 : Math.max(1, Math.trunc(maxConcurrent) || 1);
    }
    get state() {
        return this._state;
    }
    submit(req, signal) {
        if (this._state !== 'accepting')
            return Promise.resolve(this.cb.onClose());
        if (signal?.aborted)
            return Promise.resolve(this.cb.onCancel());
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        const entry = { req, signal, state: 'queued', resolve, reject };
        entry.onQueuedAbort = () => {
            // 仅排队中生效：已转 running 的条目由组合 signal 通知 handler 自行结算，
            // 不在此快捷 settle，避免与 handler 结果竞争
            if (entry.state !== 'queued')
                return;
            const index = this.queued.indexOf(entry);
            if (index >= 0)
                this.queued.splice(index, 1);
            this.settleEntry(entry, this.cb.onCancel());
        };
        signal?.addEventListener('abort', entry.onQueuedAbort, { once: true });
        this.queued.push(entry);
        this.pump();
        return promise;
    }
    /**
     * 关闭：停接单 → 用 onClose() 结算排队项 → 中止活动 worker 的组合 signal 并等待其结算。
     * 幂等；close() 后 submit 也以 onClose() 结算。handler 必须响应 signal 或自行结算，
     * 否则 close() 的等待不会完成（"所有 Promise 最终结算"是 handler 侧契约）。
     */
    close() {
        if (this._state === 'accepting') {
            this._state = 'closing';
            for (const entry of this.queued.splice(0))
                this.settleEntry(entry, this.cb.onClose());
            // 状态先落 closed：pump 不再启动新条目；abort 请求活动 handler 停止
            this._state = 'closed';
            this.closeController.abort();
        }
        this.closePromise ??= this.running === 0
            ? Promise.resolve()
            : new Promise((resolve) => { this.closeWaiters.push(resolve); });
        return this.closePromise;
    }
    pump() {
        if (this.pumping)
            return;
        this.pumping = true;
        try {
            // 只在 accepting 时启动新条目；closing/closed 阶段排队项已按 onClose 结算
            while (this._state === 'accepting' && this.running < this.limit && this.queued.length > 0) {
                this.startEntry(this.queued.shift());
            }
        }
        finally {
            this.pumping = false;
        }
    }
    startEntry(entry) {
        entry.state = 'running';
        this.running++;
        const signals = [entry.signal, this.closeController.signal].filter((s) => s !== undefined);
        const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
        // 经微任务调用：handler 同步抛出转成 rejection，条目不会永久停留在 running
        Promise.resolve()
            .then(() => this.cb.run(entry.req, combined))
            .then((value) => this.settleEntry(entry, value), (error) => this.settleEntryError(entry, error))
            .then(() => {
            this.running--;
            if (this.running === 0 && this._state === 'closed') {
                for (const resolve of this.closeWaiters.splice(0))
                    resolve();
            }
            this.pump();
        });
    }
    /** 结算必须幂等：取消/关闭/异常/正常完成会竞争同一条目 */
    settleEntry(entry, value) {
        if (entry.state === 'settled')
            return;
        entry.state = 'settled';
        if (entry.signal && entry.onQueuedAbort)
            entry.signal.removeEventListener('abort', entry.onQueuedAbort);
        entry.resolve(value);
    }
    settleEntryError(entry, error) {
        if (entry.state === 'settled')
            return;
        entry.state = 'settled';
        if (entry.signal && entry.onQueuedAbort)
            entry.signal.removeEventListener('abort', entry.onQueuedAbort);
        entry.reject(error);
    }
}
