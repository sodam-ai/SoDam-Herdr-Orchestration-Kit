# D 단계 변경 노트 — 도구 스크립트 5개 이식 + 보안 S1·S2 수정 + 시험

- 날짜: 2026-11-13 / 기준 문서: `01_이식-설계서.md` v0.3 (2-3 표, 2-4, 6장, 10장)
- 원본(`Herdr-Control-Center`의 스크립트 4개, 승인 대행 폴더의 `autopress.ps1`)은 **읽기만** 했고 한 글자도 바꾸지 않았습니다. 고친 것은 모두 이 폴더의 복사본입니다. 원본을 돌려야 했던 시험은 임시 폴더 사본으로만 돌렸습니다.
- 실제 `hc`는 한 번도 실행하지 않았습니다. 시험은 전부 가짜 `hc`(아래 3장)로만 돌렸습니다.
- 이 문서에는 개인 절대경로를 적지 않습니다(원본은 "고정 경로"라고만 부름).

## 1. 만든 파일

| 파일 | 내용 |
|---|---|
| `lib/orch-paths.mjs`, `lib/orch-paths.ps1` | 데이터 위치 해석. `ORCH_HOME`, 없으면 `%LOCALAPPDATA%\Herdr-Orchestration`. 하위 `config\` `state\` `logs\`를 없으면 만듦 |
| `functions/watch/` (`hc-watch.mjs`, `function.json`) | 감시기. 원본 `hc-watch.mjs` |
| `functions/approve/` (`approve.ps1`, `function.json`) | 승인 한 건 처리. 원본 `approve.ps1` |
| `functions/queue/` (`herdr-center.ps1`, `function.json`) | 창 목록·순번. 원본 `herdr-center.ps1` |
| `functions/pending/` (`pending.ps1`, `function.json`) | 대기 명령 보기. 원본 `pending.ps1` |
| `functions/autopress/` (`autopress.ps1`, `function.json`) | 승인 대행. 원본 `autopress.ps1` |
| `tests/functions.test.mjs`, `tests/stub/hc-stub.cs` | 자동 시험, 가짜 `hc`(시험 때 Windows 기본 `csc.exe`로 `hc.exe`를 만듦. 패키지 설치 없음) |

데이터 위치 기준("사용자가 편집하는 설정 vs 프로그램이 쓰는 기록"):

| 파일 | 위치 |
|---|---|
| `order.txt`, `ignore.txt`, `compact.off`, `autopress-allow.txt` | `config\` |
| `served.log`, `round.txt` | `state\` |
| `approve-log.txt`, `autopress.log` | `logs\` |

`compact.off`는 처음에는 지시문대로 `state\`에 두었다가, 후속 요청(7장)에서 사용자가 만드는 스위치이므로 `config\`로 옮겼습니다. 옛 위치(`state\`)에 있어도 꺼짐으로 인정하고 한 줄 안내를 냅니다.

## 2. 파일별 변경 (행 번호는 원본 기준)

### hc-watch.mjs

| 원본 행 | 변경 |
|---|---|
| 23 | `hc.exe` 전체 경로 기본값 → `hc`(PATH). `HC_BIN`이 있으면 그것 우선(원본과 같음) |
| 30, 33 | `compact.off`는 `state\`, `ignore.txt`는 `config\`에서 읽음 (`lib/orch-paths.mjs`) |
| 54~59 (56, 58, 60 포함) | 쿨다운을 환경변수로: `COMPACT_COOLDOWN_MS`(기본 20분), `CTRL_COOLDOWN_MS`(기본 60분). `CTRL_MATCH`는 `ORCH_CTRL_MATCH`(없으면 옛 이름 `CTRL_MATCH`, 그래도 없으면 `Control-Tower`). 압축 기준 `CTX_PCT`(57)·`CTRL_PCT`(70)는 원래 환경변수였고 "57 미만 금지" 안전 바닥도 그대로 |
| 80 | 폴더 접두어(`<date-prefix>_` 형태) 제거 처리만 삭제. 앞의 "공간 이름 `... /` 떼기"는 그대로 |
| 277, 300 근처 | `컨텍스트 N%` 상태줄을 읽지 못하면 조용히 넘어가던 것을, 연속 2번 스캔에서 어느 창에서도 못 읽으면 **한 번** `[자동 압축 비활성: 상태줄 없음]`을 알림(알림 누락 방지용 `important`). 화면에 선택창이 떠서 한 번 가려진 경우를 거르려고 2번 연속을 요구 |
| 390~395 | **허용 목록 우선**: `ORCH_AUTOCOMPACT=1` 이고 `WATCH_ONLY`가 비어 있지 않을 때만 자동 `/compact`(창 스캔과 컨트롤센터 자신 압축 둘 다) 시작. 아니면 시작할 때 `[자동 압축 꺼짐] 이유 …` 한 줄을 알리고 스캔을 아예 돌리지 않음. 알림 기능(새 세션, 승인 대기, 끝남, 오류 등)은 그대로 |

### approve.ps1

| 원본 행 | 변경 |
|---|---|
| 19 | `<win>` 기본값 제거. `HC_TERMINAL_ID`가 없으면 오류 문구를 내고 `exit 1`(아무것도 누르지 않음) |
| 81 | `approve-log.txt`를 `logs\`에 기록 |

### pending.ps1

| 원본 행 | 변경 |
|---|---|
| 6~7 | `ignore.txt`를 `config\`에서 읽고, **파일이 없으면 빈 목록**(원본은 `Get-Content`가 오류를 찍음) |
| 8 | `<win>` 기본값 제거. `HC_TERMINAL_ID`가 없으면 "경고: 자기 창 제외 불가"를 한 줄 찍고 계속(읽기 전용이므로) |
| 21 | 소담 훅 문구를 거르는 줄: 해롭지 않아 **그대로 둠** (설계서 표의 "정리만"은 이번에 하지 않음) |

### herdr-center.ps1

| 원본 행 | 변경 |
|---|---|
| 56, 67, 98 | `served.log` → `state\` |
| 100 | `round.txt` → `state\` |
| 70, 85~86 | `ignore.txt` → `config\` |
| 84 | `order.txt` → `config\`. **추가 변경**: 파일이 없으면 빈 순서(원본은 오류). 새 설치에는 `order.txt`가 없는 게 확실해서 pending의 `ignore.txt`와 같은 종류의 결함으로 보고 같이 고침 |
| 111 | `Control-Tower` 고정 → `ORCH_CTRL_MATCH`(기본 `Control-Tower`) |

### autopress.ps1

| 원본 행 | 변경 |
|---|---|
| (신규) | **기본 꺼짐**: `ORCH_ENABLE_AUTOPRESS=1`이 아니면 `꺼져 있음(켜려면 …)`을 출력하고 `hc`를 한 번도 부르지 않은 채 종료(`exit 0`) |
| 6~7 | 로그는 `logs\autopress.log` |
| 8 | 도구 폴더 고정 제거 → `ORCH_TOOL_DIR`. (처음 판: 없으면 파일 수정·Monitor 자동 승인을 둘 다 끔. **후속 판(7장): 도구 폴더 안 파일 수정은 아예 자동 승인 대상이 아님**. `ORCH_TOOL_DIR`는 Monitor 실행 형식과 pending 명령 형식에만 쓰이고, 없으면 그 둘이 수동) |
| 22, 26 | 창 이름 패턴 → `ORCH_PROXY_TARGET`(기본 `CT-CC-(0|Master)`). 테두리 제목 패턴은 `Herdr-` + 위 값이 기본이고, `ORCH_PROXY_TITLE`로 따로 덮어쓸 수 있음(**판단 필요**, 5장) |
| 44 (S2) | `StartsWith(도구폴더)` → `Test-InsideToolDir`: 슬래시 통일·대소문자 무시·`.`/`..` 해석 후 `도구폴더 + '/'`로 시작하는지 검사. 해석 후에도 `..`가 남으면(드라이브 문자 위로 올라가는 경우 포함) review |
| 47~51 (S1) | 글자 포함(`hc-watch\.mjs`)만 보던 것을 다음 **둘 다** 통과해야 press로 변경: (a) Monitor 명령 전체(머리줄~질문줄 사이 글자)에서 위험 토큰 없음, (b) 명령이 `[NAME=값 ...] node <ORCH_TOOL_DIR>/watch/hc-watch.mjs` 형태 하나와 정확히 일치(앞붙이 환경변수의 값은 `"..."`/`'...'`(달러·역따옴표 없음)/단어만 허용, 스크립트 뒤에 다른 글자가 붙으면 불허) |

### lib/orch-paths.*

`ORCH_HOME` > `%LOCALAPPDATA%\Herdr-Orchestration`. 폴더가 없으면 만든다. `.ps1`은 ASCII, `.mjs`는 UTF-8.

## 3. 원본과 달라진 동작 (정리)

1. 상태 파일이 스크립트 옆이 아니라 데이터 폴더에 생김. 옛 파일(`served.log` 등)은 **자동으로 옮겨 주지 않음** — 필요하면 사용자가 복사(E 단계 설치 도구의 몫).
2. `hc` 기본은 PATH의 `hc`. `<win>` 기본 주소가 사라져 `approve`는 `HC_TERMINAL_ID` 없이 못 씀.
3. 자동 `/compact`가 **기본 꺼짐**(원본은 켜져 있었음). 켜려면 `ORCH_AUTOCOMPACT=1` + `WATCH_ONLY`. 꺼진 동안은 컨트롤센터 자신의 압축 안내(`컨텍스트 N% … /compact 필요`)와 `컨텍스트 N% 접근` 안내도 나오지 않음(같은 스캐너에 속해서).
4. 승인 대행이 **기본 꺼짐**(`ORCH_ENABLE_AUTOPRESS=1` 필요). 켜도 `ORCH_TOOL_DIR`이 없으면 파일 수정·Monitor는 사람 몫.
5. S1·S2가 닫힘. 예전엔 press였던 것 중 이제 review가 되는 것: 위험 명령이 숨은 Monitor, 허용 형식이 아닌 Monitor, `..`로 도구 폴더를 빠져나가는 경로, 이름만 비슷한 폴더. 반대로 슬래시 모양이나 대문자만 다른 정상 경로는 이제 통과(원본은 글자 그대로 비교해 review).
6. 표시용 폴더 접두어 제거가 없어져 알림에 폴더 이름이 그대로 보임.
7. `pending`: `ignore.txt`가 없을 때 오류 대신 빈 목록. `queue`: `order.txt`가 없을 때 같음.
8. 새 시작 알림 줄: `[자동 압축 꺼짐] …` (알림 1줄 추가).

## 4. 시험 결과

> 이 장은 **1차 완료 시점(72/72)** 의 기록입니다. 후속 작업(S3·S4·S5 등) 이후의 최종 수치와 시험 변경 내역은 7장에 있습니다.

실행: `node tests/functions.test.mjs` (Node v26.7, Windows PowerShell 5.1) — **PASS=72 FAIL=0 SKIP=0, 종료코드 0** (약 2분).

| 절 | 내용 | PASS |
|---|---|---|
| 0 | `where hc`에 가짜만 보임 / 가짜는 `send` 같은 변경 명령을 거부·기록 | 2 |
| 1 | approve: 안전한 승인창 → Enter 호출 / 위험 토큰 → SKIP, Enter·Esc 없음 / 자기 창 → SKIP, hc 호출 0회 / `HC_TERMINAL_ID` 없음 → 오류 / 로그가 `ORCH_HOME\logs`에 생김 | 5 |
| 2 | pending: `ignore.txt` 없이 오류 0 / 자기 주소 없이 경고 / `config\ignore.txt` 적용 / **원본 사본은 `ignore.txt` 없을 때 오류 출력(재현)** | 5 |
| 3 | queue: `mark`·`next`·`queue`·`status` 동작, 상태 파일이 `ORCH_HOME\state`에만 생김, `functions\` 폴더에 새 파일 0개, `order.txt` 없어도 오류 0, `ORCH_CTRL_MATCH`, **원본 사본은 스크립트 옆에 `served.log`를 만듦(재현)** | 6 |
| 4 | watch: `ORCH_AUTOCOMPACT=1`+`WATCH_ONLY` 없음 → "압축 꺼짐 + 이유", `keys` 0회, `read`도 0회 / `WATCH_ONLY`만 있어도 꺼짐 / 허용됐는데 상태줄 없음 → "자동 압축 비활성: 상태줄 없음" / 상태줄 있으면 스캔은 돌고 안내·입력 없음 / `HC_BIN` 없이 PATH의 `hc` / **원본 사본은 안내 없이 스캔 시작(재현)** | 10 |
| 5 | autopress: 환경변수 없으면 "꺼져 있음(켜려면 …)" 출력 후 종료, hc 호출 0회 / 켜면 안전한 Bash 명령은 press 판정 / `ORCH_PROXY_TARGET` 변경과 불일치 시 TARGET_NOT_FOUND | 4 |
| 6 | S1·S2: 12개 경우 × (원본 사본 + 수정본) | 25 |
| 7 | 산출물(`lib`, `functions`, `tests/stub`, 이 시험 파일 .ps1/.mjs/.json/.cs 11개)에 사용자 폴더·D: 도구 폴더 절대경로·이메일 0건 | 1 |
| 8 | PowerShell 5.1 파싱 오류 0(.ps1 5개), 한글이 든 파일은 BOM 포함, `node --check`, `function.json` 5개의 필드·risk/default, `orch-paths.mjs` 동작 | 14 |

### S1·S2 재현 결과 (원본 `autopress.ps1`을 임시 폴더로 복사해 `-Once -DryRun`)

| 번호 | 입력 | 원본 사본 | 수정본 |
|---|---|---|---|
| S1a | Monitor `curl … \| sh # hc-watch.mjs` | **press (취약)** | review |
| S1b | Monitor `python evil.py hc-watch.mjs` | **press (취약)** | review |
| S1c | Monitor `node <도구폴더>/watch/hc-watch.mjs && node evil.js` | **press (취약)** | review |
| S1d | Monitor `node <이름만 비슷한 폴더>/watch/hc-watch.mjs` | **press (취약)** | review |
| S1-ok1/2 | 정상 Monitor(환경변수 앞붙이 + 따옴표 경로 / 평범한 형식) | press | press (정상은 계속 통과) |
| S2a | 파일 수정 `<도구폴더>\..\..\..\Windows\evil.txt` | **press (취약)** | review |
| S2b | 파일 수정 `<도구폴더>2\x.txt` | **press (취약)** | review |
| S2c | `<도구폴더>/sub/../../x.txt` | review | review |
| S2-ok1/2/3 | 정상 경로 / 안쪽에서 끝나는 `..` / 슬래시·대소문자만 다름 | press / press / (원본 review → 수정본 press) | press |

