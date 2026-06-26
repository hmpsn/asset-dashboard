import { getJob } from './jobs.js';

interface RefreshRunnerLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

export interface HeapHeadroomOptions {
  thresholdMb: number;
  waitMs: number;
  maxWaits: number;
  logger: RefreshRunnerLogger;
  logMessage: string;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function waitForHeapHeadroom({
  thresholdMb,
  waitMs,
  maxWaits,
  logger,
  logMessage,
}: HeapHeadroomOptions): Promise<void> {
  for (let attempt = 0; attempt < maxWaits; attempt++) {
    const heapMb = process.memoryUsage().heapUsed / 1024 / 1024;
    if (heapMb < thresholdMb) return;
    logger.warn(
      { heapMb: Math.round(heapMb), thresholdMb, attempt: attempt + 1 },
      logMessage,
    );
    await sleep(waitMs);
  }
}

export function isRefreshJobCancelled(jobId: string): boolean {
  return getJob(jobId)?.status === 'cancelled';
}
