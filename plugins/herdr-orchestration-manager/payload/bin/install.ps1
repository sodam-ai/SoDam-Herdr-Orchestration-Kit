# install.ps1 - Herdr 오케스트레이션 설치. 관리자 권한 필요 없음. 시스템(작업 스케줄러, 시작 프로그램, 레지스트리, PATH, Herdr 설정)은 건드리지 않습니다.
#
#   점검만(아무것도 바꾸지 않음):  powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1 -Check
#   설치/업데이트:                 powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
#   제거:                          uninstall.ps1 (같은 폴더)
#
# 하는 일: 번들(roles, templates, schema, bin, lib, functions, VERSION)을 InstallDir 로 복사하고,
#          OrchHome 아래에 config(처음 한 번만)·state·logs 폴더, 내 역할 폴더(config\roles, 처음 한 번만 + README.txt),
#          문서 폴더(기본 state\docs)와 설치 기록(install-manifest.json)을 만듭니다.
# 하지 않는 일: 이미 있는 config 덮어쓰기. 내 역할 폴더·문서 폴더 안의 파일 건드리기. 위험 기능 켜기(모두 꺼진 채 등록). 창에 무엇인가 보내기.
param(
    [string]$InstallDir = '',   # 번들 설치 위치 (기본 <OrchHome>\app)
    [string]$DocsDir = '',      # 문서 폴더(승인 대행이 파일 수정을 자동 승인할 수 있는 유일한 곳). 기본: 환경변수 ORCH_DOCS_DIR, 없으면 <OrchHome>\state\docs
    [string]$OrchHome = '',     # 설정·기록 위치 (기본: 환경변수 ORCH_HOME, 없으면 %LOCALAPPDATA%\Herdr-Orchestration). 이 인자가 있으면 인자가 우선
    [switch]$Force,             # 다른 위치/비어 있지 않은 폴더 설치를 허용
    [switch]$Check              # 점검만
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Bundle = Split-Path -Parent $Here
function Say([string]$m) { Write-Host $m }
$BundleItems = @('roles', 'templates', 'schema', 'bin', 'lib', 'functions', 'herdr-mod')   # herdr-mod: 허더 안에서 여는 관리 창(모드). 설치는 bin\install-herdr-mod.ps1

# ---------- 위치 정하기 ----------
if (-not $OrchHome) { $OrchHome = $env:ORCH_HOME }
if (-not $OrchHome) {
    $base = $env:LOCALAPPDATA
    if (-not $base) { $base = Join-Path $env:USERPROFILE 'AppData\Local' }
    $OrchHome = Join-Path $base 'Herdr-Orchestration'
}
$OrchHome = [IO.Path]::GetFullPath($OrchHome)
if (-not $InstallDir) { $InstallDir = Join-Path $OrchHome 'app' }
$InstallDir = [IO.Path]::GetFullPath($InstallDir)
$ManifestPath = Join-Path $OrchHome 'install-manifest.json'
$ConfigFile = Join-Path $OrchHome 'config\orchestration.json'
$RolesDir = Join-Path $OrchHome 'config\roles'          # 내 역할 폴더 (lib/orch-paths 의 roles 와 같은 위치)
$DefaultDocs = Join-Path $OrchHome 'state\docs'         # 문서 폴더 기본값 (lib/orch-paths 의 docs 와 같은 위치)
if (-not $DocsDir) { $DocsDir = $env:ORCH_DOCS_DIR }
if (-not $DocsDir) { $DocsDir = $DefaultDocs }
$DocsDir = [IO.Path]::GetFullPath($DocsDir)
$Placeholder = '(미설정)'

# ---------- 1) 점검 ----------
$results = New-Object System.Collections.ArrayList
function Add-Result([string]$id, [string]$status, [string]$msg) { [void]$results.Add([pscustomobject]@{ Id = $id; Status = $status; Msg = $msg }) }

# 번들이 온전한가
$missing = @()
foreach ($n in $BundleItems) { if (-not (Test-Path -LiteralPath (Join-Path $Bundle $n) -PathType Container)) { $missing += $n } }
foreach ($n in @('VERSION', 'bin\sync.mjs', 'bin\init-config.mjs')) { if (-not (Test-Path -LiteralPath (Join-Path $Bundle $n))) { $missing += $n } }
if ($missing.Count -gt 0) { Add-Result 'bundle' '중단' ("설치 파일이 빠져 있음: " + ($missing -join ', ') + " (압축을 완전히 푼 폴더에서 실행하세요)") }
else { Add-Result 'bundle' 'OK' "번들 폴더 확인: roles, templates, schema, bin, lib, functions, VERSION" }

# Windows PowerShell 5.1 이상
$psv = $PSVersionTable.PSVersion
if ($env:OS -ne 'Windows_NT') { Add-Result 'powershell' '중단' 'Windows 에서만 동작합니다.' }
elseif ($psv -ge [version]'5.1') { Add-Result 'powershell' 'OK' ("PowerShell " + $psv.ToString()) }
else { Add-Result 'powershell' '중단' ("PowerShell 5.1 이상이 필요함 (현재 " + $psv.ToString() + ")") }

# Node.js 18 이상 (PATH 에 없어도 흔한 설치 위치를 한 번 더 본다)
$node = $null; $nodeVer = ''
$cands = @()
$g = Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1
if ($g) { $cands += $g.Source }
foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if ($p -and (Test-Path -LiteralPath $p)) { $cands += $p } }
foreach ($c in $cands) {
    try {
        $out = (& $c --version 2>$null | Out-String).Trim()
        if ($out -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) { $node = $c; $nodeVer = $out; break }
    } catch {}
}
if ($node) { Add-Result 'node' 'OK' ("Node.js " + $nodeVer) }
else { Add-Result 'node' '중단' 'Node.js 18 이상이 필요한데 찾지 못함. https://nodejs.org 의 LTS 를 설치한 뒤 새 터미널에서 다시 실행하세요.' }

