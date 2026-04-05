// server/intelligence-crons.ts
// Proactive intelligence cache warming — refreshes active workspaces every 6h.

import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { hasRecentActivity } from './activity-log.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';

const log = createLogger('intelligence-crons');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;

async function runIntelligenceRefresh(): Promise<void> {
  if (isRunning) { log.warn('Intelligence refresh already in progress — skipping cycle'); return; }
  isRunning = true;
  try {
    const workspaces = listWorkspaces();
    let refreshed = 0;
    let skipped = 0;
    for (const ws of workspaces) {
      try {
        if (!hasRecentActivity(ws.id, 30)) { skipped++; continue; }
        await buildWorkspaceIntelligence(ws.id, { // bwi-all-ok — explicit slices on next line
          slices: ['seoContext', 'insights', 'learnings', 'contentPipeline', 'siteHealth', 'clientSignals', 'operational'],
          enrichWithBacklinks: true, // pre-warm the backlink-enriched cache so admin chat sessions are cache-warm
        });
        refreshed++;
      } catch (err) {
        log.warn({ workspaceId: ws.id, err }, 'Intelligence refresh failed for workspace — skipping');
      }
    }
    log.info({ refreshed, skipped, total: workspaces.length }, 'Intelligence refresh cycle complete');
  } finally {
    isRunning = false;
  }
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
