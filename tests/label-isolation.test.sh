#!/bin/bash
# 라벨·이름 시험 (설계서 9장). 격리된 시험용 코어(HC_SESSION=ktest)에서만 실행하고, 지금 쓰는 코어는 읽기만 한다.
# 안전장치: ① 시험용 코어 ID가 실제 코어 ID와 같으면 즉시 중단 ② 시험 전후 실제 코어의 pid·터미널 수 비교
# 사용: bash tests/label-isolation.test.sh   (Windows Git Bash, hc 와 node 가 PATH 에 있어야 함)
# 참고: eval 은 아래 j() 에서 이 스크립트가 직접 쓴 짧은 식만 실행한다(입력은 로컬 hc 의 JSON 출력뿐, 외부 입력 없음).
SESSION="${ORCH_TEST_SESSION:-ktest}"
j() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{s=s.replace(/^﻿/,'');try{const o=JSON.parse(s);console.log(eval(process.argv[1]))}catch(e){console.log('PARSEFAIL: '+s.slice(0,300))}})" "$1"; }
real() { ( unset HC_SESSION; "$@" ); }
kt() { HC_SESSION="$SESSION" "$@"; }
PASS=0; FAIL=0
check() { if [ "$2" = "$3" ]; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1 (기대: $3 / 실제: $2)"; FAIL=$((FAIL+1)); fi; }

REAL_ID=$(real hc server status | j 'o.core ? o.core.id : "NONE"')
real_pid_before=$(real hc server status | j 'o.pid'); real_n_before=$(real hc ls --json | j 'o.terminals.length')
[ "$REAL_ID" = "NONE" ] && { echo "ABORT: 실제 코어를 확인할 수 없음"; exit 1; }

kt hc server start >/dev/null 2>&1; sleep 3
kid=$(kt hc server status | j 'o.core ? o.core.id : "NONE"')
if [ "$kid" = "NONE" ] || [ "$kid" = "$REAL_ID" ]; then echo "ABORT: 격리 확인 실패(id=$kid)"; exit 1; fi
echo "격리 OK: 시험용 코어 id 가 실제 코어와 다름"

kt hc run --bg --keep --no-parent --name orch-commander --label orch.role=commander --label orch.slot=0 -- powershell -NoProfile -Command "Start-Sleep 900" >/dev/null 2>&1
sleep 2
addr_before=$(kt hc get orch-commander --json | j 'o.address')
check "라벨 생성(hc run --label)" "$(kt hc get orch-commander --json | j 'JSON.stringify(o.labels)')" '{"orch.role":"commander","orch.slot":"0"}'
check "hc ls 에는 labels 가 나오지 않음(주의사항)" "$(kt hc ls --json | j 'o.terminals[0].labels===undefined')" "true"
check "hc ls 에 name 은 나옴" "$(kt hc ls --json | j 'o.terminals[0].name')" "orch-commander"
kt hc label orch-commander orch.role=commander2 orch.extra=x >/dev/null 2>&1
kt hc label orch-commander orch.slot= >/dev/null 2>&1
check "라벨 수정·추가·삭제(hc label, key= 는 삭제)" "$(kt hc get orch-commander --json | j 'JSON.stringify(o.labels)')" '{"orch.extra":"x","orch.role":"commander2"}'
kt hc label orch-commander orch.role=commander orch.slot=0 orch.extra= >/dev/null 2>&1
check "같은 이름 중복 생성은 거부됨(name_taken)" "$(kt hc run --bg --no-parent --name orch-commander -- powershell -NoProfile -Command 'Start-Sleep 5' 2>&1 | j 'o.error ? o.error.kind : "created"')" "name_taken"

kt hc server restart >/dev/null 2>&1; sleep 3
check "코어 재시작 뒤 라벨 유지" "$(kt hc get orch-commander --json | j 'JSON.stringify(o.labels)')" '{"orch.role":"commander","orch.slot":"0"}'
kt hc server stop >/dev/null 2>&1; sleep 2
kt hc server start >/dev/null 2>&1; sleep 4
check "코어 정지→시작(재부팅 모형) 뒤 라벨 유지" "$(kt hc get orch-commander --json | j 'JSON.stringify(o.labels)')" '{"orch.role":"commander","orch.slot":"0"}'
# 주의: Git Bash 는 인자 속의 "/" 를 경로로 바꿀 수 있어 구분자로 "@" 를 쓴다
check "정지→시작 뒤 이름·주소 유지" "$(kt hc get orch-commander --json | j 'o.name+"@"+o.address')" "orch-commander@$addr_before"

kt hc kill orch-commander >/dev/null 2>&1; kt hc rm orch-commander >/dev/null 2>&1
kt hc server stop >/dev/null 2>&1

real_pid_after=$(real hc server status | j 'o.pid'); real_n_after=$(real hc ls --json | j 'o.terminals.length')
check "실제 코어 pid 불변" "$real_pid_after" "$real_pid_before"
check "실제 코어 터미널 수 불변" "$real_n_after" "$real_n_before"
echo "결과: PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]
