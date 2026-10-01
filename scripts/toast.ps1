# dsh-approval-center 任务通知 Toast（无交互，fire-and-forget）
#
# 退出码契约（与审批 approval-toast.ps1 的 0/1/2/3/4 语义**不同**，见 T0 契约 §4.4）：
#   0 = WinRT Show() 未抛异常。这只代表"已提交"，**绝不代表"用户已看到/听到"**。
#   1 = 参数非法（Tag/Group/Sound/Title 校验失败）——调用方 bug，必须可见。
#   2 = 投递失败（WinRT 类型加载 / AUMID 注册 / Show() 抛异常）。
#   其它/无退出码 = 未预期，由调用方按 fail-closed 处理。
#
# 本文件必须保存为「UTF-8 with BOM」：Windows PowerShell 5.1 读无 BOM 的 .ps1 时按
# ANSI（本机 CP936）解码，含中文的源码会直接语法错误并以 exit 1 退出。
# 挂载期 assertScriptsUsable 会按字节校验这一点。
#
# 兼容性：旧 showToast 结果回执只传 -Title/-Message（不传 Tag/Group/Sound）。
# 因此三个新参数**缺省时必须完全复刻旧行为**：随机 Tag + Group 'dsh-result' + 不写
# <audio>（系统默认音）。缺省值不是"任务通知默认值"——任务路径永远显式传参。
param(
    [string]$Title = '',
    [string]$Message = '',
    # 任务通知 Tag：sha256(key) 前 16 位小写 hex（^[0-9a-f]{16}$）。
    # 缺省 = 随机 GUID（旧 showToast 结果回执兼容路径）。
    [string]$Tag = '',
    # 任务通知 Group 固定 'dsh-task'，与审批 'dsh-approval'、旧结果 'dsh-result' 隔离
    # （T0 契约 §3.3）。缺省 = 'dsh-result'：保持旧结果回执的隔离不变量不被破坏。
    [string]$Group = '',
    # 任务通知声音：silent=<audio silent="true"/>；default=系统默认提示音。
    # 缺省 = 不写 <audio>（旧行为，不擅自改变结果回执的声音）。
    [ValidateSet('', 'silent', 'default')]
    [string]$Sound = ''
)

$ErrorActionPreference = 'Stop'

function Write-Diag([string]$Text) {
    # 诊断单行、截断到 512 字符、换行归一。绝不输出 -Title/-Message 正文、绝对路径或凭据。
    $t = ($Text -replace '\s+', ' ').Trim()
    if ($t.Length -gt 512) { $t = $t.Substring(0, 512) }
    Write-Output $t
}

# ── 参数白名单校验（"双端校验"的脚本侧；失败 exit 1，绝不静默改成别的值）──────────
# ⚠ 必须用**区分大小写**的 `-cnotmatch` / `-cne`：PowerShell 的 `-notmatch` / `-ne` 默认
#   大小写不敏感，而 Node 侧白名单是 /^[0-9a-f]{16}$/（只收小写）与字面量 'dsh-task'。
#   实测：'AABBCCDDEEFF0011' 在 `-notmatch` 下**通过**，却被 Node 侧拒绝 ⇒ "双端校验"
#   在大小写维度失效，大写 Tag 会真的投递出去（R4C-D1，已复现）。
if ([string]::IsNullOrEmpty($Title)) {
    Write-Diag 'TOAST FAILED: -Title is required'
    exit 1
}
if ($Tag -cne '' -and $Tag -cnotmatch '^[0-9a-f]{16}$') {
    Write-Diag 'TOAST FAILED: -Tag must match ^[0-9a-f]{16}$'
    exit 1
}
if ($Group -cne '' -and $Group -cne 'dsh-task') {
    Write-Diag 'TOAST FAILED: -Group must be dsh-task'
    exit 1
}

try {
    # 自有 AppUserModelID。未注册的 AUMID 会让 CreateToastNotifier 抛
    # 0x80073D54 "The process has no package identity"，故先在 HKCU 注册（无需管理员）。
    $appId = 'Dev.DSH.ApprovalCenter'
    $aumidKey = "HKCU:\SOFTWARE\Classes\AppUserModelId\$appId"
    if (-not (Test-Path $aumidKey)) {
        New-Item -Path $aumidKey -Force | Out-Null
        New-ItemProperty -Path $aumidKey -Name 'DisplayName' -Value 'DSH 审批中控台' -PropertyType String -Force | Out-Null
    }

    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

    function Escape-Xml([string]$s) {
        return $s.Replace('&', '&amp;').Replace('<', '&lt;').Replace('>', '&gt;').Replace('"', '&quot;')
    }

    $effectiveTag = if ($Tag -ne '') { $Tag } else { [guid]::NewGuid().ToString('N') }
    $effectiveGroup = if ($Group -ne '') { $Group } else { 'dsh-result' }

    # <audio> 是 <toast> 的直接子元素，位于 <visual> 之后（toastschema/element-audio）。
    $audioBlock = switch ($Sound) {
        'silent'  { "`n  <audio silent=`"true`"/>" }
        'default' { "`n  <audio src=`"ms-winsoundevent:Notification.Default`"/>" }
        default   { '' }
    }

    $xmlString = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$(Escape-Xml $Title)</text>
      <text>$(Escape-Xml $Message)</text>
    </binding>
  </visual>$audioBlock
</toast>
"@

    $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
    $xml.LoadXml($xmlString)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    # Tag + Group 让这条通知可被单独寻址，且三个 Group 互不串扰：
    #   dsh-approval = 审批请求（结算后由 approval-toast.ps1 自行移除）
    #   dsh-result   = 旧结果回执（有意留在操作中心，供事后查看）
    #   dsh-task     = 主对话完成/错误通知（本轮新增）
    # 教训（实测）：不带 Tag/Group 的通知无法被单独移除——History.Remove(tag, appId)
    # 的双参重载对 Group 为空的通知抛 0x80070490，try/catch 又会静默吞掉，通知就一直堆积。
    # 可用的做法是三参重载 Remove(tag, group, appId)，或按组 RemoveGroup(group, appId)。
    $toast.Tag = $effectiveTag
    $toast.Group = $effectiveGroup
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)

    $soundLabel = if ($Sound -ne '') { $Sound } else { 'legacy' }
    Write-Diag ("TOAST SUBMITTED tag={0} group={1} sound={2}" -f $effectiveTag, $effectiveGroup, $soundLabel)
    exit 0
} catch {
    # 只记异常类型与 HRESULT，便于分类（如 0x80073D54 = 无包标识）；
    # 不记 Exception.Message——XML 解析类错误的消息可能夹带正文片段。
    $hr = ''
    $hresult = $_.Exception.HResult
    if ($hresult -ne 0) { $hr = ' hr=0x{0:X8}' -f $hresult }
    Write-Diag ("TOAST FAILED: {0}{1}" -f $_.Exception.GetType().Name, $hr)
    exit 2
}