# hc (PATH 에서 찾기만 한다. 실행하지 않는다)
$hcCmd = Get-Command hc -ErrorAction SilentlyContinue | Select-Object -First 1
if ($hcCmd) { Add-Result 'hc' 'OK' 'hc 가 PATH 에 있음' }
else { Add-Result 'hc' '경고' 'PATH 에서 hc 를 찾지 못함. 설치는 되지만 창을 다루는 기능(감시, 승인, 대기 보기)은 hc 가 PATH 에 생겨야 동작합니다.' }

# Herdr 앱 (찾기만 한다)
$app = $null
$appCands = @()
if ($env:LOCALAPPDATA) { $appCands += (Join-Path $env:LOCALAPPDATA 'Programs\herdr-app\herdr-app.exe') }
$ga = Get-Command herdr-app -ErrorAction SilentlyContinue | Select-Object -First 1
if ($ga) { $appCands += $ga.Source }
foreach ($c in $appCands) { if ($c -and (Test-Path -LiteralPath $c)) { $app = $c; break } }
if ($app) { Add-Result 'herdr-app' 'OK' 'Herdr 앱을 찾음' }
else { Add-Result 'herdr-app' '경고' 'Herdr 앱(herdr-app.exe)을 찾지 못함. 설치는 되지만 창을 열려면 Herdr 가 필요합니다.' }

# 세션키퍼 (선택 의존성)
$keeper = $null
if ($env:LOCALAPPDATA) { $keeper = Join-Path $env:LOCALAPPDATA 'HerdrSessionKeeper\app\session-keeper.ps1' }
if ($keeper -and (Test-Path -LiteralPath $keeper)) { Add-Result 'session-keeper' 'OK' '세션키퍼를 찾음' }
else { Add-Result 'session-keeper' '경고' '세션키퍼를 표준 위치(%LOCALAPPDATA%\HerdrSessionKeeper\app)에서 찾지 못함(선택 사항). 다른 위치에서 쓰고 있다면 무시해도 됩니다. 정말 없다면 역할 5(window-inspector)의 창 주소 점검 일부가 비활성입니다. 실패는 아닙니다.' }

