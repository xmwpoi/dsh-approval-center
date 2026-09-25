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
export declare function assertScriptsUsable(files: readonly string[]): void;
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
}
export interface DialogHandle {
    promise: Promise<DialogOutcome>;
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
export declare function showApprovalToast(req: DialogRequest): DialogHandle;
/** 发送一条 WinRT 通知（仅用于审批结果/子代理提醒，fire-and-forget，但失败要可见）。 */
export declare function showToast(title: string, message: string): void;
