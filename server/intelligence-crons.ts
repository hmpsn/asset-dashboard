// server/intelligence-crons.ts
// Proactive intelligence cache warming — refreshes active workspaces every 6h.

import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { hasRecentActivity } from './activity-log.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import {
  getLatestCompetitorSnapshot, saveCompetitorSnapshot,
  detectCompetitorAlerts, snapshotExistsForDate, linkAlertToInsight,
} from './competitor-snapshot-store.js';
import { upsertInsight, deleteStaleInsightsByType } from './analytics-insights-store.js';

const log = createLogger('intelligence-crons');
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
let refreshInterval: ReturnType<typeof setInterval> | null = null;
let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let isRunning = false;
let competitorInterval: ReturnType<typeof setInterval> | null = null;
let competitorStartupTimeout: ReturnType<typeof setTimeout> | null = null;
let isCompetitorRunning = false;

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
          // enrichWithBacklinks intentionally omitted — backlinks require a live API call and the
          // cron's full-slice cache key (intelligence:ws:all7::all) will never match the subset
          // key admin chat uses. Pre-warming with :bl would burn SEMRush credits every 6h with
          // no consumer ever hitting that cache entry. Admin chat makes one live call on the
          // first message of each 6h window; the LRU handles subsequent messages in the session.
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

export function startCompetitorMonitoringCron(): void {
  if (competitorInterval || competitorStartupTimeout) return;
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

  competitorStartupTimeout = setTimeout(() => {
    void runCompetitorCheck();
    competitorInterval = setInterval(() => { void runCompetitorCheck(); }, TWENTY_FOUR_HOURS_MS);
    competitorInterval.unref?.();
  }, FIFTEEN_MIN_MS);
  competitorStartupTimeout.unref?.();
}

export function stopCompetitorMonitoringCron(): void {
  if (competitorStartupTimeout) { clearTimeout(competitorStartupTimeout); competitorStartupTimeout = null; }
  if (competitorInterval) { clearInterval(competitorInterval); competitorInterval = null; }
}

async function runCompetitorCheck(): Promise<void> {
  if (isCompetitorRunning) { log.warn('Competitor check already in progress — skipping cycle'); return; }
  // Only run on Monday (day 1)
  if (new Date().getDay() !== 1) return;
  isCompetitorRunning = true;

  try {
    const workspaces = listWorkspaces();
    const today = new Date().toISOString().slice(0, 10);
    const cycleStart = new Date().toISOString();

    for (const ws of workspaces) {
      if (!ws.liveDomain || !ws.competitorDomains?.length || !ws.seoDataProvider) {
        deleteStaleInsightsByType(ws.id, 'competitor_alert', cycleStart);
        continue;
      }
      const provider = getConfiguredProvider(ws.seoDataProvider);
      if (!provider?.isConfigured()) {
        deleteStaleInsightsByType(ws.id, 'competitor_alert', cycleStart);
        continue;
      }

      let anyDomainFailed = false;
      let anyDomainProcessed = false;
      for (const domain of ws.competitorDomains) {
        if (snapshotExistsForDate(ws.id, domain, today)) continue;
        anyDomainProcessed = true;
        try {
          // Read previous snapshot BEFORE saving current so diff is meaningful
          const previous = getLatestCompetitorSnapshot(ws.id, domain);
          const kwResults = await provider.getDomainKeywords(domain, ws.id, 50);
          const topKeywords = kwResults.map(k => ({
            keyword: k.keyword,
            position: k.position ?? 0,
            volume: k.volume,
          }));
          const current = saveCompetitorSnapshot(ws.id, domain, today, topKeywords, kwResults.length);
          if (!previous || previous.snapshotDate === today) continue;
          const alerts = detectCompetitorAlerts(ws.id, domain, current, previous);
          for (const alert of alerts) {
            // Use a stable unique pageId so each (domain, keyword) alert gets its own DB row
            const alertPageId = `competitor_alert::${alert.competitorDomain}::${alert.keyword ?? 'domain'}`;
            const insight = upsertInsight({
              workspaceId: ws.id,
              pageId: alertPageId,
              insightType: 'competitor_alert',
              data: {
                competitorDomain: alert.competitorDomain,
                alertType: alert.alertType,
                keyword: alert.keyword,
                previousPosition: alert.previousPosition,
                currentPosition: alert.currentPosition,
                positionChange: alert.positionChange,
                volume: alert.volume,
                snapshotDate: alert.snapshotDate,
              },
              severity: alert.severity,
            });
            // Link the alert row back to its insight for traceability
            linkAlertToInsight(alert.id, insight.id, ws.id);
          }
        } catch (err) {
          anyDomainFailed = true;
          log.warn({ err, workspaceId: ws.id, domain }, 'Failed competitor monitoring check');
        }
      }
      // Skip stale cleanup if any domain failed — transient provider errors shouldn't wipe
      // prior-week alerts that simply weren't refreshed this cycle. Mirrors the failedCategories
      // guard in server/recommendations.ts:1237-1238.
      // Also skip if no domains were processed this cycle (e.g. server restarted mid-Monday and
      // all domains were skipped via snapshotExistsForDate). Running cleanup with a fresh cycleStart
      // in that case would delete valid insights written by the pre-restart run.
      if (anyDomainProcessed && !anyDomainFailed) {
        deleteStaleInsightsByType(ws.id, 'competitor_alert', cycleStart);
      }
    }
  } finally {
    isCompetitorRunning = false;
  }
}
