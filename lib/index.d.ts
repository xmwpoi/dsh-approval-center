import z from 'schemastery';
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
    /** 子代理任务完成时弹出通知（默认关：只保留"必须问"的审批通知） */
    notifyOnSubagentEnd: z<boolean, boolean>;
    /** 子代理启动时弹出通知（默认关） */
    notifyOnSubagentStart: z<boolean, boolean>;
    /** 审批结算后把结果发进通知中心（默认关：只保留"必须问"的审批通知） */
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
    /** 子代理任务完成时弹出通知（默认关：只保留"必须问"的审批通知） */
    notifyOnSubagentEnd: z<boolean, boolean>;
    /** 子代理启动时弹出通知（默认关） */
    notifyOnSubagentStart: z<boolean, boolean>;
    /** 审批结算后把结果发进通知中心（默认关：只保留"必须问"的审批通知） */
    notifyOnApprovalResult: z<boolean, boolean>;
    /** 审批记录数据库目录，默认 $DSH_HOME/approval-center（未设 DSH_HOME 时 ~/.dsh/approval-center） */
    dataDir: z<string, string>;
}>>;
export interface Config {
    timeoutSec: number;
    timeoutAction: 'reject' | 'approve';
    tools: string[];
    queueMode: 'serial' | 'parallel';
    notifyOnSubagentEnd: boolean;
    notifyOnSubagentStart: boolean;
    notifyOnApprovalResult: boolean;
    dataDir: string;
}
/** apply 实际用到的最小 cordis 上下文面（导出以便类型消费者命名） */
export interface CordisLikeContext {
    on(event: string, listener: (...args: never[]) => unknown, options?: unknown): unknown;
    effect(setup: () => unknown): unknown;
}
export declare function apply(ctx: CordisLikeContext, config: Config): void;
