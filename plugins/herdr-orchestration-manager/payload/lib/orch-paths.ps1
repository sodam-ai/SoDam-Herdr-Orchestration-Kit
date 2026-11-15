# orch-paths.ps1 - where Herdr-Orchestration keeps the user's settings, state and logs (PowerShell twin of lib/orch-paths.mjs).
# Dot-source it:  . (Join-Path $PSScriptRoot '..\..\lib\orch-paths.ps1')
# Dot-sourcing only sets variables. It never creates a folder. A script that WRITES calls New-OrchDirs on purpose.
# ORCH_HOME wins; otherwise <LOCALAPPDATA>\Herdr-Orchestration (LOCALAPPDATA empty -> <USERPROFILE>\AppData\Local).
#   $OrchConfig = files the user edits (order.txt, ignore.txt)      $OrchRoles = my roles folder (config\roles)
#   $OrchState  = files the programs write (served.log, round.txt)  $OrchDocs  = suggested documents folder (state\docs; enables nothing, ORCH_DOCS_DIR must be set explicitly)
#   $OrchLogs   = history (approve-log.txt, autopress.log)
# tests/install.test.mjs (14) checks that this gives the same values as the node file.
# ASCII only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
if ($env:ORCH_HOME) { $OrchHome = $env:ORCH_HOME }
else {
  $OrchBase = $env:LOCALAPPDATA
  if (-not $OrchBase) { $OrchBase = Join-Path $env:USERPROFILE 'AppData\Local' }
  $OrchHome = Join-Path $OrchBase 'Herdr-Orchestration'
}
$OrchConfig = Join-Path $OrchHome 'config'
$OrchState = Join-Path $OrchHome 'state'
$OrchLogs = Join-Path $OrchHome 'logs'
$OrchRoles = Join-Path $OrchConfig 'roles'
$OrchDocs = Join-Path $OrchState 'docs'
# Explicit: creates home/config/state/logs (not roles or docs: those are the installer's job).
function New-OrchDirs {
  foreach ($d in @($OrchHome, $OrchConfig, $OrchState, $OrchLogs)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
  }
}
