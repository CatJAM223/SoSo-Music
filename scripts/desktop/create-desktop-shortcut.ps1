$WshShell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop "SoSo Music.lnk"
$exePath = Join-Path $desktop "SoSo Music\SoSo Music.exe"
$workingDir = Join-Path $desktop "SoSo Music"

$shortcut = $WshShell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $exePath
$shortcut.WorkingDirectory = $workingDir
$shortcut.IconLocation = "$exePath,0"
$shortcut.Description = "SoSo Music Player"
$shortcut.Save()

Write-Output "Shortcut created at $shortcutPath"
