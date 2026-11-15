# approve.ps1 - answer ONE blocked approval prompt safely (Enter = Yes, or -Deny = Esc).
# It presses nothing unless ALL checks pass:
#   1) hc ls says the window is blocked   2) after ctrl+End the screen shows the focused "1. Yes" (or Esc for -Deny)
#   3) every -Expect text is on the screen (use exact pieces of the command you read with pending.ps1)
#   4) no -Forbid text is on the command lines
# Usage: approve.ps1 -T t13 -Expect 'gh pr merge 24 --merge --match-head-commit ec2c068' [-Forbid '--admin','--delete-branch'] [-Deny] [-DryRun]
param(
  [Parameter(Mandatory = $true)][string]$T,
  [Parameter(Mandatory = $true)][string[]]$Expect,
  [string[]]$Forbid = @(),
  [switch]$Deny,
  [switch]$AllowRisky,
  [switch]$DryRun,
  [switch]$HeaderScrolled,
  [switch]$Exact,   # command prompts only: the whole normalized command must EQUAL -Expect[0] (no substring match)
  [int]$Lines = 120
)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot '..\..\lib\orch-paths.ps1')
New-OrchDirs   # this script writes approve-log.txt in the logs folder
# PORTABLE: no built-in window address. HC_TERMINAL_ID (this window's address) is required so "never answer my own window" can work.
if (-not $env:HC_TERMINAL_ID) { "오류: 환경변수 HC_TERMINAL_ID(이 창의 주소)가 없습니다. 자기 창을 구별할 수 없어 아무것도 누르지 않고 종료합니다."; exit 1 }
$self = $env:HC_TERMINAL_ID
if ($T -eq $self) { "$T SKIP: never answer my own window"; exit 2 }
$raw = (hc ls --json | Out-String).TrimStart([char]0xFEFF)
$row = ($raw | ConvertFrom-Json).terminals | Where-Object { $_.address -eq $T }
if (-not $row) { "$T SKIP: no such window"; exit 2 }
if ($row.status -ne 'blocked') { "$T SKIP: status is $($row.status), not blocked"; exit 2 }
hc keys $T ctrl+end | Out-Null
Start-Sleep -Milliseconds 400
$screen = @(hc read $T --lines $Lines)
$text = $screen -join "`n"
$hi = -1; for ($i = 0; $i -lt $screen.Count; $i++) { if ($screen[$i] -match '^\s*(Bash command|PowerShell command|Edit file|Create file)') { $hi = $i } }
$cmdSrc = if ($hi -ge 0) { @($screen[$hi..($screen.Count - 1)]) } else { @($screen) }
$cmdText = (@($cmdSrc | Where-Object { $_ -match '^\s*│' }) -join "`n")
if ($Deny) {
  if ($text -notmatch 'Esc to cancel') { "$T SKIP: no cancellable prompt on screen"; exit 2 }
} else {
  if ($text -notmatch ([char]0x276F + '\s*1\.\s*Yes')) { "$T SKIP: focused '1. Yes' not found"; exit 2 }
}
if ($hi -lt 0 -and $HeaderScrolled) {
  # Opt-in fallback for file create/edit prompts whose header scrolled off (long file preview above it).
  # Still requires the question line ("create <file>" / "make this edit to <file>") and every -Expect text in the tail below it.
  $qi = -1; for ($i = 0; $i -lt $screen.Count; $i++) { if ($screen[$i] -match '^\s*Do you want to (create|make this edit to|overwrite) ') { $qi = $i } }
  if ($qi -ge 0 -and $screen[$qi] -notmatch 'Bash|PowerShell|proceed') { $hi = $qi; $cmdSrc = @($screen[$qi..($screen.Count - 1)]); $cmdText = '' }
  # Command prompts (Bash/PowerShell) whose "Bash command" title scrolled off: accept ONLY if the whole command is still on screen,
  # i.e. both dashed lines that frame the command block are visible (so the first command line is seen, not cut).
  if ($hi -lt 0) {
    $dash = @(); for ($i = 0; $i -lt $screen.Count; $i++) { if ($screen[$i] -match '^\s*[╌]{10,}') { $dash += $i } }
    if ($dash.Count -ge 2 -and $screen[$dash[-2] + 1] -match '^\s*│') {
      $hi = $dash[-2]; $cmdSrc = @($screen[$hi..($screen.Count - 1)]); $forceCmd = $true
      $cmdText = (@($cmdSrc | Where-Object { $_ -match '^\s*│' }) -join "`n")
    }
  }
}
if ($hi -lt 0) { "$T SKIP: no active prompt block found (fail closed)"; exit 2 }
$blockText = ((@($cmdSrc) | ForEach-Object { ($_ -replace '^\s*│\s?', '').TrimEnd() }) -join "`n")
if ($blockText -notmatch 'Do you want|Esc to cancel') { "$T SKIP: prompt block has no question line (fail closed)"; exit 2 }
$flatBlock = ($blockText -replace '\s+', ' ')
foreach ($e in $Expect) { if (-not ($blockText.Contains($e) -or $flatBlock.Contains(($e -replace '\s+', ' ')))) { "$T SKIP: expected text not in the active prompt -> $e"; exit 2 } }
foreach ($f in $Forbid) { if ($cmdText.Contains($f) -or $flatBlock.Contains($f)) { "$T SKIP: forbidden text in command -> $f"; exit 2 } }
# Command-only text (between the header and the hook/question lines), whitespace-normalized.
$cmdLines = @(); foreach ($ln in @($cmdSrc | Select-Object -Skip 1)) { if ($ln -match 'Hook PreToolUse|requires confirmation|Do you want') { break }; $cmdLines += ($ln -replace '^\s*│\s?', '') }
$cmdOnly = (($cmdLines -join ' ') -replace '\s+', ' ').Trim()
$cmdForRisk = ($cmdOnly -replace '2>&1', '' -replace '2>\s*/dev/null', '' -replace '2>\s*\$null', '')
$expectFlat = (($Expect -join ' ') -replace '\s+', ' ')
# Fail closed on shell operators that could hide an extra action behind the expected text.
$riskRx = '(?<![\d&-])>{1,2}|\btee\b|\brm\b|Remove-Item|\bdel\b|git\s+(push|commit|reset|rebase|checkout|clean|merge|tag)|gh\s+(pr\s+merge|release|repo|api)|\bcurl\b|\bwget\b|Invoke-(WebRequest|Expression|RestMethod)|Set-Content|Add-Content|Out-File|npm\s+(i|install|publish|exec)|\bsudo\b|`|\$\(|\biex\b|\bsh\s+-c\b|bash\s+-c'
$isCmdPrompt = ($forceCmd -or ($screen[$hi] -match '^\s*(Bash command|PowerShell command)'))
if (-not $AllowRisky -and $cmdOnly -and $isCmdPrompt) {
  foreach ($mm in [regex]::Matches($cmdForRisk, $riskRx)) { if (-not $expectFlat.Contains($mm.Value.Trim())) { "$T SKIP: risky operator in command not covered by -Expect -> $($mm.Value.Trim())  (read the whole command; use -AllowRisky only after reading it)"; exit 2 } }
}
if ($Exact) {
  # Normalize both sides; strip the trailing hook sentence the prompt appends after the command.
  $c1 = ($cmdOnly -replace '\s+', ' ').Trim(); $e1 = (($Expect[0]) -replace '\s+', ' ').Trim()
  if (-not $isCmdPrompt) { "$T SKIP: -Exact works only for Bash/PowerShell command prompts"; exit 2 }
  if ($c1 -ne $e1) { "$T SKIP: command differs from -Expect[0] (-Exact)"; exit 2 }
}
if ($DryRun) { "$T DRYRUN OK: would press " + $(if ($Deny) { 'Esc' } else { 'Enter' }); exit 0 }
# Audit trail: what was approved, when, and which checks were relaxed (the log never holds secrets, only the prompt text on screen).
try {
  $why = @(); if ($AllowRisky) { $why += 'AllowRisky' }; if ($HeaderScrolled) { $why += 'HeaderScrolled' }; if ($Exact) { $why += 'Exact' }
  $snippet = (($cmdOnly + ' ' + ($screen[$hi] -replace '\s+', ' ')).Trim())
  if ($snippet.Length -gt 300) { $snippet = $snippet.Substring(0, 300) }
  Add-Content -LiteralPath (Join-Path $OrchLogs 'approve-log.txt') -Encoding UTF8 -Value ("{0}`t{1}`t{2}`t{3}`t{4}" -f (Get-Date -Format 'MM-dd HH:mm:ss'), $T, $(if ($Deny) { 'DENY' } else { 'APPROVE' }), ($why -join '+'), $snippet)
} catch { }
if ($Deny) { hc keys $T esc | Out-Null; "$T DENIED (Esc)" } else { hc keys $T enter | Out-Null; "$T APPROVED (Enter)" }
Start-Sleep -Milliseconds 600
$after = (((hc ls --json | Out-String).TrimStart([char]0xFEFF)) | ConvertFrom-Json).terminals | Where-Object { $_.address -eq $T }
"$T now: $($after.status)"
