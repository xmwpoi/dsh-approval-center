# dsh-approval-center 审批通知（Windows 通知中心，带「批准 / 拒绝」按钮）
# 退出码: 0=批准  1=拒绝  2=超时(无人应答)  3=结果异常  4=基础设施故障(未成功投递)
#
# 为什么走 protocol 激活而不是 WinRT 事件：
#   未打包的 Win32 应用收不到 ToastNotification.Activated —— 实测 add_Activated /
#   add_Dismissed 订阅成功（EventRegistrationToken 正常返回），但事件永不触发。
#   因此按钮改用 activationType="protocol"，由 Windows 唤起已注册的 URI 处理器
#   (scripts/approval-uri-handler.vbs，PowerShell 版留作回落) 把决定写进状态文件，
#   本脚本轮询该文件。
#
# 为什么 scenario="reminder"：
#   普通 toast 约 5-10 秒就离开屏幕，SnoreToast/node-notifier 的结果管道随之关闭，
#   之后在操作中心再点按钮也没有回传通道 —— 这是审批无法走通知中心的根因。
#   reminder 让通知停留到用户处理为止，审批窗口因此不受系统通知时长限制。
#
# 为什么必须给通知设 Group（'dsh-approval'）：
#   实测 History.Remove(tag, appId) 这个 2 参重载，对 Group 为空的通知一律抛
#   0x80070490 "Element not found"（3 参显式传空 Group 则抛 ArgumentException）。
#   旧版既没设 Group 又用 2 参重载，于是清扫和"结算后清除"全部静默失败，通知只增
#   不减（实测 16 -> 17 -> 18 -> 19）。设组 + 3 参重载才真正删得掉。详见下方清扫段落。
#
# 为什么 URI 处理器用 wscript.exe + VBS 而不是 powershell.exe：
#   powershell.exe 是控制台子系统（PE Subsystem=3 = WINDOWS_CUI），explorer 激活 URI 时
#   Windows 会先分配一个控制台窗口，-WindowStyle Hidden 生效前的 ~0.4-0.5s 里用户能看到
#   黑框一闪（用户截图确认）。wscript.exe 是 GUI 子系统（Subsystem=2 = WINDOWS_GUI），
#   根本不创建控制台；而且 VBS 自己就能写文件，省掉 300-500ms 的 PowerShell 启动。
#   cscript.exe 同为 CUI，不能用。
param(
    # 一律带默认值：Mandatory 缺参时 PowerShell 会以 exit 1 退出，
    # 而 exit 1 在本插件语义里是"用户点了拒绝"。
    [string]$Title = '审批请求',
    [string]$Message = '',
    [int]$TimeoutSec = 30,
    # 仅用于文案提示：实际裁决由调用方按退出码 2 + 自身配置执行
    [ValidateSet('reject', 'approve')][string]$TimeoutAction = 'reject',
    [string]$StateDir = '',
    # 维护入口（Task 3）：清空本 AUMID 在操作中心的全部通知，含无法按 tag 删除的
    # 历史遗留（Group 为空）条目。正常审批绝不传这个开关 —— src/dialog.ts 只传
    # -Title/-Message/-TimeoutSec/-TimeoutAction。风险见下面 $ClearAllNotifications 分支。
    [switch]$ClearAllNotifications,
    # 只与 -ClearAllNotifications 搭配：存在存活审批（<id>.pending）时也强制执行。
    [switch]$Force,
    # 审批内部 token（T0 契约 §4.3）：由 Node 生成并传入，用作通知 tag 与状态文件名，
    # 使取消/强杀后的定向清理（-CleanupToken）成为可能。缺省走旧随机 GUID 路径
    # （手动脚本兼容）。须为 1-64 位 hex；非法直接 exit 4，绝不静默换 GUID——
    # 那会让后续定向清理找不到目标。
    [string]$RequestToken = '',
    # 维护入口：按 token 定向清理一次审批的残留（通知按 tag 3 参 Remove、
    # .pending/.result/.dir 状态文件按映射反查）。幂等可重复；绝不 History.Clear。
    # 与 -ClearAllNotifications 的区别：那条是"按应用全清"（会伤及存活审批），这条只动自己。
    [string]$CleanupToken = ''
)

