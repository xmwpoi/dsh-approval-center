import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts')

/** 审批通道使用的脚本（通知中心 toast + 它的 protocol URI 处理器）。 */
export const APPROVAL_TOAST_SCRIPT = 'approval-toast.ps1'
export const APPROVAL_URI_HANDLER_SCRIPT = 'approval-uri-handler.ps1'
/**
 * protocol URI 处理器的首选实现：`wscript.exe` 是 GUI 子系统（PE subsystem=2），
 * 点按钮时不会像 `powershell.exe`（subsystem=3, CUI）那样闪出一个控制台窗口。
 * 必须随包发布并在挂载期校验其存在性——它一旦打包出事，点击回传会静默失效、
 * 每次审批都被误判成超时。
 */
export const APPROVAL_URI_HANDLER_VBS = 'approval-uri-handler.vbs'
/**
 * 任务通知脚本（T0 契约 §4.4）：主对话完成/错误通知的唯一投递通道。
 * 同时被旧的 `showToast` 兼容路径复用（该路径不传 -Tag/-Group，走脚本默认值）。
 */
export const RESULT_TOAST_SCRIPT = 'toast.ps1'

/**
 * 挂载期校验脚本可用性：缺失 / 空文件 / **语法错误** 都必须立刻发现。
 *
 * 为什么必须做：PowerShell 对"脚本不存在"和"语法错误"都以 exit 1 退出，而 exit 1 在本
 * 插件的语义里是"用户点了拒绝"。不校验的话，一次打包事故——例如编辑器把 UTF-8 BOM
 * 去掉，PowerShell 5.1 便按 ANSI 读取含中文的源码而直接语法报错——会被谎报成
 * "用户拒绝了这次提权"，审计库也记成 `rejected`，模型还会被告知"停止并解释，不要绕过"。
 * 校验失败就抛错：本 entry 不激活（DSH 会把可选 entry 记为未激活并打印原因），
 * 其他插件照常运行——比静默地把每次审批都判成拒绝要好得多。
 */
/** 只有 .ps1 能交给 PowerShell 解析器；.vbs 由 wscript 执行，需保持纯 ASCII。 */
const isPowerShellScript = (path: string): boolean => path.toLowerCase().endsWith('.ps1')
const isVbsScript = (path: string): boolean => path.toLowerCase().endsWith('.vbs')

