import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
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
/** 审批结果通知脚本（仅当显式开启通知时才需要）。 */
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
      ], { windowsHide: true, stdio: 'ignore' })
    } catch (error) {
      // 受限环境下 spawn 可能同步抛出：不能让它逃出去，否则
      // processOne 会在 store.settle 之前 reject，审计行永远停在 pending
      console.warn(`[dsh-approval-center] 审批通知启动失败: ${String(error)}`)
      settle('unavailable')
      return
    }

    const onAbort = () => {
      child.kill()
      settle('cancelled')
      cleanupSelf()
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    // cancel() 句柄：宿主/队列在关闭路径上的主动终止入口（契约 §4.3）。
    // 已结算时 no-op，保证幂等。
    requestCancel = () => {
      if (settled) return
      child.kill()
      settle('cancelled')
      cleanupSelf()
    }

    // 看门狗：脚本自身的 -TimeoutSec 管不到"进程卡住不退出"。超时不再多等，
    // 强杀并按基础设施故障 fail-closed，避免 promise 永不 settle。
    const watchdog = setTimerImpl(() => {
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
