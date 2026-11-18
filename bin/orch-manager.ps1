# orch-manager.ps1 - Herdr 오케스트레이션 관리 창 (현황 / 역할 편집 / 내보내기·불러오기 / 백업·복구).
# 실제 일은 같은 폴더의 manage.mjs(엔진)가 한다. 이 창은 그리기와 버튼만 한다.
#   - 번들(roles\ 등)은 바꾸지 않는다. 모든 수정은 "내 설정"(ORCH_HOME\config)에만 쓰고, 바꾸기 직전에 자동 백업한다.
#   - 어느 창에도 아무것도 보내지 않고 hc 를 부르지 않는다.
#   - 어디에 설치되어 있어도 자기 위치(이 파일이 있는 bin 폴더)와 ORCH_HOME(없으면 %LOCALAPPDATA%\Herdr-Orchestration)만 쓴다.
# 점검용: -SelfTest -ShotDir <폴더>  : 창을 화면 밖에 열어 탭마다 그림 파일(png)로 저장하고 끝낸다(클릭 시험은 아님).
param([switch]$SelfTest, [string]$ShotDir = '', [string]$PlanPackage = '')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Manage = Join-Path $Dir 'manage.mjs'
$script:Node = $null
$script:OrchHome = ''
$FontName = 'Malgun Gothic'

