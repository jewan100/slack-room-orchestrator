# Copilot Instructions

이 레포는 장기적으로 확장되는 자동화/오케스트레이션 프로젝트다.

## 필수 준수
1. 가독성 최우선, 명확한 네이밍, SRP 유지
2. `any` 금지, `latest` 금지
3. 기본 브랜치 전략: develop 기반, feature branch(`feat/*`)
4. PR/커밋 메시지 한글 우선, PR 본문 상세 작성
5. CI(lint/typecheck/test) 통과 전 머지 금지

## 참조 문서 우선순위
1. `JEWAN_DEV_CONSTITUTION.md`
2. `STANDARDS.md`
3. `SLACK_COMMAND_ENGINEERING_STANDARDS.md` (도메인 작업 시)

## 리뷰 규칙
- 1차: Copilot 빠른 리뷰
- 최종: Codex 통합 리뷰

## 응답/코드 스타일
- 불필요한 추상화 지양
- 변경 이유를 코드/PR에 명확히 설명
- 외부 연동은 adapter 경계로 분리
