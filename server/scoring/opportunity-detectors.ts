/**
 * opportunity-detectors — opportunity-event detectors (PR7 · Spine B).
 *
 * Each detector reads ALREADY-PERSISTED workspace signals (no new crawling),
 * writes DECAYING opportunity events for the high-urgency cases, and enqueues a
 * debounced rec regen so the queue re-ranks. The detector bodies live here (not
 * inline in the crons) so they are directly unit-testable without fake timers.
 *
 * ═══ NO-OP WHEN THE EVENTS FLAG IS OFF ═══
 * Every detector returns early (writing nothing, triggering nothing) when the
 * `opportunity-value-events` flag is OFF. The crons call these on their normal
 * cadence; the flag gate + try/catch isolation here is the single source of truth.
 *
 * CYCLE NOTE: imports the event store + timing defaults + the (dynamic-import-based)
 * regen helper. None of these value-import recommendations.ts, so no cycle.
 */
import { isFeatureEnabled } from '../feature-flags.js';
import { createLogger } from '../logger.js';
import { listWorkspaces } from '../workspaces.js';
import { loadDecayAnalysis } from '../content-decay.js';
import { getLatestRanks } from '../rank-tracking.js';
import { insertOpportunityEvent } from '../opportunity-events.js';
import { triggerOpportunityRegen } from './opportunity-regen.js';
import { EVENT_BOOST_DEFAULTS } from './opportunity-timing.js';

const log = createLogger('opportunity-detectors');

/** Result summary returned by each detector (for logging + test assertions). */
export interface DetectorRunResult {
  workspacesWithEvents: number;
  totalEvents: number;
}

const EMPTY_RESULT: DetectorRunResult = { workspacesWithEvents: 0, totalEvents: 0 };

/**
 * A tracked keyword whose position number rose (= dropped in the SERP) by at least
 * this many places since the prior snapshot is a meaningful rank-drop "crossing".
 * Calibration path: P5 may tune this per workspace from realized recovery value.
 */
export const RANK_DROP_MIN_DELTA = 3;

/**
 * Decay → opportunity-event detector. Reads the PERSISTED decay analysis (no
 * crawl) and emits a DECAYING `decay` event for each critical / repeat-decay page,
 * then enqueues a debounced regen per affected workspace. Flag-gated + per-workspace
 * try/catch — flag OFF is a pure no-op.
 */
export function runDecayDetector(): DetectorRunResult {
  if (!isFeatureEnabled('opportunity-value-events')) return EMPTY_RESULT;

  const { boost: decayBoost, halfLifeDays: decayHalfLife } = EVENT_BOOST_DEFAULTS.decay;
  let workspacesWithEvents = 0;
  let totalEvents = 0;

  for (const ws of listWorkspaces()) {
    try {
      const analysis = loadDecayAnalysis(ws.id);
      if (!analysis || analysis.decayingPages.length === 0) continue;

      // High-urgency only: critical decline, or a repeat decay (a page that already
      // burned a refresh and kept declining).
      const targets = analysis.decayingPages.filter(
        p => p.severity === 'critical' || p.isRepeatDecay === true,
      );
      if (targets.length === 0) continue;

      let emitted = 0;
      for (const page of targets) {
        if (!page.page) continue;
        // Repeat-decay pages get a slightly higher initial boost — a worse-but-louder
        // signal that the current play is not working.
        const boost = page.isRepeatDecay ? Math.min(decayBoost * 1.2, 0.9) : decayBoost;
        insertOpportunityEvent({
          workspaceId: ws.id,
          type: 'decay',
          pagePath: page.page,
          boost,
          halfLifeDays: decayHalfLife,
          source: 'decay-cron',
          payload: {
            severity: page.severity,
            clickDeclinePct: page.clickDeclinePct,
            isRepeatDecay: page.isRepeatDecay === true,
          },
        });
        emitted++;
      }

      if (emitted > 0) {
        totalEvents += emitted;
        workspacesWithEvents++;
        triggerOpportunityRegen(ws.id);
      }
    } catch (wsErr) {
      log.warn({ workspaceId: ws.id, err: wsErr }, 'Decay detector failed for workspace — continuing');
    }
  }

  if (totalEvents > 0) {
    log.info({ workspacesWithEvents, totalEvents }, 'Decay opportunity-event detector complete');
  }
  return { workspacesWithEvents, totalEvents };
}

/**
 * Rank-decline → opportunity-event detector. A LIGHT periodic check over the
 * already-persisted rank snapshots (no crawl): for each tracked keyword whose
 * position number rose (dropped in SERP) by ≥ RANK_DROP_MIN_DELTA since the prior
 * snapshot, emit a DECAYING `rank_drop` event keyed to the keyword's page, then
 * enqueue a debounced regen. Flag-gated + per-workspace try/catch — flag OFF no-op.
 */
export function runRankDeclineDetector(): DetectorRunResult {
  if (!isFeatureEnabled('opportunity-value-events')) return EMPTY_RESULT;

  const { boost: rankBoost, halfLifeDays: rankHalfLife } = EVENT_BOOST_DEFAULTS.rank_drop;
  let workspacesWithEvents = 0;
  let totalEvents = 0;

  for (const ws of listWorkspaces()) {
    try {
      const ranks = getLatestRanks(ws.id);
      let emitted = 0;
      for (const r of ranks) {
        // `change` = prevPosition − currentPosition, so a NEGATIVE change means the
        // position number rose (dropped in SERP). Only act on a page-keyed keyword
        // that crossed the decline threshold.
        if (!r.pagePath || r.change == null) continue;
        if (r.change > -RANK_DROP_MIN_DELTA) continue;
        insertOpportunityEvent({
          workspaceId: ws.id,
          type: 'rank_drop',
          pagePath: r.pagePath,
          keyword: r.query,
          boost: rankBoost,
          halfLifeDays: rankHalfLife,
          source: 'rank-decline-cron',
          payload: { position: r.position, change: r.change },
        });
        emitted++;
      }
      if (emitted > 0) {
        totalEvents += emitted;
        workspacesWithEvents++;
        triggerOpportunityRegen(ws.id);
      }
    } catch (wsErr) {
      log.warn({ workspaceId: ws.id, err: wsErr }, 'Rank-decline detector failed for workspace — continuing');
    }
  }

  if (totalEvents > 0) {
    log.info({ workspacesWithEvents, totalEvents }, 'Rank-decline opportunity-event detector complete');
  }
  return { workspacesWithEvents, totalEvents };
}