$ErrorActionPreference = 'Stop'
$scheme = 'dshapproval'
$appId = 'Dev.DSH.ApprovalCenter'
# 操作中心分组名。本脚本只清扫自己这个组，绝不碰别的组：
#   dsh-approval = 本脚本的审批通知（唯一清扫目标）
#   dsh-result   = 审批结果回执，属 scripts/toast.ps1（别的 agent 负责），不清扫
#   空 Group     = 旧版遗留通知，Remove 删不掉（见文件头），只能靠 -ClearAllNotifications
$group = 'dsh-approval'
$script:exitCode = 4

$defaultStateDir = Join-Path $env:LOCALAPPDATA 'dsh-approval-center'
if ([string]::IsNullOrWhiteSpace($StateDir)) {
    $StateDir = $defaultStateDir
}
$handlerPs1 = Join-Path $PSScriptRoot 'approval-uri-handler.ps1'
$handlerVbs = Join-Path $PSScriptRoot 'approval-uri-handler.vbs'

# 诊断开关：设 DSH_APPROVAL_DEBUG=1 后，异常与清扫细节追加到
# <StateDir>\approval-toast.debug.log（可用 DSH_APPROVAL_DEBUG_LOG 覆盖路径）。
# 默认关闭：审批在关键路径上，不产生任何多余 IO。就是为了让这类"被 catch 吞掉的
# 失败"下次不必靠猜 —— 旧版正是被 try { } catch { } 静默吞了 0x80070490。
function Write-DebugLog([string]$text) {
    if ($env:DSH_APPROVAL_DEBUG -ne '1') { return }
    try {
        $logPath = $env:DSH_APPROVAL_DEBUG_LOG
        if ([string]::IsNullOrWhiteSpace($logPath)) { $logPath = Join-Path $StateDir 'approval-toast.debug.log' }
        $line = (Get-Date -Format o) + ' [pid ' + $PID + '] ' + $text + [Environment]::NewLine
        [System.IO.File]::AppendAllText($logPath, $line, (New-Object System.Text.UTF8Encoding($false)))
    } catch { }
}

# 取最内层异常的类型名与消息，供日志使用
function Format-Exception($err) {
    $x = $err.Exception
    while ($x.InnerException) { $x = $x.InnerException }
    return ($x.GetType().Name + ': ' + $x.Message)
}

# 映射文件（<默认目录>\<id>.dir）里存的必须是绝对路径，否则忽略：
# 处理器的写入目标只应该由本脚本给出，绝不能让相对路径把结果写歪。
function Test-AbsolutePath([string]$p) {
    return ($p -match '^[A-Za-z]:[\\/]' -or $p.StartsWith('\\'))
}

# URI 处理器只拿到 <id>，所以"存活标记去哪里找"要靠映射文件反查：
# 并发审批可能用了私有 -StateDir，它的 .pending 在私有目录里，映射文件在默认目录里。
# 清扫必须按映射去正确的地方找，否则会把别人的存活通知误判成遗留而删掉。
function Get-MarkerDir([string]$tag) {
    try {
        $map = Join-Path $defaultStateDir ($tag + '.dir')
        if (Test-Path $map) {
            $mapped = ('' + (Get-Content $map -Raw -ErrorAction SilentlyContinue)).Trim()
            if ($mapped -and (Test-AbsolutePath $mapped)) { return $mapped }
        }
    } catch { }
    return $StateDir
}

# 某条通知是否属于"存活审批"（决定清扫能不能删它）：
#   * 没有 <tag>.pending              -> 不是（遗留通知，可清扫）
#   * 标记内容是可解析的 PID          -> 该 PID 仍在运行才算存活
#   * 标记存在但内容为空/不可解析      -> 算存活（旧格式，宁可不删）
# 为什么不是简单的"文件在就算存活"：插件看门狗会 child.kill() 强杀本脚本，进程被强杀时
# finally 不执行，.pending 必然残留；只看文件存在的话，每被强杀一次就永久多一条清扫不掉的
# 通知 —— 正是本任务要消灭的现象。写入自己的 PID 后，只有"主人已死"的标记才被当作遗留。
function Test-LiveApproval([string]$tag) {
    $marker = Join-Path (Get-MarkerDir $tag) ($tag + '.pending')
    if (-not (Test-Path $marker)) { return $false }
    $raw = ''
    try { $raw = ('' + (Get-Content $marker -Raw -ErrorAction SilentlyContinue)).Trim() } catch { return $true }
    $owner = 0
    if (-not [int]::TryParse($raw, [ref]$owner)) { return $true }
    return ($null -ne (Get-Process -Id $owner -ErrorAction SilentlyContinue))
}

