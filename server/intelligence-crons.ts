// server/intelligence-crons.ts
// Proactive intelligence cache warming — refreshes active workspaces every 6h.

import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { listActivity } from './activity-log.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';

const log = createLogger('intelligence-crons');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

async function runIntelligenceRefresh(): Promise<void> {
  if (isRunning) { log.warn('Intelligence refresh already in progress — skipping cycle'); return; }
  isRunning = true;
  const workspaces = listWorkspaces();
  let refreshed = 0;
  let skipped = 0;
  for (const ws of workspaces) {
    try {
      const recent = listActivity(ws.id, 1);
      if (recent.length === 0) { skipped++; continue; }
      await buildWorkspaceIntelligence(ws.id, { // bwi-all-ok — explicit slices on next line
        slices: ['seoContext', 'insights', 'learnings', 'contentPipeline', 'siteHealth', 'clientSignals', 'operational'],
      });
      refreshed++;
    } catch (err) {
      log.warn({ workspaceId: ws.id, err }, 'Intelligence refresh failed for workspace — skipping');
    }
  }
  isRunning = false;
  log.info({ refreshed, skipped, total: workspaces.length }, 'Intelligence refresh cycle complete');
}

export function startIntelligenceCrons(): void {
  if (refreshInterval) return;
  startupTimeout = setTimeout(() => { void runIntelligenceRefresh(); }, 5 * 60 * 1000);
  startupTimeout.unref?.();
  refreshInterval = setInterval(() => { void runIntelligenceRefresh(); }, SIX_HOURS_MS);
  refreshInterval.unref?.();
  log.info('Intelligence refresh crons started (every 6h)');
}

export function stopIntelligenceCrons(): void {
  if (startupTimeout) { clearTimeout(startupTimeout); startupTimeout = null; }
  if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
}
