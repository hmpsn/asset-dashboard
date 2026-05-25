const DEFAULT_THRESHOLD = 100;

let paidCallCount = 0;

function getWarnThreshold(): number {
  const raw = process.env.MCP_PAID_CALL_WARN_AFTER;
  if (!raw) return DEFAULT_THRESHOLD;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_THRESHOLD;
  return parsed;
}

export function recordPaidCall(increment = 1): { count: number; warning?: string } {
  paidCallCount += increment;
  const threshold = getWarnThreshold();
  if (paidCallCount >= threshold) {
    return {
      count: paidCallCount,
      warning: `paid_call_count: ${paidCallCount} (threshold ${threshold}; informational only)`,
    };
  }
  return { count: paidCallCount };
}

export function getPaidCallCount(): number {
  return paidCallCount;
}

/** Test-only: clear counter state between tests. */
export function __resetPaidCallCounterForTests(): void {
  paidCallCount = 0;
}
