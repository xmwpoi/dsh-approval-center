import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import z from 'schemastery'
import { ApprovalQueue } from './queue.js'
import { ApprovalStore } from './store.js'
import {
  APPROVAL_TOAST_SCRIPT,
  APPROVAL_URI_HANDLER_SCRIPT,
  APPROVAL_URI_HANDLER_VBS,
  RESULT_TOAST_SCRIPT,
  assertScriptsUsable,
  showApprovalToast,
  showToast,
} from './dialog.js'
import {
  HOST_OUTCOME,
  RESULT_LABEL,
  STORE_STATUS,
  agentIdOf,
  matchTool,
  selectDisplayReason,
  subagentEndLabel,
  type ApprovalOutcome,
  type ApprovalRequestEvent,
  type DialogOutcome,
  type SubagentRunEndInfo,
} from './host-contract.js'

export const name = 'dsh-approval-center'

export const Config = z.object({
  /** 审批超时秒数（默认 30）；超时后的动作由 timeoutAction 决定 */
  timeoutSec: z.number().default(30).description('审批超时时间（秒）'),
  /** 超时动作：reject=自动拒绝（默认，fail-closed）；approve=自动批准 */
  timeoutAction: z.union(['reject', 'approve']).default('reject').description('审批超时后的动作'),
  /** 拦截哪些工具的审批请求；'*' 表示全部，支持 'bash*' 前缀通配；不匹配的请求转交下一个应答者（如 Web UI） */
  tools: z.array(z.string()).default(['*']).description('拦截的工具名模式列表'),
  /** serial: 串行排队（推荐）；parallel: 并列弹出（信号量背压，最多 3 个并发） */
  queueMode: z.union(['serial', 'parallel']).default('serial').description('审批并发模式'),
  /** 子代理任务完成时弹出通知（默认关：只保留"必须问"的审批通知） */
  notifyOnSubagentEnd: z.boolean().default(false).description('子代理完成时通知'),
  /** 子代理启动时弹出通知（默认关） */
  notifyOnSubagentStart: z.boolean().default(false).description('子代理启动时通知'),
  /** 审批结算后把结果发进通知中心（默认关：只保留"必须问"的审批通知） */
  notifyOnApprovalResult: z.boolean().default(false).description('审批结果通知'),
  /** 审批记录数据库目录，默认 $DSH_HOME/approval-center（未设 DSH_HOME 时 ~/.dsh/approval-center） */
  dataDir: z.string().default('').description('审批记录存储目录'),
}).description('审批中控台：Windows 通知中心审批 + 并行子代理状态汇总')

export interface Config {
  timeoutSec: number
  timeoutAction: 'reject' | 'approve'
  tools: string[]
  queueMode: 'serial' | 'parallel'
  notifyOnSubagentEnd: boolean
  notifyOnSubagentStart: boolean
  notifyOnApprovalResult: boolean
  dataDir: string
}

