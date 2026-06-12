// server/intelligence-crons.ts
// Proactive intelligence cache warming — refreshes active workspaces every 6h.

import { createLogger } from './logger.js';
import { listWorkspaces } from './workspaces.js';
import { hasRecentActivity } from './activity-log.js';
import { buildWorkspaceIntelligence } from './workspace-intelligence.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import {
  getLatestCompetitorSnapshot, saveCompetitorSnapshot,
  detectCompetitorAlerts, saveCompetitorAlerts, snapshotExistsForDate, linkAlertToInsight,
} from './competitor-snapshot-store.js';
import { upsertInsight, deleteStaleInsightsByType } from './analytics-insights-store.js';
import { computeImpactScore } from './insight-enrichment.js';
import type * as PageKeywords from './page-keywords.js';
import type * as OpportunityEvents from './opportunity-events.js';
import type * as OpportunityRegen from './scoring/opportunity-regen.js';
import type * as OpportunityTiming from './scoring/opportunity-timing.js';

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
      try {
        if (!ws.liveDomain || !ws.competitorDomains?.length || !ws.seoDataProvider) {
          deleteStaleInsightsByType(ws.id, 'competitor_alert', cycleStart);
          continue;
        }
        const provider = getConfiguredProvider(ws.seoDataProvider);
        if (!provider?.isConfigured()) {
          deleteStaleInsightsByType(ws.id, 'competitor_alert', cycleStart);
          continue;
        }

        // ── PR7 · Spine B — competitor → opportunity-event detector setup. ──
        // Resolve a keyword→our-page map once per workspace so a competitor-
        // overtake alert can raise a DECAYING timing boost on the page that ranks
        // for the overtaken keyword. Try/catch isolated; failures degrade to
        // domain-level events only.
        const keywordToPage = new Map<string, string>();
        let competitorEventsWritten = 0;
        try {
          const { listPageKeywords }: typeof PageKeywords = await import('./page-keywords.js'); // dynamic-import-ok
          const { keywordComparisonKey } = await import('../shared/keyword-normalization.js'); // dynamic-import-ok
          for (const pk of listPageKeywords(ws.id)) {
            if (!pk.pagePath) continue;
            const keys = [pk.primaryKeyword, ...(pk.secondaryKeywords ?? [])];
            for (const kw of keys) {
              const norm = keywordComparisonKey(kw);
              if (norm && !keywordToPage.has(norm)) keywordToPage.set(norm, pk.pagePath);
            }
          }
        } catch (mapErr) {
          log.warn({ workspaceId: ws.id, err: mapErr }, 'competitor event keyword map build failed — emitting domain-level events only');
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
            saveCompetitorAlerts(alerts);
            for (const alert of alerts) {
              // Use a stable unique pageId so each (domain, keyword) alert gets its own DB row
              const alertPageId = `competitor_alert::${alert.competitorDomain}::${alert.keyword ?? 'domain'}`;
              const alertData = {
                competitorDomain: alert.competitorDomain,
                alertType: alert.alertType,
                keyword: alert.keyword,
                previousPosition: alert.previousPosition,
                currentPosition: alert.currentPosition,
                positionChange: alert.positionChange,
                volume: alert.volume,
                snapshotDate: alert.snapshotDate,
              };
              const insight = upsertInsight({
                workspaceId: ws.id,
                pageId: alertPageId,
                insightType: 'competitor_alert',
                data: alertData,
                severity: alert.severity,
                domain: 'search',
                impactScore: computeImpactScore(alert.severity, alertData as Record<string, unknown>),
              });
              // Link the alert row back to its insight for traceability
              linkAlertToInsight(alert.id, insight.id, ws.id);

              // ── PR7 · Spine B — raise a DECAYING competitor timing boost. ──
              // A competitor overtaking us on a keyword is the most urgent, fastest-
              // fading signal. We key the event to OUR page that ranks for that
              // keyword (when resolvable) so the boost lands on the right rec. We do
              // NOT mint a net-new defensive rec (DEFERRED) — the boost on existing
              // recs is the value. Try/catch isolated so this never breaks the cron.
              if (alert.keyword) {
                try {
                  const { keywordComparisonKey } = await import('../shared/keyword-normalization.js'); // dynamic-import-ok
                  const { insertOpportunityEvent }: typeof OpportunityEvents = await import('./opportunity-events.js'); // dynamic-import-ok
                  const { EVENT_BOOST_DEFAULTS }: typeof OpportunityTiming = await import('./scoring/opportunity-timing.js'); // dynamic-import-ok
                  const norm = keywordComparisonKey(alert.keyword);
                  const pagePath = norm ? keywordToPage.get(norm) ?? null : null;
                  const { boost, halfLifeDays } = EVENT_BOOST_DEFAULTS.competitor;
                  insertOpportunityEvent({
                    workspaceId: ws.id,
                    type: 'competitor',
                    pagePath,
                    keyword: alert.keyword,
                    boost,
                    halfLifeDays,
                    source: 'competitor-cron',
                    payload: {
                      competitorDomain: alert.competitorDomain,
                      alertType: alert.alertType,
                      currentPosition: alert.currentPosition,
                      previousPosition: alert.previousPosition,
                    },
                  });
                  competitorEventsWritten++;
                } catch (evErr) {
                  log.warn({ workspaceId: ws.id, err: evErr }, 'competitor opportunity-event write failed (non-fatal)');
                }
              }
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

        // ── PR7 · Spine B — debounced re-rank after competitor events. ──
        // One trigger per workspace (collapses the per-alert burst); flag-gated +
        // try/catch so it can never break the competitor cron.
        if (competitorEventsWritten > 0) {
          try {
            const { triggerOpportunityRegen }: typeof OpportunityRegen = await import('./scoring/opportunity-regen.js'); // dynamic-import-ok
            triggerOpportunityRegen(ws.id);
            log.info({ workspaceId: ws.id, competitorEventsWritten }, 'competitor opportunity events written — regen enqueued');
          } catch (regenErr) {
            log.warn({ workspaceId: ws.id, err: regenErr }, 'competitor regen trigger failed (non-fatal)');
          }
        }
      } catch (err) {
        log.warn({ err, workspaceId: ws.id }, 'Competitor monitoring workspace failed — continuing');
      }
    }
  } finally {
    isCompetitorRunning = false;
  }
}
