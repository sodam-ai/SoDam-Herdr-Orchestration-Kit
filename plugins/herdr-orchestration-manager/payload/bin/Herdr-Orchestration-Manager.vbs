' Herdr-Orchestration-Manager.vbs - double-click launcher for the management window (no console window).
' It runs orch-manager.ps1 from the same folder, so it works from any install location.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & dir & "\orch-manager.ps1""", 0, False