# URI 处理器是否真的能用 wscript + VBScript。
# Test-Path 只能证明 wscript.exe 在，证明不了 VBScript 引擎还在（Win11 24H2 起 VBScript
# 是按需功能，可能已被卸载），所以做一次真正的烟囱测试：跑一个只写标记文件的临时脚本，
# 看标记是否出现。只在需要决定/升级注册值时调用，不在每次审批的快路径上。
function Test-VbsHandlerAvailable {
    if (-not (Test-Path $handlerVbs)) { return $false }
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    if (-not (Test-Path $wscript)) { return $false }
    $probeBase = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-vbs-probe-' + [guid]::NewGuid().ToString('N'))
    $probeVbs = $probeBase + '.vbs'
    $probeOut = $probeBase + '.txt'
    try {
        # 保持 ASCII：脚本正文里不能出现非 ASCII 字节（wscript 按 ANSI 读 .vbs）
        $probeBody = "Dim fso, ts`r`nSet fso = CreateObject(""Scripting.FileSystemObject"")`r`nSet ts = fso.CreateTextFile(""" + $probeOut + """, True)`r`nts.Write ""ok""`r`nts.Close`r`n"
        [System.IO.File]::WriteAllText($probeVbs, $probeBody, (New-Object System.Text.ASCIIEncoding))
        $p = Start-Process -FilePath $wscript -ArgumentList @('//B', '//Nologo', ('"' + $probeVbs + '"')) -Wait -PassThru -WindowStyle Hidden
        foreach ($i in 1..10) {
            if (Test-Path $probeOut) { return $true }
            Start-Sleep -Milliseconds 100
        }
        return $false
    } catch {
        return $false
    } finally {
        Remove-Item $probeVbs -Force -ErrorAction SilentlyContinue
        Remove-Item $probeOut -Force -ErrorAction SilentlyContinue
    }
}

# ---------------------------------------------------------------------------
# 维护入口：-ClearAllNotifications
#
# History.Clear($appId) 是"按应用全清"，Windows 无法区分存活与遗留，也删不掉单条
# Group 为空的遗留通知。所以这是唯一能收拾历史遗留的路径，也因此**只在手动调用时执行**。
#
# 风险（务必保留）：若此刻有审批在跑（其 <id>.pending 存活标记仍存在），它的通知会被
# 一并抹掉 —— 用户再也看不到可点的按钮，那次审批只能走到超时。这是 fail-closed（不会
# 误批准），但会白等一整个超时窗口。所以默认在有 .pending 时拒绝，需 -Force 覆盖。
#
# 本路径不触碰 .pending / .result 状态文件，退出码也不属于审批契约
# （成功 0 / 拒绝执行或失败 4）。
# ---------------------------------------------------------------------------
if ($ClearAllNotifications) {
    try {
        # 私有 -StateDir 的存活标记在私有目录、映射文件在默认目录，两处都要看
        $live = @()
        foreach ($d in @($StateDir, $defaultStateDir) | Select-Object -Unique) {
            if (Test-Path $d) {
                $live += @(Get-ChildItem -Path $d -Filter '*.pending' -File -ErrorAction SilentlyContinue)
            }
        }
        if ($live.Count -gt 0 -and -not $Force) {
            Write-Output ("REFUSED: {0} live approval(s) in flight ({1}); re-run with -ClearAllNotifications -Force to override" -f `
                $live.Count, (($live | ForEach-Object { $_.Name }) -join ', '))
            $script:exitCode = 4
        } else {
            [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
            $before = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)).Count
            [Windows.UI.Notifications.ToastNotificationManager]::History.Clear($appId)
            $after = @([Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)).Count
            Write-Output ("CLEARED appId='{0}': history {1} -> {2}" -f $appId, $before, $after)
            $script:exitCode = 0
        }
    } catch {
        Write-Output ('CLEAR FAILED: ' + (Format-Exception $_))
        $script:exitCode = 4
    }
    exit $script:exitCode
}

# ---------------------------------------------------------------------------
# 维护入口：-CleanupToken <token>
#
# 按 token 定向清理（T0 契约 §4.3）：强杀/取消路径上 PowerShell 的 finally 不保证
# 执行，残留的 .pending 与 reminder 通知由此回收。只动这个 token 自己的资源：
#   * 通知：3 参 History.Remove(tag, group, appId)——tag 不存在时静默返回（见文件头
#     实测表），所以"本来就没有残留"也是成功；绝不 History.Clear、不碰其他组/其他审批。
#   * 状态文件：.pending/.result 按映射反查（私有 -StateDir 的标记在私有目录），
#     默认目录与映射目录两处都清；.dir 映射本身也删。
# 幂等：重复调用、目标不存在一律 exit 0。token 格式非法 exit 4（调用方 bug，要可见）。
# 退出码不属于审批契约（0=清理完成/无残留，4=清理失败）。
# ---------------------------------------------------------------------------
if ($CleanupToken) {
    if ($CleanupToken -notmatch '^[0-9a-fA-F]{1,64}$') {
        Write-Output ('CLEANUP FAILED: invalid token format (expected 1-64 hex chars)')
        exit 4
    }
    try {
        $markerDir = Get-MarkerDir $CleanupToken
        foreach ($d in @($markerDir, $defaultStateDir) | Select-Object -Unique) {
            Remove-Item (Join-Path $d ($CleanupToken + '.pending')) -Force -ErrorAction SilentlyContinue
            Remove-Item (Join-Path $d ($CleanupToken + '.result')) -Force -ErrorAction SilentlyContinue
        }
        Remove-Item (Join-Path $defaultStateDir ($CleanupToken + '.dir')) -Force -ErrorAction SilentlyContinue
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($CleanupToken, $group, $appId)
        Write-Output ('CLEANED token=' + $CleanupToken)
        exit 0
    } catch {
        Write-Output ('CLEANUP FAILED: ' + (Format-Exception $_))
        exit 4
    }
}

function Register-UriScheme {
    $root = "HKCU:\Software\Classes\$scheme"
    $cmdKey = "$root\shell\open\command"
    $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
    # 首选：GUI 子系统的 wscript.exe + VBS（不会闪控制台，且比 PowerShell 快 ~400ms）
    $cmdVbs = '"' + $wscript + '" //B //Nologo "' + $handlerVbs + '" "%1"'
    # 回落：VBScript 不可用（按需功能被卸载）时仍然能工作的 PowerShell 处理器。
    # 它必然还会闪一下控制台 —— 功能优先于观感，且这条路径只在 VBS 不可用时启用。
    $cmdPs1 = '"' + $psExe + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $handlerPs1 + '" "%1"'

    $current = $null
    try { $current = (Get-ItemProperty -Path $cmdKey -Name '(default)' -ErrorAction Stop).'(default)' } catch { }

    # 快路径：注册值已经是 VBS 变体 -> 直接返回，连烟囱测试都不做
    # （每次审批都在关键路径上，烟囱测试要起一次 wscript）
    if ($current -eq $cmdVbs -and (Test-Path $handlerVbs) -and (Test-Path $wscript)) { return }

    if (Test-VbsHandlerAvailable) { $cmd = $cmdVbs; $variant = 'vbs' } else { $cmd = $cmdPs1; $variant = 'powershell-fallback' }
    if ($current -eq $cmd) { return }
    New-Item -Path $root -Force | Out-Null
    New-ItemProperty -Path $root -Name '(default)' -Value 'URL:DSH approval' -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $root -Name 'URL Protocol' -Value '' -PropertyType String -Force | Out-Null
    New-Item -Path $cmdKey -Force | Out-Null
    New-ItemProperty -Path $cmdKey -Name '(default)' -Value $cmd -PropertyType String -Force | Out-Null
    Write-DebugLog ('uri handler registered: variant=' + $variant + ' cmd=' + $cmd)
}

function Ensure-AppId {
    $key = "HKCU:\SOFTWARE\Classes\AppUserModelId\$appId"
    if (-not (Test-Path $key)) {
        New-Item -Path $key -Force | Out-Null
        New-ItemProperty -Path $key -Name 'DisplayName' -Value 'DSH 审批中控台' -PropertyType String -Force | Out-Null
    }
}

function Escape-Xml([string]$s) {
    return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
}

$resultFile = $null
$pendingFile = $null
$mappingFile = $null
try {
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

    # 这两步是幂等的"首次注册"：并发审批会同时执行，注册表写入冲突**不能让整次审批失败**
    # （实测 4 并发时曾有 1 个以 exit 4 直接失败）。冲突就重试几次，仍失败也只降级为
    # "点击可能无法回调"——那时审批会以超时 fail-closed，而不是报投递故障。
    foreach ($attempt in 1..3) {
        try { Register-UriScheme; break } catch { Start-Sleep -Milliseconds 150 }
    }
    try { Ensure-AppId } catch { }

    # T0 契约 §4.3：Node 传入 -RequestToken 时以它作通知 tag 与状态文件名，
    # 定向清理（-CleanupToken）据此找到目标。格式非法直接 exit 4（fail-closed），
    # 绝不静默换随机 GUID——那会让清理永远找不到这条审批的残留。
    if ($RequestToken) {
        if ($RequestToken -notmatch '^[0-9a-fA-F]{1,64}$') {
            Write-DebugLog ('invalid RequestToken format: ' + $RequestToken)
            exit 4
        }
        $id = $RequestToken
    } else {
        $id = [guid]::NewGuid().ToString('N')
    }
    $resultFile = Join-Path $StateDir ($id + '.result')
    $pendingFile = Join-Path $StateDir ($id + '.pending')
    Remove-Item $resultFile -Force -ErrorAction SilentlyContinue
    # 存活标记：本次审批在跑期间存在。下面的清扫靠它区分"当前审批"与"遗留通知"。
    # 内容写自己的 PID：进程被强杀（插件看门狗 child.kill()）时标记会残留，清扫据此判断
    # "标记的主人还在不在"——只有主人确实已死才敢删那条通知；空/无法解析的旧格式标记一律
    # 按"存活"保守处理。
    New-Item -ItemType File -Path $pendingFile -Force | Out-Null
    try { [System.IO.File]::WriteAllText($pendingFile, "$PID`n", (New-Object System.Text.UTF8Encoding($false))) } catch { }

    # -StateDir 映射：URI 处理器只拿到 <id>，无从得知调用方把状态目录换到了哪里。
    # 所以私有目录时在默认目录留一份 <id>.dir（内容=真实目录），处理器优先读它，
    # 把 .result 写进真实目录；映射必须在 Show 之前写好，否则点击可能赶在它前面。
    # 用默认目录时无需映射（处理器自己会回落到默认目录），也就不付这份额外 IO。
    #
    # 编码必须 ANSI（Encoding.Default）：VBS 处理器的 OpenTextFile 与 PS 5.1 的
    # Get-Content 都默认按 ANSI 读无 BOM 文件。旧版用 UTF-8 写，中文路径在处理器侧
    # 变乱码 → 回落默认目录 → 等待方永远收不到结果 → 审批超时（T6 实测，ISSUE-1）。
    # ANSI 写对纯 ASCII 路径字节不变，无回归风险；含当前代码页无法表示的字符的
    # 路径仍会写成替代符——那类路径本就无法用 ANSI 协议传输，属已知限制。
    if ($StateDir -ne $defaultStateDir) {
        New-Item -ItemType Directory -Path $defaultStateDir -Force | Out-Null
        $mappingFile = Join-Path $defaultStateDir ($id + '.dir')
        [System.IO.File]::WriteAllText($mappingFile, $StateDir, [System.Text.Encoding]::Default)
    }

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    # 清扫遗留通知：操作中心里属于本组、但没有对应存活审批的那些，和当前审批长得一模一样，
    # 用户极可能点到过期的那条（实测：反复测试后堆了 16 条，并导致一次真实的「批准」落在
    # 过期通知上，当次审批被误判成超时）。
    #
    # 实测的 Remove 语义（Win11 26100 / PS 5.1，见 scratch/probe-overloads.ps1 原始输出）：
    #   History.Remove(tag, appId)          -> 抛 0x80070490 Element not found（2 参重载只认
    #                                          空 Group，我们设了 Group，永远找不到）
    #   History.Remove(tag, '', appId)      -> 抛 ArgumentException（空 Group 不允许显式传）
    #   History.Remove(tag, group, appId)   -> 命中即删；tag 不存在时静默返回（不抛）
    #   History.RemoveGroup(group, appId)   -> 删该组全部（会连存活审批一起删，故不用）
    # 因此这里用 3 参重载，且只动 $group 这一个组：
    #   * 跳过自己（tag -eq $id）
    #   * 跳过"存活"的（Test-LiveApproval：标记不存在才可删；有标记就要看主人 PID 是否还在）
    #   * 其余组（dsh-result 回执 / 空 Group 遗留）一律不碰
    #   * 任何异常只记日志，绝不让清扫影响本次审批
    try {
        foreach ($t in [Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory($appId)) {
            $tag = '' + $t.Tag
            $grp = '' + $t.Group
            if (-not $tag) { continue }
            if ($tag -eq $id) { continue }
            if ($grp -ne $group) { continue }
            if (Test-LiveApproval $tag) { continue }
            try {
                [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($tag, $grp, $appId)
                # 顺手清掉这条遗留通知的残留标记与映射（主人已死，留着只会拖慢后续清扫）
                Remove-Item (Join-Path (Get-MarkerDir $tag) ($tag + '.pending')) -Force -ErrorAction SilentlyContinue
                Remove-Item (Join-Path $defaultStateDir ($tag + '.dir')) -Force -ErrorAction SilentlyContinue
                # 只在真的删掉东西时写一行日志：稳态下永不触发，不占关键路径
                Write-DebugLog ("sweep removed stale tag='" + $tag + "' group='" + $grp + "'")
            } catch { Write-DebugLog ("sweep Remove('" + $tag + "','" + $grp + "') failed: " + (Format-Exception $_)) }
        }
    } catch { Write-DebugLog ('sweep enumeration failed: ' + (Format-Exception $_)) }

    $xmlString = @"
<toast scenario="reminder" activationType="protocol">
  <visual>
    <binding template="ToastGeneric">
      <text>$(Escape-Xml $Title)</text>
      <text>$(Escape-Xml $Message)</text>
    </binding>
  </visual>
  <actions>
    <action content="批准" arguments="$scheme`:approve/$id" activationType="protocol" />
    <action content="拒绝" arguments="$scheme`:reject/$id" activationType="protocol" />
  </actions>
</toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($xmlString)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $toast.Tag = $id
    # Group 必须设：否则 Remove 的 2 参/3 参重载都删不掉这条通知（见上面的实测表）
    $toast.Group = $group
    # 到期时间兜底：reminder 通知**不会自动消失**（这正是它能当审批用的原因），
    # 但本进程一旦被强杀——宿主重启、看门狗回收、父进程中断——正常结算路径就跑不到，
    # 屏幕上会留下一条永远挡在那里的僵尸审批（实测被中断的测试夹具留下了 3 小时）。
    # 交给 Windows 按时收走，不依赖本进程活到结算。
    try { $toast.ExpirationTime = [DateTimeOffset]::Now.AddSeconds($TimeoutSec + 30) }
    catch { Write-DebugLog ('setting ExpirationTime failed: ' + (Format-Exception $_)) }
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)

    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    $decision = ''
    while ((Get-Date) -lt $deadline) {
        if (Test-Path $resultFile) {
            $decision = (Get-Content $resultFile -Raw -ErrorAction SilentlyContinue)
            if ($decision) { break }
        }
        Start-Sleep -Milliseconds 250
    }

    # 结算后（点了按钮、超时、或结果异常）一律把这条通知从操作中心移除：
    # 残留的旧通知和新的审批长得一模一样，用户可能点到已经过期的那条。
    # 同样必须是 3 参重载 + 正确 Group —— 旧版的 2 参调用一直在抛 0x80070490 被吞掉，
    # 实测每跑一次就多留一条（17 -> 18 -> 19）。
    try { [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($id, $group, $appId) }
    catch { Write-DebugLog ('settle Remove failed: ' + (Format-Exception $_)) }

    $decision = ('' + $decision).Trim().ToLowerInvariant()
    if ($decision -like 'approve*') { $script:exitCode = 0 }
    elseif ($decision -like 'reject*') { $script:exitCode = 1 }
    elseif ($decision) { $script:exitCode = 3 }
    else { $script:exitCode = 2 }
} catch {
    Write-DebugLog ('fatal: ' + (Format-Exception $_))
    $script:exitCode = 4
} finally {
    # 状态文件清理必须与成败无关：旧版把这两行放在 try 里，一旦中途抛异常就留下
    # 孤儿 .pending，而清扫正是靠 .pending 判断"存活"，一个孤儿能让后续清扫长期失效。
    try { if ($resultFile) { Remove-Item $resultFile -Force -ErrorAction SilentlyContinue } } catch { }
    try { if ($pendingFile) { Remove-Item $pendingFile -Force -ErrorAction SilentlyContinue } } catch { }
    try { if ($mappingFile) { Remove-Item $mappingFile -Force -ErrorAction SilentlyContinue } } catch { }
}

exit $script:exitCode
