---
id: approval-proxy
name: "승인 대행"
summary: "총지휘 창에 뜨는 승인창과 메뉴에 권장 선택을 눌러 준다(기본 꺼짐, 명시해서 켠 때만 동작)"
slot: 0
kind: proxy
mode: read-only
writes_to: []
reports_to: commander
cadence: periodic
enabled: false
replaces: []
needs: []
version: 1
---
# 승인 대행

## 하는 일
- 총지휘 창에서 뜨는 승인창과 메뉴에 권장 선택을 눌러 주는 도우미다(스크립트 `autopress.ps1`). <!-- 출처: 오케스트레이션-역할표.md 2장 -->
- 총지휘 창의 승인창과 메뉴를 자동 처리한다. <!-- 출처: 오케스트레이션-역할표.md 1장 -->

## 켜기 전에
- 다른 창의 승인 키를 대신 누르는 기능이라 위험 등급이 높고 기본은 꺼짐이다. <!-- 출처: 01_이식-설계서.md 6장 -->
- 켜기 전에 사용자 확인이 필요하다. <!-- 출처: 01_이식-설계서.md 3장 4항; 01_이식-설계서.md 6장 -->
- 다른 창에 입력하는 기능은 볼 곳(허용 목록)이 비어 있으면 켜지지 않고 이유를 알린다. <!-- 출처: 01_이식-설계서.md 6장 -->

## 동작 (autopress.ps1이 하는 일)
- 총지휘 창 한 곳에서만 `1. Yes`를 누른다. 그 창은 매번 탭 이름과 화면 테두리 제목으로 다시 찾으며 자기 창은 대상에서 뺀다. <!-- 출처: autopress.ps1 머리 주석, Resolve-Target -->
- 총지휘 창이 blocked 상태일 때만 동작한다. <!-- 출처: autopress.ps1 본문 반복부 -->
- 화면 맨 아래에 활성 승인창(`Esc to cancel`)이 없거나 포커스된 `1. Yes`를 못 찾으면 누르지 않는다. <!-- 출처: autopress.ps1 Decide -->
- 질문 메뉴(사용자 선택)는 누르지 않는다. <!-- 출처: autopress.ps1 Decide -->
- 파일 만들기·수정 승인은 도구 폴더 안의 파일일 때만 누른다. <!-- 출처: autopress.ps1 Decide -->
- Monitor 승인은 자기 도구(`hc-watch.mjs`)일 때만 누른다. <!-- 출처: autopress.ps1 Decide -->
- 명령 승인(PowerShell·Bash)은 위험 표현이 없을 때만 누른다. 위험 표현은 리다이렉션(`>`), `tee`, 삭제 명령(`rm`·`del`·`Remove-`), `git`의 push·commit·reset·rebase·checkout·clean·merge·tag, `gh`의 pr merge·release·repo delete·repo create·api, `--visibility`·`--force`·`--no-verify`·`--admin`·`--delete-branch`, 내려받기 명령(`curl`·`wget`·`Invoke-WebRequest`), 비밀 환경 파일 이름, `npm`의 install·publish, `sudo`·`iex`, 파일 쓰기 명령(`Set-Content`·`Add-Content`·`Out-File`), 프로세스 종료(`Stop-Process`·`taskkill`·`kill`), `Format-Volume`, `hc send --force`, `hc server stop`이다. <!-- 출처: autopress.ps1 riskRx -->
- 안전하다고 증명되지 않으면 누르지 않고 `NEEDS_REVIEW`로 알린다. <!-- 출처: autopress.ps1 머리 주석, Decide -->
- 총지휘 창을 못 찾으면 `TARGET_NOT_FOUND`로 알린다. <!-- 출처: autopress.ps1 본문 반복부 -->
- 같은 승인 요청에는 최대 3번까지만 누른다. <!-- 출처: autopress.ps1 본문 반복부 -->
- `-DryRun`이면 누르지 않고 누를 것만 알린다. <!-- 출처: autopress.ps1 본문 반복부 -->
- 누른 것과 검토가 필요한 것은 `autopress.log`에 기록한다. <!-- 출처: autopress.ps1 Log -->
- 기본 확인 간격은 20초다. <!-- 출처: autopress.ps1 param -->
