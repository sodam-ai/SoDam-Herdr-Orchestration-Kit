# autopress.ps1 - presses "1. Yes" on ONE approval-proxy Claude window only, when the prompt is provably safe; otherwise emits NEEDS_REVIEW.
# The target window is re-resolved every tick by its screen border title (addresses change after a reboot / relaunch).
# PORTABLE VERSION - OFF unless ORCH_ENABLE_AUTOPRESS=1 (it presses keys in another window).
#   ORCH_TOOL_DIR      the tools (code) folder = the BUNDLE ROOT (the folder that holds functions, roles, bin and lib; for an installed
#                      copy that is <ORCH_HOME>\app). Only this one form is accepted (the old "functions folder" form is gone: it left
#                      roles, bin and lib outside the code zone). Used for TWO read-only things only: the Monitor run shape
#                      `node <ORCH_TOOL_DIR>/functions/watch/hc-watch.mjs` and the pending.ps1 command form.
#                      Files INSIDE it are never auto-approved for editing. Unset (or any other folder) = both of those stay manual.
#   ORCH_DOCS_DIR      the ONLY folder where file edits (Edit/Create/Write file) may be auto-approved: documents the controller
#                      edits. NO default: it must be set explicitly, otherwise file-edit auto-approval is OFF (command approval is
#                      a separate thing; turning on ORCH_ENABLE_AUTOPRESS=1 does not turn this on). The installer creates
#                      <ORCH_HOME>\state\docs as a suggested place, but creating it does not enable anything.
#                      It may not contain / sit inside / equal ORCH_TOOL_DIR or <ORCH_HOME>\config (start refused, exit 1).
#   ORCH_PROXY_TARGET  regex for the target window name (default: CT-CC-(0|Master), the original value)
#   ORCH_PROXY_TITLE   regex for the target's screen border title (default: Herdr-<ORCH_PROXY_TARGET>, the original value)
# Settings the user edits: <ORCH_HOME>\config\autopress-allow.txt (extra allowed command forms; see Get-AllowList).
# Log: <ORCH_HOME>\logs\autopress.log
param([switch]$Once, [switch]$DryRun, [int]$Interval = 20)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
if ($env:ORCH_ENABLE_AUTOPRESS -ne '1') {
  [Console]::Out.WriteLine('꺼져 있음(켜려면 환경변수 ORCH_ENABLE_AUTOPRESS=1 을 설정하고 다시 실행하세요. 함께 정할 값: ORCH_TOOL_DIR, ORCH_DOCS_DIR, ORCH_PROXY_TARGET)')
  exit 0
}
. (Join-Path $PSScriptRoot '..\..\lib\orch-paths.ps1')
New-OrchDirs   # this script writes its log in the logs folder: create the data folders on purpose (the lib no longer does it by itself)
$log = Join-Path $OrchLogs 'autopress.log'
$allowFile = Join-Path $OrchConfig 'autopress-allow.txt'
$toolDir = [string]$env:ORCH_TOOL_DIR
$docsDir = [string]$env:ORCH_DOCS_DIR   # opt-in ONLY: no implicit default folder (2026-11-14), see the header
$targetRx = if ($env:ORCH_PROXY_TARGET) { $env:ORCH_PROXY_TARGET } else { 'CT-CC-(0|Master)' }
$titleRx = if ($env:ORCH_PROXY_TITLE) { $env:ORCH_PROXY_TITLE } else { 'Herdr-' + $targetRx }
$yesRx = [string][char]0x276F + '\s*1\.\s*Yes'
$dash = [string][char]0x254C

$riskRx = @'
(?i)(?<![\d&-])>{1,2}|\btee\b|\brm\b|\bdel\b|Remove-Item|Remove-|git\s+(push|commit|reset|rebase|checkout|clean|merge|tag|branch\s+-D|stash\s+drop)|gh\s+(pr\s+merge|release\s+(create|edit|delete)|repo\s+(delete|create)|api)|--visibility|--force|--no-verify|--admin|--delete-branch|\bcurl\b|\bwget\b|Invoke-(WebRequest|Expression|RestMethod)|\.env\b|npm\s+(i|install|publish|exec)\b|\bsudo\b|\biex\b|Set-Content|Add-Content|Out-File|Stop-Process|taskkill|\bkill\b|Format-Volume|hc\s+send\s+\S+\s+--force|hc\s+server\s+stop|NODE_OPTIONS|HC_BIN|NODE_PATH|BASH_ENV
'@.Trim()