/** apply 实际用到的最小 cordis 上下文面（导出以便类型消费者命名） */
export interface CordisLikeContext {
  on(event: string, listener: (...args: never[]) => unknown, options?: unknown): unknown
  effect(setup: () => unknown): unknown
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/**
 * 数据目录跟随 DSH_HOME，与 dsh 自身的 home 解析保持一致
 */
function defaultDataDir(): string {
  // 与 @deepseek-ai/dsh-home-paths 对齐：纯空白的 DSH_HOME 视为未设置，
  // 否则 ' ' 会被当成相对路径，在 CWD 下建出库来
  const dshHome = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
  return join(dshHome, 'approval-center')
}

export function apply(ctx: CordisLikeContext, config: Config): void {
  // 容忍非 schema 调用方（手写 !!js 补丁、脚本直接调用）传入 undefined/不完整的 config
  const cfg = (config ?? {}) as Config

  if (process.platform !== 'win32') {
    // dsh 不检查 package.json 的 os 字段，必须自己快速失败：
    // 否则非 Windows 上 spawn powershell.exe 失败，插件会静默拒绝它认领的一切
    throw new Error(`dsh-approval-center 仅支持 Windows，当前平台: ${process.platform}`)
  }

  const dataDir = cfg.dataDir || defaultDataDir()
  // 懒加载：一次审批都没有时不去创建 approvals.db，避免污染用户目录
  let store: ApprovalStore | undefined
  const getStore = () => (store ??= new ApprovalStore(dataDir))

  const timeoutSec = cfg.timeoutSec ?? 30
  // reject=超时自动拒绝（fail-closed，默认）；approve=超时自动批准。
  // 只作用于 'timeout'（窗口内无人应答）：'unavailable' 永远 fail-closed——
  // 渠道故障时自动批准等于敞开大门，绝不放行。
  const timeoutAction = cfg.timeoutAction ?? 'reject'
  // 防御：config 未经 schema 处理（tools 缺失）时，不要把 TypeError 抛进 waterfall
  const tools = cfg.tools ?? ['*']

  const queue = new ApprovalQueue<ApprovalRequestEvent, ApprovalOutcome>(
    (req) => processOne(req),
    cfg.queueMode ?? 'serial',
  )

  // 出厂脚本必须可用：脚本缺失或语法错误时 PowerShell 以 exit 1 退出，而 exit 1 的语义
  // 是"用户点了拒绝"——那会把打包事故谎报成人类决策（详见 dialog.ts 的说明）。
  const needed = [APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT, APPROVAL_URI_HANDLER_VBS]
  if (cfg.notifyOnSubagentEnd || cfg.notifyOnSubagentStart || (cfg.notifyOnApprovalResult ?? false)) {
    needed.push(RESULT_TOAST_SCRIPT)
  }
  assertScriptsUsable(needed)

  async function processOne(req: ApprovalRequestEvent): Promise<ApprovalOutcome> {
    const requestId = randomUUID()
    const agentId = agentIdOf(req)
    getStore().insert({
      requestId,
      agentId,
      toolName: req.toolName,
      // 审计始终保存宿主原始 reason；displayReason 只进展示层（contract-017.md §2.2）
      reason: req.reason ?? '',
      createdAt: new Date().toISOString(),
      status: 'pending',
    })

    const displayReason = selectDisplayReason(req)
    const dialogReq = {
      title: `审批请求 · ${req.toolName}`,
      message: [
        `代理: ${shortId(agentId)}`,
        `操作: ${req.toolName}`,
        displayReason ? `原因: ${displayReason}` : '',
      ].filter(Boolean).join('\n'),
      timeoutSec,
      timeoutAction,
      signal: req.signal,
    }
    let outcome: DialogOutcome
    try {
      outcome = await showApprovalToast(dialogReq).promise
    } catch (error) {
      // 通道本身抛出：记 unavailable（fail-closed），并保证审计行不会停在 pending
      console.warn(`[dsh-approval-center] 审批通道异常: ${String(error)}`)
      outcome = 'unavailable'
    }
    try {
      // dispose 可能已经关掉 DB 句柄（processOne 仍可能在等待弹窗）
      store?.settle(requestId, STORE_STATUS[outcome])
    } catch {
      // 句柄已关闭：审计写入失败不应影响审批结果
    }
    // 超时动作：approve 时按"自动批准"上报 allowed-once；reject（默认）维持
    // unavailable（fail-closed，模型收到 deny）。审计行保留精确的 'timeout' 状态，
    // 以便事后区分"用户点的"与"超时自动的"。
    const hostOutcome: ApprovalOutcome =
      outcome === 'timeout' && timeoutAction === 'approve' ? 'allowed-once' : HOST_OUTCOME[outcome]
    if (cfg.notifyOnApprovalResult ?? false) {
      // 结果回执进 Windows 通知中心。best-effort：通知平台故障/速率限制只会
      // 产生 stderr 告警（见 showToast），不影响已结算的审批结果。
      const label =
        outcome === 'timeout'
          ? timeoutAction === 'approve'
            ? '超时无人应答（已自动批准）'
            : '超时无人应答（已自动拒绝）'
          : RESULT_LABEL[outcome]
      showToast('审批结果', `${req.toolName}：${label}（代理 ${shortId(agentId)}）`)
    }
    return hostOutcome
  }

  // approval/request 是 waterfall 事件：返回结果即认领请求，调用 next() 转交后续应答者。
  // { prepend: true } 是关键：cordis 先注册先认领，按默认 bundle 顺序本插件排在
  // dsh-api-remotes（Web UI 审批应答者）之后，浏览器在线时请求会被 Web UI 抢走。
  ctx.on('approval/request', (req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>) => {
    if (!matchTool(tools, req.toolName)) return next()
    return queue.submit(req)
  }, { prepend: true })

  if (cfg.notifyOnSubagentEnd) {
    ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
      showToast(`子代理${subagentEndLabel(info.stopReason)}`, `${info.provider}/${shortId(info.id)} 请查看结果`)
    })
  }

  if (cfg.notifyOnSubagentStart) {
    ctx.on('subagent/start', (info: { provider: string; id: string }) => {
      showToast('子代理已启动', `${info.provider}/${shortId(info.id)} 开始运行`)
    })
  }

  // cordis 没有 'dispose' 事件；用 effect 的清理函数在宿主重载/退出时关闭 DB 句柄
  ctx.effect(() => () => { store?.close() })
}
