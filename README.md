# slack-room-orchestrator 🐾

택배(메인)와 소포(워커) 에이전트들이 함께 운영하는 **범용 오케스트레이션 프로젝트**.

이 레포는 특정 기능 하나에 고정되지 않고, 
장기적으로 다양한 자동화/워크플로우/도메인 기능을 확장하는 기반 저장소를 목표로 한다.

## 캐릭터/운영 컨셉
- **택배 (OpenClaw 메인 에이전트)**: 검정고양이, 소포의 형님, 오케스트레이션 총괄
- **소포 (워커 에이전트들)**: 하얀고양이들, 병렬 실행/분석/검증 담당

## 운영 원칙
- 제완이형은 의사결정에 집중
- 실행/추적/검증/정리는 택배+소포가 담당
- 프로젝트는 확장성/이식성/영속성을 우선한다

## 개발 원칙 (요약)
- 가독성 최우선 (짧은 코드보다 읽기 쉬운 코드)
- 네이밍 엄격 (이름만 보고 역할이 드러나야 함)
- SRP 강제 (함수/클래스 1책임)
- 브랜치 전략: `develop` 기본, `feat/` prefix 기반 작업, `main` 직접 작업 금지
- 브랜치명 규칙: `feat/` 등 prefix는 허용하고, prefix 이후 구간은 영어/소문자/하이픈 사용 (예: `feat/add-slack-reminder`)
- PR/커밋 메시지: 한글 우선, PR 본문 상세 작성
- 리뷰: Copilot 1차 + Codex 최종 통합 리뷰
- CI(lint/typecheck/test) 통과 전 머지 금지
- 기술 도입 시 사전 검증 필수, `latest` 사용 금지

## 필독 문서 (에이전트 참고 순서)
1. `JEWAN_DEV_CONSTITUTION.md`
2. `STANDARDS.md`
3. `SLACK_COMMAND_ENGINEERING_STANDARDS.md` (Slack command 도메인 작업 시)
4. `.github/copilot-instructions.md`

## 문서 위치
- `docs/` 하위에 리뷰 정책/체크리스트/운영 문서 정리

## 커맨드 흐름 (MVP)
1. `/room start <topic>`: 회의 주제/맥락 준비
2. `/room launch`: 워커 토론 실행
3. `/room status`: 진행 상태 확인
4. `/room summary`: 현재까지 논의 요약 확인
5. `/room decide <A|B|C>`: 최종 결정 확정

## 확장 방향
- Slack command orchestration
- 리마인더/트래킹 자동화
- 멀티 에이전트 워크플로우
- 기타 생산성 자동화 도메인
