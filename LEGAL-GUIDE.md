# LEGAL-GUIDE — 라이선스·권리 안내 / License and Rights Guide

**한국어** (아래) · **English** ([jump to English](#english))

> **참고용 안내이며 법률 자문이 아닙니다. 법적 효력을 보장하지 않습니다.** "법무/전문가 검토 필요"로 표시한 항목은 이 저장소가 결론을 내리지 않았습니다. 라이선스의 정본은 [`LICENSE`](LICENSE) 파일(Apache License, Version 2.0 본문)입니다. 이 문서가 `LICENSE` 와 다르게 읽히면 **`LICENSE` 가 우선**합니다.

## 1. 확인된 사실

| 항목 | 내용 |
|---|---|
| 라이선스 | **Apache License, Version 2.0** (최신 버전은 2.0. SPDX 식별자 `Apache-2.0`) |
| 권리자 | **SoDam AI Studio** |
| 저작권 연도 | 2026 (최초 작성 2026-11-13) |
| `LICENSE` | 공식 본문(11,358바이트, apache.org 원문)에 권리자·연도만 부록 안내 줄에 채워 넣음 |
| `NOTICE` | 있음 (Apache-2.0 방식의 귀속 고지) |
| 외부 의존성 파일 | 없음 (`package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, 잠금 파일 없음) |
| 외부 라이브러리·글꼴·이미지·아이콘·소리·영상·바이너리 | 포함되어 있지 않음 |
| 의존성 라이선스 점검 도구 | 점검할 의존성이 없어 해당 없음(실행하지 않음) |

## 2. 쉬운 설명: 무엇을 해도 되나요?

Apache-2.0 은 **허용 범위가 넓은 라이선스**입니다. 아래 조건을 지키면 됩니다.

| 하려는 일 | 가능 여부 |
|---|---|
| 사용 | 가능 |
| 상업적 사용(회사 업무, 사업 운영, 유료 서비스에 포함) | **가능** |
| 수정 | 가능 |
| 복제·포크 | 가능 |
| 재배포(수정본 포함)·판매·납품 | 가능 — **아래 조건을 지킬 때** |
| 교육·강의 자료에 사용 | 가능 — 아래 조건을 지킬 때 |
| 특허 | 이 프로젝트에 대한 권리자의 특허를 쓸 수 있도록 허락됨(라이선스 3조). 단, 이 프로젝트 때문에 소송을 걸면 그 허락이 끝남 |

**재배포할 때 지킬 조건 (라이선스 4조 요약):**

1. 받는 사람에게 **`LICENSE` 사본을 함께** 주세요.
2. **수정한 파일에는 "바꿨다"는 표시**를 눈에 띄게 남기세요.
3. 소스 코드의 저작권·특허·상표·귀속 고지는 **지우지 마세요.**
4. **`NOTICE` 파일**이 있으면, 수정본에도 그 안의 귀속 고지를 읽을 수 있게 남기세요(`NOTICE` 파일, 문서, 또는 화면 중 한 곳).

**허락되지 않는 것·주의할 것:**

- **이름과 상표는 허락되지 않습니다**(6조). `SoDam`, `SoDam AI Studio` 같은 이름·상표·제품명을 **출처를 설명하는 정당한 범위를 넘어** 내 제품 이름처럼 쓰면 안 됩니다.
- **보증이 없습니다**(7조): 있는 그대로(AS IS) 제공됩니다. **책임이 제한됩니다**(8조). 원하면 자기 책임으로 보증을 해 줄 수 있습니다(9조).
- 이 라이선스는 **권리자가 실제로 가진 권리만** 줍니다. 다른 회사의 프로그램·이름·약관은 이 라이선스로 바뀌지 않습니다(3장).

## 3. 이 프로젝트와 함께 쓰는 외부 프로그램

이 저장소에는 **들어 있지 않으며**, 각각 **제공처의 라이선스와 약관**이 적용됩니다. 상업적으로 쓰려면 사용자가 직접 확인하세요.

| 프로그램 | 확인할 것 |
|---|---|
| Node.js | 라이선스(설치해서 사용) |
| Windows·PowerShell | 사용 조건 |
| Herdr (`herdr-app`, `hc`) | 이용 약관, **모드 개발·배포 조건(이 저장소에서는 확인하지 못함 → 법무/전문가 검토 필요)** |
| Claude Code (Anthropic) | 이용 약관, 사용 정책, **요금제** |
| GitHub | 저장소를 올리거나 공유할 때의 이용 약관 |

- Herdr 모드는 Herdr가 제공하는 부품(`gpui-kit`, `gpui-base`)을 **불러다 쓰기만** 하며 그 코드를 포함하지 않습니다.
- Herdr, Claude, Anthropic, Node.js, Windows, PowerShell, GitHub 등의 이름은 각 소유자의 상표이며 **대상을 가리키는 용도로만** 나옵니다. 제휴·후원·보증 관계가 없습니다.

## 4. AI가 개발에 참여한 사실과 주의

코드·문서·시험의 상당 부분이 AI 코딩 도구(Claude Code)의 도움으로 작성되었습니다. AI가 만든 결과물의 저작권 인정 여부와 기존 저작물과의 유사성 문제는 **나라마다 다르고 확정되지 않았습니다**(**법무/전문가 검토 필요**). 공개·납품·상업적 사용 전에 **저작권, 출처, 상업적 이용 가능 여부, 유사 저작물 침해 가능성**을 사용자가 직접 확인하세요. 이 도구로 AI 창에 일을 시켜 만든 결과물의 권리는 **해당 AI 서비스의 약관**과 사용자의 확인에 달려 있습니다.

## 5. 법무/전문가 검토 필요 항목

| 항목 | 이유 |
|---|---|
| 권리자 표기 `SoDam AI Studio` | 법인·사업자·개인 명의 중 무엇인지 이 저장소에서 확인할 수 없음 |
| 권리자가 **모든 부분의 권리**를 실제로 가지는지 | 일부 스크립트(`functions\`)는 기존 작업물에서 옮겨 온 것이고, AI가 만든 부분이 있음 |
| `SoDam` 이름의 상표 | 상표 조사를 하지 않음 |
| Herdr의 모드 개발·배포 조건 | 확인하지 못함 |
| 아이디어 참고와 코드·문서 복사의 경계 | 사안별 판단 필요 |

## 6. 기여할 때

라이선스 5조에 따라, **별도 표시가 없으면** 이 저장소에 보내는 기여물은 같은 Apache-2.0 조건으로 제공한 것으로 봅니다. 아직 기여 절차(`CONTRIBUTING`)는 없습니다. 큰 변경은 먼저 이슈로 의논하세요.

## 7. 개발 기록 문서에 대한 안내

설계서와 `docs\` 의 노트는 **개발 과정의 기록**입니다. 공개용으로 정리하는 과정에서 작성자 PC의 경로·창 주소·내부 프로젝트 이름은 `<CONTROL_DIR>`, `<commander>` 같은 **자리표시**로 바꾸었습니다. 문서 속 예시 경로와 이름은 실제 값이 아닙니다.

## 8. 우선순위 (Must / Should / Could)

| 등급 | 할 일 | 상태 |
|---|---|---|
| **Must** | `LICENSE`(Apache-2.0 본문, 권리자·연도) | **완료** |
| Must | `NOTICE`, README(한국어·영어)·이 문서의 내용 일치 | **완료** |
| Must | 권리자 표기·전체 권리 보유 여부 확인 | 법무/전문가 검토 필요 |
| Should | Herdr 모드 약관 확인 | 확인 못 함 |
| Should | `SoDam` 이름 상표 조사 | 하지 않음 |
| Should | AI 생성물 권리·유사 저작물 검토 | 전문가 검토 필요 |
| Could | `CONTRIBUTING`, 소스 파일 머리말(SPDX) 추가 | 필요할 때 |
| Could | 외부 의존성이 생기면 라이선스 점검 도구 도입 | 지금은 의존성 없음 |

---

<a id="english"></a>
# LEGAL-GUIDE — English

> **Informational only; not legal advice; no legal effect is guaranteed.** Items marked "legal/expert review needed" are not concluded by this repository. The authoritative license text is the [`LICENSE`](LICENSE) file (the Apache License, Version 2.0). If this document reads differently from `LICENSE`, **`LICENSE` prevails.**

## 1. Verified facts

| Item | Content |
|---|---|
| License | **Apache License, Version 2.0** (2.0 is the latest version; SPDX identifier `Apache-2.0`) |
| Rights holder | **SoDam AI Studio** |
| Copyright year | 2026 (first written 2026-11-13) |
| `LICENSE` | The official text (11,358 bytes, original from apache.org) with only the rights holder and year filled into the appendix notice line |
| `NOTICE` | Present (attribution notice in the Apache-2.0 manner) |
| External dependency files | None (no `package.json`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `go.mod`, or lock files) |
| External libraries, fonts, images, icons, audio, video, binaries | Not included |
| Dependency-license scanning tool | Not applicable — nothing to scan (not run) |

## 2. Plain explanation: what may I do?

Apache-2.0 is a **broadly permissive license**. Just follow the conditions below.

| What you want to do | Allowed? |
|---|---|
| Use | Yes |
| Commercial use (company work, running a business, including in a paid service) | **Yes** |
| Modify | Yes |
| Copy / fork | Yes |
| Redistribute (including modified versions), sell, deliver | Yes — **when you meet the conditions below** |
| Use in teaching or training material | Yes — when you meet the conditions below |
| Patents | The rights holder's patents are licensed for use of this project (License section 3). That license ends if you file a lawsuit over this project |

**Conditions when you redistribute (summary of License section 4):**

1. Give recipients **a copy of `LICENSE`.**
2. Leave a **prominent notice on files you changed** saying you changed them.
3. **Do not remove** copyright, patent, trademark and attribution notices in the source code.
4. If a **`NOTICE` file** exists, keep its attribution notices readable in your modified version (in the `NOTICE` file, in documentation, or on screen).

**What is not granted / things to watch:**

- **Names and trademarks are not licensed** (section 6). Do not use names, trademarks or product names such as `SoDam` or `SoDam AI Studio` **beyond reasonable use to describe the origin**, as if they were the name of your own product.
- **No warranty** (section 7): provided AS IS. **Liability is limited** (section 8). You may offer a warranty on your own responsibility (section 9).
- This license gives **only the rights the holder actually has.** Other companies' programs, names and terms are not changed by it (see section 3).

## 3. External programs used together with this project

They are **not included** in this repository, and **each provider's license and terms** apply. Check them yourself before commercial use.

| Program | What to check |
|---|---|
| Node.js | License (installed and used) |
| Windows / PowerShell | Terms of use |
| Herdr (`herdr-app`, `hc`) | Terms of use, **mod development/distribution conditions (could not be confirmed from this repository → legal/expert review needed)** |
| Claude Code (Anthropic) | Terms of use, usage policy, **pricing plan** |
| GitHub | Terms of service when uploading or sharing the repository |

- The Herdr mod only **imports** components Herdr provides (`gpui-kit`, `gpui-base`) and contains none of their code.
- Herdr, Claude, Anthropic, Node.js, Windows, PowerShell, GitHub and similar names are trademarks of their owners and appear **only to refer to those things.** There is no affiliation, sponsorship or endorsement.

## 4. AI involvement in development, and cautions

A large part of the code, documents and tests was written with the help of an AI coding tool (Claude Code). Whether copyright is recognized in AI-generated output, and similarity to existing works, **differ by country and are not settled** (**legal/expert review needed**). Before publishing, delivering or using commercially, check **copyright, source, whether commercial use is allowed, and the possibility of infringing similar works** yourself. The rights in output you make by having AI windows work with this tool depend on **that AI service's terms** and your own check.

## 5. Items needing legal/expert review

| Item | Reason |
|---|---|
| Rights-holder notation `SoDam AI Studio` | This repository cannot confirm whether it is a legal entity, a business or an individual |
| Whether the holder actually has **rights in every part** | Some scripts (`functions\`) were carried over from earlier work, and some parts were AI-generated |
| Trademark for the name `SoDam` | No trademark search was done |
| Herdr's mod development/distribution conditions | Could not be confirmed |
| The boundary between taking ideas and copying code or documents | Needs case-by-case judgment |

## 6. When contributing

Under License section 5, **unless you state otherwise**, a contribution you submit to this repository is treated as provided under the same Apache-2.0 terms. There is no contribution procedure (`CONTRIBUTING`) yet. Discuss large changes in an issue first.

## 7. About the development-record documents

The design documents and notes in `docs\` are **records of the development process.** When preparing them for publication, the author PC's paths, window addresses and internal project names were replaced with **placeholders** such as `<CONTROL_DIR>` and `<commander>`. The example paths and names in the documents are not real values.

## 8. Priorities (Must / Should / Could)

| Level | To do | Status |
|---|---|---|
| **Must** | `LICENSE` (Apache-2.0 text, rights holder, year) | **Done** |
| Must | `NOTICE`, and README (Korean/English) and this document consistent | **Done** |
| Must | Confirm the rights-holder notation and that the holder owns all rights | Legal/expert review needed |
| Should | Confirm Herdr's mod terms | Not verified |
| Should | Trademark search for the name `SoDam` | Not done |
| Should | Review rights in AI-generated output and similarity to existing works | Expert review needed |
| Could | `CONTRIBUTING`, per-file SPDX headers | When needed |
| Could | Introduce a license-scanning tool when external dependencies appear | No dependencies now |
