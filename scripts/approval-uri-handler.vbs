' dsh-approval-center URI handler (primary implementation).
'
' Invoked by Windows when the user clicks a toast button whose activationType is
' "protocol". URI form: dshapproval:<approve|reject>/<id>
'
' It only writes the decision into the state file the waiting toast script polls.
'
' WHY VBS + wscript.exe AND NOT PowerShell:
'   powershell.exe is a CONSOLE-subsystem image (PE Subsystem = 3 = WINDOWS_CUI), so when
'   explorer activates the URI Windows allocates a console; the black window is visible for
'   ~0.4-0.5s until "-WindowStyle Hidden" takes effect (the user saw it and screenshotted it).
'   wscript.exe is a GUI-subsystem image (Subsystem = 2 = WINDOWS_GUI), so no console is ever
'   created and nothing can flash. cscript.exe is CUI as well and must NOT be used.
'   Doing the file write here also removes 300-500ms of PowerShell startup latency.
'
' This file is deliberately ASCII-ONLY: wscript reads a .vbs as ANSI unless it carries a
' UTF-16 BOM, so any non-ASCII byte here would be mangled. Do not add CJK text.
'
' There is a PowerShell fallback (approval-uri-handler.ps1) for machines where VBScript is
' unavailable (it is an on-demand feature from Windows 11 24H2). approval-toast.ps1 picks
' between the two with a real capability probe and registers the winner.
'
' NOTE: wscript.exe is GUI-subsystem, so its exit code is not meaningful and the toast script
' never looks at it -- only the written .result file matters. Never use WScript.Echo here:
' under wscript in a non-interactive context it tries to raise a modal box and fails.
Option Explicit

Dim uri, body, p, decision, id, ok, i, ch, target
Dim fso, sh, base, mapPath, outFile, stream, raw, debugOn, logPath, logLine

Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
base = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\dsh-approval-center"
target = ""

uri = ""
If WScript.Arguments.Count > 0 Then uri = WScript.Arguments(0)

' strip the scheme prefix ("dshapproval:")
p = InStr(uri, ":")
If p > 0 Then body = Mid(uri, p + 1) Else body = uri

' "approve/<id>" -> decision + id (the id never contains "/")
decision = ""
id = ""
p = InStr(body, "/")
If p > 0 Then
  decision = LCase(Trim(Left(body, p - 1)))
  id = Trim(Mid(body, p + 1))
End If

' Strict validation: only approve/reject and a 1-64 char hex id. This is also what keeps the
' URI from injecting a path separator or ".." into the file name below.
ok = False
If decision = "approve" Or decision = "reject" Then
  If Len(id) >= 1 And Len(id) <= 64 Then
    ok = True
    For i = 1 To Len(id)
      ch = LCase(Mid(id, i, 1))
      If InStr("0123456789abcdef", ch) = 0 Then
        ok = False
        Exit For
      End If
    Next
  End If
End If

If ok Then
  ' A private -StateDir is invisible to us: we only get the id. The toast script therefore
  ' leaves <default-state-dir>\<id>.dir containing the real state directory; honour it and
  ' fall back to the default directory when it is missing or unusable.
  target = base
  mapPath = fso.BuildPath(base, id & ".dir")
  raw = ""
  If fso.FileExists(mapPath) Then
    On Error Resume Next
    Set stream = fso.OpenTextFile(mapPath, 1, False, -1)
    If Err.Number = 0 Then raw = stream.ReadAll
    If Err.Number = 0 Then stream.Close
    Err.Clear
    On Error GoTo 0
    ' Unicode streams may expose the UTF-16 LE BOM as a leading character.
    ' Trim does not remove it, so strip it before validating the rooted path.
    If Len(raw) > 0 Then
      If Left(raw, 1) = ChrW(&HFEFF) Then raw = Mid(raw, 2)
    End If
    raw = Trim(raw)
    ' only accept a rooted path: an empty or relative mapping must never redirect the write
    If Len(raw) > 1 Then
      If Mid(raw, 2, 1) = ":" Or Left(raw, 2) = "\\" Then target = raw
    End If
  End If

  On Error Resume Next
  If Not fso.FolderExists(target) Then fso.CreateFolder(target)
  If Err.Number <> 0 Then
    ' mapped directory unusable -> fall back to the default directory instead of losing the
    ' click entirely (can only happen if the waiter removed the mapping directory first)
    Err.Clear
    target = base
    If Not fso.FolderExists(target) Then fso.CreateFolder(target)
    Err.Clear
  End If
  Set outFile = fso.CreateTextFile(fso.BuildPath(target, id & ".result"), True)
  ' same payload shape as the PowerShell handler: "<decision>\n<ISO timestamp>\n"
  outFile.Write decision & vbLf & IsoStamp(Now) & vbLf
  outFile.Close
  Err.Clear
  On Error GoTo 0
End If

' Opt-in diagnostics: //B suppresses every dialog and error, so a silent failure would
' otherwise be indistinguishable from success. Never Echo; append to a log file instead.
debugOn = sh.ExpandEnvironmentStrings("%DSH_APPROVAL_DEBUG%")
If debugOn = "1" Then
  On Error Resume Next
  logPath = sh.ExpandEnvironmentStrings("%DSH_APPROVAL_DEBUG_LOG%")
  If logPath = "%DSH_APPROVAL_DEBUG_LOG%" Or Len(logPath) = 0 Then
    logPath = base & "\approval-uri-handler.debug.log"
  End If
  logLine = IsoStamp(Now) & " uri=""" & uri & """ decision=""" & decision & """ id=""" & id & """ accepted=" & CStr(ok) & " target=""" & target & """"
  Set stream = fso.OpenTextFile(logPath, 8, True)
  stream.WriteLine logLine
  stream.Close
  Err.Clear
  On Error GoTo 0
End If

WScript.Quit 0

' Local ISO-8601-ish timestamp (same information as PowerShell's -Format o, to the second).
Function IsoStamp(d)
  IsoStamp = Year(d) & "-" & Pad2(Month(d)) & "-" & Pad2(Day(d)) & "T" & Pad2(Hour(d)) & ":" & Pad2(Minute(d)) & ":" & Pad2(Second(d))
End Function

Function Pad2(n)
  If n < 10 Then Pad2 = "0" & CStr(n) Else Pad2 = CStr(n)
End Function
