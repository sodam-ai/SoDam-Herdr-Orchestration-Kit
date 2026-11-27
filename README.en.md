# SoDam Herdr Orchestration Kit

[한국어](README.md) | **English** · Same content as web pages: [README.html](README.html) · [README.en.html](README.en.html)

A toolkit for people who run **several AI windows (Claude Code) at once**. It lets you define **who does which job (a "role")** in plain files, and then **move those roles to another computer, edit them, back them up, and restore them** safely.

> **Current status (please read first)**
>
> - Version `0.1.1`. An early version under development.
> - License: **Apache License, Version 2.0** · Rights holder: **SoDam AI Studio**. **Commercial use is allowed** when you meet the conditions. See [Chapter 18](#s18), [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) and [`LEGAL-GUIDE.md`](LEGAL-GUIDE.md) for the conditions and cautions.
> - **Windows only** (tested on Windows 11 only).
> - By default this tool **never sends text or keystrokes to any AI window.** The features that do (approval proxy, auto-compact) are **all switched off right after installation.**
> - The on-screen text of the tool, the role documents and the generated cards are written in **Korean**. This English guide is a translation of the Korean guide.

<a id="s1"></a>
## 1. Table of contents

- [2. What is this tool? (plain explanation and glossary)](#s2)
- [3. What you need (prerequisites and required programs)](#s3)
- [4. How to download](#s4)
- [5. How to install](#s5)
- [6. Quick start (follow from start to finish)](#s6)
- [7. How to run](#s7)
- [8. How to use (the management window)](#s8)
- [9. How it works (internals)](#s9)
- [10. Command reference](#s10)
- [11. Update summary](#s11)
- [12. File and document locations](#s12)
- [13. Workflow](#s13)
- [14. Architecture](#s14)
- [15. Security and data flow](#s15)
- [16. Troubleshooting](#s16)
- [17. FAQ](#s17)
- [18. Legal, copyright, license, and commercial use](#s18)
- [19. Uninstall and testing](#s19)
- [20. Known limitations (what has not been verified)](#s20)

<a id="s2"></a>
## 2. What is this tool?

### In one sentence

A tool that safely manages the documents describing **what each of several AI windows is responsible for (its role)**.

### An analogy

Imagine a company with 12 team members and a **job-assignment sheet** that says who does what and who reports to whom. This tool

- lets you edit that sheet in **one place (the role files)** so every guide document is regenerated to match,
- lets you **move the whole sheet to another computer** (a "new office"),
- and **automatically keeps a copy (backup)** before you change anything, so you can undo mistakes.

### What it does / does not do

| What it does | What it does not do |
|---|---|
| Keeps the definitions of 12 roles as files | Send text or keys to AI windows (by default) |
| Generates the role table, role cards and a tab layout plan (`sync`) | Send information over the internet (the code contains no internet-access code) |
| View, edit, create, revert and delete roles | Delete your folders wholesale |
| Export / import role bundles (move to another PC) | Overwrite your settings without permission |
| Automatic backup and restore | Modify the Herdr app itself or AI chat history |
| Show which windows are open right now (read-only) | Change startup programs, Task Scheduler, the registry, or PATH |

### Glossary in plain words

| Term | Meaning |
|---|---|
| **Terminal / PowerShell** | A window where you type commands as text. Open the Start menu and search "PowerShell". |
| **Command** | A one-line instruction you type in the terminal and confirm with Enter. In this document, **copy the text in the grey boxes exactly and paste it.** |
| **Folder / path** | Where files live, and its address. Example: `C:\Users\YourName\Downloads` |
| **Node.js** | A free program that runs this tool's main programs (`.mjs` files). You must install it separately. |
| **Herdr** | An app that gathers many terminals (AI windows) into one screen. **A separate program that is not included in this repository.** |
| **`hc`** | A command-line tool that queries/controls windows inside Herdr. Not included in this repository. |
| **Claude Code** | Anthropic's AI coding tool used in a terminal. Most of the "AI windows" this tool deals with are this. |
| **Role** | The definition of the job one AI window handles, e.g. "Verifier" or "Security checker". One `.md` file in `roles\` is one role. |
| **Commander** | The role that hands out work to other role windows, gathers results, and reports to you. |
| **sync** | The step that reads the role files and regenerates the role table, cards and tab layout plan. |
| **Mod** | A small window program embedded in Herdr. This tool's "management window" is also available as a mod. |
| **Plugin / marketplace** | A package that adds features to Claude Code, and a list that gathers such packages. |
| **Environment variable** | A "note" a program reads for its settings. This tool reads `ORCH_HOME` (where settings are kept). |
| **Backup / restore** | Saving a copy from before a change / going back to that copy. |

<a id="s3"></a>
## 3. What you need (prerequisites and required programs)

| Item | Required? | Description |
|---|---|---|
| **Windows 10 or 11** | Required | Windows only. Development and testing were done on Windows 11 only. Windows 10 was not checked. |
| **Windows PowerShell 5.1** | Required | Built into Windows. Nothing to install. |
| **Node.js 18 or newer** | Required | The installer stops with "abort" if the version is below 18. Development and tests used a recent version (26.7.0); versions 18–25 were not checked directly. Get it from <https://nodejs.org> (the **LTS** button). |
| **Herdr app** | Optional | Needed for the "management window inside Herdr". Without it you can still use the separate Windows window. Where Herdr is distributed and under what terms could not be confirmed from this repository; follow the provider's instructions. |
| **`hc` command** | Optional | Used by the "Live windows" tab and the `functions` scripts. Without it only those parts say "cannot query"; everything else works. |
| **Claude Code** | Optional | Needed to install as a marketplace plugin and to actually operate roles with AI windows. |
| **Git** | Optional | Only needed to download with `git clone`. Not needed if you use a ZIP file. |
| **Administrator rights** | Not needed | Installation works with a normal user account. |
| **Internet** | Only for setup | Only needed to download Node.js. The tool itself does not use the internet. |

**Check whether Node.js is already installed** — open PowerShell and type the line below. A number of `v18` or higher means you are fine.

```
node -v
```

If it says `node` cannot be found, install Node.js LTS, then **close the PowerShell window and open a new one** and check again (only a new window recognizes it).

<a id="s4"></a>
## 4. How to download

This repository is public on GitHub.

- Repository address: <https://github.com/sodam-ai/SoDam-Herdr-Orchestration-Kit>
- **Method A — ZIP** (no Git needed): click the green **Code** button on the repository page → **Download ZIP**. **Extract** the ZIP (right-click → Extract All) before use. Running from inside the ZIP will fail to find some files.
- **Method B — Git**: when Git is installed.

```
git clone https://github.com/sodam-ai/SoDam-Herdr-Orchestration-Kit.git
```

- **Method C — marketplace**: see [Method 3 in Chapter 5](#s5-3).

If you can see folders such as `bin`, `roles`, `functions` and files `README.md`, `VERSION` inside, it is correct. Extraction may add one extra folder level, so the **folder where `bin` is directly visible** is the "project folder".

> Make sure the files came from **someone you trust**. This tool does not verify copies distributed by anyone other than the owner.

<a id="s5"></a>
## 5. How to install

There are three ways. **We recommend doing Method 1 first.** Method 2 is added optionally after Method 1.

> **Opening PowerShell in the project folder:** open the project folder (where `bin` is visible) in File Explorer, click the address bar at the top, and copy the address. Open PowerShell, type `cd "`, paste, close with `"` and press Enter. Example: `cd "C:\Users\YourName\Downloads\SoDam-Herdr-Orchestration-Kit"`

> **Why commands contain `-ExecutionPolicy Bypass`:** Windows may block running downloaded `.ps1` files by default. This option lifts that restriction **for that single run only**. Your computer-wide settings are not changed.

### Method 1 — Basic install (required · separate Windows window)

**Step 1: check only** (changes nothing)

```
powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1 -Check
```

If the last line says `점검 결과: 중단 0건` (check result: 0 aborts), you can install. A **경고 (warning)** means "installs, but some feature is limited", which can be normal (for example: Herdr session keeper not found, allow-list not set yet). If there is even one **중단 (abort)**, read the reason, fix it, and run again.

**Step 2: install**

```
powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1
```

What the installation does:

- **Copies** the program files to `%LOCALAPPDATA%\Herdr-Orchestration\app` (usually `C:\Users\YourName\AppData\Local\Herdr-Orchestration\app`).
- Creates `config` (settings), `state` (work records) and `logs` folders in the same place, **only the first time**. If they exist, they are **not overwritten.**
- Registers risky features **all switched off**.

What installation does not do: change startup programs, Task Scheduler, the registry or PATH; send input to any window.

To change locations, add options.

| Option | Meaning |
|---|---|
| `-OrchHome <folder>` | Where settings and records go (default: environment variable `ORCH_HOME`, otherwise `%LOCALAPPDATA%\Herdr-Orchestration`) |
| `-InstallDir <folder>` | Where program files go (default: `<OrchHome>\app`) |
| `-DocsDir <folder>` | Document folder (default: `<OrchHome>\state\docs`) |
| `-Force` | Allow installing into a different, non-empty folder |
| `-Check` | Check only |

> **If you do not use the default location:** you must set the environment variable `ORCH_HOME` to that location every time you use the tool (a note is printed when installation finishes). Example: `$env:ORCH_HOME = "D:\myfolder\orch-home"` (valid only in this PowerShell window).

<a id="s5-2"></a>
### Method 2 — Install the management window inside Herdr (optional)

A window opened by a shortcut **inside** the Herdr app. Herdr must be installed. **Do Method 1 first.**

```
powershell -NoProfile -ExecutionPolicy Bypass -File bin\install-herdr-mod.ps1 -Check
```

If there is no problem, run it again without `-Check`.

```
powershell -NoProfile -ExecutionPolicy Bypass -File bin\install-herdr-mod.ps1
```

What this installation does:

1. Builds the mod files in a temporary folder and runs **Herdr's official check (`herdr-app check`) first.** If it does not pass, it **installs nothing** and stops.
2. If it passes, copies them to `mods\orch-manager` in the Herdr settings folder (default `~\.config\herdr-app`).
3. Adds **one line** for the open shortcut (default `ctrl-shift-m`) at the top of Herdr's `keys.json`. It **makes a backup first** (`keys.json.bak-before-orch-manager`) and leaves the file untouched if the result is not valid JSON. If that key is already in use, it is skipped.

Only the `mods\orch-manager` folder and one line of `keys.json` are touched. Other mods, layouts, settings, terminals and chat history are not touched.

| Option | Meaning |
|---|---|
| `-Key <key>` | Change the open shortcut (e.g. `ctrl-shift-o`) |
| `-NoKey` | Do not bind a shortcut. Open only via the command palette (`Ctrl+Shift+P`) → `mod.open orch-manager`. |
| `-HerdrHome <folder>` | Herdr settings folder (default: environment variable `HERDR_APP_HOME`, otherwise `~\.config\herdr-app`) |
| `-HerdrApp <file>` | Location of `herdr-app.exe` (default `%LOCALAPPDATA%\Programs\herdr-app\herdr-app.exe`) |
| `-Uninstall` | Remove (deletes only files we created and removes the one key line) |

<a id="s5-3"></a>
### Method 3 — Claude Code marketplace plugin (optional)

This repository is a Claude Code marketplace (`.claude-plugin\marketplace.json`), and the plugin is named `herdr-orchestration-manager` (version 0.1.1). The install-helper skill inside the plugin runs Method 1 and Method 2 above **in order**. Running `install.ps1` in the plugin folder directly does the same.

```
powershell -NoProfile -ExecutionPolicy Bypass -File plugins\herdr-orchestration-manager\install.ps1 -Check
```

> Installing remotely through a marketplace address could **not be run and confirmed** while writing this document. The whole folder-based install flow of the plugin was confirmed by the automated test (`tests\plugin.test.mjs`).

<a id="s6"></a>
## 6. Quick start (follow from start to finish)

**Total time: about 5 minutes.** Go **from top to bottom, in order**.

1. Check Node.js: `node -v` → `v18` or higher passes ([Chapter 3](#s3)).
2. Open PowerShell in the project folder (see [Chapter 5](#s5)).
3. Check: `powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1 -Check` → confirm `중단 0건` (0 aborts).
4. Install: the same command without `-Check`.
5. **Open the settings file.** Open `%LOCALAPPDATA%\Herdr-Orchestration\config\orchestration.json` in Notepad (paste `%LOCALAPPDATA%\Herdr-Orchestration\config` into the File Explorer address bar to get there). Change the values below **to fit this computer** and save.

   | Item | Default | What to enter |
   |---|---|---|
   | `scope_prefix` | `(미설정)` (= "not set") | The first part of the name of the Herdr space to manage |
   | `projects_root` | `(미설정)` (= "not set") | The parent folder that holds your project folders |
   | `commander_name` | `orch-commander` | The name for the commander window (lowercase letters, digits, `-`, `_`; 1–32 characters) |
   | `control_dir` | `<settings location>\control` | The folder for commander record files |

   > If you leave `(미설정)`, `sync` prints a warning that "no window in that scope will be picked up". It does not stop with an error, but you must fill in the values to use it for real.

6. Generate the output (from the install folder; if `<ORCH_HOME>` is the default you do not need to set the environment variable):

   ```
   node "%LOCALAPPDATA%\Herdr-Orchestration\app\bin\sync.mjs"
   ```

   On success it prints `sync 완료: 역할 12개 (켜짐 11, 꺼짐 1) → 역할표 1, 카드 11, 탭 4개 계획` (sync done: 12 roles (11 on, 1 off) → 1 role table, 11 cards, 4 tabs planned). The result files appear in `%LOCALAPPDATA%\Herdr-Orchestration\state\generated`.

7. Open the management window: **double-click** `%LOCALAPPDATA%\Herdr-Orchestration\app\bin\Herdr-Orchestration-Manager.vbs`.
8. (Optional) The window inside Herdr: after [Method 2 in Chapter 5](#s5-2), press `Ctrl+Shift+M` in Herdr.

<a id="s7"></a>
## 7. How to run

| What | How |
|---|---|
| **Separate Windows management window** | Double-click `<install folder>\bin\Herdr-Orchestration-Manager.vbs` (opens without a black console window). To run it directly: `powershell -NoProfile -ExecutionPolicy Bypass -STA -File bin\orch-manager.ps1` |
| **Management window inside Herdr** | Press `Ctrl+Shift+M` in Herdr (the key chosen at install). If the key does not work, press `Ctrl+Shift+P` and enter `mod.open orch-manager` |
| **Regenerate roles and documents** | `node bin\sync.mjs` ([Chapter 10](#s10)) |
| **Check role syntax** | `node bin\validate-roles.mjs` |

If you changed the settings location from the default, enter this once in the same PowerShell window before running:

```
$env:ORCH_HOME = "put\your\location\here"
```

<a id="s8"></a>
## 8. How to use (the management window)

The Windows window and the window inside Herdr use the **same engine**. The wording on screen (mode and cadence names, etc.) is aligned as well. The tabs are as follows (the window inside Herdr has one more "단축키" (Shortcuts) tab at the end).

| Tab | What it does |
|---|---|
| **현황** (Status) | Shows the installation state (version, settings and backup locations, number of roles and problems, etc.). The **[sync 실행 (생성물 갱신)]** (run sync) button regenerates the role table, cards and layout plan. |
| **역할 편집** (Edit roles) | Pick a role from the list, edit its name, summary, slot, mode, cadence, reports-to, etc., and **[저장]** (Save). **[끄기 / 켜기]** (Turn off / on), **[번들 값으로 되돌리기]** (Revert to bundle values), **[새 역할 만들기...]** (Create new role...) and **[내가 만든 역할 삭제]** (Delete a role I created) are here too. |
| **내보내기·불러오기** (Export · Import) | **[내보내기]** (Export) saves your role bundle to a folder; **[미리보기...]** (Preview...) imports a bundle from another PC. Import **shows a preview first** and asks once more, "정말 적용할까요?" (Really apply?), just before applying. |
| **백업 · 복구** (Backup · Restore) | **[지금 백업]** (Back up now), the backup list, **[선택한 백업으로 복구...]** (Restore from the selected backup... — preview, then apply), **[백업 폴더 열기]** (Open backup folder). |
| **실제 창** (Live windows) | **Read-only** list of the windows currently open in Herdr. **[선택한 창 주소 복사]** (Copy selected window address) copies a window address. Without `hc` it says "cannot query". |
| **단축키** (Shortcuts, Herdr window only) | Change the key that opens this window and verify that it reached the real file using "저장 진단" (save diagnosis). |

> Button names above are for the Windows management window. The window inside Herdr offers the same functions with similarly named buttons. **[번들 값으로 되돌리기]** removes the changes you layered on top of a bundled role and returns it to its original state; **[내가 만든 역할 삭제]** deletes only roles you created (bundled roles cannot be deleted).

Keyboard in the Herdr window: `Esc` close · `Ctrl+1`–`Ctrl+6` switch tab · `F5` refresh · `Ctrl+S` save (on the Edit roles tab).

### Editing one role (example)

1. Open the management window → **역할 편집** tab.
2. Click the role to edit in the list (e.g. "검증관" / Verifier).
3. Change a value. Example: cadence from "요청 시 (on-request)" to "주기적 (periodic)".
4. **[저장]**. Just before saving, **if "my settings" files already exist, an automatic backup is made.** (When you edit for the first time and no file of yours exists yet, there is nothing to back up, so none is made. The bundle is never changed, so **[번들 값으로 되돌리기]** can return a role to its original state.) If the result violates the rules, **nothing is written** and the reason is shown.
5. After saving, **run sync again** so the role table and cards reflect the new content (the **[sync 실행 (생성물 갱신)]** button on the "현황" tab, or the command in [Chapter 10](#s10)).

### Mode and cadence names

| Shown on screen | Stored value | Meaning |
|---|---|---|
| 읽기 전용 (read-only) | `read-only` | Only reads files |
| 범위 내 쓰기 (scoped-write) | `scoped-write` | May write only to the places listed in `writes_to` |
| 요청 시 (on-request) | `on-request` | Works only when asked |
| 주기적 (periodic) | `periodic` | Works at set intervals |

### Moving to another PC

1. Original PC: on the **내보내기·불러오기** tab, choose a folder and export. A **subfolder** named `orch-export-date-time` is created inside it, containing `package.json` and the files.
2. Move that whole subfolder to the new PC by USB, cloud, etc.
3. New PC: after installing this tool, on the **내보내기·불러오기** tab, choose the **`orch-export-…` subfolder** and look at the **preview**. (If you choose the parent folder, it says "묶음 폴더가 아님" = "not a bundle folder".)
4. If the content is right, apply it. **New roles and changed roles from someone else's bundle arrive "switched off".** Their text is an instruction that AI windows follow, so **read it** and switch them on yourself.

<a id="s9"></a>
## 9. How it works (internals)

1. **Role file** (`roles\*.md`): between the `---` lines at the top are **fields** such as name, summary, slot, mode, cadence, reports-to; below is the **body** that the AI window follows. The field format is defined by `schema\role.schema.json`.
2. **My roles folder** (`<settings location>\config\roles`): a file with the same id **overrides** a bundled role (you only write the fields you change); a new id becomes a **new role**. Upgrades never touch this folder.
3. **Settings** (`orchestration.json`): paths and names are not hard-coded; they are read here.
4. **sync**: combines the roles (bundle + mine) with the settings and produces `역할표.md` (role table), role cards (`cards\<role-id>.md`), the tab layout plan (`layout-plan.json`) and a file list (`sync-manifest.json`). It **only creates plans and documents**: it does not create windows, call `hc`, or send anything to any window. If validation fails, the previous output is left as it was.
5. **Tab layout rule**: tab names are determined by **slot number** (default: slots 1–4, 5–8, 9–10 grouped, then four at a time). Turning a role off or changing it **does not change tab names.**
6. **Management engine** (`bin\manage.mjs`): handles everything the management window does (role edits, export/import, backup/restore, sync, live-window query). Before changing anything it **validates** the candidate, makes an **automatic backup**, and writes files by **writing a temporary file and then renaming it** (so a half-written file is never left if it stops midway).

### The 12 roles included at the start

| id | Name (Korean original) | Slot | Mode | Cadence | What it does (summary) |
|---|---|---|---|---|---|
| `commander` | Commander (총지휘) | 0 | scoped-write | periodic | Assigns work, handles approvals, collects your decisions through numbered menus, reports |
| `approval-proxy` | Approval proxy (승인 대행) | 0 | read-only | periodic | Presses the recommended choice on approval prompts in the commander window (**off by default**) |
| `approval-reviewer` | Approval reviewer (승인 심사관) | 1 | read-only | on-request | Classifies the risk of windows waiting for approval in one line and reports |
| `ledger-keeper` | Candidate/ledger keeper (후보·장부관) | 2 | scoped-write | on-request | Picks improvement candidates per project, ranks them, maintains the ledger |
| `verifier` | Verifier (검증관) | 3 | read-only | on-request | Judges the pre-push review queue as PASS / on hold |
| `human-tasks` | Human-task organizer (사람 몫 정리) | 4 | scoped-write | on-request | Organizes items needing your decision into numbered-menu candidates |
| `window-inspector` | Window state inspector (창 상태 점검관) | 5 | read-only | on-request | Classifies why windows have been idle, checks window state after a restart |
| `test-dispatcher` | Test dispatcher (시험 지시) | 6 | read-only | on-request | Plans and reports safe read-only tests per project in rotation |
| `doc-consistency` | Document consistency supervisor (문서 정합 감독관) | 7 | read-only | on-request | Checks that READMEs/PRDs match the code and records |
| `git-keeper` | Git keeper (깃) | 8 | read-only | on-request | Pushes to a working branch only the items whose conditions are met |
| `security-guard` | Security / sensitive-data checker (보안·민감정보 점검관) | 9 | read-only | on-request | Before push/publish, checks for keys, tokens, passwords, personal data mixed in |
| `role-auditor` | Role overlap / scope auditor (역할 중복·범위 감사관) | 10 | read-only | on-request | Re-checks role overlap and whether approval records kept within scope |

> The role bodies (the instructions AI windows read) are written in Korean. The table above is a shortened translation of each role file's `summary` field; `roles\*.md` and the generated `역할표.md` are the authoritative source.

### Bundled features (`functions\`)

Five scripts that inspect or assist AI windows. **Those with high risk are automatically switched off at installation.**

| Feature | Risk | Default | What it does |
|---|---|---|---|
| `pending` | Low | On | Shows briefly only the pending command of windows waiting for approval (read-only) |
| `queue` | Low | On | Window status table (`status`), look at one window (`peek`), summary of blocked windows (`digest`), etc. (read-only) |
| `watch` — alerts (`alerts`) | Medium | On | Collects alerts for long-blocked windows, finished windows and errors (read only) |
| `watch` — auto-compact (`auto-compact`) | **High** | **Off** | Types `/compact` into an AI window whose context usage is high. Works only when **both** `ORCH_AUTOCOMPACT=1` and an allow-list exist |
| `approve` | **High** | **Off** | Presses Enter (yes) or Esc (no) on **one** approval prompt only when every safety condition passes |
| `autopress` | **High** | **Off** | Presses "1. Yes" on one approval-proxy window only when the prompt is **provably safe**; otherwise only raises a request for human review. Works only when `ORCH_ENABLE_AUTOPRESS=1` |

<a id="s10"></a>
## 10. Command reference

Type every command in the project folder (or the install folder `<settings location>\app`). If the settings location is not the default, set `$env:ORCH_HOME` first.

### Install and uninstall

| Command | Description |
|---|---|
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1 -Check` | Installation check (no changes) |
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1` | Install / update |
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\uninstall.ps1 -Check` | Only show what would be removed |
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\uninstall.ps1` | Remove program files only (settings and records are kept) |
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\uninstall.ps1 -RemoveData` | Also remove settings and records (only files in the install record) |
| `powershell -NoProfile -ExecutionPolicy Bypass -File bin\install-herdr-mod.ps1 [-Check｜-Uninstall｜-Key ｜-NoKey]` | Install / remove the management window inside Herdr |

### Roles and generated output

| Command | Description |
|---|---|
| `node bin\sync.mjs [--out <folder>]` | Generate role table, cards and tab layout plan. Options: `--config` `--out` `--roles-dir` `--user-roles-dir` `--templates-dir` `--schema` `--env-rules`. Exit codes: 0 success / 1 validation or layout failure / 2 usage or settings error |
| `node bin\validate-roles.mjs` | Check role files (exit code 1 with reasons if any is invalid) |
| `node bin\render-card.mjs <role-id> --config <settings.json>` | Print one role card to the screen |
| `node bin\init-config.mjs --orch-home <folder> --functions-dir <folder>` | Create the default settings file **only the first time** (exit code 3 if it exists; never overwrites). The installer calls it automatically |

### Management engine (`node bin\manage.mjs <command>`)

Commands the management window uses internally. Give request values as **JSON on standard input** (you can also read from a file with `--request-file <file>` or call without input using `--no-input`); the result is one line of JSON. Exit code: 0 success, 1 failure, 2 command error.

| Command | Description | Main request values |
|---|---|---|
| `status` | Status | none |
| `role-list` | Role list and problems | none |
| `role-set` | Edit role fields | `id`, `fields`, optional `body` |
| `role-new` | New role | `id`, `fields`, optional `from`, `body` |
| `role-revert` | Remove my changes and return to the bundle default | `id` |
| `role-delete` | Delete my role | `id` |
| `export` | Export a bundle | `dest`, optional `scope` (`portable`｜`full`), `note` |
| `import-plan` | Import preview | `pkg`, optional `mode` (`merge`｜`replace`), etc. |
| `import-apply` | Apply import | `pkg`, `token` (the confirmation value from the preview) |
| `backup` / `backup-list` | Create backup / list | optional `note` |
| `restore-plan` / `restore-apply` | Restore preview / apply | `pkg`, `token` |
| `sync-run` | Run sync | optional `out` |
| `live-windows` | Query open windows (read) | optional `scopePrefix` |

Export scopes: `portable` = my roles + `env-rules.md` + `ignore.txt`; `full` = all of my settings.

### Development and test tools

| Command | Description |
|---|---|
| `node tools\build-plugin.mjs` / `--check` | Sync the plugin copy (`plugins\…\payload`) with the original / only check for drift |
| `node tools\cleanup-test-temp.mjs` | **Preview** of temporary folders left by tests. Add `--apply` to delete (`--apply --limit 1` is recommended the first time). A tool that **you run yourself**. |
| Running tests | [Chapter 19](#s19) |

<a id="s11"></a>
## 11. Update summary

The current version is `0.1.1` (the `VERSION` file). Below is a change summary in development order; click an item to expand it. All dates are in 2026.

<details>
<summary><b>11-27 · 0.1.1 security fix</b></summary>

- The management engine (`bin/manage.mjs`) now accepts only explicitly registered command names. Previously some unregistered names were accepted, and process environment information could appear in the output. If you use 0.1.0, please update.
- Requests must be JSON objects. A `null` request exited without a response, and numbers or arrays were treated as an empty request.

</details>

<details>
<summary><b>11-16 · License, preventive security hardening, documentation</b></summary>

- Assigned the **Apache License 2.0** and added `LICENSE`, `NOTICE` and `LEGAL-GUIDE.md` (rights holder SoDam AI Studio). The license is also shown in the plugin metadata.
- Preparation for publication: the author PC's paths, window addresses and internal project names in documents and tests were replaced with placeholders.
- Added `.env`, certificate and key-file patterns to `.gitignore` (prevents accidental commits).
- Wrote the Korean and English README (md and html).
- Final security review: 8 kinds of malicious bundle import, command-injection and path-manipulation tests were all blocked.

</details>

<details>
<summary><b>11-15 · Management tool, window inside Herdr, plugin, UI improvements</b></summary>

- Management engine (status, role editing, export/import, backup/restore) and a separate Windows management window.
- "Live windows" (read-only) tab.
- Management window opened inside Herdr (mod) and a marketplace plugin.
- Shortcut-change tab. Fixed a problem where a shortcut change was not reflected in the real file by making a `node` tool do the writing.
- Complete UI overhaul of the Herdr window (shared components, tab separation, status display, keyboard shortcuts, text/background contrast AA).
- Mode and cadence choices in the Windows window unified with the Herdr window's Korean wording.
- Security fixes: imported roles bypassing the "import switched off" rule with multiple BOMs; three `ignore`-validation bypasses.
- Fixed the last column of the role list being cut off.

</details>

<details>
<summary><b>11-14 · Structure cleanup after install, approval-proxy security hardening</b></summary>

- Fixed tab names to slot numbers, introduced the my-roles folder, unified path rules.
- Added the environment-rules layer and a one-line role summary (`summary`).
- File-edit auto-approval now turns on only when `ORCH_DOCS_DIR` is set explicitly (no default).
- Cross-checking of the approval prompt header, question line and path line (S6 series).
- Fixed input-handling defects (strict UTF-8 reading, error messages, install check).
- Test temp-folder cleanup tool. New-PC simulation test 18/18.

</details>

<details>
<summary><b>11-13 · Design and basic implementation</b></summary>

- Wrote the porting design document; label isolation test.
- Extracted the 12 role files and tested them against the originals.
- Install / check / uninstall tools and `sync`.
- Ported feature scripts and approval-proxy security fixes S1–S5 (switched parts that could be bypassed to an allow-list approach).
- Turned numbers and names inside role bodies into variables and removed state sentences from cards.

</details>

<a id="s12"></a>
## 12. File and document locations

### Project folder (what you downloaded)

```
SoDam-Herdr-Orchestration-Kit\
├─ README.md / README.en.md        This document (Korean / English)
├─ README.html / README.en.html    Web pages with the same content
├─ LICENSE                         Apache License 2.0 text
├─ NOTICE                          Attribution notice (Apache-2.0 manner)
├─ LEGAL-GUIDE.md                  Plain guide to the license and rights (Korean and English)
├─ VERSION                         Version (0.1.1)
├─ 01_이식-설계서.md               Design document (porting, 3-layer structure, role file format)
├─ 02_관리도구-설계서.md           Management tool / engine design and risks R1–R15
├─ bin\                            Install and management programs (install.ps1, sync.mjs, manage.mjs, orch-manager.ps1 …)
├─ roles\                          The 12 default roles
├─ functions\                      5 bundled features (approve, autopress, pending, queue, watch)
├─ herdr-mod\orch-manager\         Source of the management window inside Herdr (mod)
├─ lib\  schema\  templates\       Path rules / role format definition / card header template
├─ plugins\herdr-orchestration-manager\   Marketplace plugin (payload is a copy of the originals)
├─ .claude-plugin\marketplace.json Marketplace list
├─ docs\                           Step-by-step development notes
├─ tests\                          Automated tests
└─ tools\                          Development tools (build-plugin, cleanup-test-temp)
```

### On your computer after installation (`%LOCALAPPDATA%\Herdr-Orchestration`, changeable with the environment variable `ORCH_HOME`)

```
Herdr-Orchestration\
├─ app\                Copy of the bundle (treated as read-only, replaced on update)
├─ config\             My settings — not overwritten on update
│  ├─ orchestration.json   Settings
│  ├─ ignore.txt           List of window names to ignore
│  ├─ env-rules.md         (optional) rules for this PC only
│  └─ roles\               My roles (same id = override, new id = add)
├─ state\              Files the tool writes by itself
│  ├─ generated\           sync output (역할표.md, cards\, layout-plan.json …)
│  └─ docs\                Document folder (grants no permission by default)
├─ logs\               Logs
└─ backups\            Automatic and manual backups
```

### On the Herdr side (only if you installed Method 2)

- `~\.config\herdr-app\mods\orch-manager\` — mod files
- `~\.config\herdr-app\keys.json` — one open-key line added; backup is `keys.json.bak-before-orch-manager`

<a id="s13"></a>
## 13. Workflow

```
 [Once, at the start]                  [Day to day]
  Install (install.ps1)                  Open the management window
        ↓                                   ↓
  Edit settings (orchestration.json)     View / edit roles ──(automatic backup just before saving)
        ↓                                   ↓
  Run sync ──→ role table, cards, plan   Run sync again ──→ new role table, cards
        ↓
  (Optional) install the window inside Herdr

 [When moving to another PC]
  Original PC: Export ──→ orch-export-… folder ──→ New PC: Preview ──→ Confirm ──→ Apply (new roles arrive switched off)

 [When something went wrong]
  Backup · Restore tab ──→ choose a backup ──→ Preview ──→ Confirm ──→ Restore
```

<a id="s14"></a>
## 14. Architecture

**Three layers**

| Layer | Location | Nature |
|---|---|---|
| Bundle | Install folder (`app`) | Read-only. `roles`, `templates`, `schema`, `bin`, `lib`, `functions` |
| My settings | `config\` | Where the user edits. Not overwritten by updates |
| State | `state\`, `logs\`, `backups\` | Files the tool writes by itself |

**Components**

```
 [Windows management window]   [Window inside Herdr (mod)]      ← screens people see (same engine)
 orch-manager.ps1              herdr-mod\orch-manager\*.js
        │                              │
        └──────────┬───────────────────┘
                   ▼
            bin\manage.mjs  (management engine: validate → auto backup → atomic write)
                   │
         ┌─────────┼──────────┐
         ▼         ▼          ▼
      sync.mjs   Roles and   hc (optional, read-only queries)
   (plan output)  settings
                  (files)
```

- The screens **only call the engine** and never edit files directly. That is why both windows follow the same rules.
- The engine uses **no external packages**, only Node.js built-ins (there is no `package.json`).
- The plugin's `payload\` is a copy of the originals; `node tools\build-plugin.mjs --check` verifies there is no drift.

<a id="s15"></a>
## 15. Security and data flow

### Data flow

```
 Input (screen/command)  →  Engine: validate input  →  Pre-validate the resulting state  →  Auto backup  →  Write to temp file  →  Rename (done)
                                                ↓ validation fails
                                      Writes nothing and only reports the reason
```

- **There is no internet-access code** (result of a code scan; the only match is the `nodejs.org` address in an installation message). Data moves only inside this computer.
- Where it writes: under `<settings location>` (config, state, logs, backups). If you install the Herdr mod, additionally `mods\orch-manager` and one line of `keys.json`.
- There is **no feature that receives or stores** passwords, tokens or API keys.

### Protections (implemented) — ✔ marks what was confirmed by tests in this project

| Item | Content | Confirmed |
|---|---|---|
| Automatic backup before change | Backs up the current "my settings" just before edit/import/restore (skipped when no file of yours exists yet to back up) | ✔ |
| No change on validation failure | Writes nothing if the result violates the rules | ✔ |
| Atomic writes | Write a temp file, then rename | ✔ |
| Bundle is immutable | Every edit in the management window is written only to "my settings"; the bundle is not changed | ✔ |
| Others' bundles "switched off" | New and changed roles arrive switched off (their body is an AI instruction) | ✔ |
| Bundle path allow-list | Only fixed shapes such as `config\roles\<lowercase-id>.md` (rejects `../`, absolute paths, reserved names) | ✔ 8 kinds of malicious bundles |
| Bundle tamper detection | Compared with per-file SHA-256 and size records; rejects duplicates, out-of-scope files, bundles of another tool, symbolic links; limits 200 KB per file and 200 files | ✔ (symbolic links could not be tested directly due to permissions; code review only) |
| Apply confirmation value | Refuses to apply if it differs from the value received at preview (the bundle or settings changed in between) | ✔ |
| Command-injection prevention | External programs are always run with an "argument list" (no shell strings, no `eval`) | ✔ full code review |
| Input validation | Handles role-id format, mode values, broken JSON, 5 MB input, names containing newlines or `---` | ✔ |
| No wholesale folder deletion | Uninstall deletes only files in the install record, one by one | ✔ |
| Risky features off by default | Approval proxy, auto-approval, auto-compact | ✔ |
| Scope of file-edit auto-approval | Off by default. Only in a folder you set explicitly with `ORCH_DOCS_DIR` | ✔ |
| Ignore secret files | `.gitignore` covers `.env`, `*.pem`, `*.key`, etc. | ✔ |
| Dependencies | 0 external packages → nothing to audit for external vulnerabilities | ✔ |

### Things for the user to watch

- **Read other people's role bundles before switching them on.** A role body is an instruction AI windows follow as-is, so it could contain malicious sentences.
- Turning on the approval proxy or auto-compact **types keys into other windows.** Several layers of safety conditions exist, but **the chance of misoperation is not zero.** Read the responsibility notice in [Chapter 18](#s18) before turning them on.
- Paths containing this computer's user name (`C:\Users\…`) may appear in settings, logs and generated files, so **do not share the settings folder as it is.**

<a id="s16"></a>
## 16. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Red text: "cannot run script / signature" | Windows execution policy | Run with `-ExecutionPolicy Bypass` as in this document's commands |
| `node : The term ... is not recognized` | Node.js not installed or not on PATH | Install Node.js LTS from <https://nodejs.org> → **new** PowerShell window → `node -v` |
| Install check: `중단: Node.js 18 이상이 필요한데 찾지 못함` (abort: Node.js 18+ needed but not found) | Node missing or too old | Same as above (18 or newer) |
| `[경고]` (warning) in the install check | Optional feature missing (no session keeper, no allow-list, status line cannot be checked, etc.) | Installation is possible. Fix only when you need that feature |
| `sync` warning: `scope_prefix, projects_root 이(가) 아직 '(미설정)'` (still "not set") | Settings not filled in | Enter values in `config\orchestration.json` |
| Import: `묶음 폴더가 아님` (not a bundle folder) | You chose the parent folder | Choose the **`orch-export-…` subfolder** |
| Import: `내용이 기록과 다름(변조 또는 손상)` (content differs from record: tampered or damaged) | The file changed in transit | Export again from the original PC |
| Import: `미리보기 이후 묶음이나 내 설정이 바뀌었거나…` (the bundle or my settings changed after the preview…) | Changed between preview and apply | Preview again, then apply |
| Save is refused (`검증 실패` = validation failed) | A value violates the rules (e.g. a mode that does not exist, an invalid id) | Fix the item shown. The file was not changed, so rest assured |
| Herdr mod install stops midway | Herdr's official check failed | **Nothing was installed.** Fix the reason in the message and retry |
| `Ctrl+Shift+M` does not open | Another feature uses that key, so installation skipped binding it | `Ctrl+Shift+P` → `mod.open orch-manager`, or reinstall with `-Key` to choose another key |
| "Live windows" tab says "cannot query" | `hc` missing or Herdr not running | Install `hc` / start Herdr, then refresh (`F5`) |
| The management window does not appear | PowerShell 5.1 or STA launch problem | Run `powershell -NoProfile -ExecutionPolicy Bypass -STA -File bin\orch-manager.ps1` directly in PowerShell and read the error text |
| You changed the settings location but it looks somewhere else | `ORCH_HOME` not set | Set `$env:ORCH_HOME = "…"` in the same PowerShell window |

**If you want to undo:** management window **백업 · 복구** (Backup · Restore) tab → choose a backup → preview → apply. Backups are in the `backups\` folder.

If it is still not resolved, copy the **whole** error text and tell the owner. Remove your computer user name and paths from the text before sending.

<a id="s17"></a>
## 17. FAQ

<details>
<summary><b>Can I use it without knowing any programming?</b></summary>

Installation and use of the management window only need you to **copy and paste** the commands in this document. However, this tool is for "people who operate several AI windows", so if you are new to Herdr or Claude Code, first learn the basics of those programs.

</details>

<details>
<summary><b>Can I use it without Herdr?</b></summary>

Yes. The separate Windows management window, `sync`, and backup/restore work without Herdr. Only the "Live windows" query and the management window inside Herdr need Herdr (and `hc`).

</details>

<details>
<summary><b>What changes on my computer when I install?</b></summary>

The `%LOCALAPPDATA%\Herdr-Orchestration` folder is created and files appear only inside it (with Method 2, `mods\orch-manager` and one line of `keys.json` in the Herdr settings are added). Startup programs, Task Scheduler, the registry and PATH are not changed.

</details>

<details>
<summary><b>Will updating erase my settings and roles?</b></summary>

No. `config\` (settings and my roles) is **not overwritten.** Only the bundle (`app\`) is replaced with the new one. Still, press **[지금 백업]** (Back up now) in the management window before a big change.

</details>

<details>
<summary><b>How do I remove it?</b></summary>

See the uninstall commands in [Chapter 19](#s19). The default removal deletes only program files and keeps your settings and records.

</details>

<details>
<summary><b>Does it ever send input to AI windows on its own?</b></summary>

Not by default. Only three features send input: `approve`, `autopress`, and the auto-compact part of `watch`. All are **off right after installation** and must be turned on separately with environment variables.

</details>

<details>
<summary><b>Is it safe to import a role bundle someone else gave me?</b></summary>

It is built and tested to **block format-level attacks** such as path manipulation, file tampering and oversize files. But a role body is an **instruction** to the AI, so the tool cannot judge whether the content is malicious. That is why imported roles arrive **switched off** and you switch them on after reading them.

</details>

<details>
<summary><b>May I use it at work or in a business?</b></summary>

**Yes, but you must follow the Apache License 2.0 conditions** (keep a copy of `LICENSE` and the `NOTICE`, mark your changes, etc.). Names and trademarks are not licensed, there is no warranty, and external programs (Claude pricing plan, Herdr terms, etc.) must be **checked by you.** See [Chapter 18](#s18).

</details>

<details>
<summary><b>Can I use it on Mac or Linux?</b></summary>

Not supported. The installer and management window are built on Windows PowerShell and Windows window features, and testing was done on Windows 11 only.

</details>

<details>
<summary><b>Was this tool made by AI?</b></summary>

An AI coding tool (Claude Code) took part in writing the code and tests during development. This is also stated in the copyright section ([Chapter 18](#s18)).

</details>

<details>
<summary><b>Why are the role bodies in Korean rather than English?</b></summary>

They were carried over from role documents used in the original author's operating environment, so they are in Korean. The English document (`README.en.md`) is a translation of this guide; the role bodies and on-screen text are Korean.

</details>

<a id="s18"></a>
## 18. Legal, copyright, license, and commercial use

> **This is informational only, is not legal advice, and does not guarantee legal effect.** The authoritative license text is the [`LICENSE`](LICENSE) file. If this chapter reads differently from `LICENSE`, **`LICENSE` prevails.** Items marked "legal/expert review needed" in this chapter are ones this repository has not concluded. More detail is in [`LEGAL-GUIDE.md`](LEGAL-GUIDE.md).

### 18-1. At a glance

| Item | Content |
|---|---|
| License | **Apache License, Version 2.0** (`Apache-2.0`; 2.0 is the latest version) |
| Rights holder (copyright holder) | **SoDam AI Studio** |
| Copyright year | 2026 (first written 2026-11-13) |
| Related files | [`LICENSE`](LICENSE) (official text), [`NOTICE`](NOTICE) (attribution notice), [`LEGAL-GUIDE.md`](LEGAL-GUIDE.md) (plain explanation) |
| Commercial use | **Allowed** (when you meet the conditions below) |

### 18-2. Plain explanation: how far may I use this project?

| What you want to do | Allowed? |
|---|---|
| Use on your own computer | Yes |
| Use for company work or running a business (operating a service) | **Yes** |
| Modify the code or documents | Yes |
| Copy, fork (keep a copy under your account) | Yes |
| Give to others, put on the internet (redistribution, publication) | Yes — **when you meet the conditions in 18-3** |
| Sell it or include it in a paid service | Yes — when you meet the conditions in 18-3 |
| Deliver it to a company or client | Yes — when you meet the conditions in 18-3 |
| Put the code or documents into lessons or training material | Yes — when you meet the conditions in 18-3 |

> **This table covers "the rights the rights holder (SoDam AI Studio) actually holds".** It does not guarantee other companies' programs, names and terms, or rights this repository could not verify (see 18-12).

### 18-3. Conditions you must meet when redistributing (summary of License section 4)

1. Give recipients **a copy of the `LICENSE` file.**
2. Leave a **prominent notice on files you changed** saying you changed them.
3. **Do not remove** copyright, patent, trademark and attribution notices in the source code.
4. Keep the attribution notices in the **[`NOTICE`](NOTICE) file** readable in your modified version (in the `NOTICE` file, in documentation, or on screen).

### 18-4. What is not granted · what you must not do

- **Names and trademarks are not licensed** (License section 6). Do not use names or trademarks such as `SoDam`, `SoDam AI Studio` or `SoDam Herdr Orchestration Kit` **beyond reasonable use to state the origin**, as if they were your own product name.
- Do not use **other companies' names or logos as if affiliated, sponsored or endorsed** (Herdr, Claude, Anthropic, etc.).
- Do not **remove original copyright and attribution notices or claim "I made this".**
- Do not say **rights exist that this repository does not have** (for example, saying this license grants the right to use Herdr or Claude).
- Do not put outside material (role bundles, images, fonts, etc.) into this tool and distribute it **without checking its source and rights.**

### 18-5. What I must check myself

This repository **does not check the items below for you.** The more commercially you use it, the more carefully you should check.

| What to check | When it is needed |
|---|---|
| **Claude Code (Anthropic)** terms of use, usage policy, **pricing plan** | When you actually operate roles with AI windows |
| **Herdr** terms of use, mod development/distribution conditions | When you install or distribute the management window inside Herdr (mod) |
| **Node.js** license | When you install and use it (it is not included in this repository) |
| **Windows / PowerShell** terms of use | Always |
| **GitHub** terms of service | When you upload or share the repository |
| Rights in fonts, images, icons, music, video, templates | This tool has none. **What you put into role documents or outputs** is for you to check. |

### 18-6. Third-party programs and trademarks

- External programs **not included in this repository**: Node.js, Windows/PowerShell, Herdr (`herdr-app`, `hc`), Claude Code, Git. **Each provider's license and terms** apply.
- The Herdr mod only **imports** the mod components Herdr provides (`gpui-kit`, `gpui-base`) and does not contain their code. Herdr's mod development/distribution conditions could **not be confirmed** from this repository (**legal/expert review needed**).
- Herdr, Claude, Anthropic, Node.js, Windows, PowerShell, GitHub and similar names are trademarks of their respective owners and appear **only to refer to those things.** There is no affiliation, sponsorship or endorsement.
- **No trademark search was done** for the name `SoDam` (**legal/expert review needed**).

### 18-7. Caution about AI-generated content

- A large part of the code, documents and tests was written with the help of an AI coding tool (Claude Code). Whether copyright is recognized in AI-generated output, and problems that could arise from similarity to existing works, **differ by country and are not settled** (**legal/expert review needed**).
- **Check yourself before publishing, delivering or using commercially:** copyright (whose it is), source, whether commercial use is allowed, and the possibility of conflict with similar works.
- The rights in, and conditions of use for, **output** you make by having AI windows work with this tool depend on **that AI service's terms** and your own check.

### 18-8. No warranty · limitation of liability · risky features

- This tool is provided **"AS IS" with no warranty of any kind** (License section 7). **Liability is limited** (section 8).
- The approval proxy, auto-approval and auto-compact **type keys into other programs' windows.** **The user is responsible for the consequences** (wrong approvals, unintended command execution, data loss, etc.). Do not turn them on on a computer with important work.
- Even with the backup feature, **keep important data stored separately.**

### 18-9. Personal information · example data

- This tool does not collect personal information or send it outside (there is no internet-access code).
- Local files (settings, logs, generated output) may record **paths that contain this computer's user name.** Check before sharing files.
- The examples in tests and documents (paths, window addresses, project names) are **placeholders, not real values.** Use your own values.
- Do not put personal information, client information or non-public material in this repository, or in your own role documents.

### 18-10. Check result (2026-11-16)

| Check item | Result |
|---|---|
| External libraries and dependency files (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, lock files) | **None** → no dependency-license conflict check applies (the scanning tool was not run because it is not applicable) |
| Fonts, images, icons, audio, video, binaries | **None** |
| Passwords, keys, tokens | **None** (everything to be published was scanned) |
| Others' trademarks and names | `Herdr`, `Claude`, `Node.js`, `Windows`, etc. appear **only to refer to those things** |
| The author PC's paths, window addresses and internal project names in documents and tests | **Replaced with placeholders** for publication |

### 18-11. Contributions

- Under License section 5, **unless you state otherwise**, a contribution you submit to this repository is treated as provided under the same Apache-2.0 terms. There is no contribution procedure (`CONTRIBUTING`) yet, so discuss large changes in an issue first.

### 18-12. Items needing legal/expert review

| Item | Reason |
|---|---|
| Rights-holder notation `SoDam AI Studio` | This repository cannot confirm whether it is a legal entity, a business or an individual |
| Whether the holder actually has **rights in every part** | Some scripts were carried over from earlier work, and some parts were AI-generated |
| Trademark for `SoDam`, Herdr's mod terms, rights in AI-generated output | Not checked or researched |
| The boundary between taking ideas and copying code or documents | Needs case-by-case judgment |

<a id="s19"></a>
## 19. Uninstall and testing

### Uninstall

```
powershell -NoProfile -ExecutionPolicy Bypass -File bin\uninstall.ps1 -Check
powershell -NoProfile -ExecutionPolicy Bypass -File bin\uninstall.ps1
```

- The first line **only shows the removal list.** The second removes program files only (settings, records and backups remain).
- To also remove settings and records, add `-RemoveData` at the end of the second line. Files not in the install record (ones you made) are not deleted; they are only listed.
- It **does not delete folders wholesale.** It deletes the files in the install record one by one and only tidies up folders that became empty.
- To remove the management window inside Herdr: `bin\install-herdr-mod.ps1 -Uninstall`.

### Automated tests (for development · optional)

Run with Node.js, with no external packages. Tests work **only in temporary folders** and do not touch your real settings.

```
node tests\roles.test.mjs
node tests\install.test.mjs
node tests\manage.test.mjs
node tests\cleanup.test.mjs
node tests\mod-model.test.mjs
node tests\mod-check.test.mjs
node tests\herdr-keys.test.mjs
node tests\herdr-mod-install.test.mjs
node tests\plugin.test.mjs
node tests\functions.test.mjs
bash tests/label-isolation.test.sh
```

- `functions.test.mjs` takes about 4 minutes and has time-sensitive tests, so **do not run it at the same time as other tests.**
- Part of `roles.test.mjs` (about 12 checks) compares against the original author's documents on their PC, so **it is skipped automatically on other PCs.**
- `mod-check` and `herdr-mod-install` are skipped if `herdr-app` is absent. `label-isolation` is for environments with Herdr and `hc`.
- Check temporary folders that tests left in `%TEMP%` with `node tools\cleanup-test-temp.mjs` (preview), then clean them yourself.
- Results on the development PC as of 2026-11-15: functions 278 · install 41 · roles 40 · manage 46 · cleanup 10 · mod-model 15 · mod-check 40 · herdr-keys 9 · herdr-mod-install 9 · plugin 9 · label isolation 10, with 0 failures.

<a id="s20"></a>
## 20. Known limitations (what has not been verified)

To keep this document honest, **everything not yet verified or known to be limited** is listed.

| Item | Status |
|---|---|
| Windows 10, Node.js 18–25 | **Not verified** (tested only on Windows 11 + Node.js 26.7.0) |
| A person using the Windows management window by actually clicking with a mouse | **Not verified** (automated screen test and engine tests pass) |
| Whether **role save / export from the management window inside Herdr actually reach the real file** | **Not verified.** A similar problem existed with the shortcut change and was fixed; this part is being checked with "저장 진단" (save diagnosis). The reliable way is to use the **Windows management window**, which uses the same engine, or the command line. |
| **Remote** installation through a marketplace address | **Not verified** (the folder-based install flow passes its tests) |
| Rejection of symbolic-link bundles | Code review only (this PC lacks permission to create links, so it could not be tested directly) |
| Real-world operation of the approval proxy and auto-compact | Design and bypass tests were done, but **not validated by long-term real operation** |
| Intermittent failure of the `functions` test | There were 2 past failures of unknown cause that did not reproduce in 7 re-runs (recorded in the development notes) |
| Herdr's mod terms and distribution conditions | **Not verified** (legal/expert review needed) |
| Trademark search | **Not done** (legal/expert review needed) |
| Rights-holder notation `SoDam AI Studio` and whether the holder owns all rights | **Could not be confirmed** (legal/expert review needed) |
| Rights in AI-generated output and similarity to existing works | **Not settled** (legal/expert review needed) |
| Mac / Linux | Not supported |

---

Document version: for tool `0.1.1` · Korean `README.md`, English `README.en.md`, and the web pages `README.html` and `README.en.html` have the same content (the web pages are generated automatically from the Markdown with `node tools\build-readme.mjs`).
