export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

const LOG_LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

// 설정된 로그 레벨 기준으로 대상 로그를 출력할지 결정한다.
// 예: 현재 레벨이 info이면 debug는 버리고 info/warn/error만 남긴다.
function shouldLog(currentLevel: LogLevel, targetLevel: LogLevel): boolean {
  return LOG_LEVEL_WEIGHT[targetLevel] >= LOG_LEVEL_WEIGHT[currentLevel];
}

// 단일 JSON 로그 라인을 표준 포맷으로 기록한다.
// 구조화 로그를 유지해야 추후 필터링/추적이 쉬워진다.
function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  const line = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context
  };

  const serialized = JSON.stringify(line);
  if (level === "error") {
    console.error(serialized);
    return;
  }

  if (level === "warn") {
    console.warn(serialized);
    return;
  }

  console.log(serialized);
}

// 외부 입력 문자열을 안전한 로그 레벨로 정규화한다.
// 알 수 없는 값은 info로 강등해 로그 누락을 막는다.
function parseLogLevel(rawLevel: string | undefined): LogLevel {
  if (rawLevel === "debug" || rawLevel === "info" || rawLevel === "warn" || rawLevel === "error") {
    return rawLevel;
  }

  return "info";
}

// 최소 출력 레벨이 고정된 logger 인스턴스를 생성한다.
// 호출부는 문자열 결합보다 구조화 context를 전달하는 것을 기본으로 한다.
export function createLogger(rawLevel: string | undefined): Logger {
  const currentLevel = parseLogLevel(rawLevel);

  return {
    debug(message, context) {
      if (!shouldLog(currentLevel, "debug")) {
        return;
      }
      writeLog("debug", message, context);
    },
    info(message, context) {
      if (!shouldLog(currentLevel, "info")) {
        return;
      }
      writeLog("info", message, context);
    },
    warn(message, context) {
      if (!shouldLog(currentLevel, "warn")) {
        return;
      }
      writeLog("warn", message, context);
    },
    error(message, context) {
      if (!shouldLog(currentLevel, "error")) {
        return;
      }
      writeLog("error", message, context);
    }
  };
}