function Find-Node {
    $c = Get-Command node -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    foreach ($p in @("$env:ProgramFiles\nodejs\node.exe", "$env:LOCALAPPDATA\Programs\nodejs\node.exe")) { if ($p -and (Test-Path -LiteralPath $p)) { return $p } }
    return $null
}
function Say-Box([string]$Text, [string]$Title = 'Herdr 오케스트레이션 관리', [string]$Icon = 'Information') {
    if ($SelfTest) { Write-Host ("[창] " + $Text); return }
    [void][System.Windows.Forms.MessageBox]::Show($Text, $Title, 'OK', $Icon)
}
function Ask-Box([string]$Text, [string]$Title = '확인') {
    if ($SelfTest) { return $false }
    return ([System.Windows.Forms.MessageBox]::Show($Text, $Title, 'YesNo', 'Question', 'Button2') -eq 'Yes')
}
function ConvertTo-AsciiJson($Obj) {
    $j = ConvertTo-Json -InputObject $Obj -Depth 8 -Compress
    return [regex]::Replace($j, '[^\u0000-\u007F]', [System.Text.RegularExpressions.MatchEvaluator]{ param($m) ('\u{0:x4}' -f [int][char]$m.Value) })
}
function Call-Manage([string]$Cmd, $Req = @{}) {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $script:Node
    $psi.Arguments = '"' + $Manage + '" ' + $Cmd
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
    $psi.StandardOutputEncoding = [Text.Encoding]::UTF8; $psi.StandardErrorEncoding = [Text.Encoding]::UTF8
    $psi.CreateNoWindow = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $p.StandardInput.Write((ConvertTo-AsciiJson $Req)); $p.StandardInput.Close()
    $errTask = $p.StandardError.ReadToEndAsync()
    $out = $p.StandardOutput.ReadToEnd()
    $p.WaitForExit()
    try { return ($out | ConvertFrom-Json) }
    catch { return [pscustomobject]@{ ok = $false; errors = @("응답을 읽을 수 없습니다: " + $out + " " + $errTask.Result) } }
}
function Errors-Text($r) {
    $e = @(); if ($r -and $r.errors) { $e = @($r.errors) }
    if ($e.Count -eq 0) { return '알 수 없는 오류' }
    $t = ($e -join "`r`n"); if ($t.Length -gt 1800) { $t = $t.Substring(0, 1800) + "`r`n…(잘림)" }
    return $t
}
function Pt($x, $y) { New-Object System.Drawing.Point($x, $y) }
function Sz($w, $h) { New-Object System.Drawing.Size($w, $h) }
function New-Ctl([string]$Type, [hashtable]$P) {
    $c = New-Object ("System.Windows.Forms." + $Type)
    foreach ($k in $P.Keys) { $c.$k = $P[$k] }
    return $c
}
function New-Btn([string]$Text, [int]$X, [int]$Y, [int]$W = 140, [int]$H = 34) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $Text; $b.Location = (Pt $X $Y); $b.Size = (Sz $W $H)
    return $b
}
function New-List([string[]]$Cols, [int[]]$Widths) {
    $l = New-Object System.Windows.Forms.ListView
    $l.View = 'Details'; $l.FullRowSelect = $true; $l.GridLines = $true; $l.HideSelection = $false; $l.MultiSelect = $false
    for ($i = 0; $i -lt $Cols.Count; $i++) { [void]$l.Columns.Add($Cols[$i], $Widths[$i]) }
    return $l
}
$ColOk = [System.Drawing.Color]::FromArgb(0, 120, 60); $ColWarn = [System.Drawing.Color]::FromArgb(190, 110, 0)
$ColBad = [System.Drawing.Color]::FromArgb(190, 30, 30); $ColDim = [System.Drawing.Color]::Gray
function Fmt-Time($v) { try { return ([datetime]$v).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') } catch { return [string]$v } }
function On-Text($v) { if ($v -eq $true) { return '켜짐' } elseif ($v -eq $false) { return '꺼짐' } else { return '-' } }
$script:ChoiceLabel = @{ 'read-only' = '읽기 전용'; 'scoped-write' = '범위 내 쓰기'; 'on-request' = '요청 시'; 'periodic' = '주기적' }
function Choice-Disp([string]$v) { if ($script:ChoiceLabel.ContainsKey($v)) { $script:ChoiceLabel[$v] + ' (' + $v + ')' } else { $v } }
function Choice-Val([object]$d) { $s = [string]$d; if ($s -match '(([^()]+))s*$') { $Matches[1] } else { $s } }
function Source-Text([string]$s) { switch ($s) { 'bundle' { '번들' } 'override' { '내가 덮어씀' } 'user' { '내가 만듦' } default { $s } } }

# ---------------------------------------------------------------- 상태 저장(창 편의용: 마지막 sync 출력 폴더)
function UiState-Path { return (Join-Path (Join-Path $script:OrchHome 'state') 'manager-ui.json') }
function Load-UiState { try { $p = UiState-Path; if (Test-Path -LiteralPath $p) { return (Get-Content -LiteralPath $p -Raw -Encoding UTF8 | ConvertFrom-Json) } } catch {}; return $null }
function Save-UiState([string]$GenDir) {
    try {
        $p = UiState-Path; $d = Split-Path -Parent $p; if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
        [IO.File]::WriteAllText($p, (ConvertTo-Json -InputObject @{ generatedDir = $GenDir }), (New-Object Text.UTF8Encoding($false)))
    } catch {}
}

# ---------------------------------------------------------------- 창과 탭
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Herdr 오케스트레이션 관리'
$form.Size = (Sz 1120 740); $form.MinimumSize = (Sz 960 620); $form.StartPosition = 'CenterScreen'
$form.Font = New-Object System.Drawing.Font($FontName, 10)
$tabs = New-Object System.Windows.Forms.TabControl
$tabs.Dock = 'Fill'
$tStatus = New-Object System.Windows.Forms.TabPage; $tStatus.Text = '현황'
$tRoles = New-Object System.Windows.Forms.TabPage; $tRoles.Text = '역할 편집'
$tShare = New-Object System.Windows.Forms.TabPage; $tShare.Text = '내보내기 · 불러오기'
$tBackup = New-Object System.Windows.Forms.TabPage; $tBackup.Text = '백업 · 복구'
$tLive = New-Object System.Windows.Forms.TabPage; $tLive.Text = '실제 창'
$tRoleCk = New-Object System.Windows.Forms.TabPage; $tRoleCk.Text = '역할 점검'
$tabs.TabPages.AddRange(@($tStatus, $tRoles, $tShare, $tBackup, $tLive, $tRoleCk))
$bar = New-Object System.Windows.Forms.Label
$bar.Dock = 'Bottom'; $bar.Height = 26; $bar.TextAlign = 'MiddleLeft'; $bar.Padding = New-Object System.Windows.Forms.Padding(8, 0, 0, 0); $bar.Text = '불러오는 중...'
$form.Controls.Add($tabs); $form.Controls.Add($bar)
function Set-Bar([string]$Text, $Color = $null) { $bar.Text = $Text; if ($Color) { $bar.ForeColor = $Color } else { $bar.ForeColor = [System.Drawing.SystemColors]::ControlText } }

# ---- 현황 탭
$sumHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 44; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)); Text = "지금 구현된 상태를 한눈에 봅니다(읽기 전용). 아래 표의 항목이 주황·빨강이면 안내대로 처리하세요.`r`n번들(원본 역할)은 바뀌지 않고, 내가 바꾼 것은 `"내 설정`"에만 저장됩니다." }
$sumList = New-List @('항목', '상태', '설명') @(170, 150, 700)
$sumList.Dock = 'Fill'
$rolesList = New-List @('자리', 'id', '이름', '하는 일', '종류', '모드', '상태', '출처') @(50, 140, 120, 330, 90, 100, 60, 110)
$rolesList.Dock = 'Fill'
$stBottom = New-Object System.Windows.Forms.Panel; $stBottom.Dock = 'Bottom'; $stBottom.Height = 88
$lblGen = New-Ctl 'Label' @{ Text = '생성물(sync) 출력 폴더:'; AutoSize = $true; Location = (Pt 10 12) }
$txtGen = New-Ctl 'TextBox' @{ Location = (Pt 190 8); Size = (Sz 560 26); Anchor = 'Top,Left,Right' }
$btnGenBrowse = New-Btn '찾아보기' 760 6 100 30; $btnGenBrowse.Anchor = 'Top,Right'
$btnSync = New-Btn 'sync 실행 (생성물 갱신)' 10 44 230 34
$btnRefresh = New-Btn '새로고침' 250 44 110 34
$stNote = New-Ctl 'Label' @{ Text = 'sync 는 역할표·카드·탭 배치 계획 파일만 만듭니다. 어느 창에도 보내지 않습니다.'; AutoSize = $true; Location = (Pt 372 52); ForeColor = $ColDim }
$stBottom.Controls.AddRange(@($lblGen, $txtGen, $btnGenBrowse, $btnSync, $btnRefresh, $stNote))
$stSplit = New-Object System.Windows.Forms.SplitContainer; $stSplit.Dock = 'Fill'; $stSplit.Orientation = 'Horizontal'
$stSplit.Panel1.Controls.Add($sumList); $stSplit.Panel2.Controls.Add($rolesList)
$tStatus.Controls.Add($stSplit); $tStatus.Controls.Add($stBottom); $tStatus.Controls.Add($sumHelp)

# ---- 역할 편집 탭
$edLeft = New-Object System.Windows.Forms.Panel; $edLeft.Dock = 'Left'; $edLeft.Width = 430
$edHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 40; Padding = (New-Object System.Windows.Forms.Padding(6, 4, 6, 0)); Text = "역할을 고르면 오른쪽에서 고칠 수 있습니다. 저장하면 번들이 아니라 `"내 설정`"에 기록되고, 바꾸기 직전 상태는 자동 백업됩니다." }
$edList = New-List @('자리', 'id', '이름', '상태', '출처') @(50, 140, 120, 60, 90); $edList.Dock = 'Fill'
$edLeft.Controls.Add($edList); $edLeft.Controls.Add($edHelp)
$edRight = New-Object System.Windows.Forms.Panel; $edRight.Dock = 'Fill'
$edInfo = New-Ctl 'Label' @{ Location = (Pt 10 8); Size = (Sz 600 40); Text = '(왼쪽에서 역할을 고르세요)'; ForeColor = $ColDim }
$lblName = New-Ctl 'Label' @{ Text = '이름'; AutoSize = $true; Location = (Pt 10 58) }
$txtName = New-Ctl 'TextBox' @{ Location = (Pt 100 54); Size = (Sz 230 26) }
$lblSlot = New-Ctl 'Label' @{ Text = '자리'; AutoSize = $true; Location = (Pt 350 58) }
$numSlot = New-Ctl 'NumericUpDown' @{ Location = (Pt 392 54); Size = (Sz 70 26); Minimum = 0; Maximum = 99 }
$chkOn = New-Ctl 'CheckBox' @{ Text = '켜짐'; AutoSize = $true; Location = (Pt 480 56) }
$lblSum = New-Ctl 'Label' @{ Text = '하는 일'; AutoSize = $true; Location = (Pt 10 94) }
$txtSum = New-Ctl 'TextBox' @{ Location = (Pt 100 90); Size = (Sz 490 26); Anchor = 'Top,Left,Right' }
$lblMode = New-Ctl 'Label' @{ Text = '모드'; AutoSize = $true; Location = (Pt 10 130) }
$cmbMode = New-Ctl 'ComboBox' @{ Location = (Pt 100 126); Size = (Sz 200 26); DropDownStyle = 'DropDownList' }; [void]$cmbMode.Items.AddRange(@((Choice-Disp 'read-only'), (Choice-Disp 'scoped-write')))
$lblCad = New-Ctl 'Label' @{ Text = '주기'; AutoSize = $true; Location = (Pt 320 130) }
$cmbCad = New-Ctl 'ComboBox' @{ Location = (Pt 360 126); Size = (Sz 170 26); DropDownStyle = 'DropDownList' }; [void]$cmbCad.Items.AddRange(@((Choice-Disp 'on-request'), (Choice-Disp 'periodic')))
$lblRep = New-Ctl 'Label' @{ Text = '보고 대상'; AutoSize = $true; Location = (Pt 10 166) }
$cmbRep = New-Ctl 'ComboBox' @{ Location = (Pt 100 162); Size = (Sz 200 26); DropDownStyle = 'DropDownList' }
$lblWr = New-Ctl 'Label' @{ Text = '쓸 수 있는 곳 (한 줄에 하나, 읽기 전용 모드면 비움)'; AutoSize = $true; Location = (Pt 10 198) }
$txtWr = New-Ctl 'TextBox' @{ Location = (Pt 10 222); Size = (Sz 580 52); Multiline = $true; ScrollBars = 'Vertical'; Anchor = 'Top,Left,Right' }
$lblBody = New-Ctl 'Label' @{ Text = '지시문(본문) - 이 역할 창이 읽는 글입니다'; AutoSize = $true; Location = (Pt 10 282) }
$txtBody = New-Ctl 'TextBox' @{ Location = (Pt 10 306); Size = (Sz 580 230); Multiline = $true; ScrollBars = 'Vertical'; AcceptsReturn = $true; Anchor = 'Top,Left,Right,Bottom' }
$edBtns = New-Object System.Windows.Forms.Panel; $edBtns.Dock = 'Bottom'; $edBtns.Height = 134
$btnSave = New-Btn '저장' 10 8 110 36; $btnSave.Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold)
$btnToggle = New-Btn '끄기 / 켜기' 130 8 120 36
$btnRevert = New-Btn '번들 값으로 되돌리기' 10 52 190 36
$btnNew = New-Btn '새 역할 만들기...' 260 8 160 36
$btnDel = New-Btn '내가 만든 역할 삭제' 210 52 170 36
$edNote = New-Ctl 'Label' @{ Location = (Pt 10 94); Size = (Sz 590 36); ForeColor = $ColDim; Text = "저장·삭제·되돌리기 뒤에는 현황 탭에서 [sync 실행]으로 생성물을 갱신하세요. 번들 역할을 고치면 바꾼 항목만 `"덮어쓰기`" 파일로 저장됩니다." }
$edBtns.Controls.AddRange(@($btnSave, $btnToggle, $btnRevert, $btnNew, $btnDel, $edNote))
$edRight.Controls.AddRange(@($edInfo, $lblName, $txtName, $lblSlot, $numSlot, $chkOn, $lblSum, $txtSum, $lblMode, $cmbMode, $lblCad, $cmbCad, $lblRep, $cmbRep, $lblWr, $txtWr, $lblBody, $txtBody))
$tRoles.Controls.Add($edRight); $tRoles.Controls.Add($edBtns); $tRoles.Controls.Add($edLeft)

# ---- 내보내기 · 불러오기 탭
$shHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 52; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)); Text = "역할 구성을 폴더 하나(묶음)로 내보내고, 다른 곳에서 불러옵니다. 남의 묶음은 위험할 수 있어 불러온 역할은 `"꺼진 채로`" 들어오고, 미리보기에서 바뀔 내용을 확인한 뒤에만 적용됩니다." }
$gbExp = New-Ctl 'GroupBox' @{ Text = '내보내기'; Dock = 'Top'; Height = 150 }
$lblExScope = New-Ctl 'Label' @{ Text = '범위'; AutoSize = $true; Location = (Pt 14 30) }
$cmbExScope = New-Ctl 'ComboBox' @{ Location = (Pt 80 26); Size = (Sz 520 26); DropDownStyle = 'DropDownList' }
[void]$cmbExScope.Items.AddRange(@('portable - 역할 + 환경 규칙 + ignore (다른 PC로 옮길 때, 이 PC 경로 설정은 제외)', 'full - 위 전부 + 이 PC 설정 (이 PC의 백업용)')); $cmbExScope.SelectedIndex = 0
$lblExDest = New-Ctl 'Label' @{ Text = '저장할 폴더'; AutoSize = $true; Location = (Pt 14 66) }
$txtExDest = New-Ctl 'TextBox' @{ Location = (Pt 100 62); Size = (Sz 500 26) }
$btnExBrowse = New-Btn '찾아보기' 610 60 100 30
$lblExNote = New-Ctl 'Label' @{ Text = '메모'; AutoSize = $true; Location = (Pt 14 102) }
$txtExNote = New-Ctl 'TextBox' @{ Location = (Pt 100 98); Size = (Sz 500 26) }
$btnExport = New-Btn '내보내기' 610 94 110 34
$gbExp.Controls.AddRange(@($lblExScope, $cmbExScope, $lblExDest, $txtExDest, $btnExBrowse, $lblExNote, $txtExNote, $btnExport))
$gbImp = New-Ctl 'GroupBox' @{ Text = '불러오기'; Dock = 'Top'; Height = 256 }
$lblImPkg = New-Ctl 'Label' @{ Text = '묶음 폴더'; AutoSize = $true; Location = (Pt 14 30) }
$txtImPkg = New-Ctl 'TextBox' @{ Location = (Pt 100 26); Size = (Sz 500 26) }
$btnImBrowse = New-Btn '찾아보기' 610 24 100 30
$rbMerge = New-Ctl 'RadioButton' @{ Text = '합치기 - 내 역할은 남기고 묶음의 것을 더하거나 바꿈'; AutoSize = $true; Location = (Pt 100 66); Checked = $true }
$rbReplace = New-Ctl 'RadioButton' @{ Text = '교체 - 묶음에 없는 내 역할은 지움 (지운 것은 자동 백업에 남음)'; AutoSize = $true; Location = (Pt 100 92) }
$chkEnv = New-Ctl 'CheckBox' @{ Text = '환경 규칙(모든 카드 끝에 붙는 지시문)도 불러오기'; AutoSize = $true; Location = (Pt 100 124) }
$chkIgn = New-Ctl 'CheckBox' @{ Text = '무시 목록(ignore)도 불러오기 (승인 대기 창을 숨길 수 있어 내가 만든 묶음일 때만)'; AutoSize = $true; Location = (Pt 100 150) }
$chkEnable = New-Ctl 'CheckBox' @{ Text = '불러온 역할을 켠 채로 (내가 만든 묶음일 때만 선택)'; AutoSize = $true; Location = (Pt 100 176) }
$btnImPlan = New-Btn '미리보기...' 100 206 150 34; $btnImPlan.Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold)
$imNote = New-Ctl 'Label' @{ Text = '미리보기를 본 뒤에 [적용]을 누를 수 있습니다. 이 PC 고유 설정(경로 등)은 불러오기로 바뀌지 않습니다.'; AutoSize = $true; Location = (Pt 262 216); ForeColor = $ColDim }
$gbImp.Controls.AddRange(@($lblImPkg, $txtImPkg, $btnImBrowse, $rbMerge, $rbReplace, $chkEnv, $chkIgn, $chkEnable, $btnImPlan, $imNote))
$tShare.Controls.Add($gbImp); $tShare.Controls.Add($gbExp); $tShare.Controls.Add($shHelp)

