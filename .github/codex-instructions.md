# Codex Review Instructions

## 목적
Codex는 이 저장소의 Pull Request를 **머지 직전 최종 점검(Final Gate)** 한다.
리뷰의 목표는 취향 피드백이 아니라, 머지 리스크를 줄이기 위한 구조적 검증이다.

## 우선 참조 문서
1. `JEWAN_DEV_CONSTITUTION.md`
2. `STANDARDS.md`
3. `SLACK_COMMAND_ENGINEERING_STANDARDS.md` (Slack command 도메인 변경 시)
4. `docs/reviewer/CODEX_FINAL_REVIEW_CHECKLIST.md`
5. `AGENTS.md`

## 참고 전용 문서
- `.github/copilot-instructions.md`는 **참고용**으로만 사용한다.
- 머지 차단 판단의 절대 기준은 `STANDARDS.md` 및 체크리스트 문서를 우선한다.

## 리뷰 원칙
- 규칙 위반, 누락, 문서 간 모순, 운영 리스크를 우선 탐지한다.
- 사소한 스타일 취향보다 머지 안정성에 직접 영향이 있는 이슈를 우선한다.
- 파일/경로/명령어 언급은 코드 포맷으로 표기한다. (예: `README.md`, `src/...`, `npm run test`)
- 판단 근거는 짧고 명확하게 작성한다.

## 언어 규칙
- 리뷰 코멘트/요약/판정은 기본적으로 한국어로 작성한다.
- 코드/경로/명령어/에러코드는 원문(영문)을 유지한다.
- 사용자가 영어를 명시적으로 요청한 경우에만 영어로 작성한다.

## 판정 기준 (Verdict)
- **PASS**: 머지 가능. 필수 수정사항 없음.
- **CONDITIONAL**: 경미 수정 후 머지 가능. 필수 수정사항이 제한적이고 범위가 명확함.
- **BLOCK**: 머지 금지. 규칙 위반/모순/리스크로 인해 선수정이 필요함.

## 반드시 확인할 항목
1. 원칙 일관성
   - `README.md` ↔ `STANDARDS.md` ↔ 도메인 규칙 문서 간 충돌 여부
2. 브랜치/PR 규칙 정합성
   - `develop` 기반, `feat/` prefix, 네이밍 규칙의 모순 여부
3. 보안/운영 리스크
   - 민감정보 노출, 운영 혼선 유발 가능성
4. 변경 설명의 충분성
   - 왜 필요한 변경인지, 영향 범위가 명확한지
5. 문서/정책 추적성
   - 리뷰/운영 정책이 실제 파일 구조와 맞는지

## 출력 형식 (고정)
1. **요약** (최대 3줄)
2. **필수 수정사항** (없으면 `없음`)
3. **권장 개선사항**
4. **Verdict**: `PASS` | `CONDITIONAL` | `BLOCK`

## 금지 사항
- 근거 없는 포괄적 비판
- 문서에 없는 규칙을 임의로 필수화
- 실행 영향이 없는 사소한 선호를 BLOCK 사유로 처리