# File extensions that can run code (S4). Never auto-approved for editing, even inside the docs folder.
$execExt = @('ps1', 'psm1', 'psd1', 'mjs', 'js', 'cjs', 'ts', 'cmd', 'bat', 'vbs', 'vbe', 'wsf', 'sh', 'py', 'exe', 'dll', 'lnk', 'com', 'msi', 'jar', 'json', 'cs')
# Settings / manifest files that decide what is allowed: never auto-approved, wherever they are (by name).
$protectedNames = @('autopress-allow.txt', 'orchestration.json', 'function.json', 'install-manifest.json')

function Emit([string]$m) { [Console]::Out.WriteLine($m); [Console]::Out.Flush() }
function Log([string]$m) { try { Add-Content -LiteralPath $log -Value ("{0} {1}" -f (Get-Date -Format 'HH:mm:ss'), $m) -Encoding UTF8 } catch {} }

# Path normalisation for the folder tests (S2 fix): slashes unified, case ignored, "." and ".." resolved.
# A ".." that cannot be resolved (it would climb above the start, or above a drive letter) stays in the result -> caller must review.
function ConvertTo-NormPath([string]$p) {
  $q = (($p -replace '\\', '/').Trim().Trim([char]34, [char]39)).ToLowerInvariant()
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($seg in ($q -split '/')) {
    if ($seg -eq '' -or $seg -eq '.') { continue }
    if ($seg -eq '..') {
      $n = $parts.Count
      if ($n -gt 0 -and $parts[$n - 1] -ne '..' -and $parts[$n - 1] -notmatch '^[a-z]:$') { $parts.RemoveAt($n - 1) } else { $parts.Add('..') }
      continue
    }
    $parts.Add($seg)
  }
  return ($parts -join '/')
}

# True when normalised $p is strictly inside normalised $dir (starts with <dir> + separator). Unresolvable ".." anywhere -> false.
function Test-InsideDir([string]$p, [string]$dir) {
  if (-not $dir) { return $false }
  $base = ConvertTo-NormPath $dir
  $n = ConvertTo-NormPath $p
  if (-not $base -or ($base -split '/') -contains '..') { return $false }
  if (($n -split '/') -contains '..') { return $false }
  return $n.StartsWith($base + '/', [StringComparison]::Ordinal)
}

# True when two folders are the same or one contains the other (settings error for the docs folder).
function Test-FoldersOverlap([string]$a, [string]$b) {
  if (-not $a -or -not $b) { return $false }
  $na = ConvertTo-NormPath $a; $nb = ConvertTo-NormPath $b
  return ($na -eq $nb) -or $na.StartsWith($nb + '/', [StringComparison]::Ordinal) -or $nb.StartsWith($na + '/', [StringComparison]::Ordinal)
}

