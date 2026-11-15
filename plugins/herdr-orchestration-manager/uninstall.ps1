# uninstall.ps1 - Herdr 오케스트레이션 관리(플러그인) 제거 도우미.
#
#   무엇을 지울지 보기만:  powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1 -Check
#   제거:                  powershell -NoProfile -ExecutionPolicy Bypass -File uninstall.ps1
#
# 하는 일: (1) 허더 모드 제거(우리가 넣은 파일과 keys.json 한 줄만), (2) 번들 제거(설치 기록에 적힌 파일만 하나씩).
# 내 설정·내 역할·백업(config, state, logs)은 남깁니다. 데이터까지 지우려면 번들 제거기에 -RemoveData 를 직접 쓰세요(이 스크립트는 쓰지 않음).
param(
    [switch]$Check,
    [string]$InstallDir = '',
    [string]$OrchHome = '',
    [string]$HerdrHome = '',
    [string]$Key = 'ctrl-shift-m',
    [switch]$NoKey
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $Here 'payload'
function Say([string]$m) { Write-Host $m }
if (-not $OrchHome) { $OrchHome = $env:ORCH_HOME }
if (-not $OrchHome) { $OrchHome = Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }) 'Herdr-Orchestration' }
$OrchHome = [IO.Path]::GetFullPath($OrchHome)
if (-not $InstallDir) { $InstallDir = Join-Path $OrchHome 'app' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$PS = (Get-Process -Id $PID).Path

Say '== 1/2 허더 모드 제거 =='
$modScript = Join-Path $InstallDir 'bin\install-herdr-mod.ps1'
if (-not (Test-Path -LiteralPath $modScript)) { $modScript = Join-Path $Payload 'bin\install-herdr-mod.ps1' }
$b = @('-Key', $Key, '-ToolPath', (Join-Path $InstallDir 'bin\manage.mjs')); if ($NoKey) { $b += '-NoKey' }; if ($HerdrHome) { $b += @('-HerdrHome', $HerdrHome) }
if ($Check) {
    $mods = if ($HerdrHome) { $HerdrHome } elseif ($env:HERDR_APP_HOME) { $env:HERDR_APP_HOME } else { Join-Path $env:USERPROFILE '.config\herdr-app' }
    $dest = Join-Path $mods 'mods\orch-manager'
    Say ('모드 폴더: ' + $dest + $(if (Test-Path -LiteralPath $dest) { ' (있음 - 제거하면 우리 파일만 지움)' } else { ' (없음)' }))
} else {
    & $PS -NoProfile -ExecutionPolicy Bypass -File $modScript @($b + '-Uninstall')
}

Say ''
Say '== 2/2 번들 제거 =='
$u = Join-Path $Payload 'bin\uninstall.ps1'                      # 지워질 설치 폴더 밖의 사본을 쓴다(실행 중인 스크립트가 자기 자신을 지우지 않게)
if (-not (Test-Path -LiteralPath $u)) { $u = Join-Path $InstallDir 'bin\uninstall.ps1' }
$a = @('-OrchHome', $OrchHome); if ($Check) { $a += '-Check' }
& $PS -NoProfile -ExecutionPolicy Bypass -File $u @a
exit $LASTEXITCODE