export function assertScriptsUsable(files: readonly string[], baseDir: string = SCRIPTS_DIR): void {
  const paths = files.map((file) => join(baseDir, file))

  for (const path of paths) {
    let bytes: Buffer
    try {
      bytes = readFileSync(path)
    } catch {
      throw new Error(`dsh-approval-center: 缺少脚本 ${path}；安装包不完整`)
    }
    if (bytes.length === 0) throw new Error(`dsh-approval-center: 脚本为空 ${path}；安装包不完整`)

    // R2 §6 完整性门：**仅靠"非空 + 有 BOM + 语法能解析"不足以证明脚本可用**。
    // R1 实测事故：toast.ps1 被截断成只剩 3 字节 BOM——长度非 0、BOM 存在、
    // 空文件 Parser::ParseFile 零错误，三项门禁全过，但脚本什么都不做，
    // sender 会以 exit 0 **静默假成功**。这里按"剥掉 BOM 后是否还有非空白字节"拦下。
    {
      const start = (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) ? 3
        : ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) ? 2
        : 0
      let hasContent = false
      for (let i = start; i < bytes.length; i++) {
        const b = bytes[i]
        // 0x20 空格 与 \t \r \n \v \f 之外，只要有任何字节就算有内容
        if (b !== 0x20 && b !== 0x09 && b !== 0x0d && b !== 0x0a && b !== 0x0b && b !== 0x0c) {
          hasContent = true
          break
        }
      }
      if (!hasContent) {
        throw new Error(
          `dsh-approval-center: 脚本 ${path} 只有 BOM/空白、没有任何可执行内容。` +
          '这种情况会通过"非空+BOM+语法"三项检查却什么都不做（R1 实测事故），必须拒绝挂载。',
        )
      }
    }

    let nonAscii = false
    for (const byte of bytes) {
      if (byte >= 0x80) {
        nonAscii = true
        break
      }
    }

    if (isPowerShellScript(path)) {
      // Windows PowerShell 5.1 读无 BOM 的 .ps1 时按 ANSI（本机 CP936）解码：
      // 含中文的 UTF-8 源码会直接变成语法错误，脚本以 exit 1 退出 —— 而 exit 1 在
      // 本插件的语义里是"用户点了拒绝"。这个坑很容易被一次保存动作踩到（实测踩过），
      // 所以这里按字节判定：非 ASCII + 无 BOM 一律拒绝挂载。
      const hasUtf8Bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      const hasUtf16Bom = bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))
      if (nonAscii && !hasUtf8Bom && !hasUtf16Bom) {
        throw new Error(
          `dsh-approval-center: ${path} 含非 ASCII 字符却没有 BOM。` +
          'Windows PowerShell 5.1 会按 ANSI 解码它，脚本立刻语法报错并以 exit 1 退出，' +
          '而 exit 1 会被当成"用户拒绝"上报。请以「UTF-8 with BOM」保存该文件。',
        )
      }
    } else if (isVbsScript(path) && nonAscii) {
      // wscript 按 ANSI 读取 .vbs（UTF-8 BOM 反而会被它当成脚本内容而报错），
      // 所以 URI 处理器必须保持纯 ASCII：任何非 ASCII 字节都会被误解码。
      throw new Error(
        `dsh-approval-center: ${path} 必须保持纯 ASCII（wscript 按 ANSI 读取 .vbs，` +
        '非 ASCII 字节会被误解码、UTF-8 BOM 更会让它直接语法报错）。',
      )
    }
  }

  // 语法门禁只对 .ps1 执行：解析器是 PowerShell 的，把 .vbs 交给它会报出几十个假语法错误
  // （实测 65 个），exit 3 直接让整个 entry 拒绝挂载。而且宿主是唯一真正会执行这段检查的
  // 地方——受限文件沙箱里 spawnSync 直接 EPERM 并降级为告警，所以这类错误在沙箱内的自测
  // 里根本暴露不出来（实测踩过：插件静默未激活，审批全部落到 Web GUI）。
  const ps1Paths = paths.filter(isPowerShellScript)
  if (ps1Paths.length === 0) return
  const list = ps1Paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
  const checker = [
    // PowerShell 5.1 默认按控制台代码页（本机 CP936）写 stdout，父进程按 utf8 解码
    // 会把语法错误正文变成乱码。先强制 UTF-8 输出——DSH 自己的子进程也是这么做的。
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$e = $null',
    `foreach ($f in @(${list})) {`,
    '  $err = $null',
    '  [void][System.Management.Automation.Language.Parser]::ParseFile($f, [ref]$e, [ref]$err)',
    '  if ($err -and $err.Count) { $err | ForEach-Object { Write-Output $_.Message }; exit 3 }',
    '}',
    'exit 0',
  ].join('\n')

  let result: ReturnType<typeof spawnSync>
  try {
    // stdio 用管道读取语法错误正文；受限环境可能同步抛出，不能让它逃出去
    result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', checker], {
      encoding: 'utf8',
      windowsHide: true,
    })
  } catch (error) {
    console.warn(`[dsh-approval-center] 无法校验 PowerShell 脚本（继续运行）: ${String(error)}`)
    return
  }

  if (result.error !== undefined && result.error !== null) {
    console.warn(`[dsh-approval-center] 无法校验 PowerShell 脚本（继续运行）: ${String(result.error)}`)
    return
  }
  if (result.status === 3) {
    throw new Error(
      'dsh-approval-center: PowerShell 脚本存在语法错误——审批会被全部误报为"用户拒绝"，' +
      `已拒绝挂载：\n${String(result.stdout ?? '').trim()}`,
    )
  }
  if (result.status !== 0) {
    console.warn(`[dsh-approval-center] 脚本校验退出码 ${String(result.status)}（继续运行）`)
  }
}

/**
 * 审批结果。'timeout'（无人应答）与 'rejected'（用户点了拒绝）严格区分，
 * 避免"谎报用户拒绝"。'dismissed' 保留在词汇表里但通知通道无法探测到
 * （未打包应用收不到 WinRT 的 Dismissed 事件），因此不会被产生。
 */
