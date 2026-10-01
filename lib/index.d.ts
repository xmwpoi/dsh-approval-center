import z from 'schemastery';
import { type SessionLike } from './host-contract.js';
import { type NotificationSender } from './notifications.js';
export declare const name = "dsh-approval-center";
export declare const Config: z<Schemastery.ObjectS<{
    /** 审批超时秒数（默认 30）；超时后的动作由 timeoutAction 决定 */
    timeoutSec: z<number, number>;
    /** 超时动作：reject=自动拒绝（默认，fail-closed）；approve=自动批准 */
    timeoutAction: z<"reject" | "approve", "reject" | "approve">;
    /** 拦截哪些工具的审批请求；'*' 表示全部，支持 'bash*' 前缀通配；不匹配的请求转交下一个应答者（如 Web UI） */
    tools: z<string[], string[]>;
    /** serial: 串行排队（推荐）；parallel: 并列弹出（信号量背压，最多 3 个并发） */
    queueMode: z<"serial" | "parallel", "serial" | "parallel">;
    /** 主会话完成一轮回复时通知（默认开；只对主会话，子代理一律不通知） */
    notifyOnTurnEnd: z<boolean, boolean>;
    /** 主会话本轮异常结束（出错/受阻/触顶）时通知（默认开；子代理一律不通知） */
    notifyOnTurnFailure: z<boolean, boolean>;
    /** 任务通知声音：silent=静音（默认）；default=系统默认提示音 */
    taskNotificationSound: z<"default" | "silent", "default" | "silent">;
    /** 任务通知是否显示会话标题；false 时仅显示会话短 ID（锁屏也可能展示正文） */
    taskNotificationShowTitle: z<boolean, boolean>;
    /**
     * @deprecated 子代理通知已关闭：即使旧配置为 true 也强制不生效。
     * 保留字段只为让旧 profile 的 config 整体替换后仍能通过 schema 校验。
     */
    notifyOnSubagentEnd: z<boolean, boolean>;
    /** @deprecated 同上：子代理通知已关闭，true 也无效。 */
    notifyOnSubagentStart: z<boolean, boolean>;
    /** 审批结算后把结果发进通知中心（默认关；仅主对话审批，子代理结果回执始终禁用） */
    notifyOnApprovalResult: z<boolean, boolean>;
    /** 审批记录数据库目录，默认 $DSH_HOME/approval-center（未设 DSH_HOME 时 ~/.dsh/approval-center） */
    dataDir: z<string, string>;
}>, Schemastery.ObjectT<{
    /** 审批超时秒数（默认 30）；超时后的动作由 timeoutAction 决定 */
    timeoutSec: z<number, number>;
    /** 超时动作：reject=自动拒绝（默认，fail-closed）；approve=自动批准 */
    timeoutAction: z<"reject" | "approve", "reject" | "approve">;
    /** 拦截哪些工具的审批请求；'*' 表示全部，支持 'bash*' 前缀通配；不匹配的请求转交下一个应答者（如 Web UI） */
    tools: z<string[], string[]>;
    /** serial: 串行排队（推荐）；parallel: 并列弹出（信号量背压，最多 3 个并发） */
    queueMode: z<"serial" | "parallel", "serial" | "parallel">;
    /** 主会话完成一轮回复时通知（默认开；只对主会话，子代理一律不通知） */
    notifyOnTurnEnd: z<boolean, boolean>;
    /** 主会话本轮异常结束（出错/受阻/触顶）时通知（默认开；子代理一律不通知） */
    notifyOnTurnFailure: z<boolean, boolean>;
    /** 任务通知声音：silent=静音（默认）；default=系统默认提示音 */
    taskNotificationSound: z<"default" | "silent", "default" | "silent">;
    /** 任务通知是否显示会话标题；false 时仅显示会话短 ID（锁屏也可能展示正文） */
    taskNotificationShowTitle: z<boolean, boolean>;
    /**
     * @deprecated 子代理通知已关闭：即使旧配置为 true 也强制不生效。
     * 保留字段只为让旧 profile 的 config 整体替换后仍能通过 schema 校验。
     */
    notifyOnSubagentEnd: z<boolean, boolean>;
    /** @deprecated 同上：子代理通知已关闭，true 也无效。 */
    notifyOnSubagentStart: z<boolean, boolean>;
    /** 审批结算后把结果发进通知中心（默认关；仅主对话审批，子代理结果回执始终禁用） */
    notifyOnApprovalResult: z<boolean, boolean>;
    /** 审批记录数据库目录，默认 $DSH_HOME/approval-center（未设 DSH_HOME 时 ~/.dsh/approval-center） */
    dataDir: z<string, string>;
}>>;
export interface Config {
    timeoutSec: number;
    timeoutAction: 'reject' | 'approve';
    tools: string[];
    queueMode: 'serial' | 'parallel';
    notifyOnTurnEnd: boolean;
    notifyOnTurnFailure: boolean;
    taskNotificationSound: 'silent' | 'default';
    taskNotificationShowTitle: boolean;
    /** @deprecated 强制不生效 */
    notifyOnSubagentEnd: boolean;
    /** @deprecated 强制不生效 */
    notifyOnSubagentStart: boolean;
    notifyOnApprovalResult: boolean;
    dataDir: string;
}
/**
 * 注入点（仅供自动化测试）：默认走真实 Windows sender。
 * 生产路径不传 deps，行为与设计一致。
 */
export interface ApplyDeps {
    /** 任务通知 sender 工厂（测试注入 mock，避免真实 PowerShell/WinRT）。 */
    createSender?: () => NotificationSender;
}
/** apply 实际用到的最小 cordis 上下文面（导出以便类型消费者命名） */
export interface CordisLikeContext {
    on(event: string, listener: (...args: never[]) => unknown, options?: unknown): unknown;
    effect(setup: () => unknown): unknown;
    /**
     * 宿主 AgentRegistry（公开查询面）。**可选**：cordis 在服务未注入时读取该属性会抛，
     * 因此接线必须经 `safeAgentLookup` 访问，不得直接取值。
     */
    agents?: {
        get(id: string): {
            readonly session?: SessionLike;
        } | undefined;
    };
}
export declare function apply(ctx: CordisLikeContext, config: Config, deps?: ApplyDeps): void;
