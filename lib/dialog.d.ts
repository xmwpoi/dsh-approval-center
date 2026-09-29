/** 审批通道使用的脚本（通知中心 toast + 它的 protocol URI 处理器）。 */
export declare const APPROVAL_TOAST_SCRIPT = "approval-toast.ps1";
export declare const APPROVAL_URI_HANDLER_SCRIPT = "approval-uri-handler.ps1";
/**
 * protocol URI 处理器的首选实现：`wscript.exe` 是 GUI 子系统（PE subsystem=2），
 * 点按钮时不会像 `powershell.exe`（subsystem=3, CUI）那样闪出一个控制台窗口。
 * 必须随包发布并在挂载期校验其存在性——它一旦打包出事，点击回传会静默失效、
 * 每次审批都被误判成超时。
 */
export declare const APPROVAL_URI_HANDLER_VBS = "approval-uri-handler.vbs";
/** 审批结果通知脚本（仅当显式开启通知时才需要）。 */
export declare const RESULT_TOAST_SCRIPT = "toast.ps1";
export declare function assertScriptsUsable(files: readonly string[], baseDir?: string): void;
/**
 * 审批结果。'timeout'（无人应答）与 'rejected'（用户点了拒绝）严格区分，
 * 避免"谎报用户拒绝"。'dismissed' 保留在词汇表里但通知通道无法探测到
 * （未打包应用收不到 WinRT 的 Dismissed 事件），因此不会被产生。
 */
export type DialogOutcome = 'allowed-once' | 'rejected' | 'timeout' | 'dismissed' | 'cancelled' | 'unavailable';
export interface DialogRequest {
    title: string;
    message: string;
    timeoutSec: number;
    /** 超时动作（仅影响文案提示；实际裁决在调用方）：reject=自动拒绝 approve=自动批准 */
    timeoutAction?: 'reject' | 'approve';
    signal?: AbortSignal;
    /**
     * 插件内部请求 token（T0 契约 §4.3）：传入后作为通知 tag 与状态文件名，
     * 使取消/看门狗强杀后的清理能按 token 定向。须为 1-64 位 hex；
     * 缺省时脚本沿用随机 GUID（手动脚本兼容路径）。
     */
    requestToken?: string;
}
export interface DialogHandle {
    promise: Promise<DialogOutcome>;
    /** 终止本次审批并按 token 定向清理本人通知/状态文件；幂等，重复调用安全。 */
    cancel(): void;
}
/**
 * 可注入的进程/时钟边界（仅供自动化测试；T3 计划 §3.3 的 mock 测试依赖它）。
 * 生产路径不传 deps，走真实 spawn 与 setTimeout，行为与基线完全一致。
 * 结构化最小接口：真实 ChildProcess / spawn 天然满足，mock 也无需模拟完整类型。
 */
export interface DialogDeps {
    spawn?: (file: string, args: readonly string[], options: {
        windowsHide: boolean;
        stdio: 'ignore';
    }) => {
        on(event: 'error', listener: (error: Error) => void): unknown;
        on(event: 'exit', listener: (code: number | null) => void): unknown;
        kill(): unknown;
    };
    setTimer?: (fn: () => void, ms: number) => unknown;
    clearTimer?: (handle: unknown) => void;
}
/**
 * 以 Windows 通知中心通知的形式请求审批（独立 PowerShell 子进程，带「批准 / 拒绝」按钮）。
 *
 * 实现要点（两条都是从实测限制倒推出来的）：
 * 1. `scenario="reminder"` 让通知停留到用户处理为止。普通 toast 约 5–10 秒就离开屏幕，
 *    SnoreToast/node-notifier 的结果管道随之关闭，之后在操作中心再点按钮也没有回传通道
 *    —— 这是"审批走通知中心"此前不可行的根因。
 * 2. 按钮用 `activationType="protocol"`：未打包的 Win32 应用收不到 WinRT 的
 *    `ToastNotification.Activated`（实测订阅成功但事件永不触发），因此由 Windows 唤起
 *    已注册的 URI 处理器写状态文件，本进程只轮询该文件。
 *
 * 退出码契约见 scripts/approval-toast.ps1：0=批准 1=拒绝 2=超时 3=结果异常 4=投递故障。
 */
export declare function showApprovalToast(req: DialogRequest, deps?: DialogDeps): DialogHandle;
/**
 * 按 token 定向清理一次审批在 Windows 侧的残留（T0 契约 §4.3）：通知用
 * 3 参 History.Remove（tag 不存在时静默返回），状态文件与私有 StateDir 映射
 * 由脚本按映射反查清理。幂等、可重复；绝不调用 History.Clear、绝不触碰
 * 其他审批的资源。fire-and-forget：失败只告警——残留通知仍有 ExpirationTime
 * 兜底，绝不能反过来影响已定的审批结果。
 */
export declare function cleanupRequest(token: string, deps?: DialogDeps): void;
/** 发送一条 WinRT 通知（仅用于审批结果/子代理提醒，fire-and-forget，但失败要可见）。 */
export declare function showToast(title: string, message: string): void;