export type DialogOutcome =
  | 'allowed-once' // 用户点了批准
  | 'rejected' // 用户点了拒绝
  | 'timeout' // 窗口内无人应答
  | 'dismissed' // 保留：用户直接关闭了横幅（通知通道探测不到）
  | 'cancelled' // 请求方中止（AbortSignal）
  | 'unavailable' // 基础设施故障（投递失败/进程异常），fail-closed

export interface DialogRequest {
  title: string
  message: string
  timeoutSec: number
  /** 超时动作（仅影响文案提示；实际裁决在调用方）：reject=自动拒绝 approve=自动批准 */
  timeoutAction?: 'reject' | 'approve'
  signal?: AbortSignal
  /**
   * 插件内部请求 token（T0 契约 §4.3）：传入后作为通知 tag 与状态文件名，
   * 使取消/看门狗强杀后的清理能按 token 定向。须为 1-64 位 hex；
   * 缺省时脚本沿用随机 GUID（手动脚本兼容路径）。
   */
  requestToken?: string
  /**
   * R5 §3 冻结的可选结构化字段：**固定安全信息**（拒绝含义 + 真实超时动作）。
   * 主审批卡片**必须**提供；作为独立 PS 参数 `-DecisionSummary` 传递，
   * 使脚本把它放进**第一个** `<text>` 且**不参与**截断预算。
   * 缺省（legacy 调用，如手动脚本/结果回执）走旧单 `Message` 路径。
   */
  decisionSummary?: string
  /**
   * R5 §3 冻结的可选结构化字段：**动态摘要**（任务/操作/原因，各字段独立限宽）。
   * 作为独立 PS 参数 `-ContextSummary` 传递，放进**第二个** `<text>`，
   * 与 decisionSummary **互不合并、互不分摊**截断预算。
   * 缺省同上（legacy 路径）。
   */
  contextSummary?: string
}

export interface DialogHandle {
  promise: Promise<DialogOutcome>
  /** 终止本次审批并按 token 定向清理本人通知/状态文件；幂等，重复调用安全。 */
  cancel(): void
}

/**
 * 可注入的进程/时钟边界（仅供自动化测试；T3 计划 §3.3 的 mock 测试依赖它）。
 * 生产路径不传 deps，走真实 spawn 与 setTimeout，行为与基线完全一致。
 * 结构化最小接口：真实 ChildProcess / spawn 天然满足，mock 也无需模拟完整类型。
 */