### 일부러 되돌려 본 시험

수정본 `autopress.ps1`의 두 줄을 원본 방식(`StartsWith(도구폴더)`, `hc-watch.mjs` 글자 포함)으로 되돌리고 같은 시험을 돌리면 **FAIL 6건**(S1b, S1c, S1d, S2a, S2b, S2-ok3)이 나옴 → `PASS=66 FAIL=6`, 종료코드 1. 되돌린 뒤 바이트 단위로 원상복구해 같은 파일임을 확인했고 다시 72/72 통과. (S1a는 되돌려도 `curl`이라는 위험 토큰 검사에 걸려 계속 review였음 — Monitor에 위험 토큰 검사를 새로 넣은 효과.)

## 5. 못 한 것 · 가정 · 사용자 판단이 필요한 것

- **실제 `hc`·실제 Claude Code 화면으로는 한 번도 시험하지 못함.** 화면은 가짜 텍스트(승인창 모양을 추정해 만든 것)입니다. 특히 **`Monitor` 승인창의 실제 배치를 확인하지 못했습니다**(원본 로그에는 "Monitor 허용" 기록만 있고 화면은 없음). 수정본은 머리줄 `Monitor`~질문줄 사이 글자 전체를 명령으로 보고, 허용 형식과 정확히 같을 때만 press합니다. 실제 화면에 설명 줄이 같이 있으면 정상 Monitor도 review가 됩니다(안전한 쪽으로 실패). 실제 화면을 한 번 보고 맞춰야 합니다(E 단계 또는 사용자 확인).
- 테두리 제목(`Herdr-CT-CC-0`)의 출처는 여전히 모릅니다. 지시는 "`ORCH_PROXY_TARGET` 하나로"였지만 제목은 별도 값이라, 기본을 `Herdr-` + 대상 패턴으로 하고 `ORCH_PROXY_TITLE`(선택)을 **하나 더 추가**했습니다. 불필요하면 빼도 됩니다.
- `function.json`에 설계서 6장 필드 외에 `entry`(스크립트 파일명)와, `watch`에만 `parts`(알림 medium/on, 자동 압축 high/off)를 넣었습니다. 6장 표가 `hc-watch` 한 파일을 두 줄(알림, 자동 압축)로 나누고 있어서입니다. 상위 `risk`는 `medium`/`on`(알림 기준). 스키마(C 단계 `schema/`)와 맞출지 결정이 필요합니다.
- (해결됨) `compact.off` 위치, `ORCH_PROXY_TITLE` 유지, `function.json`의 `entry`·`parts`는 후속 요청에서 사용자(총지휘)가 정리·승인했습니다. 아래 7장 참고.
- 설계서 2-3 표의 "`pending.ps1` 21행 정리"는 하지 않았습니다(해롭지 않음).
- 원본 `pending.ps1`은 `ignore.txt`가 없을 때 설계서가 말한 "오류로 멈춤"이 아니라 **오류를 찍고 계속**했습니다(종료코드 0). 수정은 같고, 시험은 "오류 출력"을 재현으로 기록합니다.
- 심볼릭 링크·8.3 짧은 이름·끝에 점이 붙은 폴더 이름 같은 윈도우 경로 변형은 S2 검사가 "일치하지 않음 = review"로 막을 뿐 별도로 해석하지는 않습니다. 도구 폴더 안의 링크가 밖을 가리키는 경우는 못 막습니다.
- 시험 임시 폴더(`%TEMP%\orch-test-*`)는 지우지 않습니다(폴더 삭제 금지 규칙). 필요하면 사용자가 지우면 됩니다.
- 시험은 가짜 `hc.exe`를 만들 때 .NET Framework의 `csc.exe`에 기대므로 Windows에서만 돕니다(이 프로젝트의 가정과 같음).
- `.ps1` 줄바꿈은 CRLF로 저장했습니다(`.gitattributes` 규칙과 같음). 한글이 든 `.ps1`(approve, pending, herdr-center, autopress)은 BOM 포함 UTF-8, `lib/orch-paths.ps1`은 순수 ASCII입니다.
- 같은 폴더의 다른 단계 파일(`bin\`, `roles\`, `tests\fixtures`, `tests\roles.test.mjs`)은 건드리지 않았습니다. (줄바꿈 정리 도구를 처음 돌릴 때 `bin\*.mjs` 3개를 줄바꿈 정규화 대상으로 한 번 읽고 다시 썼습니다. 내용 변화는 없어야 하며, 이 단계 이후로는 제외했습니다.)

## 6. 다음 단계(E)에 넘기는 것

- 설치 도구는 `ORCH_HOME` 아래 `config\ignore.txt`(빈 파일), `config\order.txt`를 만들고, 위험 기능(`ORCH_AUTOCOMPACT`, `ORCH_ENABLE_AUTOPRESS`)은 **꺼진 채** 두어야 합니다.
- `-Check`: `hc` PATH, 상태줄 `컨텍스트 N%`, `WATCH_ONLY` 설정 여부, `ORCH_TOOL_DIR` 설정 여부는 `function.json`의 `checks`에 적어 두었습니다.
- Monitor로 감시를 띄우는 명령은 `[환경변수=값 …] node <ORCH_TOOL_DIR>/watch/hc-watch.mjs` 형식이어야 승인 대행이 통과시킵니다(`ORCH_TOOL_DIR` = 번들의 `functions` 폴더).

## 7. 후속 보안 작업: S3 · S4(+영역 분리·링크) · S5(Monitor 환경변수) · compact.off 이동

자동 보안 검토가 지적한 내용(설계서 2-4의 S3·S4, CHECKPOINT의 "D 단계 후속 보안 과제", 그리고 S1 수정본 자체의 결함인 S5)을 `functions/autopress`에 반영했습니다. 원본보다 **자동 승인이 줄어드는 것은 의도한 변화**입니다.

### 7-1. 바뀐 것

| 번호 | 내용 | 구현 |
|---|---|---|
| S3 | Bash/PowerShell 명령 승인을 거부 목록에서 **허용 목록 우선**으로 뒤집음. 순서: (1) 한 줄짜리 명령만(여러 줄이면 review), (2) 셸 메타문자(세미콜론, 파이프, 앰퍼샌드, 역따옴표, 달러, 괄호, 꺾쇠, 중괄호)가 하나라도 있으면 review, (3) 양 끝이 고정된(`^…$`) 허용 형식과 일치해야 press, (4) 그다음 기존 거부 목록(`$riskRx`)도 통과해야 press(두 번째 방어선) | `Decide`, `Get-AllowList`, `Test-AllowedCommand` |
| S3 기본 허용 목록 | `hc (ls/get/read)`(옵션은 `--json`, `--lines N`, 터미널 주소 `tNN`만), `git status/log/diff/show/branch`의 읽기 전용 형태(예: `git log --oneline -n 15`, `git status --short`, `git diff --stat`, `git branch --show-current`), `powershell -NoProfile -File <ORCH_TOOL_DIR>\pending\pending.ps1 [-Only tNN,tNN]` (경로는 정해진 한 곳만. `..`, 이름만 비슷한 폴더, 다른 옵션은 불일치. `ORCH_TOOL_DIR`이 번들 루트인 경우를 위해 `<ORCH_TOOL_DIR>\functions\pending\pending.ps1`도 같은 형식으로 인정) | 위 함수 |
| S3 사용자 목록 | `config\autopress-allow.txt`(한 줄에 정규식 하나, `#` 주석). 추가만 가능: 기본 목록을 빼지 못하고, 메타문자 금지는 못 풀며, 줄이 `^`로 시작해 `$`로 끝나지 않거나 문법이 틀리면 무시하고 `autopress.log`에 한 줄 기록 | 위 함수 |
| S4 | 파일 수정(Edit/Create/Write file) 자동 승인에서 실행 가능한 확장자는 항상 review: `.ps1 .psm1 .psd1 .mjs .js .cjs .ts .cmd .bat .vbs .vbe .wsf .sh .py .exe .dll .lnk .com .msi .jar` + 문서 폴더 안에서도 `.json .cs`. 대소문자 무시. 끝의 점·공백, 콜론이 든 경로, 와일드카드 문자, UNC·상대 경로는 "일치 안 함"으로 보고 review | `Test-FileEdit` |
| S4 보강(영역 분리) | 파일 수정 자동 승인의 허용 영역을 `ORCH_TOOL_DIR`(실행 코드)이 아니라 **`ORCH_DOCS_DIR`**(총지휘가 고치는 문서 폴더)로 바꿈. `ORCH_TOOL_DIR` 안은 확장자와 무관하게 항상 review. `config` 폴더 안, 그리고 이름이 `autopress-allow.txt` / `orchestration.json` / `function.json` / `install-manifest.json` 인 파일은 어느 경로에 있어도 review | `Test-FileEdit` |
| 설정 오류 | `ORCH_DOCS_DIR`이 `ORCH_TOOL_DIR` 또는 `<ORCH_HOME>\config`와 같거나 포함 관계(안쪽·바깥쪽 모두)이면 시작할 때 `설정 오류`를 출력하고 `exit 1`(hc는 한 번도 부르지 않음) | 시작부 |
| 문서 폴더 | `ORCH_DOCS_DIR`를 **직접 지정했을 때만** 파일 수정 자동 승인이 켜짐. 기본 폴더 자동 사용은 없음(2026-11-14 변경, 9장). 설치 도구가 만드는 `<ORCH_HOME>\state\docs`는 제안 위치일 뿐 | 시작부 |
| S4 링크 검사 | 정규화한 경로의 존재하는 모든 상위 폴더·파일 중 하나라도 링크(정션·심볼릭 링크)이면 review. 조회 중 오류가 나도 review | `Test-HasReparsePoint` |
| S5 | Monitor 허용 형식의 환경변수 앞붙이를 **이름 허용 목록 + 값 형식 검증**으로 제한. 허용: `HC_SELF`=`t`+영숫자 1~8자, `WATCH_ONLY`=따옴표 안 1~80자(`" ' 백틱 $ ; & \| < > ( ) { } \ % ! ^` 와 줄바꿈 불가), `BLOCK_MS DONE_MS ERROR_MS FLUSH_MS CTX_SCAN_MS CTX_PCT CTRL_PCT COMPACT_COOLDOWN_MS CTRL_COOLDOWN_MS`=숫자 1~9자리, `DRY_RUN`·`ORCH_AUTOCOMPACT`=0 또는 1. 이름은 대소문자 정확히 일치, 같은 이름 두 번 지정은 review. 그 밖의 이름(`NODE_OPTIONS`, `HC_BIN`, `PATH`, `ORCH_HOME`, `BASH_ENV`, `NODE_PATH`, `LD_*`, `DYLD_*` 등)은 모두 review. 스크립트 인자는 정확히 하나이고, 정규화한 경로가 `<ORCH_TOOL_DIR>/watch/hc-watch.mjs`(도구 폴더=functions 폴더인 경우) 또는 `<ORCH_TOOL_DIR>/functions/watch/hc-watch.mjs`(번들 루트인 경우)와 같아야 함. 추가 인자나 node 옵션은 review. 거부 목록(`$riskRx`)에도 `NODE_OPTIONS`, `HC_BIN`, `NODE_PATH`, `BASH_ENV`를 추가(이중 방어) | `Test-AllowedMonitorCommand` |
| compact.off | `config\compact.off`로 이동. 옛 위치 `state\compact.off`도 꺼짐으로 인정하고 "config 폴더로 옮겨 주세요" 한 줄을 한 번 냄 | `hc-watch.mjs` `compactKilled()` |
| function.json | autopress: `data.config`에 `autopress-allow.txt`, `settings`에 `ORCH_DOCS_DIR`와 허용 파일 설명, `ORCH_TOOL_DIR` 설명 수정. watch: `compact.off`를 `data.config`로 | |
| (자리만) | Monitor 승인에서 실행할 스크립트 파일의 내용 일치 확인(설치 목록의 해시 비교)은 통합 단계로 미룸. 코드에는 `TODO(integration)` 주석과, 목록이 없으면 통과가 아니라 review로 가야 한다는 메모만 남김 | `Decide`의 Monitor 분기 |

### 7-2. 달라진 동작 (원본 대비 자동 승인이 줄어드는 곳)

1. Bash/PowerShell 명령은 이제 **위 허용 목록에 있는 것만** 자동 승인됩니다. 원본은 위험 글자만 없으면 거의 다 통과했습니다(`Get-ChildItem`, `python x.py`, `hc send …` 같은 것도). 지금은 모두 사람 검토입니다.
2. 파이프, `&&`, `;`, `$( )`, 리다이렉트(`2>&1` 포함) 등 메타문자가 든 명령은 허용 형식과 같아 보여도 전부 review입니다.
3. 여러 줄(화면에서 줄이 나뉘어 보이는) 명령은 review입니다. 좁은 창에서 한 명령이 줄바꿈되어 보이는 경우도 구별할 수 없어 같이 review가 됩니다(안전한 쪽으로 실패).
4. 파일 수정 자동 승인은 문서 폴더(`ORCH_DOCS_DIR`)의 일반 문서(`.md`, `.txt` 등)만입니다. 도구 폴더(코드) 안은 `.md`도 review, 설정 폴더·허용 파일·manifest류는 항상 review, 링크를 거친 경로도 review입니다.
5. 문서 폴더 설정이 코드·설정 폴더와 겹치면 승인 대행이 시작되지 않습니다.
6. Monitor 승인은 감시기 실행에 쓰는 환경변수 열세 가지 이름(위 S5 목록)만 앞에 붙일 수 있고, 그 외 이름이나 추가 인자가 있으면 사람 검토입니다.
7. `compact.off`는 `config\`에 둡니다(옛 위치도 인정).

### 7-3. 이번에 의도적으로 바꾼 기존 시험 (조용히 고친 것 없음)

| 시험 | 바꾼 내용 | 이유 |
|---|---|---|
| 5b, 5c (autopress 켜진 상태의 "안전한 Bash 명령 → press") | 입력 명령을 `Get-ChildItem` → `hc ls --json` 으로 교체. 기대값(press)은 그대로 | `Get-ChildItem`은 이제 허용 목록에 없어 review가 되는 것이 올바름(S3 의도). 허용 목록에 있는 명령으로 같은 동작을 시험 |
| 6장 S2a·S2b·S2c·S2-ok1·S2-ok2·S2-ok3 (수정본 쪽) | 파일 경로의 기준 폴더를 `ORCH_TOOL_DIR` → `ORCH_DOCS_DIR`로 바꿈(수정본 실행 시 `ORCH_DOCS_DIR`을 가짜 폴더로 지정). 기대값(review/press)은 그대로 | 파일 수정 허용 영역이 도구 폴더에서 문서 폴더로 이동(S4 영역 분리). **원본 사본 쪽 시험은 원본 방식(자기 도구 폴더 기준)을 그대로 유지** |
| 6x | 이름을 "파일·Monitor 자동 승인이 꺼짐" → "Monitor 자동 승인이 꺼짐"으로 | 파일 수정은 더 이상 `ORCH_TOOL_DIR`에 의존하지 않음 |
| 6장 전체 | 원본이 없는 PC에서도 수정본 시험이 돌도록 도구 폴더 대체값을 둠(원본 재현은 원본이 있을 때만) | 시험 견고성(기대값 변화 아님) |
| 시험 구조 | 구역별로 골라 돌리는 `ORCH_TEST_ONLY`(정규식) 추가 | 빨강→초록 확인용. 기본은 전체 실행 |

6장의 S1 시험(S1a~S1d, S1-ok1·2)은 그대로 통과합니다. 정상 Monitor 형식 두 개(환경변수 앞붙이 형식, 평범한 형식)는 S5 이후에도 press입니다(환경변수 이름이 허용 목록에 있으므로). 그 밖의 기존 시험(approve, pending, queue, watch, 인코딩·구문, 개인경로 검색 등)은 기대값 변경 없이 그대로 통과합니다.

### 7-4. 시험 결과

- **S3·S4 빨강 단계(구현 전, 새 시험만 추가해 이전 수정본에 실행):** `ORCH_TEST_ONLY='^(9|10|11)\.' node tests/functions.test.mjs` → **PASS=64 FAIL=52, 종료코드 1.** 실패 52건: 허용 밖 명령이 press로 통과한 것 33건(실행기 호출 각종 형태, 메타문자가 든 명령, `hc send`·`hc keys`, 읽기 전용이 아닌 `git` 옵션, `Get-ChildItem`, `echo hello`, 경로가 다른 `pending.ps1` 4가지, 여러 줄 명령 등) + 사용자 허용 파일 3건 + 도구 폴더 안 `.md`·`.txt`·`hc-watch.mjs` 수정이 press로 통과 3건 + 문서 폴더 개념이 없어 생긴 실패(문서 폴더의 `.md`/`.txt`가 review가 됨 5건, 기본 문서 폴더 2건, 겹침 검사 6건, 정션 대조군 1건) + `config\compact.off` 무시·안내 없음 2건.
- **S3·S4 초록 단계(구현 후):** 같은 9·10·11장 시험 **PASS=116 FAIL=0.**
- **S5 빨강 단계:** `ORCH_TEST_ONLY='^12\.'` 로 새 12장만 이전 수정본(환경변수 이름 아무거나 허용)에 실행 → **PASS=22 FAIL=24, 종료코드 1.** 이름이 허용 목록 밖인 앞붙이 11가지(`NODE_OPTIONS` 두 형태, `HC_BIN`, `ORCH_HOME`, `PATH`, `BASH_ENV`, `NODE_PATH`, `ORCH_TOOL_DIR`, `ORCH_DOCS_DIR`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`), 대소문자가 틀린 이름, 같은 이름 중복 2건, 값 형식 위반(`HC_SELF`가 주소가 아님·슬래시 포함, `WATCH_ONLY`에 세미콜론·너무 긺, 숫자 아님·10자리, `DRY_RUN=2`, `ORCH_AUTOCOMPACT=yes`)이 모두 **press로 통과**했고, 번들 루트 형식 2건이 아직 지원되지 않아 실패.
- **S5 초록 단계(구현 후):** 같은 12장 **PASS=46 FAIL=0.** 추가 인자(`--require …`, 한 단어, 스크립트 두 번), node 옵션 앞붙이(`--require`, `--inspect`, `-e`), 엉뚱한 경로·이름만 비슷한 폴더는 구현 전에도 review였고 구현 후에도 review입니다(회귀 방지용으로 유지). 문서에 있는 정상 명령(`HC_SELF … BLOCK_MS … DONE_MS … FLUSH_MS … WATCH_ONLY="…" [DRY_RUN=1] node "…/hc-watch.mjs"`)과 허용 이름을 두루 쓴 형식, 작은따옴표 형식, `node.exe`, 번들 루트 형식은 press입니다.
- **일부러 되돌린 시험:**
  - 수정본 `autopress.ps1`의 네 줄(S3 허용 목록 검사, S4 실행 확장자 검사, S4 링크 검사, 도구 폴더 영역 검사)을 `if ($false)`로 바꾸고 9·10장을 돌리면 **PASS=65 FAIL=47, 종료코드 1.** S3 되돌림 → 허용 밖 명령 20건과 사용자 파일 2건 실패, S4 되돌림 → 실행 확장자 22건과 `.PS1` 실패, 링크 검사 되돌림 → 정션 2건(허용 영역 안 정션, 문서 폴더 자체가 정션) 실패. (도구 폴더 영역 검사만 빼도 문서 폴더 검사가 한 번 더 막아서 실패 항목이 늘지 않음 — 이중 방어가 의도대로 동작.)
  - S5: 환경변수 이름 검사와 중복 검사 두 줄을 되돌리고 12장을 돌리면 **PASS=37 FAIL=9, 종료코드 1**(`ORCH_HOME`, `PATH`, `ORCH_TOOL_DIR`, `ORCH_DOCS_DIR`, `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, 대소문자 틀린 이름, 중복 2건). `NODE_OPTIONS`·`HC_BIN`·`NODE_PATH`·`BASH_ENV`는 되돌려도 거부 목록이 막아 실패하지 않음 — 이중 방어.
  - 매번 되돌린 뒤 `cmp`로 바이트 단위로 같은 파일임을 확인했습니다.
- 정션은 `mklink /J`(관리자 권한 불필요)로 임시 폴더에 실제로 만들어 시험했습니다(건너뜀 없음).
- `11a`는 60초 "안정" 규칙을 기다려야 해서 처음 전체 실행에서 한 번 시간 초과로 실패했고(단독 3회는 통과), 대기 시간을 85초 → 110초로 늘렸습니다.
- **최종 전체 실행:** `node tests/functions.test.mjs` → **RESULT: PASS=234 FAIL=0 SKIP=0, 종료코드 0** (약 4분 26초). 절별 PASS 수: 안전 2 / approve 5 / pending 5 / queue 6 / watch 10 / autopress 기본 4 / S1·S2 25 / 경로·이메일 검색 1 / 인코딩·구문 14 / S3 53 / S4·링크 59 / compact.off 4 / S5 46. 시험 파일 .ps1·.mjs·.json·.cs 개인 경로·이메일 검색 0건.

### 7-5. 못 한 것 · 가정 (후속 작업분)

- 실제 승인창의 명령 줄바꿈 표시 방식은 확인하지 못했습니다. 한 명령이 여러 줄로 보이면 review가 되므로 정상 명령도 자주 review가 될 수 있습니다. 실사용에서 많이 걸리면 그때 허용 목록 또는 줄 판정을 손봐야 합니다(E 단계/사용자 확인).
- 허용 목록의 `git diff`/`git show`는 저장소 설정에 따라 외부 diff·textconv 프로그램을 실행할 수 있습니다(저장소가 내 것일 때만 안전). 지시대로 읽기 전용 형태로 두었고 `--ext-diff` 옵션은 허용하지 않습니다.
- 링크 검사는 정션·심볼릭 링크만 봅니다. 하드 링크나 검사 직후 교체(경쟁 상태)는 막지 못합니다.
- (2026-11-14 갱신: 아래 기본값 규칙은 9장에서 **폐지**됐습니다. 지금은 기본값이 없고 직접 지정해야만 켜집니다.) `ORCH_DOCS_DIR` 기본값 규칙("그 폴더가 있을 때만 사용")은 지시문의 두 문장(기본값 `<ORCH_HOME>\state\docs` / 없으면 꺼짐)을 합친 해석이었습니다.
- `ORCH_TOOL_DIR`이 가리키는 곳이 functions 폴더인지 번들 루트인지 지시문이 서로 달라(앞: `<도구폴더>/watch/hc-watch.mjs`, 뒤: `ORCH_TOOL_DIR\functions\watch\hc-watch.mjs`), Monitor 스크립트 경로와 `pending.ps1` 경로 **두 형태를 모두** 정확 일치로 인정했습니다. 통합 단계에서 하나로 정해지면 다른 쪽을 지우면 됩니다. 이름 충돌 주의: 앞 요청의 "링크 검사"를 이 노트에서는 `S4 링크 검사`로 부르고, 지시문의 "S5"는 Monitor 환경변수 문제입니다.
- Monitor 승인의 스크립트 내용 일치 확인(해시 비교)은 구현하지 않고 자리(주석)만 남겼습니다. 허용 환경변수 중 `ORCH_AUTOCOMPACT`는 값 형식만 검사하며, 실제 압축은 그와 별개로 `WATCH_ONLY`가 있어야 켜집니다(`hc-watch.mjs`).

## 8. 후속 보안 작업 S6: 승인창 머리글 모호성 (자동 보안 검토 지적, 2026-11-14)

- **문제:** `Decide`가 화면 전체에서 "마지막" 머리글 줄(`Edit file` 등)을 골랐습니다. 승인창 미리보기에 보이는 파일 내용이 머리글 한 줄을 흉내 내면(예: 줄 전체가 `Edit file`), 그 아래 줄이 경로로 읽혀 자동 승인될 수 있었습니다. 또 긴 경로가 두 줄로 꺾이면 첫 조각만 읽었습니다.
- **재현(빨강):** 새 시험 4건이 수정 전 코드에서 모두 `press`로 통과(우회 성공) — 코드 파일 수정 승인 미리보기 속 가짜 머리글, 머리글 2개, 꺾인 경로, Bash 승인 뒤의 가짜 `Edit file`.
- **수정:** ① 활성 승인창 구간(직전 `Esc to cancel` 다음 ~ 마지막 `Esc to cancel`)에 머리글 줄이 **정확히 1개**일 때만 판정, 0개·2개 이상이면 review. ② 파일 승인은 경로 줄 다음이 빈 줄이나 점선일 때만 인정(다른 글자가 이어지면 경로가 꺾인 것으로 보고 review).
- **결과:** 새 시험 6건(우회 4건 → review, 정상 화면 2건 → press 유지) 통과. 전체 시험은 이 노트 맨 아래 CHECKPOINT 참고.
- **한계:** 실제 승인창의 화면 모양(점선 사용 여부 등)은 아직 못 봤습니다(I3·I4). 실제 모양이 다르면 정상 승인도 review가 될 수 있으나 안전한 쪽입니다.

### 8-2. S6 보강 (두 번째 자동 보안 검토 지적, 2026-11-14)

- **문제:** 8장 수정에서 "직전 `Esc to cancel` 줄 이후"를 활성 승인창 구간으로 삼았는데, 이 경계도 미리보기 내용으로 조종할 수 있었습니다. 미리보기에 `Esc to cancel` 줄과 가짜 머리글을 넣으면 진짜 머리글이 구간 밖으로 밀려나 가짜 머리글 1개만 남았습니다.
- **재현(빨강):** 새 시험 S6g·S6h 2건이 수정 전 코드에서 `press`로 통과(우회 성공).
- **수정:** 화면 글자로 계산하는 경계를 모두 없앴습니다. 읽어 온 화면 전체(80줄)에 머리글 줄이 **정확히 1개**일 때만 판정합니다. 오래된 머리글이 화면에 남아 있으면 review가 됩니다(안전한 쪽으로만 틀림).
- **결과:** section 10 전체 74건 통과(S6a~S6h 포함).
- **남은 한계(중요):** 미리보기가 화면보다 길어서 **진짜 머리글이 위로 밀려 나가고**, 미리보기 속 가짜 머리글(+점선 규칙)만 화면에 남으면 이 검사로는 구별할 수 없습니다. 실제 승인창이 미리보기 줄 앞에 줄번호·기호를 붙이면 줄 전체가 머리글과 같을 수 없어 막히지만, 실제 화면은 아직 못 봤습니다(I3·I4). **F 단계 전에 실제 승인창 화면으로 확인**하고, 확인 전에는 `ORCH_DOCS_DIR`를 설정해 파일 자동 승인을 켜지 않는 것을 권장합니다(~~기본값은 문서 폴더가 이미 있을 때만 켜짐 — 설치 도구가 폴더를 만들면 켜지는 점 주의~~ → 2026-11-14 9장에서 해소: 지금은 직접 지정하지 않으면 켜지지 않습니다).

## 9. 후속: 파일 수정 자동 승인은 직접 지정해야만 켠다 (사용자 결정, 2026-11-14)

- **문제:** `ORCH_DOCS_DIR`를 지정하지 않아도 `<ORCH_HOME>\state\docs`가 있으면 그 폴더를 문서 폴더로 썼습니다(`autopress.ps1`의 기본 폴더 자동 사용 줄, 코드 대조로 확인). 설치 도구(정리 2의 I2)가 이 폴더를 만들기 때문에, 승인 대행을 켜려고 `ORCH_ENABLE_AUTOPRESS=1`만 설정해도 **파일 수정 자동 승인이 함께 켜졌습니다.** 설계서 3장 원칙 4(위험한 기능은 기본 꺼짐), 8-2장의 남은 한계(실제 승인창 확인 전에는 켜지 않기)와 맞지 않았고, 설치 끝 안내의 "위험 기능은 모두 꺼진 상태"와도 어긋났습니다.
- **재현(빨강):** 시험 2건이 수정 전 코드에서 실패했습니다. ① functions 섹션 10: 기본 폴더가 있고 `ORCH_DOCS_DIR`가 없을 때 `DRYRUN would press`(자동 승인하려 함). ② install 시험 (13): 설치 끝 안내에 "파일 수정 자동 승인은 꺼짐"과 켜는 방법이 없음. 둘 다 예상한 이유로만 실패했습니다.
- **수정:** ① `autopress.ps1`에서 기본 폴더 자동 사용을 없앴습니다. `ORCH_DOCS_DIR`를 직접 지정했을 때만 켜지고, 지정하지 않으면 review이며 이유에 `ORCH_DOCS_DIR not set`이 나옵니다. ② 설치 도구는 폴더를 계속 만들되, 끝 안내에 항상 "파일 수정 자동 승인: 꺼짐(기본)"과 켜는 방법을 출력합니다. ③ `lib/orch-paths` 주석 2곳을 바로잡았습니다.
- **시험 변경:** 기존 시험 1건의 기대를 뒤집었고(기본 폴더 있음 + 미설정 → review), 새 시험 2건을 더했습니다(Create file도 review, 직접 지정하면 press). install 시험 (13)에 안내 문구 단정 2개를 더했습니다.
- **동작이 달라지는 점:** `ORCH_DOCS_DIR` 없이 기본 폴더로 쓰던 환경은 파일 수정 자동 승인이 꺼집니다. 켜려면 환경변수를 직접 지정해야 합니다. 자동 승인이 줄어드는 쪽이라 안전한 방향입니다.
- **결과:** 전체 시험 숫자는 CHECKPOINT 참고.

### 9-2. 실제 승인창 화면 형식 시험과 알려진 구멍 1건 (2026-11-14, 샘플 1건)

- **출처:** 막혀 있던 실제 창의 `Edit file` 승인창 1건을 **읽기만** 해서 확인했습니다(입력 없음). 시험 자료에는 구조만 쓰고 모든 글자를 지어낸 말로 바꿨습니다(개인 정보 없음).
- **실제 형식의 특징(단순화한 기존 시험 자료와 다른 점):** 머리글 위에 전체 폭 줄 · 경로 뒤가 빈 줄이 아니라 **점선(`╌`)** · 점선 두 줄 사이에 **줄번호가 붙은 미리보기**(`-`/`+` 표시, 긴 줄이 이어진 행은 번호 없음) · 질문문에 **파일명 포함**("…make this edit to <파일명>?") · 바닥 줄 `Esc to cancel · Tab to amend` · **아래 테두리에 세션 이름**(` Herdr-CT-CC-Master ─`). 즉 대상 창 식별에 쓰는 "테두리 제목"은 Herdr 탭 이름이 아니라 **사용자가 지은 세션 이름**입니다(같은 탭에 창이 여러 개여도 구별되지만, 다른 환경에서는 같은 이름을 지어야 동작).
- **결과:** 6건 중 5건이 기대대로입니다. 정상 문서 수정·생성은 `press`, 코드 파일·폴더 밖 파일·줄 이어짐으로 만든 가짜 머리글(진짜 머리글이 화면에 있을 때)은 `review`.
- **알려진 구멍(1건, 이 시점엔 미수정 → 9-3장에서 수정함):** 진짜 머리글이 읽은 화면(80줄) 밖으로 밀려나고, 미리보기 속 줄 이어짐 행이 `Edit file` + 문서 폴더 경로 + 점선 모양이면 `press`가 됩니다. 실제 수정 대상은 다른 파일(질문문의 파일명이 다름)인데 가짜 경로 기준으로 승인하는 것입니다. 8-2장의 "남은 한계"를 실제 형식으로 재현한 것입니다. **정정:** 8-2장에서 "줄번호가 막아 줄 것"이라고 한 추정은 부분적으로만 맞습니다. 번호가 붙은 행은 가짜 머리글이 될 수 없지만, 줄 이어짐 행은 번호가 없어 흉내 낼 수 있습니다.
- **시험 처리:** 이 건은 "알려진 구멍"으로 표시되어 매번 실행되고 SKIP으로 보고됩니다. 코드가 구멍을 막으면 자동으로 PASS가 됩니다(조용히 초록이 되지 않음).
- **수정안(→ 사용자 결정 후 9-3장에서 적용):** 질문문("…make this edit to <파일명>?")은 앱이 그리므로 파일 내용으로 조종할 수 없습니다. **그 파일명이 경로 줄의 파일명과 같을 때만 `press`**, 다르거나 질문문이 없으면 `review`. 자동 승인이 줄어드는 쪽(안전한 방향)입니다.
- **아직 못 본 것:** Monitor, Bash·PowerShell 명령(여러 줄), 실제 Create file 승인창. I3·I4는 열려 있습니다.

### 9-3. 알려진 구멍 수정: 질문줄 파일명 교차 확인 (S6c, 사용자 결정 2026-11-14)

- **수정:** 파일 수정 승인(`Edit file`·`Create file`·`Write file`)은 경로가 문서 폴더로 판정돼도, 읽은 화면에 **질문줄**("Do you want to make this edit to <파일명>?" / "…create <파일명>?" / "…overwrite <파일명>?")이 **정확히 1개** 있고 그 파일명이 경로 줄의 파일명과 **같을 때만** `press`합니다(대소문자 무시). 0개, 2개 이상, 파일명 불일치, 알 수 없는 문구는 모두 `review`입니다.
- **왜 막히나:** 질문줄은 앱이 그리므로 파일 내용(미리보기)으로 바꿀 수 없습니다. 머리글·경로 줄은 미리보기에서 가짜로 흉내 낼 수 있어도, 질문줄에 있는 **실제 파일명과는 맞출 수 없습니다.** 가짜 질문줄을 하나 더 넣으면 2개가 되어 `review`입니다.
- **빨강 → 초록:** 수정 전 코드에서 "진짜 머리글이 밀려난 실화면 형식" 시험이 `press`였고(알려진 구멍, SKIP으로 표시), 수정 뒤 **자동으로 PASS**가 됐습니다. 새 시험 5건(질문줄에 파일명 없음, 다른 파일명, Create에서 다른 파일명, 가짜 두 번째 질문줄 → `review` / 대소문자만 다름 → `press`)도 통과했습니다. 이 5건은 수정 **뒤에** 쓴 시험이라 수정 전 실패를 직접 보지는 못했습니다. 직접 본 빨강은 구멍 1건입니다.
- **시험 자료 변경:** 단순화돼 있던 `filePrompt`의 질문줄에 파일명을 넣어 실제 형식에 맞췄습니다. S6 묶음의 `Q`는 공격자가 노리는 파일명(`x.md`)에 맞춰, S6 머리글 논리만 독립적으로 시험되게 했습니다.
- **동작이 달라지는 점:** 질문줄 문구가 위 세 가지가 아니거나, 긴 파일명이 좁은 창에서 줄바꿈돼 한 줄에 안 맞으면 `review`가 됩니다(자동 승인 감소, 안전한 방향).
- **미확인:** `Write file`의 실제 질문 문구(`overwrite`는 승인 도구가 쓰는 표현을 따랐을 뿐 실화면은 못 봤음), 아주 긴 파일명이 좁은 창에서 질문줄을 꺾는지.