# ---- 백업 · 복구 탭
$bkHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 52; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)); Text = "바꾸기 직전에는 자동으로 백업이 만들어집니다. 여기서 직접 백업하거나, 옛 백업으로 되돌릴 수 있습니다.`r`n백업은 지워지지 않고 쌓입니다. 정리는 사용자가 직접 폴더에서 하세요." }
$bkList = New-List @('시각', '종류', '메모', '파일 수', '폴더') @(160, 70, 330, 70, 420); $bkList.Dock = 'Fill'
$bkBottom = New-Object System.Windows.Forms.Panel; $bkBottom.Dock = 'Bottom'; $bkBottom.Height = 96
$lblBkNote = New-Ctl 'Label' @{ Text = '메모'; AutoSize = $true; Location = (Pt 10 14) }
$txtBkNote = New-Ctl 'TextBox' @{ Location = (Pt 56 10); Size = (Sz 380 26) }
$btnBackup = New-Btn '지금 백업' 446 8 120 32
$btnRestore = New-Btn '선택한 백업으로 복구...' 580 8 220 32
$btnOpenBk = New-Btn '백업 폴더 열기' 810 8 150 32
$bkNote = New-Ctl 'Label' @{ Location = (Pt 10 52); Size = (Sz 950 38); ForeColor = $ColDim; Text = '복구는 미리보기를 먼저 보여 주고, 적용 직전 현재 상태를 한 번 더 백업합니다. 복구는 "교체" 방식이라 백업에 없는 내 파일은 지워집니다(그 내용은 직전 백업에 남음).' }
$bkBottom.Controls.AddRange(@($lblBkNote, $txtBkNote, $btnBackup, $btnRestore, $btnOpenBk, $bkNote))
$tBackup.Controls.Add($bkList); $tBackup.Controls.Add($bkBottom); $tBackup.Controls.Add($bkHelp)

