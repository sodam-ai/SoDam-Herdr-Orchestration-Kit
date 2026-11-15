// orch-paths.mjs - the ONE place that decides where Herdr-Orchestration keeps the user's settings, state and logs (node side).
// lib/orch-paths.ps1 is the PowerShell twin of this file; tests/install.test.mjs (14) checks that both give the same answer.
// Importing this file and calling resolvePaths() never touches the disk. Folders are created only by ensurePaths(),
// which the caller (an installer or a long-running tool at start-up) calls on purpose.
//   ORCH_HOME wins; otherwise <LOCALAPPDATA>\Herdr-Orchestration (LOCALAPPDATA empty -> <home>\AppData\Local).
//   config\       = files the user edits (order.txt, ignore.txt, orchestration.json)
//   config\roles\ = "my roles" folder: same id overrides a bundled role, a new id adds one (bin/orch-lib.mjs loadRolesLayered)
//   state\        = files the programs write for themselves (served.log, round.txt, generated\)
//   state\docs\   = suggested documents folder made by the installer. It enables nothing by itself: autopress auto-approves
//                   file edits only in the folder named by ORCH_DOCS_DIR, which must be set explicitly (no implicit default)
//   logs\         = history (approve-log.txt, autopress.log)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function resolveOrchHome(env = process.env) {
  if (env.ORCH_HOME) return env.ORCH_HOME;
  const base = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'Herdr-Orchestration');
}

// Pure: only computes paths.
export function resolvePaths(env = process.env) {
  const home = resolveOrchHome(env);
  const config = path.join(home, 'config');
  const state = path.join(home, 'state');
  return { home, config, state, logs: path.join(home, 'logs'), roles: path.join(config, 'roles'), docs: path.join(state, 'docs') };
}

// Explicit: creates home/config/state/logs (not roles or docs: those are the installer's job). Returns the same object.
export function ensurePaths(paths, keys = ['home', 'config', 'state', 'logs']) {
  for (const k of keys) fs.mkdirSync(paths[k], { recursive: true });
  return paths;
}
