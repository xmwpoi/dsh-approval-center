# dsh-approval-center Toast 通知（仅任务完成提醒，无交互）
param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Message
)

$ErrorActionPreference = 'Stop'

# 自有 AppUserModelID。未注册的 AUMID 会让 CreateToastNotifier 抛
# 0x80073D54 "The process has no package identity"（Win11 25H2 实测，
# 连 PowerShell 自带的 AUMID 也未必已注册），故先在 HKCU 注册（无需管理员）。
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

$xmlString = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>$(Escape-Xml $Title)</text>
      <text>$(Escape-Xml $Message)</text>
    </binding>
  </visual>
</toast>
"@

$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml($xmlString)
$toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
# Tag + Group 让这条回执可被单独寻址，并与审批通知分属不同组：
#   Group 'dsh-approval' = 审批请求（结算后由 approval-toast.ps1 自行移除）
#   Group 'dsh-result'   = 结果回执（有意留在操作中心，供事后查看）
# 教训（实测）：不带 Tag/Group 的通知**无法被单独移除**——
#   History.Remove(tag, appId) 的双参重载对 Group 为空的通知会抛
#   0x80070490 (Element not found)，而 try/catch 会把这个失败静默吞掉，
#   于是通知一直堆积。可用的做法是三参重载 Remove(tag, group, appId)，
#   或按组 RemoveGroup(group, appId)，全清用 Clear(appId)。
$toast.Tag = [guid]::NewGuid().ToString('N')
$toast.Group = 'dsh-result'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