# ---- 실제 창 탭 (읽기 전용: hc ls --json 조회만, 어느 창에도 아무것도 보내지 않음)
$lvHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 48; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)); Text = "지금 떠 있는 Herdr 창의 상태를 읽기만 합니다(hc ls 조회). 어느 창에도 아무것도 보내지 않고 기록도 남기지 않습니다.`r`n주황색 = 승인 대기 창, 회색 = 설정한 범위(scope_prefix) 밖의 창입니다." }
$lvSummary = New-Ctl 'Label' @{ Dock = 'Top'; Height = 30; TextAlign = 'MiddleLeft'; Padding = (New-Object System.Windows.Forms.Padding(8, 0, 0, 0)); Text = '(아직 조회하지 않음)'; Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold) }
$lvList = New-List @('주소', '상태', '범위', '종류', '턴', '위치 (Herdr 공간 / 탭)') @(70, 90, 70, 110, 60, 760); $lvList.Dock = 'Fill'
$lvBottom = New-Object System.Windows.Forms.Panel; $lvBottom.Dock = 'Bottom'; $lvBottom.Height = 56
$btnLvRefresh = New-Btn '새로고침' 10 10 110 34
$chkLvScope = New-Ctl 'CheckBox' @{ Text = '범위 안의 창만'; AutoSize = $true; Location = (Pt 134 18) }
$chkLvAuto = New-Ctl 'CheckBox' @{ Text = '10초마다 자동 새로고침'; AutoSize = $true; Location = (Pt 280 18) }
$btnLvCopy = New-Btn '선택한 창 주소 복사' 480 10 200 34
$lvTimer = New-Object System.Windows.Forms.Timer; $lvTimer.Interval = 10000
$lvBottom.Controls.AddRange(@($btnLvRefresh, $chkLvScope, $chkLvAuto, $btnLvCopy))
$tLive.Controls.Add($lvList); $tLive.Controls.Add($lvBottom); $tLive.Controls.Add($lvSummary); $tLive.Controls.Add($lvHelp)
# ---- 역할 점검 탭 (읽기 전용: role-check = hc ls --json 조회 + 세션키퍼 기록 읽기만. 어느 창에도 아무것도 보내지 않고 아무것도 쓰지 않음)
$rcHelp = New-Ctl 'Label' @{ Dock = 'Top'; Height = 48; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)); Text = "역할 창이 제대로 있는지 세션 ID 로 확인합니다(주소·탭 순서가 바뀌어도 같은 세션이면 정상). 읽기만 하며 어느 창에도 아무것도 보내지 않습니다.`r`n초록 = 정상, 주황 = 탭 밖·추정만·확인 불가, 빨강 = 없음, 회색 = 배정 안 됨. 탭 이름을 바꾸거나 세션이 복구되면 다음 점검에 바로 반영됩니다." }
$rcSummary = New-Ctl 'Label' @{ Dock = 'Top'; Height = 30; TextAlign = 'MiddleLeft'; Padding = (New-Object System.Windows.Forms.Padding(8, 0, 0, 0)); Text = '(아직 점검하지 않음)'; Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold) }
$rcList = New-List @('번호', '역할', '상태', '주소', '세션', '창 상태', '설명') @(60, 190, 100, 70, 90, 90, 480); $rcList.Dock = 'Fill'
$rcBottom = New-Object System.Windows.Forms.Panel; $rcBottom.Dock = 'Bottom'; $rcBottom.Height = 56
$btnRcRefresh = New-Btn '새로고침' 10 10 110 34
$chkRcAuto = New-Ctl 'CheckBox' @{ Text = '15초마다 자동 새로고침'; AutoSize = $true; Location = (Pt 134 18); Checked = $true }
$rcTimer = New-Object System.Windows.Forms.Timer; $rcTimer.Interval = 15000; $rcTimer.Enabled = $true
$rcBottom.Controls.AddRange(@($btnRcRefresh, $chkRcAuto))
$tRoleCk.Controls.Add($rcList); $tRoleCk.Controls.Add($rcBottom); $tRoleCk.Controls.Add($rcSummary); $tRoleCk.Controls.Add($rcHelp)


# ---------------------------------------------------------------- 데이터 읽기·그리기
$script:Status = $null; $script:RoleFull = @{}; $script:Loaded = $null; $script:Backups = @()

