# SoDam-Herdr-Orchestration-Kit

Herdr 오케스트레이션의 **역할과 기능을 다른 PC·다른 경로로 옮겨 쓰고**, 역할을 추가·수정·삭제·업그레이드해도 깨지지 않게 하는 도구 묶음입니다.

- 역할의 정본은 **역할 파일**(`roles\*.md`) 하나입니다. `sync` 가 거기서 **역할표, 역할 카드, 탭 배치 계획**을 만듭니다.
- 경로와 이름은 코드에 적지 않고 **설정 파일**(`orchestration.json`)에서 읽습니다.
- 사람이 쓰는 **관리 창**(현황 / 역할 편집 / 내보내기·불러오기 / 백업·복구 / 실제 창)이 있습니다.
- 어느 창에도 아무것도 보내지 않습니다. 위험 기능(승인 대행, 자동 압축)은 **설치 직후 모두 꺼져 있습니다.**

> 상태: 개발 중인 비공개 저장소입니다. 라이선스는 아직 지정하지 않았습니다.

## 요구 사항

| 필요한 것 | 비고 |
|---|---|
| Windows 10/11 + PowerShell 5.1 | 설치·관리 창이 PowerShell 로 되어 있습니다 |
| Node.js | 개발과 시험은 최신 Node.js 에서 했고, 다른 버전은 확인하지 않았습니다 |
| Herdr 와 `hc` | 선택. 없으면 설치 점검이 경고만 하고, 관리 창의 "실제 창" 탭은 조회 불가로 안내합니다 |

## 빠른 시작

1. **점검만 해 보기**(아무것도 바꾸지 않음)
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1 -Check
   ```
2. **설치**(관리자 권한 불필요. 번들을 복사하고 설정 폴더를 만듭니다)
   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File bin\install.ps1
   ```
   기본 위치는 `%LOCALAPPDATA%\Herdr-Orchestration` 입니다. 바꾸려면 환경변수 `ORCH_HOME` 이나 `-OrchHome`, `-InstallDir`, `-DocsDir` 를 쓰세요.
3. **설정 채우기** — `<설정 폴더>\config\orchestration.json` 에서 아래 값을 이 PC에 맞게 고칩니다.
   `commander_name`(총지휘 창 이름), `scope_prefix`(관리할 공간 이름 앞부분), `projects_root`, `control_dir`
4. **생성물 만들기**
   ```
   node <설치 폴더>\bin\sync.mjs --out <생성물을 둘 폴더>
   ```
5. **관리 창 열기** — `<설치 폴더>\bin\Herdr-Orchestration-Manager.vbs` 를 더블클릭합니다.

## 구조 (3겹)

| 층 | 위치 | 설명 |
|---|---|---|
| 번들(읽기 전용) | 설치 폴더 | `roles`, `templates`, `schema`, `bin`, `lib`, `functions` |
| 내 설정 | `<ORCH_HOME>\config` | `orchestration.json`, `env-rules.md`(이 PC 전용 규칙), `config\roles\`(내 역할) |
| 상태 | `<ORCH_HOME>\state`, `logs` | 도구가 스스로 쓰는 파일 |

내 역할 폴더(`config\roles\`)에 같은 id 파일을 두면 번들 역할을 **덮어쓰고**(바꾼 항목만 적으면 됨), 새 id 는 **새 역할**이 됩니다. 업그레이드해도 이 폴더는 건드리지 않습니다.

## 안전 원칙

- 번들은 바꾸지 않습니다. 관리 창의 모든 수정은 "내 설정"에만 쓰고, 바꾸기 직전에 **자동 백업**합니다.
- 남의 묶음을 불러오면 새 역할·달라지는 역할은 **꺼진 채로** 들어옵니다(본문이 AI 창이 따르는 지시문이기 때문). 이 PC 고유 설정·환경 규칙·무시 목록은 기본으로 받지 않습니다.
- 사용자 폴더와 백업은 지우지 않습니다(파일 단위로만).
- 결과가 검증을 통과하지 못하면 아무것도 쓰지 않습니다.

## 시험

외부 패키지 없이 Node.js 로 돌립니다.

```
node tests\roles.test.mjs
node tests\install.test.mjs
node tests\manage.test.mjs
node tests\cleanup.test.mjs
node tests\functions.test.mjs      # 약 4분. 다른 시험과 동시에 돌리지 마세요(시간에 민감한 시험이 있습니다)
```

`roles.test.mjs` 의 일부(약 12건)는 원작자 PC 의 원본 문서와 비교하는 시험이라 **다른 PC 에서는 자동으로 건너뜁니다.** 시험은 임시 폴더(`%TEMP%\orch-test-*`)를 남기며, `tools\cleanup-test-temp.mjs` 로 미리보기 후 정리할 수 있습니다.

## 문서

- `01_이식-설계서.md` — 이식 설계(3겹 구조, 역할 파일 형식, sync, 설치·점검 흐름)
- `02_관리도구-설계서.md` — 관리 창과 엔진 설계(위험 R1~R15 와 대응)
- `CHECKPOINT.md` — 진행 상태의 정본
- `docs\` — 단계별 노트

문서에 나오는 `<CONTROL_DIR>`, `My-Space`, `<win>` 같은 표기는 작성자 PC 의 실제 경로·이름·창 주소를 일반화한 **자리표시**입니다(공개용으로 올릴 때 바꾼 것).
