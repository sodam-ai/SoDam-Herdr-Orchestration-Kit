# herdr-center.ps1 - Herdr control-center helper (READ-ONLY).
# Shows which Claude Code sessions in Herdr are blocked/done and what they are asking.
# It never sends input. To act on a session, use `hc send` / `hc keys` explicitly.
#
# Usage:
#   herdr-center.ps1 status                 # table of all live terminals (blocked first)
#   herdr-center.ps1 peek <t> [-Lines 14]   # last N non-empty screen lines of one terminal
#   herdr-center.ps1 digest [-Lines 14]     # peek at every blocked/error/done terminal (skips me)
param(
  [Parameter(Position = 0)][ValidateSet('status', 'peek', 'digest', 'queue', 'mark', 'next')][string]$Cmd = 'status',
  [Parameter(Position = 1)][string]$Target,
  [int]$Lines = 14,
  [int]$MaxPick = 4,
  [switch]$Preview
)

[Console]::OutputEncoding = [Text.Encoding]::UTF8
. (Join-Path $PSScriptRoot '..\..\lib\orch-paths.ps1')
New-OrchDirs   # this script writes served.log and round.txt in the state folder
# State/config files: served.log + round.txt in state\, ignore.txt + order.txt in config\ (ORCH_HOME moves them all).
$servedFile = Join-Path $OrchState 'served.log'
$roundFile = Join-Path $OrchState 'round.txt'
$ignoreFile = Join-Path $OrchConfig 'ignore.txt'
$orderFile = Join-Path $OrchConfig 'order.txt'
# "Helper window" name fragment (those only count when blocked/error). Default kept from the original; ORCH_CTRL_MATCH overrides.
$ctrlMatch = if ($env:ORCH_CTRL_MATCH) { $env:ORCH_CTRL_MATCH } else { 'Control-Tower' }
$me = $env:HC_TERMINAL_ID
$rank = @{ blocked = 0; error = 1; done = 2; working = 3; idle = 4 }

function Get-Terminals {
  $raw = (& hc ls --json | Out-String)
  @(($raw | ConvertFrom-Json).terminals)
}

function Show-Peek([string]$addr, [int]$n) {
  $text = (& hc read $addr | Out-String)
  $rows = $text -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last $n
  foreach ($r in $rows) {
    if ($r.Length -gt 170) { $r.Substring(0, 170) } else { $r }
  }
}

