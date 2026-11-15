# install.ps1 - Herdr 오케스트레이션 관리(플러그인) 설치 도우미. 관리자 권한 필요 없음.
#
#   점검만(아무것도 바꾸지 않음):  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Check
#   설치/업데이트:                 powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#
# 하는 일 (두 단계, 이 순서)
#   1) payload\bin\install.ps1  : 번들(roles, templates, schema, bin, lib, functions, herdr-mod)을 <OrchHome>\app 에 복사하고
#                                 설정 폴더(config, state, logs)를 만든다. 이미 있는 설정·내 역할은 덮어쓰지 않는다. 위험 기능은 모두 꺼진 채 등록.
#   2) 설치된 bin\install-herdr-mod.ps1 : 허더 안에서 여는 관리 창(모드)을 Herdr 설정 폴더에 넣고 키 한 줄을 연결한다.
#                                 허더 공식 검사(herdr-app check)를 통과해야만 설치하고, keys.json 은 백업 후 한 줄만 추가한다.
# 하지 않는 일: 작업 스케줄러·시작 프로그램·레지스트리·PATH 변경, 허더 앱·터미널·AI 대화 기록 수정, 어느 창에든 입력 보내기.
param(
    [switch]$Check,
    [string]$InstallDir = '',   # 번들 설치 위치 (기본 <OrchHome>\app)
    [string]$OrchHome = '',     # 설정·기록 위치 (기본: 환경변수 ORCH_HOME, 없으면 %LOCALAPPDATA%\Herdr-Orchestration)
    [string]$HerdrHome = '',    # Herdr 설정 폴더 (기본: HERDR_APP_HOME 또는 ~\.config\herdr-app)
    [string]$HerdrApp = '',     # herdr-app.exe
    [string]$Key = 'ctrl-shift-m',
    [switch]$NoKey,             # 키 연결 없이 설치(팔레트 Ctrl+Shift+P -> mod.open orch-manager 로 열기)
    [switch]$Force              # 번들 설치기의 -Force(다른 위치/비어 있지 않은 폴더 설치 허용)
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Payload = Join-Path $Here 'payload'
function Say([string]$m) { Write-Host $m }
function Stop-With([string]$m) { Write-Host ('중단: ' + $m); exit 1 }

if (-not (Test-Path -LiteralPath (Join-Path $Payload 'bin\install.ps1'))) { Stop-With "payload 가 없습니다: $Payload (플러그인 폴더가 온전한지 확인하세요)" }
if (-not $OrchHome) { $OrchHome = $env:ORCH_HOME }
if (-not $OrchHome) { $OrchHome = Join-Path $(if ($env:LOCALAPPDATA) { $env:LOCALAPPDATA } else { Join-Path $env:USERPROFILE 'AppData\Local' }) 'Herdr-Orchestration' }
$OrchHome = [IO.Path]::GetFullPath($OrchHome)
if (-not $InstallDir) { $InstallDir = Join-Path $OrchHome 'app' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)

$PS = (Get-Process -Id $PID).Path
function Invoke-Script([string]$file, [string[]]$extra) {
    # 출력은 화면으로 보내고(Out-Host), 함수의 반환값은 종료 코드 하나만 되게 한다(출력이 반환값에 섞이면 판정이 틀어진다)
    & $PS -NoProfile -ExecutionPolicy Bypass -File $file @extra | Out-Host
    return [int]$LASTEXITCODE
}

# ---------------------------------------------------------------- 점검만
if ($Check) {
    Say '== 1/2 번들 설치 점검 =='
    $a = @('-Check', '-InstallDir', $InstallDir, '-OrchHome', $OrchHome); if ($Force) { $a += '-Force' }
    $c1 = Invoke-Script (Join-Path $Payload 'bin\install.ps1') $a
    Say ''
    Say '== 2/2 허더 모드 설치 점검 =='
    $b = @('-Check', '-ToolPath', (Join-Path $Payload 'bin\manage.mjs'), '-Key', $Key)
    if ($NoKey) { $b += '-NoKey' }; if ($HerdrHome) { $b += @('-HerdrHome', $HerdrHome) }; if ($HerdrApp) { $b += @('-HerdrApp', $HerdrApp) }
    $c2 = Invoke-Script (Join-Path $Payload 'bin\install-herdr-mod.ps1') $b
    if ($c1 -ne 0 -or $c2 -ne 0) { Stop-With '점검에서 문제가 나왔습니다. 위 내용을 해결한 뒤 다시 실행하세요. (아무것도 바꾸지 않았습니다)' }
    Say ''; Say '점검 통과. (아무것도 바꾸지 않았습니다)'
    exit 0
}

# ---------------------------------------------------------------- 설치
Say '== 1/2 번들 설치 =='
$a = @('-InstallDir', $InstallDir, '-OrchHome', $OrchHome); if ($Force) { $a += '-Force' }
$c1 = Invoke-Script (Join-Path $Payload 'bin\install.ps1') $a
if ($c1 -ne 0) { Stop-With '번들 설치에 실패해 허더 모드 설치는 하지 않았습니다.' }

Say ''
Say '== 2/2 허더 모드 설치 =='
$installedTool = Join-Path $InstallDir 'bin\manage.mjs'
$installedMod = Join-Path $InstallDir 'bin\install-herdr-mod.ps1'
if (-not (Test-Path -LiteralPath $installedMod)) { Stop-With "설치된 번들에서 install-herdr-mod.ps1 을 찾지 못했습니다: $installedMod" }
$b = @('-ToolPath', $installedTool, '-Key', $Key)
if ($NoKey) { $b += '-NoKey' }; if ($HerdrHome) { $b += @('-HerdrHome', $HerdrHome) }; if ($HerdrApp) { $b += @('-HerdrApp', $HerdrApp) }
$c2 = Invoke-Script $installedMod $b
if ($c2 -ne 0) { Say ''; Say '번들은 설치되었지만 허더 모드는 설치되지 않았습니다. (위 이유를 해결한 뒤 이 스크립트를 다시 실행하면 이어서 설치됩니다)'; exit 1 }
Say ''
Say ('완료. 내 설정 위치: ' + $OrchHome)
Say ('다음: <설정 폴더>\config\orchestration.json 의 commander_name, scope_prefix, projects_root, control_dir 를 이 PC에 맞게 고치세요.')
