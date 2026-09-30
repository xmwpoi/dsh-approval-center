param([string]$Uri = '')
# dsh-approval-center URI handler -- PowerShell FALLBACK.
#
# Invoked by Windows when the user clicks a toast button whose activationType is "protocol",
# but ONLY on machines where the primary VBS handler cannot run (VBScript is an on-demand
# feature from Windows 11 24H2 and may be uninstalled). approval-toast.ps1 probes that
# capability and registers whichever variant actually works.
# Cost of this fallback: powershell.exe is console-subsystem (WINDOWS_CUI), so the user sees a
# ~0.4-0.5s console flash when clicking. Functionality wins over polish on that path.
# URI form: dshapproval:<approve|reject>/<id>
# It only writes the decision into the state file the waiting toast script polls.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less files as ANSI.
try {
    $body = $Uri -replace '^[^:]*:', ''
    $parts = $body -split '/', 2
    $decision = $parts[0].Trim().ToLowerInvariant()
    $id = ''
    if ($parts.Count -gt 1) { $id = $parts[1].Trim() }

    if ($id -match '^[0-9a-fA-F]{1,64}$' -and ($decision -eq 'approve' -or $decision -eq 'reject')) {
        $defaultDir = Join-Path $env:LOCALAPPDATA 'dsh-approval-center'
        # The toast script may have been started with a private -StateDir, which we cannot know
        # from the URI alone: it leaves <default-state-dir>\<id>.dir holding the real state
        # directory. Honour it; fall back to the default directory when absent/unusable.
        # Only a rooted path is accepted so a stray mapping can never redirect the write.
        $target = $defaultDir
        $map = Join-Path $defaultDir ($id + '.dir')
        if (Test-Path $map) {
            $mapped = ('' + [System.IO.File]::ReadAllText($map, [System.Text.Encoding]::Unicode)).Trim()
            if ($mapped -and ($mapped -match '^[A-Za-z]:[\\/]' -or $mapped.StartsWith('\\'))) { $target = $mapped }
        }
        if (-not (Test-Path $target)) { New-Item -ItemType Directory -Path $target -Force | Out-Null }
        $file = Join-Path $target ($id + '.result')
        $payload = $decision + "`n" + (Get-Date -Format o) + "`n"
        [System.IO.File]::WriteAllText($file, $payload, (New-Object System.Text.UTF8Encoding($false)))
    }
} catch {
    # A failed handler must never block the approval pipeline; the waiter will time out.
}
exit 0
