# ROOM launch MVP notes (2026-02-13)

## 배경
- 오늘 MVP 목표: Slack 오케스트레이션에서 `/room launch`가 실제로 2개 AI 역할을 호출해 결과물을 남기는 것.

## 합의된 회의실 흐름 요약
- `/room start`:
  - 사람(제완)↔택배가 대화로 준비를 끝낸다.
  - 결과는 `Launch Brief`(압축 입력) 하나로 만든다.
  - start 단계에는 LLM 호출 프롬프트가 필수가 아니다(launch 단계에서만 사용).

- `/room launch`:
  - 1라운드 기본.
  - 2개 역할을 병렬 호출:
    - GPT: Builder/Ideator (아이디어 확장, MVP 설계, 구현 로드맵)
    - Claude: Critic/Editor (논리 구멍, 위험/윤리/약관, 명료화)
  - 결과물은 모델 원문 덤프가 아니라 Moderator(택배)가 합친 `Final Memo` 1개(길게)로 Slack 스레드에 남긴다.

## LLM 연동 설계 합의
- LLM 호출은 인터페이스로 추상화하고 구현체는 교체 가능하게 유지한다.
  - Prompt 기반(모델명 + 프롬프트 + Launch Brief)
  - Agent 기반(벤더 대시보드에서 준비한 agent 설정을 ID로 호출) — 가능해지면 교체
- 형은 OpenAI/Claude 벤더 API로 직접 통신하는 구조도 괜찮다고 판단.
  - 별도 AI 라우터 서버를 반드시 추가하지 않는다.

## 실행 TODO(오늘/단기)
- [P0] `LLMClient` 인터페이스 도입(Builder/Critic)
- [P0] Prompt 기반 구현체로 MVP 연결(프롬프트는 `docs/prompts/*`)
- [P0] `/room launch`에서 Builder/Critic 병렬 호출 + `Final Memo` 합본 게시
- [P1] 실패 처리(부분 실패 안내, 재시도 정책) 및 결과/라운드 저장 강화

## 참고
- 회의(launch) 전용 프롬프트 파일은 `docs/prompts/`에 보관.
- 흐름 설계 문서는 `docs/ROOM_FLOW.md` 참고.