# S4b (links): true if ANY existing part of the path (every folder on the way, and the file itself) is a reparse point
# (junction / symbolic link). Such a link can make an "inside the docs folder" path really point somewhere else. Errors count as "yes" (fail closed).
function Test-HasReparsePoint([string]$p) {
  $segs = @(((ConvertTo-NormPath $p) -split '/') | Where-Object { $_ -ne '' })
  if ($segs.Count -lt 2) { return $true }
  $cur = $segs[0] + '\'
  for ($i = 1; $i -lt $segs.Count; $i++) {
    $cur = $cur.TrimEnd('\') + '\' + $segs[$i]
    try {
      if ([System.IO.Directory]::Exists($cur) -or [System.IO.File]::Exists($cur)) {
        if (([System.IO.File]::GetAttributes($cur) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { return $true }
      }
    } catch { return $true }
  }
  return $false
}

# File-edit approval (Edit/Create/Write file). Returns @{ ok; why }. ok=$true only for a plain document inside ORCH_DOCS_DIR.
function Test-FileEdit([string]$p) {
  if (-not $docsDir) { return @{ ok = $false; why = 'ORCH_DOCS_DIR not set (file auto-approval is off)' } }
  if ($p -notmatch '^[A-Za-z]:[\\/]') { return @{ ok = $false; why = 'not an absolute drive path' } }
  if ($p -match '[. ]$') { return @{ ok = $false; why = 'path ends with a dot or space' } }
  if ($p.Substring(2) -match '[:*?"<>|]') { return @{ ok = $false; why = 'path has a stream (:) or wildcard character' } }
  $n = ConvertTo-NormPath $p
  if (($n -split '/') -contains '..') { return @{ ok = $false; why = 'unresolvable ".." in path' } }
  $leaf = ($n -split '/')[-1]
  if ($protectedNames -contains $leaf) { return @{ ok = $false; why = "protected settings file name ($leaf)" } }
  if (Test-InsideDir $p $toolDir) { return @{ ok = $false; why = 'inside the tool folder (code zone: never auto-approved)' } }
  if (Test-InsideDir $p $OrchConfig) { return @{ ok = $false; why = 'inside the config folder (never auto-approved)' } }
  if (-not (Test-InsideDir $p $docsDir)) { return @{ ok = $false; why = 'outside the docs folder' } }
  if ($leaf.Contains('.')) {
    $ext = $leaf.Substring($leaf.LastIndexOf('.') + 1)
    if ($execExt -contains $ext) { return @{ ok = $false; why = "executable/code extension .$ext" } }
  }
  if (Test-HasReparsePoint $p) { return @{ ok = $false; why = 'path goes through a junction / symbolic link' } }
  return @{ ok = $true; why = 'document in docs folder' }
}

# S3: Bash/PowerShell commands are allowed ONLY when they match one of these anchored (^...$) forms. Everything else is reviewed.
# Defaults are deliberately tiny and read-only. The user's <config>\autopress-allow.txt can ADD forms (one regex per line, # = comment;
# a line must start with ^ (or (?i)^) and end with $; invalid lines are ignored). It can never remove a default.
function Get-AllowList([switch]$Report) {
  $list = New-Object System.Collections.Generic.List[string]
  $list.Add('^hc (?:ls|get|read)(?: (?:--json|t[0-9a-z]{1,8}|--lines [0-9]{1,4}))*$')
  $list.Add('^git status(?: (?:--short|-s|-sb|--branch))*$')
  $list.Add('^git log(?: (?:--oneline|--stat|--decorate|--graph|-n [0-9]{1,3}|-[0-9]{1,3}))*$')
  $list.Add('^git diff(?: (?:--stat|--name-only|--name-status|--cached|--staged))*$')
  $list.Add('^git show(?: (?:--stat|--oneline|--name-only|HEAD|[0-9a-f]{7,40}))*$')
  $list.Add('^git branch(?: (?:-a|-r|-v|--list|--show-current))*$')
  if ($toolDir) {
    $segs = @((($toolDir -replace '/', '\').TrimEnd('\')) -split '\\' | ForEach-Object { [regex]::Escape($_) })
    $pathRx = ($segs -join '[\\/]') + '[\\/]functions[\\/]pending[\\/]pending\.ps1'
    $list.Add('(?i)^powershell(?:\.exe)? -NoProfile -File (?:"' + $pathRx + '"|' + $pathRx + ')(?: -Only t[0-9a-z]{1,8}(?:,t[0-9a-z]{1,8})*)?$')
  }
  if (Test-Path -LiteralPath $allowFile) {
    foreach ($ln in @(Get-Content -LiteralPath $allowFile -Encoding UTF8)) {
      $t = ([string]$ln).Trim()
      if (-not $t -or $t.StartsWith('#')) { continue }
      $okShape = ($t.StartsWith('^') -or $t.StartsWith('(?i)^')) -and $t.EndsWith('$')
      $okRx = $false
      if ($okShape) { try { [void][regex]::new($t); $okRx = $true } catch { } }
      if ($okRx) { $list.Add($t) } elseif ($Report) { Log "ALLOW-IGNORED (needs ^...$ and a valid regex): $t" }
    }
  }
  return , $list.ToArray()
}

function Test-AllowedCommand([string]$cmdText) {
  foreach ($rx in (Get-AllowList)) { if ([regex]::IsMatch($cmdText, $rx)) { return $true } }
  return $false
}

# S1 + S5 fix: a Monitor command is allowed ONLY in this one shape:
#     [NAME=value ...] node <script>        (nothing else, no extra arguments, no node options)
# - NAME must be on the list below (exact case, each at most once) and the value must have the listed format. Any other name
#   (NODE_OPTIONS, HC_BIN, PATH, ORCH_HOME, BASH_ENV, NODE_PATH, LD_*, ...) is reviewed: such a variable could make the approved
#   script load or run something else.
# - <script> (one argument, "..." or '...' or bare) must normalise (slashes/case unified) to exactly
#   <ORCH_TOOL_DIR>/functions/watch/hc-watch.mjs   (ORCH_TOOL_DIR = the bundle root; no other form is accepted)
$monitorEnvRules = New-Object 'System.Collections.Generic.Dictionary[string,string]'   # ordinal = case-sensitive names
$monitorEnvRules['HC_SELF'] = '^t[0-9a-z]{1,8}$'
$monitorEnvRules['WATCH_ONLY'] = '^[^"''`$;&|<>(){}\\%!^\r\n]{1,80}$'
foreach ($n in 'BLOCK_MS', 'DONE_MS', 'ERROR_MS', 'FLUSH_MS', 'CTX_SCAN_MS', 'CTX_PCT', 'CTRL_PCT', 'COMPACT_COOLDOWN_MS', 'CTRL_COOLDOWN_MS') { $monitorEnvRules[$n] = '^[0-9]{1,9}$' }
$monitorEnvRules['DRY_RUN'] = '^[01]$'
$monitorEnvRules['ORCH_AUTOCOMPACT'] = '^[01]$'
function Test-AllowedMonitorCommand([string]$cmd) {
  if (-not $toolDir) { return $false }
  $rest = $cmd.Trim()
  $seenNames = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  while ($true) {
    $m = [regex]::Match($rest, '^([A-Za-z_][A-Za-z0-9_]*)=("([^"]*)"|''([^'']*)''|([^\s"'']*))(?:\s+|$)')
    if (-not $m.Success) { break }
    $name = $m.Groups[1].Value
    $val = ''
    foreach ($gi in 3, 4, 5) { if ($m.Groups[$gi].Success) { $val = $m.Groups[$gi].Value; break } }
    if (-not $monitorEnvRules.ContainsKey($name)) { return $false }
    if (-not $seenNames.Add($name)) { return $false }
    if (-not [regex]::IsMatch($val, $monitorEnvRules[$name])) { return $false }
    $rest = $rest.Substring($m.Length)
  }
  $m2 = [regex]::Match($rest, '(?i)^node(?:\.exe)?\s+(?:"([^"]+)"|''([^'']+)''|([^\s"'']+))$')
  if (-not $m2.Success) { return $false }
  $path = ''
  foreach ($gi in 1, 2, 3) { if ($m2.Groups[$gi].Success -and $m2.Groups[$gi].Value) { $path = $m2.Groups[$gi].Value; break } }
  if (-not $path) { return $false }
  $base = ConvertTo-NormPath $toolDir
  $np = ConvertTo-NormPath $path
  return ($np -ceq ($base + '/functions/watch/hc-watch.mjs'))
}

# Find the target window: tab name matches $targetRx AND the screen border title matches $titleRx (not the proxy window).
function Resolve-Target {
  $raw = (hc ls --json | Out-String).TrimStart([char]0xFEFF)
  $cands = @(($raw | ConvertFrom-Json).terminals | Where-Object { $_.agent -eq 'claude-code' -and $_.where -match $targetRx })
  foreach ($c in $cands) {
    if ($env:HC_TERMINAL_ID -and $c.address -eq $env:HC_TERMINAL_ID) { continue }   # never target my own window
    $tail = @(hc read $c.address --lines 40 | Where-Object { $_.Trim() } | Select-Object -Last 24) -join "`n"
    if ($tail -match ($titleRx + '\s*\W*\s*(\n|$)')) { return $c }
  }
  return $null
}

function Clean-Command([string]$c) {
  $c = $c -replace '2>&1', '' -replace '2>\s*/dev/null', '' -replace '2>\s*\$null', ''
  $c = $c -replace "-Forbid\s+(('[^']*'|`"[^`"]*`")\s*,?\s*)+", ' '
  $c = $c -replace "(?i)Select-String\s+(-Pattern\s+)?('[^']*'|`"[^`"]*`")", ' Select-String X '
  return $c
}

function Decide([string[]]$s) {
  $tail = @($s | Where-Object { $_.Trim() } | Select-Object -Last 16)
  $tailText = $tail -join "`n"
  $flat = ($tailText -replace '\s+', ' ')   # narrow windows wrap phrases across lines
  if ($flat -notmatch 'Esc to cancel') { return @{ act = 'review'; why = 'no active prompt at screen bottom' } }
  if ($flat -match 'Enter to select|Submit answers|Type something|Chat about this') { return @{ act = 'review'; why = 'question menu (user choice)' } }
  if ($tailText -notmatch $yesRx) { return @{ act = 'review'; why = 'focused 1. Yes not found' } }
  # S6: the header of the ACTIVE prompt must be unambiguous. File content shown in the preview can imitate a header line
  # (e.g. a line that is only "Edit file"), so "take the last header" is attacker-steerable. The preview can imitate other
  # landmarks too (a fake "Esc to cancel" line would move any block boundary computed from the text), so NO boundary is derived
  # from screen text: exactly ONE header-like line may exist on the whole screen that was read; otherwise REVIEW.
  # (An old header left in the scrollback only causes a review - it fails on the safe side.)
  $heads = New-Object System.Collections.Generic.List[int]
  for ($i = 0; $i -lt $s.Count; $i++) { if ($s[$i] -match '^\s*(PowerShell command|Bash command|Edit file|Create file|Write file|Monitor)\s*$') { $heads.Add($i) } }
  if ($heads.Count -eq 0) { return @{ act = 'review'; why = 'prompt header not found' } }
  if ($heads.Count -gt 1) { return @{ act = 'review'; why = 'more than one prompt header line (ambiguous: file content may imitate a header)' } }
  $hi = $heads[0]
  $type = $s[$hi].Trim()
  if ($type -in 'Edit file', 'Create file', 'Write file') {
    $p = ''; if ($hi + 1 -lt $s.Count) { $p = $s[$hi + 1].Trim() }
    # S6: the path must be on ONE line. Whatever follows it has to be blank or a dashed rule; any other text may be the wrapped rest of the path.
    if ($hi + 2 -ge $s.Count) { return @{ act = 'review'; why = "$type : nothing after the path line" } }
    $nx = $s[$hi + 2]
    if ($nx.Trim() -and -not $nx.TrimStart().StartsWith($dash)) { return @{ act = 'review'; why = "$type : text follows the path line (wrapped path?)" } }
    $fe = Test-FileEdit $p
    if ($fe.ok) {
      # S6c: cross-check the QUESTION line. The app draws it ("Do you want to make this edit to <file>?" / "...create <file>?") and file content
      # cannot change it, while the header + path lines can be a FAKE copy taken from the preview once the real ones scrolled out of the
      # lines read. Exactly ONE question line must exist (a second one would be a fake) and the file name in it must equal the file name
      # on the path line; otherwise REVIEW. An unknown wording of the question also lands here (fails on the safe side).
      $qNames = New-Object System.Collections.Generic.List[string]
      foreach ($ln in $s) { $qm = [regex]::Match($ln, '^\s*Do you want to (?:make this edit to|create|overwrite) (.+?)\s*\?\s*$'); if ($qm.Success) { $qNames.Add($qm.Groups[1].Value.Trim()) } }
      if ($qNames.Count -ne 1) { return @{ act = 'review'; why = "$type : expected exactly one question line naming the file, found $($qNames.Count)" } }
      $pBase = ($p -split '[\\/]')[-1]
      if ($qNames[0] -ine $pBase) { return @{ act = 'review'; why = "$type : the question names '$($qNames[0])' but the path line names '$pBase' (fake path?)" } }
      return @{ act = 'press'; why = "$type in docs folder: $p" }
    }
    return @{ act = 'review'; why = "$type not auto-approved ($($fe.why)): $p" }
  }
  if ($type -eq 'Monitor') {
    # S1 fix: read the WHOLE Monitor command (text between the header and the question), then require BOTH
    # (a) no risky token and (b) exactly the one allowed run shape. Merely containing "hc-watch.mjs" is not enough.
    # TODO(integration): also pin the script itself - compare the SHA-256 of <ORCH_TOOL_DIR>/functions/watch/hc-watch.mjs with the hash recorded in
    #   install-manifest.json. If there is no manifest (or no entry / hash mismatch) the answer must be REVIEW, never "skip the check".
    #   Waiting for the installer's manifest format (stage E); not implemented here on purpose.
    if (-not $toolDir) { return @{ act = 'review'; why = 'Monitor : ORCH_TOOL_DIR not set (Monitor auto-approval is off)' } }
    $mon = New-Object System.Collections.Generic.List[string]
    for ($i = $hi + 1; $i -lt $s.Count; $i++) {
      if ($s[$i] -match 'Do you want|requires confirmation|Hook PreToolUse|Esc to cancel') { break }
      if ($s[$i].TrimStart().StartsWith($dash)) { continue }
      $mon.Add(($s[$i] -replace '^\s*[|│]\s?', ''))
    }
    $mc = (($mon -join ' ') -replace '\s+', ' ').Trim()
    if (-not $mc) { return @{ act = 'review'; why = 'Monitor command text not found' } }
    $mr = [regex]::Match((Clean-Command $mc), $riskRx)
    if ($mr.Success) { return @{ act = 'review'; why = "Monitor: risky token '" + $mr.Value.Trim() + "' in command" } }
    if (Test-AllowedMonitorCommand $mc) { return @{ act = 'press'; why = 'Monitor hc-watch.mjs (own tool, allowed run shape)' } }
    return @{ act = 'review'; why = 'Monitor command is not the allowed hc-watch.mjs run shape' }
  }
  $cmd = New-Object System.Collections.Generic.List[string]
  $seen = 0
  for ($i = $hi + 1; $i -lt $s.Count; $i++) {
    if ($s[$i].TrimStart().StartsWith($dash)) { $seen++; if ($seen -ge 2) { break }; continue }
    if ($seen -eq 1) { $cmd.Add(($s[$i] -replace '^\s*[|│]\s?', '')) }
  }
  if ($seen -lt 1 -or $cmd.Count -eq 0) { return @{ act = 'review'; why = 'command text not found' } }
  # S3: allow list first. (1) one line only, (2) no shell metacharacter at all, (3) must match an allowed form. Then the old deny list still runs.
  if (@($cmd | Where-Object { $_.Trim() }).Count -gt 1) { return @{ act = 'review'; why = 'multi-line command (never auto-approved)' } }
  $c0 = (($cmd -join ' ') -replace '\s+', ' ').Trim()
  if ($c0 -match '[;|&`$()<>{}]') { return @{ act = 'review'; why = 'shell metacharacter in command' } }
  if (-not (Test-AllowedCommand $c0)) { return @{ act = 'review'; why = 'command is not on the allow list' } }
  $c = Clean-Command $c0
  $m = [regex]::Match($c, $riskRx)
  if ($m.Success) { return @{ act = 'review'; why = "risky token '" + $m.Value.Trim() + "' in command" } }
  $short = $c; if ($short.Length -gt 90) { $short = $short.Substring(0, 90) }
  return @{ act = 'press'; why = "$type allow-listed: $short" }
}

# Settings check: the docs folder must not overlap the code folder or the settings folder (else an "edit a document" approval could edit code/settings).
if ($docsDir) {
  foreach ($pair in @(@('ORCH_TOOL_DIR', $toolDir), @('config', $OrchConfig))) {
    if (Test-FoldersOverlap $docsDir $pair[1]) {
      Emit "설정 오류: ORCH_DOCS_DIR($docsDir)가 $($pair[0]) 폴더($($pair[1]))와 같거나 포함 관계입니다. 문서 폴더는 실행 코드·설정 폴더와 완전히 분리되어야 해서 시작하지 않습니다."
      Log "CONFIG_ERROR docs overlaps $($pair[0])"
      exit 1
    }
  }
}
[void](Get-AllowList -Report)

$pressKey = ''; $pressCount = 0; $reviewKey = ''; $missWarned = $false
do {
  try {
    $row = Resolve-Target
    if (-not $row) {
      if (-not $missWarned) { Emit "TARGET_NOT_FOUND: no window matches '$targetRx' with border title '$titleRx' (relaunch or rename?)"; Log 'TARGET_NOT_FOUND'; $missWarned = $true }
    } else {
      $missWarned = $false
      $target = $row.address
      if ($row.status -eq 'blocked') {
        hc keys $target ctrl+end | Out-Null
        Start-Sleep -Milliseconds 600
        $screen = @(hc read $target --lines 80)
        $d = Decide $screen
        $key = "$target/$($row.turn)"
        if ($d.act -eq 'press') {
          if ($key -ne $pressKey) { $pressKey = $key; $pressCount = 0 }
          if ($pressCount -lt 3) {
            if ($DryRun) { Emit "DRYRUN would press ($key): $($d.why)" }
            else {
              hc keys $target enter | Out-Null
              $pressCount++
              Log "PRESS $key try=$pressCount :: $($d.why)"
              Start-Sleep -Seconds 2
            }
          }
        } elseif ($key -ne $reviewKey) {
          $reviewKey = $key
          Log "REVIEW $key :: $($d.why)"
          Emit "NEEDS_REVIEW ($target blocked, turn $($row.turn)): $($d.why)"
        }
      }
    }
  } catch { Log "ERR $_" }
  if (-not $Once) { Start-Sleep -Seconds $Interval }
} while (-not $Once)
