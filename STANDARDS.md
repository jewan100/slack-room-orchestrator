# STANDARDS.md

이 문서는 모든 프로젝트에서 공통 적용되는 전역 개발 표준입니다.

- 원문 기준: `JEWAN_DEV_CONSTITUTION.md`
- 프로젝트별 예외는 ADR로 기록하고, 근거 없이 예외 허용 금지

## 핵심 원칙
1. 가독성 최우선
2. 명시성 우선(파라미터/흐름 출처 명확)
3. SRP 강제
4. 이식성/확장성 우선
5. 추적 가능한 개발(문서/로그/PR)

## 구현 강제 규칙 (요약)
- `main` 직접 작업 금지, `develop` 기본
- 저장소에 `develop`이 없으면 작업 시작 전에 먼저 생성하고 default branch로 지정
- 기능 브랜치: `feat/` prefix 사용 (예: `feat/add-slack-reminder`)
- 브랜치명 규칙: `prefix/실제-브랜치-이름` 형식, prefix/실제 이름은 영어 소문자 사용, 실제 이름 단어 구분은 하이픈(`-`) 사용
- PR + AI 리뷰 + CI 통과 전 머지 금지
- PR/커밋 관련 메시지는 한글 우선
- PR 본문은 기능 목적/변경점/검증 내용을 상세 작성
- `any` 금지, `latest` 금지
- 민감정보 로그 금지
- 모든 의사결정/보류사항 문서화

## 문서 기본 세트 (필수)
- README
- ARCHITECTURE
- ADR
- API/Command 문서
- RUNBOOK
- CHANGELOG

## 참고
세부 규칙은 반드시 `JEWAN_DEV_CONSTITUTION.md`를 따른다.