export interface DialogDeps {
  spawn?: (file: string, args: readonly string[], options: { windowsHide: boolean; stdio: 'ignore' }) => {
    on(event: 'error', listener: (error: Error) => void): unknown
    on(event: 'exit', listener: (code: number | null) => void): unknown
    kill(): unknown
  }
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

function mapExitCode(code: number | null): DialogOutcome {
  switch (code) {
    case 0: return 'allowed-once'
    case 1: return 'rejected'
    case 2: return 'timeout' // 窗口内无人应答
    // 3=结果内容异常、4=未成功投递、其它/无退出码：一律 fail-closed
    default: return 'unavailable'
  }
}

/** token 即状态文件名/通知 tag 的一部分，必须把路径注入（../、% 等）挡在这里和脚本双重校验之外 */
const TOKEN_PATTERN = /^[0-9a-fA-F]{1,64}$/

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
export function showApprovalToast(req: DialogRequest, deps: DialogDeps = {}): DialogHandle {
  const spawnImpl = deps.spawn ?? spawn
  const setTimerImpl = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimerImpl = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  let requestCancel: () => void = () => {}
  const promise = new Promise<DialogOutcome>((resolve) => {
    // 已中止的请求不该再拉起进程：必须在 spawn 之前判定
    if (req.signal?.aborted) {
      resolve('cancelled')
      return
    }
    // token 非法：与其让脚本以 exit 4 烧掉一整次投递开销，不如投递前 fail-closed。
    // 绝不静默换随机 GUID——那会让后续定向清理找不到目标。空串等价于缺省。
    if (req.requestToken && !TOKEN_PATTERN.test(req.requestToken)) {
      console.warn(`[dsh-approval-center] requestToken 非法（须为 1-64 位 hex），本次审批按投递故障处理`)
      resolve('unavailable')
      return
    }

    // 结算必须幂等：abort / watchdog / error / exit 四条路径会互相竞争
    let settled = false
    const settle = (outcome: DialogOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    // token 定向清理：abort/cancel/watchdog 走 child.kill()，PowerShell 的 finally
    // 不保证执行（实测：强杀时 .pending 与通知必然残留）。按 token 清理本人资源，
    // 幂等可重复；无 token（手动兼容路径）时没有可定向的 tag，只能靠脚本自身 finally
    // 与通知 ExpirationTime 兜底。
    const cleanupSelf = () => {
      if (req.requestToken) cleanupRequest(req.requestToken, deps)
    }

    // ── R6 §1 唯一规则：成对/类型/空白**预检**（在任何 spawn 之前）────────────
    // | 输入                                   | 行为 |
    // | 两字段都未提供（undefined）             | legacy 兼容 |
    // | 两字段显式提供且非空白字符串             | 结构化 title/decision/context |
    // | 只提供一项                              | unavailable，禁止 legacy/投递 |
    // | 显式空串/空白/null/非字符串/缺配对       | unavailable，禁止 legacy/投递 |
    //
    // R5 的实现只检查 `!== undefined`，缺一时两项全省略 → 静默落 legacy。
    // 那是契约防御缺口：调用方以为结构化布局生效，实际横幅仍是会丢行的旧布局。
    // **只告警而继续投递不算按渠道不可用处理**（R6 派发 §13）。
    // `undefined` 按"未提供"处理（可选字段的 JS 语义）；**任何已定义值**（含 null、
    // 空串、纯空白、非字符串）都进入成对预检，非法即 `unavailable`、**零 spawn**。
    const providedDecision = req.decisionSummary !== undefined
    const providedContext = req.contextSummary !== undefined
    let structuredArgs: readonly string[] = []
    if (providedDecision || providedContext) {
      const invalid =
        !providedDecision || !providedContext ||
        typeof req.decisionSummary !== 'string' || typeof req.contextSummary !== 'string' ||
        req.decisionSummary.trim() === '' || req.contextSummary.trim() === ''
      if (invalid) {
        console.warn(
          '[dsh-approval-center] 结构化字段非法（必须成对提供且为非空白字符串）；' +
          '本次审批按渠道不可用处理，不投递（R6 §1 唯一规则）',
        )
        settle('unavailable')
        return
      }
      // 类型收窄在此处已成立：预检保证两字段都是非空字符串
      structuredArgs = [
        '-DecisionSummary', req.decisionSummary as string,
        '-ContextSummary', req.contextSummary as string,
      ]
    }

    let child: ReturnType<NonNullable<DialogDeps['spawn']>>
    try {
      child = spawnImpl('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', join(SCRIPTS_DIR, APPROVAL_TOAST_SCRIPT),
        '-Title', req.title,
        '-Message', req.message,
        '-TimeoutSec', String(req.timeoutSec),
        '-TimeoutAction', req.timeoutAction ?? 'reject',
        ...(req.requestToken ? ['-RequestToken', req.requestToken] : []),
        // R5 §3/R6 §1：结构化字段**独立传参**，脚本据此构造 title→decision→context 三个 <text>。
        // 预检已保证：要么两项都未提供（legacy 兼容），要么两项都是非空白字符串（结构化）。
        ...structuredArgs,
      ], { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      // 受限环境下 spawn 可能同步抛出：不能让它逃出去，否则
      // processOne 会在 store.settle 之前 reject，审计行永远停在 pending
      console.warn(`[dsh-approval-center] 审批通知启动失败: ${String(error)}`)
      settle('unavailable')
      return
    }

    let watchdog: unknown
    const onAbort = () => {
      if (settled) return
      if (watchdog !== undefined) clearTimerImpl(watchdog)
      child.kill()
      settle('cancelled')
      cleanupSelf()
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    // cancel() 句柄：宿主/队列在关闭路径上的主动终止入口（契约 §4.3）。
    // 已结算时 no-op，保证幂等。
    requestCancel = () => {
      if (settled) return
      if (watchdog !== undefined) clearTimerImpl(watchdog)
      child.kill()
      settle('cancelled')
      cleanupSelf()
    }

    // 看门狗：脚本自身的 -TimeoutSec 管不到"进程卡住不退出"。超时不再多等，
    // 强杀并按基础设施故障 fail-closed，避免 promise 永不 settle。
    watchdog = setTimerImpl(() => {
      req.signal?.removeEventListener('abort', onAbort)
      // 无论是否已结算都要强杀：杀掉卡死的子进程本身就是必要的副作用。
      // 但已结算时（例如 abort 已 resolve 'cancelled'）不再告警——那条
      // "超过 Ns 未退出" 的文案在那种情境下会误导排查者。
      child.kill()
      if (!settled) {
        console.warn(`[dsh-approval-center] 审批通知进程超过 ${req.timeoutSec}s 未退出，已强制终止`)
      }
      settle('unavailable')
      // 强杀路径 finally 不执行：按 token 清残留（无 token 时靠 ExpirationTime 兜底）
      cleanupSelf()
    }, req.timeoutSec * 1000 + 15_000)

    child.on('error', (error: Error) => {
      // 缺 powershell.exe / 被安全软件拦截会走这里：静默 fail-closed 排查时毫无线索
      req.signal?.removeEventListener('abort', onAbort)
      clearTimerImpl(watchdog)
      console.warn(`[dsh-approval-center] 审批通知进程启动失败: ${String(error)}`)
      settle('unavailable')
      // 进程从未启动：没有通知也没有状态文件，无需清理
    })
    child.on('exit', (code: number | null) => {
      req.signal?.removeEventListener('abort', onAbort)
      clearTimerImpl(watchdog)
      settle(mapExitCode(code))
      // 正常退出：脚本 finally 已自清理，无需（也不应）再跑一次清理进程
    })
  })

  return { promise, cancel: () => requestCancel() }
}

/**
 * 按 token 定向清理一次审批在 Windows 侧的残留（T0 契约 §4.3）：通知用
 * 3 参 History.Remove（tag 不存在时静默返回），状态文件与私有 StateDir 映射
 * 由脚本按映射反查清理。幂等、可重复；绝不调用 History.Clear、绝不触碰
 * 其他审批的资源。fire-and-forget：失败只告警——残留通知仍有 ExpirationTime
 * 兜底，绝不能反过来影响已定的审批结果。
 */
export function cleanupRequest(token: string, deps: DialogDeps = {}): void {
  if (!TOKEN_PATTERN.test(token)) {
    console.warn('[dsh-approval-center] cleanupRequest: 非法 token（须为 1-64 位 hex），已跳过')
    return
  }
  const spawnImpl = deps.spawn ?? spawn
  let child: ReturnType<NonNullable<DialogDeps['spawn']>>
  try {
    child = spawnImpl('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', join(SCRIPTS_DIR, APPROVAL_TOAST_SCRIPT),
      '-CleanupToken', token,
    ], { windowsHide: true, stdio: 'ignore' })
  } catch (error) {
    console.warn(`[dsh-approval-center] 定向清理启动失败: ${String(error)}`)
    return
  }
  child.on('error', (error: Error) => {
    console.warn(`[dsh-approval-center] 定向清理进程未能启动: ${String(error)}`)
  })
  child.on('exit', (code: number | null) => {
    if (code !== 0) console.warn(`[dsh-approval-center] 定向清理 exit=${String(code)}（残留通知由 ExpirationTime 兜底）`)
  })
}

/** 发送一条 WinRT 通知（仅用于审批结果/子代理提醒，fire-and-forget，但失败要可见）。 */
export function showToast(title: string, message: string): void {
  let child: ChildProcess
  try {
    child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-File', join(SCRIPTS_DIR, RESULT_TOAST_SCRIPT),
      '-Title', title,
      '-Message', message,
    ], { windowsHide: true, stdio: 'ignore' })
  } catch (error) {
    // spawn 同步抛出：不能让它逃进 subagent/end 这类 emit 监听器
    console.warn(`[dsh-approval-center] toast 通知启动失败: ${String(error)}`)
    return
  }
  child.on('error', (error) => {
    console.warn(`[dsh-approval-center] toast 通知未能启动: ${String(error)}`)
  })
  // 非零退出必须可见：修复前只有 spawn 失败会被吞，脚本自身 exit 1 时毫无线索
  child.on('exit', (code) => {
    if (code !== 0) console.warn(`[dsh-approval-center] toast.ps1 exit=${code}（通知可能未送达）`)
  })
}

// ---------------------------------------------------------------------------
// T0 契约 §4.1 / §4.3 / §4.4：任务通知 sender（C 独占）
//
// 语义边界（§4.4，逐字执行，不得放宽）：
//   'submitted' **仅**表示 WinRT `Show()` 未抛异常。它**不**表示用户看到/听到通知，
//   也**不**表示系统已呈现横幅。任何日志与文档都不得把 submitted 写成"用户已看到"。
//   'failed'  = 参数非法 / 启动失败 / 非零退出 / watchdog 超时
//   'aborted' = 调用方 signal 中止（B 的 NotificationService 在 close() 时 abort 在飞发送）
// ---------------------------------------------------------------------------

/** 冻结的消息结构（T0 契约 §4.1）。字段由 B 归一化/截断后传入，sender 不再改写正文。 */
export interface NotificationMessage {
  /** 去重键；主通知 = `${sessionId}:${turn}`。sender 只用它算 Tag。 */
  readonly key: string
  readonly source: 'turn'
  readonly sessionId: string
  readonly title: string
  readonly message: string
  /** true = 静音（`<audio silent="true"/>`）；false = 系统默认提示音 */
  readonly silent: boolean
}

/** 冻结的三值结果（T0 契约 §4.1）。'submitted' ≠ 用户已看到。 */
export type SendResult = 'submitted' | 'failed' | 'aborted'

/** 冻结的 sender 接口（T0 契约 §4.1）。`signal` **必填**（CR-C-1 裁决）。 */
export interface NotificationSender {
  send(message: NotificationMessage, signal: AbortSignal): Promise<SendResult>
}

/** Tag 白名单：sha256(key) 前 16 位小写 hex（T0 契约 §3.3）。 */
export const TASK_TAG_PATTERN = /^[0-9a-f]{16}$/
/** Group 固定字面量，与审批 `dsh-approval` / 旧结果 `dsh-result` 隔离（§3.3）。 */
export const TASK_GROUP = 'dsh-task'
/** 单次发送的进程 watchdog（§3.3「进程 watchdog 10 秒」）。 */
export const TASK_SEND_TIMEOUT_MS = 10_000
/** stdout/stderr 各自的受限收集上限（§4.4「受限收集诊断」）。 */
export const TASK_DIAG_LIMIT_BYTES = 4096

/**
 * Tag = `sha256(key)` 的前 16 个十六进制小写字符（T0 契约 §3.3）。
 * 纯函数、确定性：同一 key 永远映射到同一 Tag，从而让 Windows 侧的同 tag/group
 * 替换成为去重缓存之外的第二层保障。
 */
export function taskNotificationTag(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex').slice(0, 16)
}

/**
 * 任务通知 sender 的可注入边界（沿用 `DialogDeps` 的 mock 风格）。
 * 生产路径不传 deps：走真实 `spawn` 与 `setTimeout`。
 *
 * 与 `DialogDeps` 的差异只有一处——stdio 必须是管道（要受限收集诊断），
 * 所以 child 上多要求 `stdout`/`stderr` 可读流。mock 只需提供 on/kill/stdout/stderr。
 */
export interface TaskSenderDeps {
  spawn?: (
    file: string,
    args: readonly string[],
    options: { windowsHide: boolean; stdio: 'pipe' },
  ) => {
    stdout?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null
    stderr?: { on(event: 'data', listener: (chunk: unknown) => void): unknown } | null
    on(event: 'error', listener: (error: Error) => void): unknown
    on(event: 'exit', listener: (code: number | null) => void): unknown
    kill(): unknown
  }
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/** 受限诊断缓冲：只保留前 N 字节，丢弃其余（绝不无界累积）。 */
interface BoundedBuffer {
  readonly chunks: Buffer[]
  size: number
  truncated: boolean
}

function appendBounded(buf: BoundedBuffer, chunk: unknown, limit: number): void {
  let bytes: Buffer
  if (Buffer.isBuffer(chunk)) bytes = chunk
  else if (typeof chunk === 'string') bytes = Buffer.from(chunk, 'utf8')
  else if (chunk instanceof Uint8Array) bytes = Buffer.from(chunk)
  else return
  const room = limit - buf.size
  if (room <= 0) {
    buf.truncated = true
    return
  }
  if (bytes.length > room) {
    buf.chunks.push(bytes.subarray(0, room))
    buf.size = limit
    buf.truncated = true
    return
  }
  buf.chunks.push(bytes)
  buf.size += bytes.length
}

/**
 * 有界摘要：单行、去控制字符、长度封顶。
 *
 * 为什么必须清洗：诊断文本最终进 `console.warn`，而子进程的 stdout 里可能回显
 * 我们自己的参数（脚本诊断行会带 tag/group，绝不带正文）。控制字符与超长文本
 * 会污染日志、甚至伪造日志行。
 */
function boundedSummary(buf: BoundedBuffer): string {
  if (buf.size === 0) return ''
  const text = Buffer.concat(buf.chunks, buf.size).toString('utf8')
  // eslint-disable-next-line no-control-regex
  const flat = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim()
  const suffix = buf.truncated ? '…[truncated]' : ''
  const max = 512
  const clipped = flat.length > max ? `${flat.slice(0, max)}…` : flat
  if (!clipped && !suffix) return '(non-text output)'
  return `${clipped}${suffix}`
}

/**
 * 构造一条任务通知的 sender（T0 契约 §4.3）。
 *
 * 实现要点：
 * 1. **参数数组**启动隐藏的 `powershell.exe`（5.1）：`-File toast.ps1 -Title … -Message …`。
 *    绝不拼 Shell 命令字符串、绝不用 `Invoke-Expression`——正文里出现 `&`/`"`/换行时
 *    拼接会产生命令注入面。
 * 2. **双端校验**：Tag/Group 在 Node 侧于 spawn **之前**校验（§4.4）。非法即 `'failed'`
 *    且**不拉起任何进程**——绝不静默替换成随机 Tag（那会让 Windows 侧的同 tag 替换去重失效）。
 * 3. **幂等结算**：`exit` / `error` / caller-abort / watchdog 四路竞争，只结算一次，先到先得。
 * 4. **watchdog 10 秒**：卡死的子进程一律 `kill()` 并按 `'failed'` 结算，promise 永不悬挂。
 * 5. `spawn` 同步抛出（受限沙箱 EPERM）必须捕获，绝不让它逃进宿主的 emit 监听器。
 */
export function createTaskNotificationSender(deps: TaskSenderDeps = {}): NotificationSender {
  const spawnImpl = deps.spawn ?? (spawn as unknown as NonNullable<TaskSenderDeps['spawn']>)
  const setTimerImpl = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimerImpl = deps.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  return {
    send(message: NotificationMessage, signal: AbortSignal): Promise<SendResult> {
      return new Promise<SendResult>((resolve) => {
        // 结算必须幂等：四条路径互相竞争（§4.1）。
        let settled = false
        const settle = (result: SendResult) => {
          if (settled) return
          settled = true
          resolve(result)
        }

        // key 的类型守卫必须在 taskNotificationTag() **之前**（R4C-D2）。
        // 顺序反了的话，非字符串 key 会让 createHash.update() 抛
        // TypeError [ERR_INVALID_ARG_TYPE]，该异常**逃出**本 promise（reject）而不是
        // 结算成 'failed' —— 调用方拿到的是 rejection，违背 send() 的契约（只 resolve 三值）。
        // 经正常接线不可达（B 的 observe() 已守卫 sessionId，key 恒为 `${sessionId}:${turn}`），
        // 但这是契约健壮性缺陷，必须按 fail-closed 结算。
        if (typeof message.key !== 'string' || message.key.length === 0) {
          console.warn('[dsh-approval-center] 任务通知 key 非法（须为非空字符串），本次发送按失败处理')
          settle('failed')
          return
        }

        const tag = taskNotificationTag(message.key)
        // Node 侧白名单校验（spawn 之前，§4.4「双端校验」）。Tag 由纯函数产出，
        // 这里守的是"实现没被改坏 + key 是可用字符串"；非法即 fail-closed，
        // 绝不静默换随机 Tag——那会让 Windows 侧的同 tag 替换去重失效。
        if (!TASK_TAG_PATTERN.test(tag)) {
          console.warn('[dsh-approval-center] 任务通知 Tag 非法（须为 16 位小写 hex），本次发送按失败处理')
          settle('failed')
          return
        }
        // Group 是固定字面量：这里显式断言，保证"与审批 dsh-approval 隔离"这条不变量
        // 在 spawn 之前就被检查，而不是靠脚本兜底。
        if (TASK_GROUP !== 'dsh-task') {
          console.warn('[dsh-approval-center] 任务通知 Group 非法（须为 dsh-task），本次发送按失败处理')
          settle('failed')
          return
        }
        // silent 只允许布尔；非布尔（B 侧类型被绕过）fail-closed，不猜测用户意图。
        if (typeof message.silent !== 'boolean') {
          console.warn('[dsh-approval-center] 任务通知 silent 字段非布尔，本次发送按失败处理')
          settle('failed')
          return
        }
        const sound = message.silent ? 'silent' : 'default'

        // 已中止的发送不该再拉起进程：与 showApprovalToast 同一处理（§4.1 响应 abort）。
        if (signal.aborted) {
          settle('aborted')
          return
        }

        let child: ReturnType<NonNullable<TaskSenderDeps['spawn']>>
        try {
          child = spawnImpl('powershell.exe', [
            '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
            '-File', join(SCRIPTS_DIR, RESULT_TOAST_SCRIPT),
            '-Title', message.title,
            '-Message', message.message,
            '-Tag', tag,
            '-Group', TASK_GROUP,
            '-Sound', sound,
          ], { windowsHide: true, stdio: 'pipe' })
        } catch (error) {
          // 受限沙箱里 spawn 同步抛 EPERM：捕获后 fail-closed，绝不让异常逃出去。
          console.warn(`[dsh-approval-center] 任务通知启动失败（spawn 同步抛出）: ${String(error)}`)
          settle('failed')
          return
        }

        const out: BoundedBuffer = { chunks: [], size: 0, truncated: false }
        const err: BoundedBuffer = { chunks: [], size: 0, truncated: false }
        // 管道必须被消费：不读的话子进程写满管道缓冲后会阻塞在 Write-Output 上，
        // 直到 watchdog 强杀——那会把"成功发送"误报成超时失败。
        child.stdout?.on('data', (chunk: unknown) => appendBounded(out, chunk, TASK_DIAG_LIMIT_BYTES))
        child.stderr?.on('data', (chunk: unknown) => appendBounded(err, chunk, TASK_DIAG_LIMIT_BYTES))

        let watchdog: unknown
        const disarm = () => {
          if (watchdog !== undefined) clearTimerImpl(watchdog)
          watchdog = undefined
          signal.removeEventListener('abort', onAbort)
        }

        const onAbort = () => {
          if (settled) return
          disarm()
          child.kill()
          settle('aborted')
        }
        signal.addEventListener('abort', onAbort, { once: true })

        // watchdog：脚本自身管不到"进程卡住不退出"。超时强杀并 fail-closed，
        // 保证 promise 一定结算（第一版不自动重试——WinRT 可能已接收，重试会重复响铃）。
        watchdog = setTimerImpl(() => {
          if (settled) return
          disarm()
          console.warn(`[dsh-approval-center] 任务通知进程超过 ${TASK_SEND_TIMEOUT_MS / 1000}s 未退出（watchdog 超时），已强制终止`)
          child.kill()
          settle('failed')
        }, TASK_SEND_TIMEOUT_MS)

        child.on('error', (error: Error) => {
          // 缺 powershell.exe / 被安全软件拦截：与"非零退出"区分开，否则排查时毫无线索。
          if (settled) return
          disarm()
          console.warn(`[dsh-approval-center] 任务通知进程启动失败（error 事件）: ${String(error)}`)
          settle('failed')
        })

        child.on('exit', (code: number | null) => {
          if (settled) return
          disarm()
          if (code === 0) {
            // 只记"已提交"，绝不写"用户已看到"（§4.4 / §5.4 验收铁律）。
            settle('submitted')
            return
          }
          // 区分三种失败：1=参数非法（调用方 bug）2=投递失败 其它/无退出码=未预期。
          const why = code === 1 ? '参数非法' : code === 2 ? '投递失败' : '未预期退出'
          const detail = [boundedSummary(err), boundedSummary(out)].filter(Boolean).join(' | ')
          console.warn(
            `[dsh-approval-center] 任务通知投递未成功（exit=${String(code)}，${why}，tag=${tag}）` +
            (detail ? `: ${detail}` : ''),
          )
          settle('failed')
        })
      })
    },
  }
}
