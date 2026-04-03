// server/data-retention.ts
import { createLogger } from './logger.js';
import { cleanupOldChatSessions } from './chat-memory.js';
import { cleanupOldSnapshots } from './reports.js';
import { cleanupOldLlmsTxt } from './llms-txt-generator.js';

const log = createLogger('data-retention');
const DAILY_MS = 24 * 60 * 60 * 1000;
let retentionInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;

async function runRetention(): Promise<void> {
  try {
    const sessions = cleanupOldChatSessions(180);
    const snapshots = cleanupOldSnapshots(10);
    const llmsTxt = cleanupOldLlmsTxt(90);
    log.info({ sessions, snapshots, llmsTxt }, 'Data retention cycle complete');
  } catch (err) {
    log.error({ err }, 'Data retention cycle failed');
  }
}

export function startDataRetentionCrons(): void {
  if (retentionInterval) return;
  startupTimeout = setTimeout(() => { void runRetention(); }, 2 * 60 * 1000);
  startupTimeout.unref?.();
  retentionInterval = setInterval(() => { void runRetention(); }, DAILY_MS);
  retentionInterval.unref?.();
  log.info('Data retention crons started (daily)');
}

export function stopDataRetentionCrons(): void {
  if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
  if (retentionInterval) { clearInterval(retentionInterval); retentionInterval = null; }
}