# 기존 설치 기록
$prev = $null
if (Test-Path -LiteralPath $ManifestPath) { try { $prev = [IO.File]::ReadAllText($ManifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json } catch { $prev = $null } }
$sameDir = { param($a, $b) ([IO.Path]::GetFullPath("$a").TrimEnd('\') -ieq [IO.Path]::GetFullPath("$b").TrimEnd('\')) }
if ($Bundle.TrimEnd('\') -ieq $InstallDir.TrimEnd('\')) { Add-Result 'install-dir' '중단' ("번들 폴더와 설치 폴더가 같음: " + $InstallDir) }
elseif ($prev -and $prev.installDir -and -not (& $sameDir $prev.installDir $InstallDir)) {
    if ($Force) { Add-Result 'install-dir' '경고' ("다른 위치(" + $prev.installDir + ")의 기존 설치 기록을 이 설치로 바꿉니다(-Force). 옛 위치의 파일은 그대로 남습니다.") }
    else { Add-Result 'install-dir' '중단' ("이미 다른 위치에 설치되어 있음: " + $prev.installDir + " (먼저 uninstall 하거나 -Force)") }
}
elseif ($prev) { Add-Result 'install-dir' 'OK' ("기존 설치(버전 " + $prev.version + ")를 업데이트합니다. 번들 파일만 교체하고 설정·기록은 보존합니다.") }
elseif ((Test-Path -LiteralPath $InstallDir) -and ([IO.Directory]::GetFileSystemEntries($InstallDir).Count -gt 0)) {
    if ($Force) { Add-Result 'install-dir' '경고' ("설치 폴더가 비어 있지 않음(-Force 로 진행): " + $InstallDir) }
    else { Add-Result 'install-dir' '중단' ("설치 폴더가 비어 있지 않고 설치 기록도 없음: " + $InstallDir + " (다른 폴더를 쓰거나 -Force)") }
}
else { Add-Result 'install-dir' 'OK' ("새로 설치: " + $InstallDir) }

# 내 역할 폴더 (config\roles): 번들과 같은 id 의 파일은 덮어쓰기, 새 id 는 추가. 이 도구는 폴더가 없을 때만 만들고 안의 파일은 건드리지 않는다
if (Test-Path -LiteralPath $RolesDir -PathType Container) {
    $nMine = @(Get-ChildItem -LiteralPath $RolesDir -File -ErrorAction SilentlyContinue).Count
    Add-Result 'my-roles' 'OK' ("내 역할 폴더가 이미 있음(파일 " + $nMine + "개) - 안의 파일은 건드리지 않습니다: " + $RolesDir)
} else { Add-Result 'my-roles' 'OK' ("내 역할 폴더를 새로 만듭니다(빈 폴더 + README.txt): " + $RolesDir) }

# 문서 폴더: 코드 폴더(설치 폴더)·설정 폴더와 겹치면 승인 대행이 시작을 거부하므로 설치 단계에서 미리 막는다
$ovl = { param($a, $b) $x = $a.TrimEnd('\') + '\'; $y = $b.TrimEnd('\') + '\'; $x.StartsWith($y, [StringComparison]::OrdinalIgnoreCase) -or $y.StartsWith($x, [StringComparison]::OrdinalIgnoreCase) }
$docsClash = $null
if (& $ovl $DocsDir $InstallDir) { $docsClash = "설치 폴더(" + $InstallDir + ")" }
elseif (& $ovl $DocsDir (Join-Path $OrchHome 'config')) { $docsClash = "설정 폴더(" + (Join-Path $OrchHome 'config') + ")" }
if ($docsClash) { Add-Result 'docs-dir' '중단' ("문서 폴더(" + $DocsDir + ")가 " + $docsClash + "와 같거나 포함 관계임. 문서 폴더는 코드·설정 폴더와 완전히 분리되어야 합니다(-DocsDir 로 다른 곳을 지정).") }
elseif (Test-Path -LiteralPath $DocsDir -PathType Container) { Add-Result 'docs-dir' 'OK' ("문서 폴더가 이미 있음 - 그대로 둡니다: " + $DocsDir) }
else { Add-Result 'docs-dir' 'OK' ("문서 폴더를 새로 만듭니다: " + $DocsDir) }

# 기존 설정 (있으면 덮어쓰지 않는다)
$cfgText = $null
if (Test-Path -LiteralPath $ConfigFile) {
    try { $cfgText = [IO.File]::ReadAllText($ConfigFile, [Text.Encoding]::UTF8) } catch {}
    Add-Result 'config' 'OK' '기존 설정이 있음 - 덮어쓰지 않고 그대로 둡니다.'
} else { Add-Result 'config' 'OK' '설정이 없음 - 기본 설정을 새로 만듭니다(위험 기능은 모두 꺼짐).' }

# 허용 목록 (scope_prefix). 정해지지 않았으면 다른 창에 입력하는 기능은 켜지 않는다 (설계서 6장 허용 목록 우선)
$scope = $null
if ($cfgText) { $m = [regex]::Match($cfgText, '"scope_prefix"\s*:\s*"((?:[^"\\]|\\.)*)"'); if ($m.Success) { $scope = $m.Groups[1].Value } }
if ($scope -and $scope -ne $Placeholder) { Add-Result 'allow-list' 'OK' 'scope_prefix(허용 목록)가 설정되어 있음' }
else { Add-Result 'allow-list' '경고' '허용 목록(scope_prefix)이 아직 없음 - 자동 압축·승인 대행은 켜지 않습니다. 설정 파일에 값을 적은 뒤 켤 수 있습니다.' }

# 상태줄 '컨텍스트 N%' : 설치 단계에서는 화면을 읽을 수 없다
Add-Result 'statusline' '경고' "정적 점검 불가 - Claude Code 화면 아래에 '컨텍스트 N%' 상태줄이 보이는지 자동 압축을 켜기 전에 직접 확인해야 합니다."

foreach ($r in $results) { Say ("[{0}] {1,-14} {2}" -f $r.Status, $r.Id, $r.Msg) }
Say '  (OK = 문제 없음, 경고 = 설치는 되지만 일부 기능 제한, 중단 = 설치하지 않음)'
$stops = @($results | Where-Object { $_.Status -eq '중단' })
$warns = @($results | Where-Object { $_.Status -eq '경고' })
Say ''
Say ("점검 결과: 중단 {0}건, 경고 {1}건" -f $stops.Count, $warns.Count)
if ($stops.Count -gt 0) { Say '중단 항목이 있어 설치하지 않았습니다. (아무것도 바꾸지 않았습니다)'; exit 1 }
if ($Check) { Say '점검만 했습니다. 아무것도 바꾸지 않았습니다. 설치하려면 -Check 없이 다시 실행하세요.'; exit 0 }

# ---------- 2) 번들 복사 ----------
Say ''
Say '== 번들 복사 =='
$files = New-Object System.Collections.ArrayList        # @{Rel; Sha}
$cNew = 0; $cUpd = 0; $cSame = 0
function Get-Sha([string]$p) { (Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLower() }
function Copy-One([string]$src, [string]$rel) {
    $dst = Join-Path $InstallDir ($rel -replace '/', '\')
    $dir = Split-Path -Parent $dst
    if (-not (Test-Path -LiteralPath $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
    $sha = Get-Sha $src
    if (Test-Path -LiteralPath $dst) {
        if ((Get-Sha $dst) -eq $sha) { $script:cSame++ } else { Copy-Item -LiteralPath $src -Destination $dst -Force; $script:cUpd++ }
    } else { Copy-Item -LiteralPath $src -Destination $dst -Force; $script:cNew++ }
    [void]$files.Add([pscustomobject]@{ path = $rel; sha256 = $sha })
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
foreach ($n in $BundleItems) {
    $root = Join-Path $Bundle $n
    Get-ChildItem -LiteralPath $root -Recurse -File | Sort-Object FullName | ForEach-Object {
        $rel = ($_.FullName.Substring($Bundle.TrimEnd('\').Length + 1)) -replace '\\', '/'
        Copy-One $_.FullName $rel
    }
}
Copy-One (Join-Path $Bundle 'VERSION') 'VERSION'
# 옛 번들에 있었는데 이번 번들에는 없는 파일: 파일 하나씩만 지운다(폴더 통째 삭제 없음)
$cGone = 0
if ($prev -and $prev.files) {
    $keep = @{}
    foreach ($f in $files) { $keep[$f.path] = $true }
    foreach ($old in $prev.files) {
        $rel = "$($old.path)"
        if ($keep.ContainsKey($rel) -or $rel -eq '' -or [IO.Path]::IsPathRooted($rel) -or ($rel -split '[\\/]') -contains '..') { continue }
        $full = Join-Path $InstallDir ($rel -replace '/', '\')
        if (Test-Path -LiteralPath $full -PathType Leaf) { [IO.File]::Delete($full); $cGone++ }
    }
}
Say ("  새 파일 {0}, 바뀐 파일 {1}, 그대로 {2}, 번들에서 빠진 옛 파일 {3}" -f $cNew, $cUpd, $cSame, $cGone)

# ---------- 3) 설정·기록 폴더 (설정은 처음 한 번만) ----------
Say '== 설정·기록 폴더 =='
foreach ($d in @('config', 'state', 'logs')) { New-Item -ItemType Directory -Path (Join-Path $OrchHome $d) -Force | Out-Null }
$dataFiles = New-Object System.Collections.ArrayList
# 내 역할 폴더: 없을 때만 만들고 README.txt 를 한 번 넣는다. 이미 있으면 안의 파일은 하나도 건드리지 않는다(README 를 지웠어도 다시 만들지 않음)
$readme = Join-Path $RolesDir 'README.txt'
$readmeCreated = $false
if (-not (Test-Path -LiteralPath $RolesDir -PathType Container)) {
    New-Item -ItemType Directory -Path $RolesDir -Force | Out-Null
    $readmeText = @(
        '내 역할 폴더 (config\roles)',
        '',
        '이 폴더에 역할 파일(<id>.md)을 넣으면 번들 역할 위에 얹힙니다. 재설치·업그레이드해도 이 폴더는 건드리지 않습니다.',
        '- 번들에 있는 id 와 같은 이름의 파일: 덮어쓰기. 머리말에는 바꿀 항목만 적으면 되고(나머지는 번들 값), 본문을 적으면 번들 본문을 대신합니다.',
        '- 번들에 없는 id 의 파일: 새 역할 추가. 머리말 필수 항목을 모두 적어야 합니다(roles 폴더의 번들 역할 파일을 본보기로).',
        '- 번들 역할 끄기: 번들과 같은 이름의 파일에 머리말 enabled: false 한 줄만 적습니다.',
        '    ---',
        '    enabled: false',
        '    ---',
        '- 파일 이름이 곧 역할 id 입니다(소문자·숫자·하이픈). .md 가 아닌 파일(이 README.txt 같은 것)은 무시됩니다.',
        '- 잘못된 파일이 하나라도 있으면 sync 가 멈추고 이유를 알려 줍니다. 고친 뒤 다시 실행하세요.',
        ''
    ) -join "`r`n"
    [IO.File]::WriteAllBytes($readme, (New-Object Text.UTF8Encoding($false)).GetBytes($readmeText))
    $readmeCreated = $true
    Say '  만듦: config\roles\ (내 역할 폴더, README.txt 포함)'
}
# 문서 폴더 (없을 때만 만든다. 안의 파일은 건드리지 않는다)
if (-not (Test-Path -LiteralPath $DocsDir -PathType Container)) { New-Item -ItemType Directory -Path $DocsDir -Force | Out-Null; Say ('  만듦: 문서 폴더 ' + $DocsDir) }
$ignore = Join-Path $OrchHome 'config\ignore.txt'
if (-not (Test-Path -LiteralPath $ignore)) { [IO.File]::WriteAllBytes($ignore, [byte[]]@()); Say '  만듦: config\ignore.txt (빈 파일)' }
if (-not (Test-Path -LiteralPath $ConfigFile)) {
    & $node (Join-Path $InstallDir 'bin\init-config.mjs') '--orch-home' $OrchHome '--functions-dir' (Join-Path $InstallDir 'functions') | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $ConfigFile)) { Say '중단: 기본 설정을 만들지 못했습니다.'; exit 1 }
    Say '  만듦: config\orchestration.json (기본 설정, 위험 기능은 모두 꺼짐)'
} else { Say '  기존 config\orchestration.json 은 그대로 둠' }
# 이번 설치가 만든 데이터 파일 기록: 이전 기록에 있던 것(아직 존재하면) + 이번에 만든 것
$known = @{}
if ($prev -and $prev.dataFiles) { foreach ($d in $prev.dataFiles) { $known["$($d.path)"] = $true } }
$createdNow = @{}
if (-not $known.ContainsKey('config/ignore.txt') -and (Test-Path -LiteralPath $ignore)) { $createdNow['config/ignore.txt'] = $true }
if (-not $known.ContainsKey('config/orchestration.json') -and (Test-Path -LiteralPath $ConfigFile)) { $createdNow['config/orchestration.json'] = $true }
if ($readmeCreated) { $createdNow['config/roles/README.txt'] = $true }
foreach ($rel in @('config/ignore.txt', 'config/orchestration.json', 'config/roles/README.txt')) {
    $full = Join-Path $OrchHome ($rel -replace '/', '\')
    if ((Test-Path -LiteralPath $full) -and ($known.ContainsKey($rel) -or $createdNow.ContainsKey($rel))) {
        [void]$dataFiles.Add([pscustomobject]@{ path = $rel; sha256 = (Get-Sha $full) })
    }
}

# ---------- 4) 설치 기록 + 확인 ----------
$version = ([IO.File]::ReadAllText((Join-Path $Bundle 'VERSION'), [Text.Encoding]::UTF8)).Trim()
$manifest = [ordered]@{
    kit = 'herdr-orchestration'; version = $version; installedAt = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
    installDir = $InstallDir; orchHome = $OrchHome; docsDir = $DocsDir
    files = @($files); dataFiles = @($dataFiles)
}
[IO.File]::WriteAllBytes($ManifestPath, (New-Object Text.UTF8Encoding($false)).GetBytes((ConvertTo-Json -InputObject $manifest -Depth 5) + "`r`n"))
$bad = 0
foreach ($f in $files) {
    $full = Join-Path $InstallDir ($f.path -replace '/', '\')
    if (-not (Test-Path -LiteralPath $full) -or ((Get-Sha $full) -ne $f.sha256)) { $bad++ }
}
Say '== 확인 =='
if ($bad -gt 0) { Say ("중단: 복사한 파일 {0}개가 기록과 다릅니다. 다시 실행해 보세요." -f $bad); exit 1 }
Say ("  설치 기록 {0}개 파일 모두 일치 (버전 {1})" -f $files.Count, $version)
Say ''
Say '설치가 끝났습니다. 위험 기능(승인 대행, 자동 압축)은 모두 꺼진 상태입니다.'
Say ("  - 번들:  " + $InstallDir)
Say ("  - 설정:  " + $ConfigFile + "  (scope_prefix, projects_root 를 먼저 고치세요)")
Say ("  - 내 역할: " + $RolesDir + "  (번들 역할 덮어쓰기·새 역할 추가. 업그레이드해도 그대로)")
Say ("  - 문서:  " + $DocsDir)
Say ("  - 파일 수정 자동 승인: 꺼짐(기본). 폴더를 만들었다고 켜지지 않습니다. 켜려면 승인 대행과 별개로 환경변수 ORCH_DOCS_DIR 을 이 위치로 직접 지정하세요: " + $DocsDir)
$envHome = $null
if ($env:ORCH_HOME) { $envHome = [IO.Path]::GetFullPath($env:ORCH_HOME) }
if ($envHome -ne $OrchHome) { Say ("  - 참고: 사용할 때 환경변수 ORCH_HOME 을 이 위치로 지정하세요(기본 위치와 다르면 필수): " + $OrchHome) }
Say ("  - 다음: node `"" + (Join-Path $InstallDir 'bin\sync.mjs') + "`"  (역할표·카드·탭 배치 계획 생성)")
Say ("  - 관리 창(더블클릭): " + (Join-Path $InstallDir 'bin\Herdr-Orchestration-Manager.vbs') + "  (현황 보기, 역할 편집, 내보내기·불러오기, 백업·복구)")
