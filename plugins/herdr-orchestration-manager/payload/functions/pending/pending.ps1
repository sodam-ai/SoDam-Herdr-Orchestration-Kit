# pending.ps1 - show only the pending command of every blocked Claude Code window (compact).
# Read-only. Skips self (HC_TERMINAL_ID), non-claude windows and names in config\ignore.txt.
# Usage: powershell -NoProfile -File pending.ps1 [-Lines 80] [-Only t3,t12]
param([int]$Lines = 80, [string[]]$Only = @())
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot '..\..\lib\orch-paths.ps1')
# ignore.txt lives in the config folder; a missing file means an empty list (no error).
$ignoreFile = Join-Path $OrchConfig 'ignore.txt'
$ignore = @()
if (Test-Path -LiteralPath $ignoreFile) { $ignore = @(Get-Content -LiteralPath $ignoreFile -Encoding UTF8 | Where-Object { $_.Trim() -and $_ -notmatch '^\s*#' } | ForEach-Object { $_.Trim() }) }
# PORTABLE: no built-in window address. Read-only script, so a missing HC_TERMINAL_ID only means "cannot exclude my own window".
$self = $env:HC_TERMINAL_ID
if (-not $self) { '경고: 환경변수 HC_TERMINAL_ID가 없어 자기 창을 제외할 수 없습니다(읽기만 하므로 계속합니다).' }
$raw = (hc ls --json | Out-String).TrimStart([char]0xFEFF)
$rows = ($raw | ConvertFrom-Json).terminals | Where-Object {
  $_.status -eq 'blocked' -and $_.agent -eq 'claude-code' -and $_.address -ne $self }
$rows = $rows | Where-Object { $w = $_.where; -not ($ignore | Where-Object { ([string]$w).IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
$Only = @($Only | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
if ($Only.Count) { $rows = $rows | Where-Object { $Only -contains $_.address } }
$risk = '(?i)(\s>\s?["$/A-Za-z]|>>|\btee\b|Out-File|Set-Content|Add-Content|Remove-Item|\brm\s|\bdel\s|git push|git commit|git reset|git rebase|git checkout\s+--|gh pr merge|gh release|gh repo|--force|--admin|--delete-branch|--no-verify|/tmp/|\\Temp\\|/Temp/|\.env|npm (i|install)\b|curl\s|Invoke-WebRequest|open\([^)]*[''"]w)'
foreach ($r in $rows) {
  hc keys $r.address ctrl+end | Out-Null
  $screen = @(hc read $r.address --lines $Lines)
  $hi = -1; for ($i = 0; $i -lt $screen.Count; $i++) { if ($screen[$i] -match '^\s*(Bash command|PowerShell command)') { $hi = $i } }
  $cmdSrc = if ($hi -ge 0) { $screen[$hi..($screen.Count - 1)] } else { @() }
  $cmd = @($cmdSrc | Where-Object { $_ -match '^\s*│' -and $_ -notmatch 'Hook PreToolUse|requires confirmation|\[plugin:|소담 에이전틱' } | ForEach-Object { ($_ -replace '^\s*│\s?', '').TrimEnd() })
  $ask = @($screen | Where-Object { $_ -match 'Do you want to|Bash command|PowerShell command|Edit file|Create file|Write\(|Update\(' } | Select-Object -Last 2 | ForEach-Object { $_.Trim() })
  $hook = @($screen | Where-Object { $_ -match '\[plugin:|settings\.json to update hooks|plugin hooks\.json' } | Select-Object -Last 1 | ForEach-Object { $_.Trim() })
  $yes = [bool]($screen -match ([char]0x276F + '\s*1\.\s*Yes'))
  $joined = ($cmd -join ' ')
  $flags = ([regex]::Matches($joined, $risk) | ForEach-Object { $_.Value.Trim() } | Select-Object -Unique) -join ' | '
  "=== {0} [{1}] turn={2} focus1Yes={3}" -f $r.address, ($r.where -replace '^.*/ ', ''), $r.turn, $yes
  if ($ask) { "  ask : " + ($ask -join ' / ') }
  if ($hook) { "  hook: " + $hook }
  if ($cmd.Count) { "  cmd : " + ($(if ($joined.Length -gt 1500) { $joined.Substring(0, 1500) + ' ...(cut)' } else { $joined })) }
  else { "  cmd : (no command block - edit/menu prompt, read the screen)" }
  "  RISK: " + $(if ($flags) { $flags } else { '-' })
}
if (-not $rows) { 'no blocked windows' }
