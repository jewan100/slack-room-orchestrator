// 일정 주기 작업을 중복 실행 없이(single-flight) 돌리기 위한 유틸 클래스
export class OpenClawIntervalRunner {
  private timer: NodeJS.Timeout | null = null;
  private runningPromise: Promise<void> | null = null;

  public constructor(
    private readonly intervalMs: number,
    private readonly task: () => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  // interval 루프를 시작한다.
  // 시작 즉시 1회 실행해 초기 대기 시간을 줄인다.
  public start(): void {
    if (this.timer) {
      return;
    }

    this.runIfIdle();
    this.timer = setInterval(() => {
      this.runIfIdle();
    }, this.intervalMs);
  }

  // interval 루프를 멈추고, 이미 실행 중인 작업이 있으면 완료까지 기다린다.
  public async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.runningPromise) {
      await this.runningPromise;
    }
  }

  // 현재 실행 중인 작업이 없을 때만 task를 시작한다.
  private runIfIdle(): void {
    if (this.runningPromise) {
      return;
    }

    // task 호출 시 동기 throw가 발생해도 rejected promise로 흡수해 프로세스 크래시를 막는다.
    this.runningPromise = Promise.resolve()
      .then(() => this.task())
      .catch((error) => {
        this.onError(error);
      })
      .finally(() => {
        this.runningPromise = null;
      });
  }
}
