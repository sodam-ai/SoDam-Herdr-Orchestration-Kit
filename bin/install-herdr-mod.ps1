# install-herdr-mod.ps1 - Herdr 앱에 "orch-manager"(오케스트레이션 관리) 모드를 설치/점검/제거한다. 관리자 권한 필요 없음.
#
#   점검만(아무것도 바꾸지 않음):  powershell -NoProfile -ExecutionPolicy Bypass -File install-herdr-mod.ps1 -Check
#   설치/업데이트:                 powershell -NoProfile -ExecutionPolicy Bypass -File install-herdr-mod.ps1
#   제거:                          powershell -NoProfile -ExecutionPolicy Bypass -File install-herdr-mod.ps1 -Uninstall
#
# 하는 일
#   1) 임시 폴더에 모드 파일(main.js, model.js, mod.json)을 만들고, main.js 의 `const TOOL` 에 엔진(manage.mjs)의 절대 경로를 채워 넣는다.
#   2) 그 임시 사본을 Herdr 공식 검사(herdr-app check)로 먼저 검사한다. 통과하지 못하면 아무것도 설치하지 않고 멈춘다.
#   3) 통과하면 <Herdr 설정 폴더>\mods\orch-manager 에 복사한다(Herdr 는 저장되는 즉시 다시 읽는다).
#   4) keys.json 의 "global" 맨 앞에 키 한 줄을 추가한다(기본 ctrl-shift-m). 이미 그 키가 쓰이고 있으면 건너뛴다(팔레트로 열 수 있다).
#      백업(keys.json.bak-before-orch-manager)을 먼저 만들고, 수정 결과가 올바른 JSON 이 아니면 파일을 그대로 둔다.
# 건드리는 곳: mods\orch-manager 폴더, keys.json 한 줄. 다른 모드·layouts·settings·터미널·대화 기록은 손대지 않는다.
# 제거(-Uninstall)는 우리가 만든 파일만 지우고(폴더째 지우지 않음) 키 한 줄을 뺀다. 오케스트레이션 설정·백업은 건드리지 않는다.
param(
    [switch]$Check,
    [switch]$Uninstall,
    [string]$Key = 'ctrl-shift-m',   # 열기 단축키(허더 keys.json 형식). 기본은 Ctrl+Shift+M
    [switch]$NoKey,                   # 키 연결을 하지 않음(팔레트 Ctrl+Shift+P -> mod.open orch-manager 로만 연다)
    [string]$HerdrHome = '',          # Herdr 설정 폴더 (기본: 환경변수 HERDR_APP_HOME, 없으면 ~\.config\herdr-app)
    [string]$HerdrApp = '',           # herdr-app.exe (기본: %LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe)
    [string]$ToolPath = ''            # 엔진 manage.mjs 의 경로 (기본: 이 스크립트와 같은 폴더의 manage.mjs)
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Split-Path -Parent $Here
function Say([string]$m) { Write-Host $m }
$script:Stage = ''
function Clear-Stage {
    if ($script:Stage -and (Test-Path -LiteralPath $script:Stage)) {
        foreach ($x in @(Get-ChildItem -LiteralPath $script:Stage -File -Force -ErrorAction SilentlyContinue)) { Remove-Item -LiteralPath $x.FullName -Force -ErrorAction SilentlyContinue }
        Remove-Item -LiteralPath $script:Stage -Force -ErrorAction SilentlyContinue
    }
}
function Stop-With([string]$m) { Clear-Stage; Write-Host ('중단: ' + $m); exit 1 }

if (-not $HerdrHome) { $HerdrHome = $env:HERDR_APP_HOME }
if (-not $HerdrHome) { $HerdrHome = Join-Path $env:USERPROFILE '.config\herdr-app' }
if (-not $HerdrApp) { $HerdrApp = Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe' }
if (-not $ToolPath) { $ToolPath = Join-Path $Here 'manage.mjs' }
$ToolPath = [IO.Path]::GetFullPath($ToolPath)
$ModSrc = Join-Path $Bundle 'herdr-mod\orch-manager'
$Mods = Join-Path $HerdrHome 'mods'
$Dest = Join-Path $Mods 'orch-manager'
$KeysFile = Join-Path $HerdrHome 'keys.json'
# 모드 파일 = mod.json + 원본 폴더의 모든 .js (main.js 가 ./model.js ./ui.js ./tabs.js 를 불러온다). 허더가 자동으로 만드는 .d.ts·jsconfig.json 은 복사하지 않는다.
$ModFiles = @()
if (Test-Path -LiteralPath $ModSrc) { $ModFiles = @(Get-ChildItem -LiteralPath $ModSrc -File | Where-Object { $_.Name -eq 'mod.json' -or $_.Extension -eq '.js' } | ForEach-Object { $_.Name }) }
if ($ModFiles -notcontains 'main.js' -or $ModFiles -notcontains 'mod.json') { $ModFiles = @('main.js', 'mod.json') }   # 원본이 이상하면 아래 점검이 "원본 파일이 없음"으로 알려 준다
$ModKnown = @('main.js', 'model.js', 'ui.js', 'tabs.js', 'mod.json') + $ModFiles   # 제거할 때는 예전 버전이 설치한 파일 이름까지 지운다
$KeyOk = ($Key -match '^[a-z0-9+\-/=,.\[\]]{1,40}$')
$Binding = '"' + $Key + '": "mod.open:orch-manager"'
$BindingPattern = '[ \t]*"' + [regex]::Escape($Key) + '"\s*:\s*"mod\.open:orch-manager",?\r?\n'

function Write-Utf8NoBom([string]$path, [string]$text) {
    $tmp = "$path.tmp-om"
    [IO.File]::WriteAllBytes($tmp, (New-Object Text.UTF8Encoding($false)).GetBytes($text))
    Move-Item -LiteralPath $tmp -Destination $path -Force
}

# 이 키가 keys.json 의 어느 구역에서든 이미 쓰이고 있는지(우리 모드를 여는 줄이면 '내 것'으로 본다)
function Get-OwnKey([string]$raw) {
    $m = [regex]::Match($raw, '"([^"\\]+)"\s*:\s*"mod\.open:orch-manager"')
    if ($m.Success) { return $m.Groups[1].Value }
    return ''
}
function Get-KeyState([string]$raw) {
    if (Get-OwnKey $raw) { return 'mine' }   # 관리 창의 단축키 탭으로 키를 바꿨어도 이미 연결된 것으로 본다(옛 키를 또 연결하지 않음)
    if ($raw -match ('"' + [regex]::Escape($Key) + '"\s*:')) { return 'taken' }
    return 'free'
}

# ---------------------------------------------------------------- 점검
function Test-Prereq {
    $p = @()
    foreach ($f in $ModFiles) { if (-not (Test-Path -LiteralPath (Join-Path $ModSrc $f))) { $p += "모드 원본 파일이 없음: $ModSrc\$f" } }
    if (-not (Test-Path -LiteralPath $ToolPath)) { $p += "엔진 manage.mjs 를 찾지 못함: $ToolPath" }
    if (-not (Test-Path -LiteralPath $Mods)) { $p += "Herdr 설정 폴더(mods)를 찾지 못함: $Mods (Herdr 앱을 한 번 실행한 뒤 다시 시도하세요)" }
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { $p += 'Node.js 를 찾지 못함 (모드가 엔진을 node 로 부릅니다)' }
    if (-not (Test-Path -LiteralPath $HerdrApp)) { $p += "herdr-app.exe 를 찾지 못함: $HerdrApp (공식 검사를 할 수 없어 설치하지 않습니다)" }
    if (-not $NoKey -and -not $KeyOk) { $p += "키 이름 형식이 올바르지 않음: $Key" }
    return $p
}

if ($Check) {
    $p = Test-Prereq
    Say ('Herdr 설정 폴더: ' + $HerdrHome)
    Say ('엔진: ' + $ToolPath)
    if ((Test-Path -LiteralPath $KeysFile) -and -not $NoKey -and $KeyOk) {
        $st = Get-KeyState ([IO.File]::ReadAllText($KeysFile, [Text.Encoding]::UTF8))
        Say ('키 ' + $Key + ': ' + $(switch ($st) { 'free' { '비어 있음(연결됩니다)' } 'mine' { '이미 연결되어 있음' } default { '다른 용도로 쓰이고 있음(연결을 건너뛰고 팔레트로 엽니다)' } }))
    }
    Say ('모드 설치 위치: ' + $Dest + $(if (Test-Path -LiteralPath $Dest) { ' (이미 있음 - 설치하면 새 버전으로 바뀜)' } else { ' (아직 없음)' }))
    if ($p.Count -gt 0) { foreach ($x in $p) { Say ('문제: ' + $x) }; Say '중단: 위 문제를 먼저 해결하세요. (아무것도 바꾸지 않았습니다)'; exit 1 }
    Say '점검 통과. (아무것도 바꾸지 않았습니다)'
    exit 0
}

# ---------------------------------------------------------------- keys.json
function Set-KeyBinding([bool]$On) {
    if ($NoKey) { Say '키 연결: 건너뜀(-NoKey). 팔레트(Ctrl+Shift+P)에서 "mod.open orch-manager" 로 여세요.'; return }
    if (-not (Test-Path -LiteralPath $KeysFile)) { Say 'keys.json 이 없어 키 연결은 건너뜁니다. (팔레트: Ctrl+Shift+P -> mod.open orch-manager)'; return }
    $raw = [IO.File]::ReadAllText($KeysFile, [Text.Encoding]::UTF8)
    $nl = if ($raw.Contains("`r`n")) { "`r`n" } else { "`n" }
    if ($On) {
        $st = Get-KeyState $raw
        if ($st -eq 'mine') { Say ('키 연결: 이미 되어 있습니다 (' + (Get-OwnKey $raw) + '). 바꾸려면 관리 창의 "단축키" 탭을 쓰세요.'); return }
        if ($st -eq 'taken') { Say ('키 연결: ' + $Key + ' 가 이미 다른 용도로 쓰이고 있어 건너뜁니다. (팔레트: Ctrl+Shift+P -> mod.open orch-manager, 또는 -Key 로 다른 키를 지정)'); return }
        $m = [regex]::Match($raw, '"global"\s*:\s*\{\r?\n')
        if (-not $m.Success) { Say 'keys.json 의 "global" 구역을 찾지 못해 키 연결은 건너뜁니다.'; return }
        $new = $raw.Insert($m.Index + $m.Length, '    ' + $Binding + ',' + $nl)
    } else {
        $new = [regex]::Replace($raw, '[ \t]*"[^"\\]+"\s*:\s*"mod\.open:orch-manager",?\r?\n', '')
        if ($new -ne $raw) { try { $null = $new | ConvertFrom-Json } catch { $new = [regex]::Replace($raw, ',(\r?\n)[ \t]*"[^"\\]+"\s*:\s*"mod\.open:orch-manager"(\r?\n)', '$1') } }   # 맨 끝 줄이어서 쉼표가 남으면 앞 줄의 쉼표까지 지운다
        if ($new -eq $raw) { return }
    }
    try { $null = $new | ConvertFrom-Json } catch { Say 'keys.json 수정 결과가 올바른 JSON 이 아니라서 키 연결을 건너뜁니다 (파일 그대로).'; return }
    $bak = "$KeysFile.bak-before-orch-manager"
    if (-not (Test-Path -LiteralPath $bak)) { Copy-Item -LiteralPath $KeysFile -Destination $bak; Say "keys.json 백업: $bak" }
    Write-Utf8NoBom $KeysFile $new
    Say ($(if ($On) { '키 연결 완료: ' + $Key } else { '키 연결 제거 완료' }))
}

# ---------------------------------------------------------------- 제거
if ($Uninstall) {
    if (-not $KeyOk -and -not $NoKey) { Stop-With "키 이름 형식이 올바르지 않음: $Key" }
    Set-KeyBinding $false
    if (-not (Test-Path -LiteralPath $Dest)) { Say '모드는 설치되어 있지 않습니다.'; exit 0 }
    if (-not ($Dest.EndsWith('mods\orch-manager'))) { Stop-With "예상하지 못한 위치라 지우지 않습니다: $Dest" }
    # 우리가 만든 파일만 지운다(폴더째 지우지 않음). 허더가 자동으로 만드는 보조 파일(.d.ts, jsconfig.json)도 함께.
    foreach ($f in @(Get-ChildItem -LiteralPath $Dest -File -Force)) {
        if ($ModKnown -contains $f.Name -or $f.Name -eq 'jsconfig.json' -or $f.Name -like '*.d.ts') { Remove-Item -LiteralPath $f.FullName -Force }
    }
    if (@(Get-ChildItem -LiteralPath $Dest -Force).Count -eq 0) { Remove-Item -LiteralPath $Dest -Force; Say "제거했습니다: $Dest" }
    else { Say "다른 파일이 남아 있어 폴더는 그대로 둡니다: $Dest" }
    exit 0
}

# ---------------------------------------------------------------- 설치
$problems = Test-Prereq
if ($problems.Count -gt 0) { foreach ($x in $problems) { Say ('문제: ' + $x) }; Stop-With '설치하지 않았습니다.' }

# 1) 임시 폴더에 만들고 검사(통과해야만 실제 mods 폴더에 닿는다)
$stage = Join-Path ([IO.Path]::GetTempPath()) ('orch-mod-stage-' + [Guid]::NewGuid().ToString('N').Substring(0, 10))
New-Item -ItemType Directory -Path $stage | Out-Null
$script:Stage = $stage
foreach ($f in $ModFiles) { Copy-Item -LiteralPath (Join-Path $ModSrc $f) -Destination (Join-Path $stage $f) -Force }
$toolSlash = ($ToolPath -replace '\\', '/')
if ($toolSlash -match '["\r\n]') { Stop-With 'manage.mjs 경로에 사용할 수 없는 글자(따옴표·줄바꿈)가 있습니다.' }
$mainPath = Join-Path $stage 'main.js'
$mainText = [IO.File]::ReadAllText($mainPath, [Text.Encoding]::UTF8)
if ($mainText -notmatch 'const TOOL = "[^"]*";') { Stop-With '모드 파일 형식이 예상과 다릅니다(const TOOL 을 찾지 못함).' }
$mainNew = [regex]::Replace($mainText, 'const TOOL = "[^"]*";', { param($m) 'const TOOL = "' + $toolSlash + '";' })
Write-Utf8NoBom $mainPath $mainNew
$out = & $HerdrApp check $stage 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $out -notmatch 'check passed') { Say ('검사 결과: ' + $out.Trim()); Stop-With 'Herdr 공식 검사를 통과하지 못해 설치하지 않았습니다. (Herdr 설정은 바뀌지 않았습니다)' }
Say ('검사 통과(임시 사본): ' + $out.Trim())

# 2) 실제 mods 폴더로 복사 (main.js 는 맨 마지막에 - Herdr 가 모드를 다시 읽을 때 model.js 가 이미 있게)
New-Item -ItemType Directory -Path $Dest -Force | Out-Null
foreach ($f in (@($ModFiles | Where-Object { $_ -ne 'main.js' }) + 'main.js')) { Copy-Item -LiteralPath (Join-Path $stage $f) -Destination (Join-Path $Dest $f) -Force }
Say "복사 완료: $Dest"
Clear-Stage

# 3) 설치된 사본도 한 번 더 검사
$out2 = & $HerdrApp check $Dest 2>&1 | Out-String
Say ('설치본 검사: ' + $out2.Trim())

Set-KeyBinding $true
Say ''
Say ('사용법: Herdr 화면에서 ' + $(if ($NoKey) { 'Ctrl+Shift+P 를 누르고 "mod.open orch-manager"' } else { $Key + ' (안 되면 Ctrl+Shift+P -> "mod.open orch-manager")' }) + ' 를 실행하세요.')
Say '제거: 같은 명령에 -Uninstall'
