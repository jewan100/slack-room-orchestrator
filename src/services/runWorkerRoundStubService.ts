import { ROOM_WORKER_STUB_MESSAGES } from "../shared/messages";
import type { WorkerCandidate } from "../shared/types";

// 실제 LLM 연동 전까지 사용하는 1차 스텁 워커 서비스
// 주제 문자열을 받아 A/B/C 후보안을 고정 포맷으로 생성한다.
export class RunWorkerRoundStubService {
  // 후보안 배열을 생성해 launch 서비스가 저장/공유하도록 반환한다.
  public execute(topic: string): WorkerCandidate[] {
    // A/B/C는 현재 MVP에서 비교 의사결정을 돕기 위한 고정 포맷
    // 2차에서는 LLM 어댑터 결과로 교체할 수 있도록 서비스 경계를 분리해 두었다.
    return [
      // A안: 가장 빠른 실행 경로
      {
        option: "A",
        summary: ROOM_WORKER_STUB_MESSAGES.optionASummary(topic),
        pros: [...ROOM_WORKER_STUB_MESSAGES.optionAPros],
        risk: ROOM_WORKER_STUB_MESSAGES.optionARisk,
        estimatedCost: ROOM_WORKER_STUB_MESSAGES.optionACost
      },
      // B안: 속도/구조 균형 경로
      {
        option: "B",
        summary: ROOM_WORKER_STUB_MESSAGES.optionBSummary(topic),
        pros: [...ROOM_WORKER_STUB_MESSAGES.optionBPros],
        risk: ROOM_WORKER_STUB_MESSAGES.optionBRisk,
        estimatedCost: ROOM_WORKER_STUB_MESSAGES.optionBCost
      },
      // C안: 장기 확장 우선 경로
      {
        option: "C",
        summary: ROOM_WORKER_STUB_MESSAGES.optionCSummary(topic),
        pros: [...ROOM_WORKER_STUB_MESSAGES.optionCPros],
        risk: ROOM_WORKER_STUB_MESSAGES.optionCRisk,
        estimatedCost: ROOM_WORKER_STUB_MESSAGES.optionCCost
      }
    ];
  }
}
