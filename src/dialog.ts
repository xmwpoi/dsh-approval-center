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

export function assertScriptsUsable(files: readonly string[]): void {
  const paths = files.map((file) => join(SCRIPTS_DIR, file))

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
}

export interface DialogHandle {
  promise: Promise<DialogOutcome>
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
export function showApprovalToast(req: DialogRequest): DialogHandle {
  const promise = new Promise<DialogOutcome>((resolve) => {
    // 已中止的请求不该再拉起进程：必须在 spawn 之前判定
    if (req.signal?.aborted) {
      resolve('cancelled')
      return
    }

    // 结算必须幂等：abort / watchdog / error / exit 四条路径会互相竞争
    let settled = false
    const settle = (outcome: DialogOutcome) => {
      if (settled) return
      settled = true
      resolve(outcome)
    }

    let child: ChildProcess
    try {
      child = spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', join(SCRIPTS_DIR, APPROVAL_TOAST_SCRIPT),
        '-Title', req.title,
        '-Message', req.message,
        '-TimeoutSec', String(req.timeoutSec),
        '-TimeoutAction', req.timeoutAction ?? 'reject',
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
    }
    req.signal?.addEventListener('abort', onAbort, { once: true })

    // 看门狗：脚本自身的 -TimeoutSec 管不到"进程卡住不退出"。超时不再多等，
    // 强杀并按基础设施故障 fail-closed，避免 promise 永不 settle。
    const watchdog = setTimeout(() => {
      req.signal?.removeEventListener('abort', onAbort)
      // 无论是否已结算都要强杀：杀掉卡死的子进程本身就是必要的副作用。
      // 但已结算时（例如 abort 已 resolve 'cancelled'）不再告警——那条
      // "超过 Ns 未退出" 的文案在那种情境下会误导排查者。
      child.kill()
      if (!settled) {
        console.warn(`[dsh-approval-center] 审批通知进程超过 ${req.timeoutSec}s 未退出，已强制终止`)
      }
      settle('unavailable')
    }, req.timeoutSec * 1000 + 15_000)

    child.on('error', (error) => {
      // 缺 powershell.exe / 被安全软件拦截会走这里：静默 fail-closed 排查时毫无线索
      req.signal?.removeEventListener('abort', onAbort)
      clearTimeout(watchdog)
      console.warn(`[dsh-approval-center] 审批通知进程启动失败: ${String(error)}`)
      settle('unavailable')
    })
    child.on('exit', (code) => {
      req.signal?.removeEventListener('abort', onAbort)
      clearTimeout(watchdog)
      settle(mapExitCode(code))
    })
  })

  return { promise }
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
