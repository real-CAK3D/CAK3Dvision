' Runs cak3dvision.ps1 with no console window. Usage: wscript cak3dvision-hidden.vbs Start|Stop
Dim action, dir
action = "Start"
If WScript.Arguments.Count > 0 Then action = WScript.Arguments(0)
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\cak3dvision.ps1"" -Action " & action, 0, False