function Add-SumRow([string]$Item, [string]$State, [string]$Desc, $Color) {
    $it = New-Object System.Windows.Forms.ListViewItem($Item); [void]$it.SubItems.Add($State); [void]$it.SubItems.Add($Desc)
    $it.ForeColor = $Color; [void]$sumList.Items.Add($it)
}
function Fill-Status {
    $s = $script:Status
    $sumList.BeginUpdate(); $sumList.Items.Clear()
    Add-SumRow '번들 위치' ('버전 ' + $s.version) ([string]$s.root) $ColDim
    Add-SumRow '내 설정 위치' '' ([string]$s.paths.home) $ColDim
    if (-not $s.config.exists) { Add-SumRow '설정 파일' '없음' 'install 을 먼저 실행하세요' $ColBad }
    elseif (-not $s.config.valid) { Add-SumRow '설정 파일' '문제 있음' ((@($s.config.errors) -join ' / ')) $ColBad }
    elseif (@($s.config.unset).Count -gt 0) { Add-SumRow '설정 파일' '값 미설정' (("아직 바꾸지 않은 값: " + (@($s.config.unset) -join ', ') + " (카드에 그대로 들어가고 해당 범위 창이 잡히지 않음)")) $ColWarn }
    else { Add-SumRow '설정 파일' '정상' ("총지휘 이름 " + $s.config.values.commander_name + " / 공간 " + $s.config.values.scope_prefix) $ColOk }
    if ($s.envRules.exists) { if (@($s.envRules.errors).Count) { Add-SumRow '환경 규칙' '문제 있음' ((@($s.envRules.errors) -join ' / ')) $ColBad } else { Add-SumRow '환경 규칙' ('' + $s.envRules.count + '개') '모든 카드 끝에 붙는 이 PC 전용 규칙' $ColOk } } else { Add-SumRow '환경 규칙' '없음' '(선택 사항)' $ColDim }
    $on = @($s.roles | Where-Object { $_.enabled -eq $true }).Count
    if (@($s.problems).Count) { Add-SumRow '역할 파일' ('오류 ' + @($s.problems).Count + '건') ((@($s.problems | ForEach-Object { $_.label + ': ' + ((@($_.errors)) -join ' ') }) -join ' | ')) $ColBad }
    else { Add-SumRow '역할 파일' ('' + @($s.roles).Count + '개 (켜짐 ' + $on + ')') ('내가 덮어씀 ' + @($s.roles | Where-Object { $_.source -eq 'override' }).Count + ' / 내가 만듦 ' + @($s.roles | Where-Object { $_.source -eq 'user' }).Count) $ColOk }
    $g = $s.generated
    switch ($g.state) {
        'fresh' { Add-SumRow '생성물' '최신' ([string]$g.dir) $ColOk }
        'stale' { Add-SumRow '생성물' '낡음' ('바뀐 파일: ' + (@($g.changed) -join ', ') + ' -> [sync 실행]을 누르세요') $ColWarn }
        'none' { Add-SumRow '생성물' '아직 없음' ([string]$g.note) $ColWarn }
        default { Add-SumRow '생성물' '알 수 없음' ([string]$g.note) $ColDim }
    }
    if ($s.backups.count -gt 0) { Add-SumRow '백업' ('' + $s.backups.count + '개') ('가장 최근 ' + (Fmt-Time $s.backups.latest.createdAt) + '  ' + $s.backups.latest.note) $(if ($s.backups.tooMany) { $ColWarn } else { $ColOk }) } else { Add-SumRow '백업' '없음' '바꾸기 전에 자동으로 만들어집니다' $ColDim }
    foreach ($t in @($s.layout)) { Add-SumRow ('탭 ' + $t.name) ('자리 ' + (@($t.seats) -join ',')) ((@($t.roles) -join ', ')) $ColDim }
    $sumList.EndUpdate()
    foreach ($l in @($rolesList, $edList)) { $l.BeginUpdate(); $l.Items.Clear() }
    foreach ($r in @($s.roles)) {
        $stateText = if ($r.errors -and @($r.errors).Count) { '오류' } elseif ($r.enabled -eq $true) { '켜짐' } else { '꺼짐' }
        $col = if ($stateText -eq '오류') { $ColBad } elseif ($stateText -eq '꺼짐') { $ColDim } else { [System.Drawing.SystemColors]::ControlText }
        $i1 = New-Object System.Windows.Forms.ListViewItem([string]$r.slot)
        foreach ($v in @([string]$r.id, [string]$r.name, [string]$r.summary, [string]$r.kind, [string]$r.mode, $stateText, (Source-Text $r.source))) { [void]$i1.SubItems.Add($v) }
        $i1.ForeColor = $col; [void]$rolesList.Items.Add($i1)
        $i2 = New-Object System.Windows.Forms.ListViewItem([string]$r.slot)
        foreach ($v in @([string]$r.id, [string]$r.name, $stateText, (Source-Text $r.source))) { [void]$i2.SubItems.Add($v) }
        $i2.ForeColor = $col; $i2.Tag = $r.id; [void]$edList.Items.Add($i2)
    }
    foreach ($l in @($rolesList, $edList)) { $l.EndUpdate() }
    $cmbRep.Items.Clear(); [void]$cmbRep.Items.Add('user'); foreach ($r in @($s.roles)) { [void]$cmbRep.Items.Add([string]$r.id) }
    if (-not $txtGen.Text) { $ui = Load-UiState; $txtGen.Text = if ($ui -and $ui.generatedDir) { [string]$ui.generatedDir } elseif ($g.dir) { [string]$g.dir } else { '' } }
}
function Fill-Backups {
    $r = Call-Manage 'backup-list' @{}
    $script:Backups = @(); $bkList.Items.Clear()
    if (-not $r.ok) { return }
    $script:Backups = @($r.backups)
    foreach ($b in $script:Backups) {
        $when = ''; try { $when = ([datetime]$b.createdAt).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss') } catch { $when = [string]$b.createdAt }
        $it = New-Object System.Windows.Forms.ListViewItem($when)
        foreach ($v in @([string]$b.kind, [string]$b.note, [string]$b.files, [string]$b.dir)) { [void]$it.SubItems.Add($v) }
        $it.Tag = $b.dir; [void]$bkList.Items.Add($it)
    }
}
function Refresh-All {
    try { if ($stSplit.Height -gt 450 -and $stSplit.SplitterDistance -ne 290) { $stSplit.SplitterDistance = 290 } } catch {}
    $form.Cursor = 'WaitCursor'
    try {
        $gen = $txtGen.Text.Trim()
        $req = @{}; if ($gen) { $req.generated = $gen }
        $s = Call-Manage 'status' $req
        if (-not $s.ok) { Set-Bar ('현황을 읽지 못했습니다: ' + (Errors-Text $s)) $ColBad; return }
        $script:Status = $s; $script:OrchHome = [string]$s.paths.home
        $rl = Call-Manage 'role-list' @{}
        $script:RoleFull = @{}; if ($rl.ok) { foreach ($r in @($rl.roles)) { $script:RoleFull[[string]$r.id] = $r } }
        Fill-Status; Fill-Backups
        Set-Bar ('내 설정: ' + $script:OrchHome) $ColDim
    } finally { $form.Cursor = 'Default' }
}

# ---------------------------------------------------------------- 역할 편집 동작
function Selected-RoleId { if ($edList.SelectedItems.Count -gt 0) { return [string]$edList.SelectedItems[0].Tag } else { return $null } }
function Load-RoleToForm {
    $id = Selected-RoleId
    $script:Loaded = $null
    if (-not $id -or -not $script:RoleFull.ContainsKey($id)) { $edInfo.Text = '(왼쪽에서 역할을 고르세요)'; return }
    $r = $script:RoleFull[$id]; $m = $r.meta; $script:Loaded = $r
    $ov = ''; if ($r.source -eq 'override') { $ov = ' - 내가 덮어쓴 항목: ' + (@($r.overridden) -join ', ') }
    $edInfo.Text = ('역할 ' + $id + ' (' + (Source-Text $r.source) + ')' + $ov)
    $txtName.Text = [string]$m.name; $txtSum.Text = [string]$m.summary; $numSlot.Value = [int]$m.slot; $chkOn.Checked = ($m.enabled -eq $true)
    $cmbMode.SelectedItem = (Choice-Disp ([string]$m.mode)); $cmbCad.SelectedItem = (Choice-Disp ([string]$m.cadence)); $cmbRep.SelectedItem = [string]$m.reports_to
    $txtWr.Text = (@($m.writes_to) -join "`r`n"); $txtBody.Text = ([string]$r.body -replace "`r?`n", "`r`n")
    $isBundleKind = ($m.kind -ne 'worker')
    $btnRevert.Enabled = ($r.source -eq 'override'); $btnDel.Enabled = ($r.source -eq 'user')
}
function Do-Result($r, [string]$OkText) {
    if ($r.ok) {
        $extra = ''; if ($r.backup) { $extra = "`r`n(변경 전 상태는 자동 백업됨: " + $r.backup + ')' }
        Say-Box ($OkText + $extra); Refresh-All; return $true
    }
    Say-Box ("적용하지 않았습니다. 내 설정은 그대로입니다.`r`n`r`n" + (Errors-Text $r)) '적용 안 됨' 'Warning'; return $false
}
function Save-Role {
    if (-not $script:Loaded) { return }
    $m = $script:Loaded.meta; $f = @{}
    if ($txtName.Text -ne [string]$m.name) { $f.name = $txtName.Text }
    if ($txtSum.Text -ne [string]$m.summary) { if ($txtSum.Text.Trim() -eq '') { Say-Box '"하는 일"은 비울 수 없습니다.' '확인' 'Warning'; return }; $f.summary = $txtSum.Text }
    if ([int]$numSlot.Value -ne [int]$m.slot) { $f.slot = [int]$numSlot.Value }
    if ($chkOn.Checked -ne ($m.enabled -eq $true)) { $f.enabled = [bool]$chkOn.Checked }
    if ((Choice-Val $cmbMode.SelectedItem) -ne [string]$m.mode) { $f.mode = (Choice-Val $cmbMode.SelectedItem) }
    if ((Choice-Val $cmbCad.SelectedItem) -ne [string]$m.cadence) { $f.cadence = (Choice-Val $cmbCad.SelectedItem) }
    if ([string]$cmbRep.SelectedItem -ne [string]$m.reports_to -and $cmbRep.SelectedItem) { $f.reports_to = [string]$cmbRep.SelectedItem }
    $wr = @($txtWr.Text -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
    if ((($wr -join "`n")) -ne ((@($m.writes_to)) -join "`n")) { $f.writes_to = @($wr) }
    $req = @{ id = [string]$script:Loaded.id; fields = $f }
    $bodyNow = ($txtBody.Text -replace "`r`n", "`n").TrimEnd(); $bodyOld = ([string]$script:Loaded.body -replace "`r?`n", "`n").TrimEnd()
    if ($bodyNow -ne $bodyOld) { $req.body = $bodyNow }
    if ($f.Count -eq 0 -and -not $req.ContainsKey('body')) { Say-Box '바뀐 내용이 없습니다.'; return }
    $form.Cursor = 'WaitCursor'; try { $r = Call-Manage 'role-set' $req } finally { $form.Cursor = 'Default' }
    [void](Do-Result $r '저장했습니다.')
}
function New-RoleDialog {
    $d = New-Object System.Windows.Forms.Form
    $d.Text = '새 역할 만들기'; $d.Size = (Sz 520 300); $d.StartPosition = 'CenterParent'; $d.FormBorderStyle = 'FixedDialog'; $d.MaximizeBox = $false; $d.MinimizeBox = $false
    $d.Font = New-Object System.Drawing.Font($FontName, 10)
    $l1 = New-Ctl 'Label' @{ Text = 'id (영문 소문자·숫자·하이픈, 2~31자)'; AutoSize = $true; Location = (Pt 14 16) }
    $t1 = New-Ctl 'TextBox' @{ Location = (Pt 14 40); Size = (Sz 470 26) }
    $l2 = New-Ctl 'Label' @{ Text = '이름 (화면에 보일 이름, 비우면 id)'; AutoSize = $true; Location = (Pt 14 76) }
    $t2 = New-Ctl 'TextBox' @{ Location = (Pt 14 100); Size = (Sz 470 26) }
    $l3 = New-Ctl 'Label' @{ Text = '본보기 (복사해서 시작)'; AutoSize = $true; Location = (Pt 14 136) }
    $c3 = New-Ctl 'ComboBox' @{ Location = (Pt 14 160); Size = (Sz 470 26); DropDownStyle = 'DropDownList' }
    [void]$c3.Items.Add('(빈 역할로 시작)')
    foreach ($r in @($script:Status.roles | Where-Object { $_.kind -eq 'worker' -and -not (@($_.errors).Count) })) { [void]$c3.Items.Add([string]$r.id) }
    $c3.SelectedIndex = 0
    $ok = New-Btn '만들기' 280 208 100 34; $cancel = New-Btn '취소' 390 208 94 34
    $cancel.DialogResult = 'Cancel'; $d.CancelButton = $cancel
    $ok.Add_Click({
        $req = @{ id = $t1.Text.Trim(); fields = @{} }
        if ($t2.Text.Trim()) { $req.fields.name = $t2.Text.Trim() }
        if ($c3.SelectedIndex -gt 0) { $req.from = [string]$c3.SelectedItem }
        $d.Tag = $req; $d.DialogResult = 'OK'; $d.Close()
    })
    $d.Controls.AddRange(@($l1, $t1, $l2, $t2, $l3, $c3, $ok, $cancel))
    $res = $d.ShowDialog($form)
    if ($res -eq 'OK') { return $d.Tag } else { return $null }
}

# ---------------------------------------------------------------- 미리보기 창(불러오기·복구 공용)
function Show-PlanDialog($Plan, [string]$Title, [string]$ApplyLabel, [scriptblock]$ApplyAction) {
    $d = New-Object System.Windows.Forms.Form
    $d.Text = $Title; $d.Size = (Sz 1000 700); $d.MinimumSize = (Sz 820 560); $d.StartPosition = 'CenterParent'
    $d.Font = New-Object System.Drawing.Font($FontName, 10)
    $c = $Plan.counts
    $head = New-Ctl 'Label' @{ Dock = 'Top'; Height = 70; Padding = (New-Object System.Windows.Forms.Padding(8, 6, 8, 0)) }
    $headText = ('추가 ' + $c.add + ' / 바뀜 ' + $c.change + ' / 지움 ' + $c.remove + ' / 같음 ' + $c.same + '   (방식: ' + $(if ($Plan.mode -eq 'replace') { '교체' } else { '합치기' }) + ')')
    if ($Plan.note) { $headText += ("`r`n묶음 메모: " + $Plan.note) }
    if ($Plan.noop) { $headText += "`r`n바뀌는 것이 없습니다." }
    $head.Text = $headText
    $list = New-List @('동작', '파일', '역할', '켜짐(전 -> 후)') @(80, 360, 210, 140); $list.Dock = 'Top'; $list.Height = 220
    $info = New-Ctl 'TextBox' @{ Dock = 'Top'; Height = 96; Multiline = $true; ReadOnly = $true; ScrollBars = 'Vertical'; BackColor = [System.Drawing.Color]::White }
    $lines = @()
    foreach ($n in @($Plan.notes)) { if ($n) { $lines += ('* ' + $n.message) } }
    foreach ($s in @($Plan.skipped)) { if ($s) { $lines += ('- 받지 않음: ' + $s.path + ' - ' + $s.reason) } }
    foreach ($w in @($Plan.warnings)) { if ($w) { $lines += ('! ' + $w) } }
    if ($lines.Count -eq 0) { $lines = @('알림 없음') }
    $info.Text = ($lines -join "`r`n")
    $split = New-Object System.Windows.Forms.SplitContainer; $split.Dock = 'Fill'; $split.Orientation = 'Vertical'
    $before = New-Ctl 'TextBox' @{ Dock = 'Fill'; Multiline = $true; ReadOnly = $true; ScrollBars = 'Both'; WordWrap = $false; BackColor = [System.Drawing.Color]::White; Font = New-Object System.Drawing.Font('Consolas', 9.5) }
    $after = New-Ctl 'TextBox' @{ Dock = 'Fill'; Multiline = $true; ReadOnly = $true; ScrollBars = 'Both'; WordWrap = $false; BackColor = [System.Drawing.Color]::White; Font = New-Object System.Drawing.Font('Consolas', 9.5) }
    $lb = New-Ctl 'Label' @{ Dock = 'Top'; Height = 22; Text = '지금(이 PC)'; ForeColor = $ColDim }; $la = New-Ctl 'Label' @{ Dock = 'Top'; Height = 22; Text = '적용 후'; ForeColor = $ColDim }
    $split.Panel1.Controls.Add($before); $split.Panel1.Controls.Add($lb); $split.Panel2.Controls.Add($after); $split.Panel2.Controls.Add($la)
    $foot = New-Object System.Windows.Forms.Panel; $foot.Dock = 'Bottom'; $foot.Height = 54
    $apply = New-Btn $ApplyLabel 10 8 220 38; $apply.Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold); $apply.Enabled = (-not $Plan.noop)
    $close = New-Btn '닫기' 240 8 100 38; $close.DialogResult = 'Cancel'; $d.CancelButton = $close
    $foot.Controls.AddRange(@($apply, $close))
    $act = @{ 'add' = '추가'; 'change' = '바뀜'; 'remove' = '지움'; 'same' = '같음' }
    foreach ($ch in @($Plan.changes)) {
        $it = New-Object System.Windows.Forms.ListViewItem($act[[string]$ch.action])
        $roleText = ''; $onText = ''
        if ($ch.role) {
            $roleText = if ($ch.role.name) { [string]$ch.role.name } else { [string]$ch.role.id + ' (덮어쓰기)' }
            $beforeText = if ($ch.roleBefore) { On-Text $ch.roleBefore.enabled } elseif ($ch.role.bundle) { '번들 기본' } else { '없음' }
            $onText = ($beforeText + ' -> ' + (On-Text $ch.role.enabled))
        }
        [void]$it.SubItems.Add([string]$ch.path); [void]$it.SubItems.Add($roleText); [void]$it.SubItems.Add($onText)
        $it.Tag = $ch
        if ($ch.action -eq 'remove') { $it.ForeColor = $ColBad } elseif ($ch.action -eq 'same') { $it.ForeColor = $ColDim } elseif ($ch.action -eq 'add') { $it.ForeColor = $ColOk }
        [void]$list.Items.Add($it)
    }
    $list.Add_SelectedIndexChanged({
        if ($list.SelectedItems.Count -gt 0) { $ch = $list.SelectedItems[0].Tag; $before.Text = (([string]$ch.beforeText) -replace "`r?`n", "`r`n"); $after.Text = (([string]$ch.afterText) -replace "`r?`n", "`r`n") }
    }.GetNewClosure())
    $apply.Add_Click({
        if (-not (Ask-Box ("정말 적용할까요?`r`n적용 직전 현재 상태가 자동 백업되고, 문제가 생기면 자동으로 되돌립니다.") '적용 확인')) { return }
        $d.Cursor = 'WaitCursor'; try { $r = & $ApplyAction } finally { $d.Cursor = 'Default' }
        if (Do-Result $r '적용했습니다.') { $d.DialogResult = 'OK'; $d.Close() }
    }.GetNewClosure())
    $d.Controls.Add($split); $d.Controls.Add($info); $d.Controls.Add($list); $d.Controls.Add($head); $d.Controls.Add($foot)
    if ($SelfTest) {
        $d.StartPosition = 'Manual'; $d.Location = (Pt -32000 -32000); $d.Show(); [System.Windows.Forms.Application]::DoEvents()
        if ($list.Items.Count -gt 0) { $list.Items[0].Selected = $true; [System.Windows.Forms.Application]::DoEvents() }
        return $d
    }
    [void]$d.ShowDialog($form)
}

# ---------------------------------------------------------------- 단추 동작
function Browse-Folder([string]$Desc) {
    $fb = New-Object System.Windows.Forms.FolderBrowserDialog; $fb.Description = $Desc; $fb.ShowNewFolderButton = $true
    if ($fb.ShowDialog($form) -eq 'OK') { return $fb.SelectedPath } else { return $null }
}
$btnRefresh.Add_Click({ Refresh-All })
$btnGenBrowse.Add_Click({ $p = Browse-Folder 'sync 가 역할표·카드를 만들 폴더'; if ($p) { $txtGen.Text = $p; Refresh-All } })
$btnSync.Add_Click({
    $out = $txtGen.Text.Trim()
    $msg = if ($out) { "역할표·카드·탭 배치 계획을 이 폴더에 만듭니다(같은 내용 파일은 건드리지 않음).`r`n" + $out } else { '기본 위치에 역할표·카드를 만듭니다.' }
    if (-not (Ask-Box ($msg + "`r`n`r`n실행할까요?") 'sync 실행')) { return }
    $form.Cursor = 'WaitCursor'; try { $req = @{}; if ($out) { $req.out = $out }; $r = Call-Manage 'sync-run' $req } finally { $form.Cursor = 'Default' }
    if ($r.ok) { if ($out) { Save-UiState $out }; Say-Box ('sync 완료.' + "`r`n" + $r.stdout); Refresh-All } else { Say-Box ('sync 가 멈췄습니다(출력은 그대로).' + "`r`n" + $r.stderr) 'sync 실패' 'Warning' }
})
$edList.Add_SelectedIndexChanged({ Load-RoleToForm })
$btnSave.Add_Click({ Save-Role })
$btnToggle.Add_Click({
    if (-not $script:Loaded) { return }
    $new = -not ($script:Loaded.meta.enabled -eq $true)
    $r = Call-Manage 'role-set' @{ id = [string]$script:Loaded.id; fields = @{ enabled = [bool]$new } }
    [void](Do-Result $r $(if ($new) { '켰습니다.' } else { '껐습니다.' }))
})
$btnRevert.Add_Click({
    if (-not $script:Loaded) { return }
    if (-not (Ask-Box ('"' + $script:Loaded.id + '" 역할의 내 덮어쓰기를 지우고 번들 값으로 되돌릴까요?' + "`r`n(지우는 파일은 자동 백업에 남습니다)") '되돌리기')) { return }
    [void](Do-Result (Call-Manage 'role-revert' @{ id = [string]$script:Loaded.id }) '번들 값으로 되돌렸습니다.')
})
$btnDel.Add_Click({
    if (-not $script:Loaded) { return }
    if (-not (Ask-Box ('내가 만든 "' + $script:Loaded.id + '" 역할을 삭제할까요?' + "`r`n(삭제 전 내용은 자동 백업에 남습니다)") '삭제')) { return }
    [void](Do-Result (Call-Manage 'role-delete' @{ id = [string]$script:Loaded.id }) '삭제했습니다.')
})
$btnNew.Add_Click({ $req = New-RoleDialog; if ($req) { [void](Do-Result (Call-Manage 'role-new' $req) ('역할 "' + $req.id + '"을(를) 만들었습니다. 새 역할은 자리를 자동 배정했으니 확인하세요.')) } })
$btnExBrowse.Add_Click({ $p = Browse-Folder '묶음을 저장할 폴더(그 안에 새 폴더가 만들어집니다)'; if ($p) { $txtExDest.Text = $p } })
$btnExport.Add_Click({
    if (-not $txtExDest.Text.Trim()) { Say-Box '저장할 폴더를 고르세요.' '확인' 'Warning'; return }
    $scope = if ($cmbExScope.SelectedIndex -eq 1) { 'full' } else { 'portable' }
    $r = Call-Manage 'export' @{ dest = $txtExDest.Text.Trim(); scope = $scope; note = $txtExNote.Text }
    if ($r.ok) { Say-Box ('내보냈습니다(' + $r.files + '개 파일).' + "`r`n" + $r.dir) } else { Say-Box (Errors-Text $r) '내보내기 실패' 'Warning' }
})
$btnImBrowse.Add_Click({ $p = Browse-Folder '불러올 묶음 폴더(package.json 이 들어 있는 폴더)'; if ($p) { $txtImPkg.Text = $p } })
$btnImPlan.Add_Click({
    $pkg = $txtImPkg.Text.Trim()
    if (-not $pkg) { Say-Box '불러올 묶음 폴더를 고르세요.' '확인' 'Warning'; return }
    $req = @{ pkg = $pkg; mode = $(if ($rbReplace.Checked) { 'replace' } else { 'merge' }); includeEnvRules = [bool]$chkEnv.Checked; includeIgnore = [bool]$chkIgn.Checked; enableImported = [bool]$chkEnable.Checked }
    $form.Cursor = 'WaitCursor'; try { $plan = Call-Manage 'import-plan' $req } finally { $form.Cursor = 'Default' }
    if (-not $plan.ok) { Say-Box ("불러올 수 없습니다. 내 설정은 그대로입니다.`r`n`r`n" + (Errors-Text $plan)) '불러오기 불가' 'Warning'; return }
    $areq = @{ pkg = $pkg; mode = $req.mode; includeEnvRules = $req.includeEnvRules; includeIgnore = $req.includeIgnore; enableImported = $req.enableImported; token = [string]$plan.token }
    Show-PlanDialog $plan '불러오기 미리보기' '이대로 적용' ({ Call-Manage 'import-apply' $areq }.GetNewClosure())
})
$btnBackup.Add_Click({
    $r = Call-Manage 'backup' @{ note = $txtBkNote.Text }
    if ($r.ok) { if ($r.empty) { Say-Box '백업할 내 설정이 아직 없습니다.' } else { Say-Box ('백업했습니다(' + $r.files + '개 파일).' + "`r`n" + $r.dir) }; Refresh-All } else { Say-Box (Errors-Text $r) '백업 실패' 'Warning' }
})
$btnRestore.Add_Click({
    if ($bkList.SelectedItems.Count -eq 0) { Say-Box '복구할 백업을 목록에서 고르세요.' '확인' 'Warning'; return }
    $dir = [string]$bkList.SelectedItems[0].Tag
    $form.Cursor = 'WaitCursor'; try { $plan = Call-Manage 'restore-plan' @{ pkg = $dir } } finally { $form.Cursor = 'Default' }
    if (-not $plan.ok) { Say-Box ("이 백업으로 복구할 수 없습니다. 내 설정은 그대로입니다.`r`n`r`n" + (Errors-Text $plan)) '복구 불가' 'Warning'; return }
    $areq = @{ pkg = $dir; token = [string]$plan.token }
    Show-PlanDialog $plan '복구 미리보기' '이 백업으로 복구' ({ Call-Manage 'restore-apply' $areq }.GetNewClosure())
})
$btnOpenBk.Add_Click({ $p = if ($script:Status) { [string]$script:Status.paths.backups } else { '' }; if ($p -and (Test-Path -LiteralPath $p)) { Start-Process explorer.exe -ArgumentList ('"' + $p + '"') } else { Say-Box '아직 백업 폴더가 없습니다.' } })

# ---------------------------------------------------------------- 실제 창 조회(읽기 전용)
function Live-StatusText([string]$s) { switch ($s) { 'blocked' { '승인 대기' } 'idle' { '대기' } 'working' { '작업 중' } 'done' { '완료' } '' { '(없음)' } default { $s } } }
function Refresh-Live {
    $form.Cursor = 'WaitCursor'
    $lvList.BeginUpdate()
    try {
        $lvList.Items.Clear()
        $r = Call-Manage 'live-windows' @{}
        if (-not $r.ok) { $lvSummary.Text = '조회하지 못했습니다: ' + (Errors-Text $r); $lvSummary.ForeColor = $ColBad; return }
        if (-not $r.available) { $lvSummary.Text = [string]$r.note; $lvSummary.ForeColor = $ColWarn; return }
        $shown = 0
        foreach ($w in @($r.windows)) {
            if ($chkLvScope.Checked -and $w.inScope -ne $true) { continue }
            $scopeText = if ($w.inScope -eq $true) { '안' } elseif ($w.inScope -eq $false) { '밖' } else { '-' }
            $it = New-Object System.Windows.Forms.ListViewItem([string]$w.address)
            foreach ($v in @((Live-StatusText ([string]$w.status)), $scopeText, [string]$w.agent, [string]$w.turn, [string]$w.where)) { [void]$it.SubItems.Add($v) }
            if ($w.status -eq 'blocked') { $it.ForeColor = $ColWarn; $it.Font = New-Object System.Drawing.Font($FontName, 10, [System.Drawing.FontStyle]::Bold) }
            elseif ($w.inScope -eq $false) { $it.ForeColor = $ColDim }
            $it.Tag = [string]$w.address; [void]$lvList.Items.Add($it); $shown++
        }
        $all = @($r.windows)
        $blocked = @($all | Where-Object { $_.status -eq 'blocked' }).Count
        $working = @($all | Where-Object { $_.status -eq 'working' }).Count
        $inScope = @($all | Where-Object { $_.inScope -eq $true }).Count
        $txt = '창 ' + $r.total + '개 (표시 ' + $shown + ')  |  승인 대기 ' + $blocked + '  |  작업 중 ' + $working
        if ($r.scope) { $txt += '  |  범위 안 ' + $inScope } else { $txt += '  |  범위 미설정' }
        $txt += '  |  조회 ' + (Get-Date).ToString('HH:mm:ss')
        $lvSummary.Text = $txt; $lvSummary.ForeColor = $(if ($blocked -gt 0) { $ColWarn } else { $ColOk })
    } finally { $lvList.EndUpdate(); $form.Cursor = 'Default' }
}
$btnLvRefresh.Add_Click({ Refresh-Live })
$chkLvScope.Add_CheckedChanged({ Refresh-Live })
$chkLvAuto.Add_CheckedChanged({ $lvTimer.Enabled = [bool]$chkLvAuto.Checked })
$lvTimer.Add_Tick({ if ($tabs.SelectedTab -eq $tLive) { Refresh-Live } })
$btnLvCopy.Add_Click({
    if ($lvList.SelectedItems.Count -eq 0) { Say-Box '복사할 창을 목록에서 고르세요.' '확인' 'Warning'; return }
    try { [System.Windows.Forms.Clipboard]::SetText([string]$lvList.SelectedItems[0].Tag); Set-Bar ('주소를 복사했습니다: ' + $lvList.SelectedItems[0].Tag) $ColOk } catch { Say-Box '클립보드에 복사하지 못했습니다.' '확인' 'Warning' }
})
$tabs.Add_SelectedIndexChanged({ if ($tabs.SelectedTab -eq $tLive) { Refresh-Live } elseif ($tabs.SelectedTab -eq $tRoleCk) { Refresh-RoleCheck } })

# ---------------------------------------------------------------- 역할 점검(읽기 전용)
function RoleCk-StatusText([string]$s) { switch ($s) { 'ok' { '정상' } 'moved' { '탭 밖' } 'missing' { '없음' } 'unknown' { '확인 불가' } 'guess' { '추정만' } 'unassigned' { '배정 안 됨' } default { $s } } }
function Refresh-RoleCheck {
    $form.Cursor = 'WaitCursor'
    $rcList.BeginUpdate()
    try {
        $rcList.Items.Clear()
        $r = Call-Manage 'role-check' @{}
        if (-not $r.ok) { $rcSummary.Text = '점검하지 못했습니다: ' + (Errors-Text $r); $rcSummary.ForeColor = $ColBad; return }
        if (-not $r.available) { $rcSummary.Text = [string]$r.note; $rcSummary.ForeColor = $ColWarn; return }
        foreach ($x in @($r.roles)) {
            $it = New-Object System.Windows.Forms.ListViewItem([string]$x.slot)
            $note = if ($x.note) { [string]$x.note } else { '' }
            foreach ($v in @([string]$x.name, (RoleCk-StatusText ([string]$x.status)), [string]$x.address, [string]$x.sid8, (Live-StatusText ([string]$x.windowStatus)), $note)) { [void]$it.SubItems.Add($v) }
            if ($x.status -eq 'ok') { $it.ForeColor = $ColOk } elseif ($x.status -eq 'missing') { $it.ForeColor = $ColBad } elseif ($x.status -eq 'unassigned') { $it.ForeColor = $ColDim } else { $it.ForeColor = $ColWarn }
            [void]$rcList.Items.Add($it)
        }
        foreach ($e in @($r.extras)) {
            $it = New-Object System.Windows.Forms.ListViewItem('-')
            foreach ($v in @('(역할 배정 안 된 새 창)', '새 창', [string]$e.address, [string]$e.sid8, (Live-StatusText ([string]$e.status)), [string]$e.where)) { [void]$it.SubItems.Add($v) }
            $it.ForeColor = $ColWarn; [void]$rcList.Items.Add($it)
        }
        $bad = [int]$r.summary.moved + [int]$r.summary.missing + [int]$r.summary.unknown + [int]$r.summary.guess + [int]$r.summary.unassigned + @($r.extras).Count
        $rcSummary.Text = [string]$r.headline + '  |  점검 ' + (Get-Date).ToString('HH:mm:ss')
        $rcSummary.ForeColor = $(if ($bad -eq 0) { $ColOk } elseif ([int]$r.summary.missing -gt 0) { $ColBad } else { $ColWarn })
    } finally { $rcList.EndUpdate(); $form.Cursor = 'Default' }
}
$btnRcRefresh.Add_Click({ Refresh-RoleCheck })
$chkRcAuto.Add_CheckedChanged({ $rcTimer.Enabled = [bool]$chkRcAuto.Checked })
$rcTimer.Add_Tick({ if ($tabs.SelectedTab -eq $tRoleCk) { Refresh-RoleCheck } })

# ---------------------------------------------------------------- 시작
function Start-Main {
    $script:Node = Find-Node
    if (-not $script:Node) { Say-Box 'Node.js 를 찾을 수 없습니다. Node.js 를 설치한 뒤 다시 실행하세요.' '실행 불가' 'Error'; return 1 }
    if (-not (Test-Path -LiteralPath $Manage)) { Say-Box ('엔진 파일이 없습니다: ' + $Manage) '실행 불가' 'Error'; return 1 }
    if ($SelfTest) {
        if (-not $ShotDir) { Write-Host '-ShotDir 가 필요합니다'; return 2 }
        New-Item -ItemType Directory -Path $ShotDir -Force | Out-Null
        $form.StartPosition = 'Manual'; $form.Location = (Pt -32000 -32000); $form.Show(); [System.Windows.Forms.Application]::DoEvents()
        Refresh-All
        if ($edList.Items.Count -gt 0) { $edList.Items[0].Selected = $true }
        $names = @('1-status', '2-roles', '3-share', '4-backup', '5-live', '6-rolecheck')
        for ($i = 0; $i -lt 6; $i++) {
            $tabs.SelectedIndex = $i; [System.Windows.Forms.Application]::DoEvents()
            $bmp = New-Object System.Drawing.Bitmap($form.Width, $form.Height)
            $form.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
            $bmp.Save((Join-Path $ShotDir ($names[$i] + '.png')), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
        }
        if ($PlanPackage) {
            $plan = Call-Manage 'import-plan' @{ pkg = $PlanPackage; mode = 'merge' }
            if ($plan.ok) {
                $pd = Show-PlanDialog $plan '불러오기 미리보기' '이대로 적용' ({ $null })
                $bmp = New-Object System.Drawing.Bitmap($pd.Width, $pd.Height); $pd.DrawToBitmap($bmp, (New-Object System.Drawing.Rectangle(0, 0, $pd.Width, $pd.Height)))
                $bmp.Save((Join-Path $ShotDir '6-plan.png'), [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose(); $pd.Close()
            } else { Write-Host ('계획 실패: ' + (Errors-Text $plan)) }
        }
        $form.Close()
        Write-Host ('SELFTEST OK roles=' + @($script:Status.roles).Count + ' home=' + $script:OrchHome)
        return 0
    }
    $form.Add_Shown({ Refresh-All })
    [void]$form.ShowDialog()
    return 0
}
try { $code = Start-Main; exit $code }
catch {
    $msg = '관리 창에서 예상하지 못한 오류가 났습니다.' + "`r`n" + $_.Exception.Message
    if ($SelfTest) { Write-Host ('SELFTEST FAIL ' + $_.Exception.Message + "`r`n" + $_.ScriptStackTrace); exit 1 }
    [void][System.Windows.Forms.MessageBox]::Show($msg, 'Herdr 오케스트레이션 관리', 'OK', 'Error'); exit 1
}
