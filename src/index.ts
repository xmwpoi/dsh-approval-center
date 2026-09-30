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
  createTaskNotificationSender,
  showApprovalToast,
  showToast,
} from './dialog.js'
import {
  HOST_OUTCOME,
  RESULT_LABEL,
  STORE_STATUS,
  agentIdOf,
  approvalResultLabel,
  classifySessionOrigin,
  effectiveDialogOutcome,
  matchTool,
  resolveRequestSession,
  selectDisplayReason,
  type AgentLookup,
  type ApprovalOutcome,
  type ApprovalRequestEvent,
  type DialogOutcome,
  type SessionEventLike,
  type SessionLike,
} from './host-contract.js'
import {
  NotificationService,
  formatApprovalCard,
  type NotificationSender,
  type TurnEventInput,
} from './notifications.js'

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
  /** 主会话完成一轮回复时通知（默认开；只对主会话，子代理一律不通知） */
  notifyOnTurnEnd: z.boolean().default(true).description('主会话本轮回复完成时通知'),
  /** 主会话本轮异常结束（出错/受阻/触顶）时通知（默认开；子代理一律不通知） */
  notifyOnTurnFailure: z.boolean().default(true).description('主会话本轮异常结束时通知'),
  /** 任务通知声音：silent=静音（默认）；default=系统默认提示音 */
  taskNotificationSound: z.union(['silent', 'default']).default('silent').description('任务通知声音'),
  /** 任务通知是否显示会话标题；false 时仅显示会话短 ID（锁屏也可能展示正文） */
  taskNotificationShowTitle: z.boolean().default(true).description('任务通知显示会话标题'),
  /**
   * @deprecated 子代理通知已关闭：即使旧配置为 true 也强制不生效。
   * 保留字段只为让旧 profile 的 config 整体替换后仍能通过 schema 校验。
   */
  notifyOnSubagentEnd: z.boolean().default(false).description('（已弃用，强制无效）子代理完成时通知'),
  /** @deprecated 同上：子代理通知已关闭，true 也无效。 */
  notifyOnSubagentStart: z.boolean().default(false).description('（已弃用，强制无效）子代理启动时通知'),
  /** 审批结算后把结果发进通知中心（默认关；仅主对话审批，子代理结果回执始终禁用） */
  notifyOnApprovalResult: z.boolean().default(false).description('审批结果通知'),
  /** 审批记录数据库目录，默认 $DSH_HOME/approval-center（未设 DSH_HOME 时 ~/.dsh/approval-center） */
  dataDir: z.string().default('').description('审批记录存储目录'),
}).description('审批中控台：Windows 通知中心审批 + 主对话完成/错误通知')

export interface Config {
  timeoutSec: number
  timeoutAction: 'reject' | 'approve'
  tools: string[]
  queueMode: 'serial' | 'parallel'
  notifyOnTurnEnd: boolean
  notifyOnTurnFailure: boolean
  taskNotificationSound: 'silent' | 'default'
  taskNotificationShowTitle: boolean
  /** @deprecated 强制不生效 */
  notifyOnSubagentEnd: boolean
  /** @deprecated 强制不生效 */
  notifyOnSubagentStart: boolean
  notifyOnApprovalResult: boolean
  dataDir: string
}

/**
 * 注入点（仅供自动化测试）：默认走真实 Windows sender。
 * 生产路径不传 deps，行为与设计一致。
 */
export interface ApplyDeps {
  /** 任务通知 sender 工厂（测试注入 mock，避免真实 PowerShell/WinRT）。 */
  createSender?: () => NotificationSender
}

/** apply 实际用到的最小 cordis 上下文面（导出以便类型消费者命名） */
export interface CordisLikeContext {
  on(event: string, listener: (...args: never[]) => unknown, options?: unknown): unknown
  effect(setup: () => unknown): unknown
  /**
   * 宿主 AgentRegistry（公开查询面）。**可选**：cordis 在服务未注入时读取该属性会抛，
   * 因此接线必须经 `safeAgentLookup` 访问，不得直接取值。
   */
  agents?: { get(id: string): { readonly session?: SessionLike } | undefined }
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id
}

