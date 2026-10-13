$ErrorActionPreference = "Stop"
$desktop = [System.Environment]::GetFolderPath([System.Environment+SpecialFolder]::Desktop)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$releaseVersion = (Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json).version
if ($releaseVersion -notmatch "^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$") { throw "Invalid release version" }
$zipName = "SoSo-Music-$releaseVersion-windows-x64.zip"
$zipSource = Join-Path $projectRoot "release\$zipName"
$exeSource = Join-Path $PSScriptRoot "..\..\release\win-unpacked\SoSo Music.exe"

Write-Host "Desktop folder: $desktop"

if (Test-Path $zipSource) {
    Copy-Item -Path $zipSource -Destination (Join-Path $desktop $zipName) -Force
    Write-Host "Copied desktop zip -> $desktop\$zipName"
}



if (Test-Path $exeSource) {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcut = $wsh.CreateShortcut((Join-Path $desktop "SoSo Music.lnk"))
    $shortcut.TargetPath = (Resolve-Path $exeSource).Path
    $shortcut.WorkingDirectory = (Split-Path (Resolve-Path $exeSource).Path -Parent)
    $shortcut.Description = "SoSo Music Desktop Player"
    $shortcut.Save()
    Write-Host "Created Desktop Shortcut -> $desktop\SoSo Music.lnk"
}

Write-Host "Done! Files on Desktop:"
Get-ChildItem $desktop | Where-Object { $_.Name -like "*SoSo*" } | Format-Table Name, Length, LastWriteTime
