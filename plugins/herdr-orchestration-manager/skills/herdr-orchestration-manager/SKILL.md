---
name: herdr-orchestration-manager
description: Herdr 오케스트레이션 관리(역할 편집·내보내기/불러오기·백업/복구 창과 엔진)를 이 PC 에 설치·점검·제거할 때 사용. "오케스트레이션 관리 설치", "Herdr 역할 관리 창 설치", "orch-manager 설치" 같은 요청에 쓴다.
---

# Herdr 오케스트레이션 관리 설치 도우미

이 스킬은 **설치 스크립트를 실행해 주는 안내서**입니다. 실제 설치 프로그램은 이 플러그인 폴더에 들어 있습니다.

## 1. 위치 찾기
- 이 스킬이 로드될 때 알려 주는 "Base directory for this skill" 에서 **두 단계 위**(`..\..`)가 플러그인 폴더입니다. 그 안에 `install.ps1`, `uninstall.ps1`, `payload\` 가 있습니다.
- 환경변수 `CLAUDE_PLUGIN_ROOT` 가 있으면 그 폴더와 같은 곳입니다. 두 방법으로 `install.ps1` 이 확인되지 않으면 설치하지 말고 사용자에게 알리세요.

## 2. 순서 (반드시 이 순서, 각 단계 결과를 사용자에게 쉬운 말로 전달)
1. **점검만 먼저**: `powershell -NoProfile -ExecutionPolicy Bypass -File "<플러그인 폴더>\install.ps1" -Check`
   - Node.js, Herdr 앱, 설정 폴더, 단축키(기본 `Ctrl+Shift+M`)가 비어 있는지 확인합니다. 아무것도 바꾸지 않습니다.
   - "중단:" 이 나오면 이유를 그대로 전하고 멈춥니다(임의로 `-Force` 를 붙이지 않습니다).
2. **사용자에게 확인**: 설치하면 바뀌는 것(아래)을 알리고 진행 여부를 묻습니다.
3. **설치**: 같은 명령에서 `-Check` 만 뺍니다. 옵션: `-InstallDir` `-OrchHome` `-HerdrHome` `-Key`(다른 단축키) `-NoKey`(키 연결 안 함).
4. **확인**: 설치 끝 메시지, Herdr 에서 `Ctrl+Shift+M`(안 되면 `Ctrl+Shift+P` → `mod.open orch-manager`)로 관리 창이 열리는지.
5. **설정 채우기**: `<설정 폴더>\config\orchestration.json` 의 `commander_name`, `scope_prefix`, `projects_root`, `control_dir` 를 이 PC에 맞게 고치게 안내합니다.

## 바뀌는 것 (설치 전에 사용자에게 알릴 것)
- 프로그램 파일: `%LOCALAPPDATA%\Herdr-Orchestration\app` (기본, 번들 복사본)
- 내 설정: `%LOCALAPPDATA%\Herdr-Orchestration\config`, `state`, `logs` (이미 있으면 덮어쓰지 않음, 위험 기능은 모두 꺼진 채 등록)
- Herdr 모드: `<Herdr 설정 폴더>\mods\orch-manager` + `keys.json` 에 키 한 줄(원본 백업 자동 생성, 이미 쓰이는 키면 건너뜀)
- 허더 공식 검사(`herdr-app check`)를 통과하지 못하면 모드는 설치되지 않습니다.
- Herdr 앱·터미널·Claude/Codex 대화 기록·작업 스케줄러·레지스트리는 건드리지 않습니다. 관리자 권한 불필요. 어느 창에도 아무것도 보내지 않습니다.

## 자주 쓰는 다른 작업
- **제거**: `uninstall.ps1` (`-Check` 로 미리 보기). 우리가 넣은 파일과 키 한 줄만 지우고, 내 설정·내 역할·백업은 남깁니다.
- **별도 Windows 창(허더 없이)**: `<설치 위치>\bin\Herdr-Orchestration-Manager.vbs` 더블클릭.

## 주의
- Windows 전용. Node.js 필요(없으면 https://nodejs.org 의 LTS 안내).
- 설치/제거 스크립트가 실패하면 출력 그대로 전하고, 파일을 직접 고치거나 가드를 우회하지 마세요.
- 오케스트레이션이 일시 중지 상태이면 이 설치와 무관하게 창에 입력을 보내지 않습니다.
