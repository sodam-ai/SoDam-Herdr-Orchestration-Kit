# uninstall.ps1 - Herdr 오케스트레이션 제거. install.ps1 이 남긴 설치 기록(install-manifest.json)에 적힌 파일만 하나씩 지웁니다.
#
#   무엇을 지울지 보기만:  powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -Check
#   제거(번들만):          powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1
#   데이터까지:            ... -File uninstall.ps1 -RemoveData
#
# - 폴더를 통째로 지우지 않습니다. 설치 기록에 적힌 파일을 하나씩 지우고, 비어 버린 폴더만 치웁니다.
# - 설정·기록(config, state, logs)은 -RemoveData 없이는 남깁니다.
# - -RemoveData 도 설치 기록에 없는 파일(사용자가 만든 것, 프로그램이 쓴 기록)은 지우지 않고 목록만 알려 줍니다.
param(
    [string]$InstallDir = '',   # 기록에 적힌 설치 위치와 다르면 중단합니다(생략 가능)
    [string]$OrchHome = '',     # 기본: 환경변수 ORCH_HOME, 없으면 %LOCALAPPDATA%\Herdr-Orchestration
    [switch]$RemoveData,
    [switch]$Check              # 지우지 않고 목록만
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
function Say([string]$m) { Write-Host $m }

if (-not $OrchHome) { $OrchHome = $env:ORCH_HOME }
if (-not $OrchHome) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Local' }
    $OrchHome = Join-Path $base 'Herdr-Orchestration'
}
$OrchHome = [IO.Path]::GetFullPath($OrchHome)
$ManifestPath = Join-Path $OrchHome 'install-manifest.json'
if (-not (Test-Path -LiteralPath $ManifestPath)) { Say ("설치 기록이 없습니다: " + $ManifestPath + " (아무것도 지우지 않았습니다)"); exit 1 }
$mf = [IO.File]::ReadAllText($ManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
$Inst = [IO.Path]::GetFullPath("$($mf.installDir)").TrimEnd('\')
if ($InstallDir -and ([IO.Path]::GetFullPath($InstallDir).TrimEnd('\') -ine $Inst)) { Say ("-InstallDir 이 기록의 설치 위치와 다릅니다: " + $Inst + " (아무것도 지우지 않았습니다)"); exit 1 }
$Home0 = $OrchHome.TrimEnd('\')

# 기록에 적힌 상대 경로를 기준 폴더 안의 전체 경로로. 기준 밖이면 $null (기록이 손상됐거나 조작된 경우 방어)
function Resolve-Inside([string]$baseDir, [string]$rel) {
    if ($rel -eq '' -or [IO.Path]::IsPathRooted($rel) -or (($rel -split '[\\/]') -contains '..')) { return $null }
    $full = [IO.Path]::GetFullPath((Join-Path $baseDir ($rel -replace '/', '\')))
    if (-not $full.StartsWith($baseDir + '\', [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $full
}
function Get-Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
$dirsTouched = @{}
# 기록된 파일을 하나씩 지운다. 지운 파일 수·바뀌어 있던 파일 수·이미 없던 파일 수를 센다.
function Remove-Listed($list, [string]$baseDir) {
    $r = [ordered]@{ removed = 0; modified = 0; absent = 0; skipped = 0 }
    foreach ($f in $list) {
        $full = Resolve-Inside $baseDir "$($f.path)"
        if (-not $full) { $r.skipped++; Say ("  건너뜀(기준 폴더 밖 경로): " + $f.path); continue }
        if (-not (Test-Path -LiteralPath $full -PathType Leaf)) { $r.absent++; continue }
        if ($Check) { Say ("  지울 파일: " + $f.path); continue }
        if ((Get-Sha $full) -ne "$($f.sha256)") { $r.modified++ }
        try {
            [IO.File]::Delete($full); $r.removed++
            $d = Split-Path -Parent $full
            while ($d.Length -gt $baseDir.Length) { $dirsTouched[$d] = $true; $d = Split-Path -Parent $d }
        } catch { Say ("  경고: 지우지 못함: " + $f.path + " (" + $_.Exception.Message + ")") }
    }
    $dirsTouched[$baseDir] = $true
    return $r
}
# 비어 버린 폴더만 치운다 (비어 있지 않으면 Delete 가 실패하므로 건드리지 않음. 재귀 삭제 아님)
function Remove-EmptyDirs([string]$baseDir) {
    $dirs = @($dirsTouched.Keys | Where-Object { $_.StartsWith($baseDir, [StringComparison]::OrdinalIgnoreCase) } | Sort-Object { $_.Length } -Descending)
    foreach ($d in $dirs) {
        if ((Test-Path -LiteralPath $d -PathType Container) -and ([IO.Directory]::GetFileSystemEntries($d).Count -eq 0)) { try { [IO.Directory]::Delete($d, $false) } catch {} }
    }
}
function Show-Remaining([string]$dir, [string]$title) {
    if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return }
    $left = @(Get-ChildItem -LiteralPath $dir -Recurse -File -ErrorAction SilentlyContinue)
    if ($left.Count -eq 0) { return }
    Say ($title + " (" + $left.Count + "개, 지우지 않았습니다):")
    foreach ($f in $left) { Say ("    " + $f.FullName) }
}

Say ('== Herdr 오케스트레이션 제거' + $(if ($Check) { ' (점검만, 지우지 않음)' } else { '' }) + ' ==')
$files = @(); if ($mf.files) { $files = @($mf.files) }
$data = @(); if ($mf.dataFiles) { $data = @($mf.dataFiles) }

# 1) 번들 파일
$r = Remove-Listed $files $Inst
if ($Check) { Say ("  기록된 번들 파일 {0}개 (이미 없는 파일 {1}개)" -f $files.Count, $r.absent) }
else {
    Remove-EmptyDirs $Inst
    Say ("  번들 파일 {0}개 지움 (이미 없던 것 {1}, 내용이 바뀌어 있던 것 {2}, 건너뜀 {3})" -f $r.removed, $r.absent, $r.modified, $r.skipped)
    Show-Remaining $Inst '  설치 폴더에 남은 파일(설치 기록에 없음, 사용자가 만든 것)'
}

# 2) 데이터
if ($RemoveData) {
    $dirsTouched.Clear()
    $r2 = Remove-Listed $data $Home0
    if ($Check) { Say ("  기록된 데이터 파일 {0}개" -f $data.Count) }
    else {
        Say ("  데이터 파일 {0}개 지움 (설치가 만든 설정 파일만)" -f $r2.removed)
        $dirsTouched[(Join-Path $Home0 'config\roles')] = $true; $dirsTouched[(Join-Path $Home0 'config')] = $true; $dirsTouched[(Join-Path $Home0 'state')] = $true; $dirsTouched[(Join-Path $Home0 'logs')] = $true
        Remove-EmptyDirs $Home0
        # 설치 기록은 마지막에 지운다 (남은 파일이 있어도 기록 파일 자체는 더 쓸 데가 없다)
        if (Test-Path -LiteralPath $ManifestPath) { [IO.File]::Delete($ManifestPath) }
        $dirsTouched[$Home0] = $true; Remove-EmptyDirs $Home0
        Show-Remaining $Home0 '  데이터 폴더에 남은 파일(설치 기록에 없음: 사용자가 만들었거나 프로그램이 쓴 것)'
    }
} else {
    if (-not $Check) {
        # 번들 목록만 비운 기록을 남겨, 나중에 -RemoveData 로 데이터를 정리할 수 있게 한다
        $mf.files = @()
        $mf | Add-Member -NotePropertyName uninstalledAt -NotePropertyValue (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss') -Force
        [IO.File]::WriteAllBytes($ManifestPath, (New-Object Text.UTF8Encoding($false)).GetBytes((ConvertTo-Json -InputObject $mf -Depth 5) + "`r`n"))
    }
    Say ("  데이터(config, state, logs)는 그대로 둡니다: " + $OrchHome + "  (모두 정리하려면 -RemoveData)")
}
if ($mf.docsDir) { Say ("  문서 폴더는 지우지 않습니다(내 문서): " + $mf.docsDir) }
Say '끝났습니다.'