/**
 * 宿主公开的 live-agent 查询面（契约 §2.6 解析第 2 步）。
 *
 * ⚠ 不能直接写 `ctx.agents`：cordis 的 service proxy 在服务未注入时会**抛**
 * `cannot get property "agents" without inject`。本插件不依赖 dsh-agent —— 集成
 * fixture、精简宿主、乃至未来的宿主版本都可能没有它。所以必须走安全访问：
 * 拿不到就按"身份不可确认"处理，绝不能让插件因此拒载。
 */
function safeAgentLookup(ctx: CordisLikeContext): AgentLookup | undefined {
  let registry: unknown
  try {
    registry = (ctx as { agents?: unknown }).agents
  } catch {
    return undefined
  }
  if (registry === null || typeof registry !== 'object') return undefined
  const get = (registry as { get?: unknown }).get
  if (typeof get !== 'function') return undefined
  return (id: string) => (get as (id: string) => unknown).call(registry, id) as
    | { readonly session?: SessionLike }
    | undefined
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

export function apply(ctx: CordisLikeContext, config: Config, deps: ApplyDeps = {}): void {
  // 容忍非 schema 调用方（手写 !!js 补丁、脚本直接调用）传入 undefined/不完整的 config
  const cfg = (config ?? {}) as Config

  if (process.platform !== 'win32') {
    // dsh 不检查 package.json 的 os 字段，必须自己快速失败：
    // 否则非 Windows 上 spawn powershell.exe 失败，插件会静默拒绝它认领的一切
    throw new Error(`dsh-approval-center 仅支持 Windows，当前平台: ${process.platform}`)
  }

  const dataDir = cfg.dataDir || defaultDataDir()
  // 懒加载：一次审批都没有时不去创建 approvals.db，避免污染用户目录。
  // owner identity 写入实例锁做诊断；存活判定由 pid/hostname 承担（store 模块）。
  let store: ApprovalStore | undefined
  const getStore = () => (store ??= new ApprovalStore(dataDir, { identity: 'dsh-approval-center' }))

  const timeoutSec = cfg.timeoutSec ?? 30
  // reject=超时自动拒绝（fail-closed，默认）；approve=超时自动批准。
  // 只作用于 'timeout'（窗口内无人应答）：'unavailable' 永远 fail-closed——
  // 渠道故障时自动批准等于敞开大门，绝不放行。
  const timeoutAction = cfg.timeoutAction ?? 'reject'
  // 防御：config 未经 schema 处理（tools 缺失）时，不要把 TypeError 抛进 waterfall
  const tools = cfg.tools ?? ['*']

  // 主对话通知开关（默认开）。子代理通知已按需求整体关闭，不存在对应开关。
  const notifyOnTurnEnd = cfg.notifyOnTurnEnd ?? true
  const notifyOnTurnFailure = cfg.notifyOnTurnFailure ?? true
  const taskNotificationSound = cfg.taskNotificationSound ?? 'silent'
  const showTitle = cfg.taskNotificationShowTitle ?? true

  // ── 弃用兼容：旧子代理开关即使为 true 也强制不生效（只限频记一次日志） ──
  // 不能只改默认值而让旧配置继续响铃：旧 profile 里写死的 true 必须被显式忽略。
  if (cfg.notifyOnSubagentStart === true || cfg.notifyOnSubagentEnd === true) {
    console.warn(
      '[dsh-approval-center] notifyOnSubagentStart/notifyOnSubagentEnd 已弃用：' +
      '本插件不再发送任何子代理通知（即使配置为 true 也不生效）。' +
      '请从 profile 配置中移除这两个字段。',
    )
  }

  const queue = new ApprovalQueue<ApprovalRequestEvent, ApprovalOutcome>({
    run: (req, signal) => processOne(req, signal),
    // 排队中/入队前被宿主撤回 → cancelled（不谎报拒绝）；关闭/卸载 → unavailable（fail-closed）
    onCancel: () => 'cancelled',
    onClose: () => 'unavailable',
  }, cfg.queueMode ?? 'serial')

  // 出厂脚本必须可用：脚本缺失或语法错误时 PowerShell 以 exit 1 退出，而 exit 1 的语义
  // 是"用户点了拒绝"——那会把打包事故谎报成人类决策（详见 dialog.ts 的说明）。
  // 任务通知路径复用 RESULT_TOAST_SCRIPT（toast.ps1，C 已重写为任务发送器）。
  const needed = [APPROVAL_TOAST_SCRIPT, APPROVAL_URI_HANDLER_SCRIPT, APPROVAL_URI_HANDLER_VBS]
  if (notifyOnTurnEnd || notifyOnTurnFailure || (cfg.notifyOnApprovalResult ?? false)) {
    needed.push(RESULT_TOAST_SCRIPT)
  }
  assertScriptsUsable(needed)

  // ── 主对话通知服务（§2.4：独立于审批队列；任何通知异常不改变审批/模型/SQLite 结果） ──
  // 只在与任务通知相关的开关开启时才创建：两个开关都关时零进程、零监听、零开销。
  const notificationService = (notifyOnTurnEnd || notifyOnTurnFailure)
    ? new NotificationService({
      sender: (deps.createSender ?? createTaskNotificationSender)(),
      silent: taskNotificationSound === 'silent',
      showTitle,
    })
    : undefined

  // 会话标题缓存：容量有界 + session/disposed 清理（契约 §2.5/§4 A 段）。
  // 宿主 Session 没有 title 属性，标题只能来自 `session/title` 事件流。
  //
  // ⚠ 契约 §2.5 R2 裁决：宿主已把 `snapshotEvents()` 标记为
  //   "@deprecated … but new calls are prohibited"
  // （dsh-session index.d.ts，0.1.7-rc.2）。本插件**不得新增**对它的调用，
  // 因此这里**没有**"首次遇到会话回读事件快照"的冷读路径——缓存只由事件流喂。
  // 后果（如实记录）：插件挂载**之前**就已产生的标题读不到，
  // 此时回退 `会话 <短ID>`；这不阻断任何通知或审批。
  const TITLE_CACHE_MAX = 256
  const titleCache = new Map<string, string>()
  const rememberTitle = (sessionId: string, title: string): void => {
    if (!titleCache.has(sessionId) && titleCache.size >= TITLE_CACHE_MAX) {
      const oldest = titleCache.keys().next().value
      if (oldest !== undefined) titleCache.delete(oldest)
    }
    titleCache.set(sessionId, title)
  }
  const titleOf = (sessionId: string): string | undefined => titleCache.get(sessionId)

  // ── 主会话监听入口（§2.2 冻结）：只监听公开的 session/event，不做任何猜测 ──
  // 回调必须**同步返回**（该事件是 emit 模式，宿主不 await 监听器）：绝不 await PowerShell。
  // 异步失败由 NotificationService 自行捕获，不得逃进宿主事件派发。
  if (notificationService !== undefined) {
    ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
      try {
        const type = event?.type
        if (type !== 'turn/start' && type !== 'step/start' && type !== 'turn/end' && type !== 'session/title') return

        const sessionId = session?.id
        if (typeof sessionId !== 'string' || sessionId === '') return

        if (type === 'session/title') {
          const title = event.data?.['title']
          if (typeof title === 'string' && title.trim() !== '') rememberTitle(sessionId, title)
          return
        }

        const turn = event.data?.['turn']
        if (typeof turn !== 'number') return

        // 主/子判据（§2.4）：origin === 'subagent' 是唯一判据。子代理事件在这里就被丢弃，
        // 不占队列、不建去重项、不产生任何发送进程。
        const origin = session?.header?.origin

        if (type === 'turn/end') {
          const reason = event.data?.['reason']
          const reasonKind = (reason !== null && typeof reason === 'object')
            ? (reason as { kind?: unknown }).kind
            : undefined
          const kind = typeof reasonKind === 'string' ? reasonKind : undefined
          // 配置门（A 拥有配置语义；B 的服务保持配置无关）：
          // completed → notifyOnTurnEnd；error/blocked/max-tokens → notifyOnTurnFailure。
          // 其余 kind（aborted/interrupted/forked/未知）一律不转发，服务侧本就静默。
          const isSuccess = kind === 'completed'
          const isFailure = kind === 'error' || kind === 'blocked' || kind === 'max-tokens'
          if (isSuccess && !notifyOnTurnEnd) return
          if (isFailure && !notifyOnTurnFailure) return
          notificationService.observe({
            kind: 'turn-end',
            sessionId,
            turn,
            origin,
            reasonKind: kind,
            title: titleOf(sessionId),
          } satisfies TurnEventInput)
          return
        }

        notificationService.observe({
          kind: type === 'turn/start' ? 'turn-start' : 'step-start',
          sessionId,
          turn,
          origin,
        } satisfies TurnEventInput)
      } catch (error) {
        // 监听器绝不能把异常抛回宿主的事件派发
        console.warn(`[dsh-approval-center] session/event 处理异常（已忽略）: ${String(error)}`)
      }
    })

    // 会话销毁即释放标题缓存（不让缓存随长生命周期进程无限增长）
    ctx.on('session/disposed', (session: SessionLike) => {
      const sessionId = session?.id
      if (typeof sessionId === 'string') titleCache.delete(sessionId)
    })
  }

  async function processOne(req: ApprovalRequestEvent, signal?: AbortSignal): Promise<ApprovalOutcome> {
    const requestId = randomUUID()
    const agentId = agentIdOf(req)
    try {
      getStore().insert({
        requestId,
        agentId,
        toolName: req.toolName,
        // 审计始终保存宿主原始 reason；displayReason 只进展示层（contract-017.md §2.2）
        reason: req.reason ?? '',
        createdAt: new Date().toISOString(),
        status: 'pending',
      })
    } catch (error) {
      // 审计失败不弹审批（contract-017.md §4.4）：没有可审计记录的审批不能发生
      console.warn(`[dsh-approval-center] 审计记录写入失败，按渠道不可用处理: ${String(error)}`)
      return 'unavailable'
    }

    // requestToken = requestId 去连字符（32 位 hex，符合 dialog 的 token 校验）：
    // 取消清理按 token 定向，审计与通知共用一套 ID（C 的 CR-1 建议）
    const requestToken = requestId.replace(/-/g, '')
    // 主审批卡片（契约 §3.4）：结构化多行，含任务/操作/原因/选择/等待。
    // 工具名不是命令——卡片绝不拼接未核实的命令或参数。
    const card = formatApprovalCard({
      toolName: req.toolName,
      title: titleCache.get(req.agent?.session?.id ?? ''),
      sessionId: req.agent?.session?.id,
      reason: req.reason,
      displayReason: req.displayReason,
      timeoutSec,
      timeoutAction,
      showTitle,
    })
    const dialogReq = {
      title: card.title,
      message: card.message,
      timeoutSec,
      timeoutAction,
      // 队列传入的组合 signal：宿主撤回与插件关闭都会触发
      signal,
      requestToken,
    }
    let outcome: DialogOutcome
    try {
      outcome = await showApprovalToast(dialogReq).promise
    } catch (error) {
      // 通道本身抛出：记 unavailable（fail-closed），并保证审计行不会停在 pending
      console.warn(`[dsh-approval-center] 审批通道异常: ${String(error)}`)
      outcome = 'unavailable'
    }
    // 关闭来源消歧：close() 中止的活动 worker 到达时队列已 closed，那是插件停机
    // 而非宿主撤回（§4.5）；宿主侧早已自行结算 cancelled，这里怎么报都安全。
    outcome = effectiveDialogOutcome(outcome, queue.state !== 'accepting')
    let settleFailed = false
    try {
      store?.settle(requestId, STORE_STATUS[outcome])
    } catch (error) {
      // StoreClosedError（卸载竞态）只告警；其他写失败按计划 §3.4 处理：
      // 批准后无法结算 = 插件无法审计的放行，必须返回 unavailable
      settleFailed = true
      console.warn(`[dsh-approval-center] 审计结算失败 (requestId=${requestId}, outcome=${outcome}): ${String(error)}`)
    }
    // 超时动作：approve 时按"自动批准"上报 allowed-once；reject（默认）维持
    // unavailable（fail-closed，模型收到 deny）。审计行保留精确的 'timeout' 状态，
    // 以便事后区分"用户点的"与"超时自动的"。
    let hostOutcome: ApprovalOutcome =
      outcome === 'timeout' && timeoutAction === 'approve' ? 'allowed-once' : HOST_OUTCOME[outcome]
    if (settleFailed && hostOutcome === 'allowed-once') {
      console.warn(`[dsh-approval-center] 批准结果未能落审计，改判 unavailable (requestId=${requestId})`)
      hostOutcome = 'unavailable'
    }
    if (cfg.notifyOnApprovalResult ?? false) {
      // 文案与实际上报一致：降级后不得再展示"已批准"（approvalResultLabel 处理 settleFailed）
      const label = approvalResultLabel(outcome, { timeoutAction, settleFailed })
      showToast('审批结果', `${req.toolName}：${label}（代理 ${shortId(agentId)}）`)
    }
    return hostOutcome
  }

  // 宿主公开的 live agent 查询面（§2.6 解析第 2 步）。缺失时按"身份不可确认"处理。
  const lookupAgent = safeAgentLookup(ctx)

  // approval/request 是 waterfall 事件：返回结果即认领请求，调用 next() 转交后续应答者。
  // { prepend: true } 是关键：cordis 先注册先认领，按默认 bundle 顺序本插件排在
  // dsh-api-remotes（Web UI 审批应答者）之后，浏览器在线时请求会被 Web UI 抢走。
  ctx.on('approval/request', (req: ApprovalRequestEvent, next: () => Promise<ApprovalOutcome>) => {
    if (!matchTool(tools, req.toolName)) return next()
    // 主会话身份门（§2.7 冻结）：先解析真实 Session，再按 header.origin 判定。
    // 子代理审批与**身份无法可靠确认**的请求一律不认领——不入审批队列、不建审计记录、
    // 不弹窗，next() 恰一次交宿主其他应答者。绝不静默自动批准或拒绝。
    const session = resolveRequestSession(req, lookupAgent)
    if (classifySessionOrigin(session?.header) !== 'root') return next()
    return queue.submit(req, req.signal)
  }, { prepend: true })

  // 子代理通知监听已按需求整体移除：subagent/start、subagent/end 不再注册任何监听器。
  // 旧开关即使为 true 也不产生通知、不产生 PowerShell 进程（见上方弃用告警）。

  // cordis 没有 'dispose' 事件；用 effect 的清理函数在宿主重载/退出时收尾。
  // cordis 的 _unload 会 await 异步 cleanup（contract-017.md §2.4），因此这里可以
  // 等待队列结算：close() 结算排队项为 unavailable、中止活动 worker 的组合 signal、
  // 等它们落完审计，最后才关 DB——旧请求不会再写已关闭的句柄。
  // 通知 close 放在最后且自身有界（§2.4 最多 12 秒）：不让通知拖挂审批卸载。
  ctx.effect(() => async () => {
    await queue.close()
    store?.close()
    if (notificationService !== undefined) {
      try {
        await notificationService.close()
      } catch (error) {
        console.warn(`[dsh-approval-center] 通知服务关闭异常（已忽略）: ${String(error)}`)
      }
    }
    titleCache.clear()
  })
}