switch ($Cmd) {
  'status' {
    Get-Terminals |
      ForEach-Object {
        [pscustomobject]@{
          Addr   = $_.address
          Me     = $(if ($_.address -eq $me) { '<-- me' } else { '' })
          Agent  = $_.agent
          Status = $_.status
          Turn   = $_.turn
          Where  = $_.where
        }
      } |
      Sort-Object { if ($rank.ContainsKey($_.Status)) { $rank[$_.Status] } else { 9 } }, Addr |
      Format-Table -AutoSize
  }
  'peek' {
    if (-not $Target) { throw 'usage: herdr-center.ps1 peek <terminal> [-Lines N]' }
    Show-Peek $Target $Lines
  }
  'mark' {
    # Record "I just served these sessions" so the queue can rotate fairly. Usage: herdr-center.ps1 mark t3,t13
    $log = $servedFile
    $nowMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    foreach ($a in ($Target -split '[,\s]+' | Where-Object { $_ })) { Add-Content -LiteralPath $log -Value "$nowMs $a" -Encoding UTF8 }
    "marked: $Target"
  }
  'queue' {
    # Fair-service queue: sessions that need a person (blocked/done/error) first.
    # ORDER = the session that has gone LONGEST WITHOUT BEING SERVED by me comes first (served.log, written by `mark`);
    # a session that keeps producing small prompts therefore cannot crowd out quiet ones. Ties -> longest waiting.
    $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    $servedAt = @{}
    $slog = $servedFile
    if (Test-Path $slog) { foreach ($ln in Get-Content $slog -Encoding UTF8) { $p = $ln -split ' '; if ($p.Count -ge 2 -and $p[0] -match '^\d+$') { $servedAt[$p[1]] = [double]$p[0] } } }
    # ignore.txt (config folder): sessions the owner said "신경 쓰지 마" - skipped entirely (one name fragment per line)
    $ign = @(); $igf = $ignoreFile
    if (Test-Path $igf) { $ign = @(Get-Content $igf -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }) }
    Get-Terminals | Where-Object { $t = $_; ($t.address -ne $me) -and ($t.agent -eq 'claude-code') -and (@($ign | Where-Object { ([string]$t.where).IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -eq 0) } | ForEach-Object {
      $g = (& hc get $_.address --json | Out-String | ConvertFrom-Json)
      $waitMin = if ($g.status_ms) { [math]::Round(($now - [double]$g.status_ms) / 60000, 1) } else { $null }
      $ago = if ($servedAt.ContainsKey($_.address)) { [math]::Round(($now - $servedAt[$_.address]) / 60000, 1) } else { 9999 }
      [pscustomobject]@{ Addr = $_.address; Status = $_.status; WaitMin = $waitMin; ServedAgoMin = $(if ($ago -eq 9999) { 'never' } else { $ago }); Agent = $_.agent; Where = $_.where; _ago = $ago }
    } | Sort-Object @{ Expression = { if ($_.Status -in 'blocked', 'done', 'error') { 0 } else { 1 } } }, @{ Expression = { $_._ago }; Descending = $true }, @{ Expression = { $_.WaitMin }; Descending = $true } |
      Select-Object Addr, Status, WaitMin, ServedAgoMin, Agent, Where | Format-Table -AutoSize
  }
  'next' {
    # Fixed round-robin (user rule 2026-11-02): walk order.txt starting AFTER the entry saved in round.txt,
    # pick the first $MaxPick sessions that need a person, list the ones skipped on the way. -Preview = do not move the pointer.
    # "Needs a person": Claude project sessions = blocked/done/error. Control-Tower helper windows and Codex windows = blocked/error only.
    # PORTABLE: a fresh install has no order.txt yet -> empty order (the original stopped with an error).
    $order = @(); if (Test-Path $orderFile) { $order = @(Get-Content $orderFile -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }) }
    $ign = @(); $igf = $ignoreFile
    if (Test-Path $igf) { $ign = @(Get-Content $igf -Encoding UTF8 | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }) }
    # 2026-11-02 user rule: control Claude Code sessions only, never ignored ones
    $terms = @(Get-Terminals | Where-Object { $t = $_; ($t.address -ne $me) -and ($t.agent -eq 'claude-code') -and (@($ign | Where-Object { ([string]$t.where).IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -eq 0) })
    $slots = New-Object System.Collections.ArrayList
    $used = @{}
    foreach ($o in $order) {
      $m = $terms | Where-Object { $_.where -like "*$o*" } | Select-Object -First 1
      if ($m) { $used[$m.address] = $true }
      [void]$slots.Add([pscustomobject]@{ Name = $o; T = $m })
    }
    foreach ($t in $terms) { if (-not $used.ContainsKey($t.address)) { [void]$slots.Add([pscustomobject]@{ Name = $t.where; T = $t }) } }
    $servedAt = @{}
    $slog = $servedFile
    if (Test-Path $slog) { foreach ($ln in Get-Content $slog -Encoding UTF8) { $p = $ln -split ' '; if ($p.Count -ge 2 -and $p[0] -match '^\d+$') { $servedAt[$p[1]] = [double]$p[0] } } }
    $pf = $roundFile
    $last = ''
    if (Test-Path $pf) { $last = ([string](Get-Content $pf -Encoding UTF8 -TotalCount 1)).Trim() }
    $start = 0
    for ($i = 0; $i -lt $slots.Count; $i++) { if ($slots[$i].Name -eq $last) { $start = ($i + 1) % $slots.Count; break } }
    $picked = @(); $skipped = @(); $lastName = $last
    for ($k = 0; $k -lt $slots.Count; $k++) {
      if ($picked.Count -ge $MaxPick) { break }
      $s = $slots[($start + $k) % $slots.Count]
      if (-not $s.T) { continue }
      $st = $s.T.status
      $helper = ($s.T.where -like "*$ctrlMatch*") -or ($s.T.agent -ne 'claude-code')
      $need = if ($helper) { $st -in 'blocked', 'error' } else { $st -in 'blocked', 'done', 'error' }
      # a finished turn ('done') only counts when it is NEW: finished after the last time I reported/served this session (served.log)
      if ($need -and $st -eq 'done') {
        $gj = ((& hc get $s.T.address --json | Out-String).TrimStart([char]0xFEFF) | ConvertFrom-Json)
        $since = [double]$gj.status_ms
        if ($servedAt.ContainsKey($s.T.address) -and $since -le $servedAt[$s.T.address]) { $need = $false }
      }
      if ($need) { $picked += "$($s.T.address) $($s.Name) [$st]"; $lastName = $s.Name } else { $skipped += "$($s.Name) [$st]" }
    }
    "start after : $(if ($last) { $last } else { '(top)' })"
    "this round  : $(if ($picked.Count) { $picked -join '  ->  ' } else { '(nobody needs a person)' })"
    "skipped     : $(if ($skipped.Count) { $skipped -join ', ' } else { '-' })"
    if (-not $Preview -and $picked.Count) { Set-Content -LiteralPath $pf -Value $lastName -Encoding UTF8; "pointer saved: $lastName" }
  }
  'digest' {
    foreach ($t in Get-Terminals) {
      if ($t.address -eq $me) { continue }
      if ($t.status -notin 'blocked', 'error', 'done') { continue }
      "=== $($t.address) [$($t.status)] $($t.where)"
      Show-Peek $t.address $Lines
      ''
    }
  }
}
