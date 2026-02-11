# PROJECT TODO

## 목적
- 진행할 작업을 한 곳에서 계속 누적 관리한다.
- 별도 스프린트 문서 없이, 이 문서에서 바로 꺼내 실행한다.

## 상태 기준
- `TODO`: 아직 착수 전
- `DOING`: 진행 중
- `BLOCKED`: 외부 조건/결정 대기
- `DONE`: 완료

## 백로그 항목
| ID | 우선순위 | 작업 | 주체 | 상태 | 연결 문서 |
| --- | --- | --- | --- | --- | --- |
| BG-001 | P0 | 트렌드 보고서 자동 발송 파이프라인 안정화 | 택배, 소포 | DOING | `docs/operations/REMINDER_POLICY.md` |
| BG-002 | P0 | 아이디어 허들 -> IDEA_BANK 수집 플로우 자동화 | 택배, 소포 | DOING | `docs/owner/PROJECT_CHARTER.md` |
| BG-003 | P1 | `/room help` 커맨드 도입 여부 확정 및 반영 | 형(결정), 택배(조율) | TODO | `docs/developer/COMMAND_SPEC.md` |
| BG-004 | P1 | 로컬 -> N100 이전 설계 검증 및 런북 보강 | 택배 | TODO | `docs/operations/MIGRATION_PLAN_LOCAL_TO_N100.md` |
| BG-005 | P2 | `/room status`, `/room decide` 2차 구현 | 택배, 소포 | TODO | `docs/developer/COMMAND_SPEC.md` |
| BG-006 | P2 | 실 LLM adapter 연동 | 택배, 소포 | TODO | `docs/decision/DECISION_LOG.md` |
| BG-007 | P2 | Slash Command 자동 로그(아이디어) | 택배 | TODO | `docs/decision/DECISION_LOG.md` |

## 운영 규칙
- 새로운 작업은 이 문서에 바로 추가한다.
- 우선순위(`P0/P1/P2`)와 상태(`TODO/DOING/BLOCKED/DONE`)를 기준으로 순차 실행한다.
- 완료 항목은 1회 이상 릴리즈/운영 검증 후 `DONE`으로 변경한다.
