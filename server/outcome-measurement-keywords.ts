// server/outcome-measurement-keywords.ts
// A4 (audit #15): keyword-level outcome bridge.
//
// Two responsibilities:
//   1. The rank-snapshot reader — keyword-level "current position" for outcome
//      measurement, sourced from the rank_snapshots table instead of page-aggregate
//      GSC data. Keyword actions carry keyword-level baselines (A3's
//      pm.currentPosition, this module's snapshot position), so the comparator must
//      be keyword-level too — comparing a keyword baseline against a page-aggregate
//      position fabricates deltas.
//   2. The Hub recording helper — `recordAction` for Keyword Hub lifecycle actions
//      (track / promote / add-to-strategy), called from B2's contract point in
//      the KCC action service. Reuses A3's
//      STRATEGY_PAGE_KEYWORD_SOURCE_TYPE + strategyPageKeywordSourceId() so both
//      write sites (strategy regeneration and the Hub) share one dedup space.
//
// FM-2 contract: a missing or stale rank snapshot is NEVER fabricated into a
// current reading — the reader returns null and the caller scores `inconclusive`.

import { createLogger } from './logger.js';
import { getRankHistory } from './rank-tracking.js';
import {
  getActionByWorkspaceAndSource,
  recordAction,
  STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
  strategyPageKeywordSourceId,
} from './outcome-tracking.js';
import { normalizePageUrl } from './helpers.js';
import type { BaselineSnapshot, TrackedAction } from '../shared/types/outcome-tracking.js';

const log = createLogger('outcome-measurement-keywords');

/**
 * A rank snapshot older than this is treated as missing (FM-2: stale rank data
 * must not be presented as a current reading). Snapshots are written by the daily
 * rank cron; 14 days tolerates cron gaps without accepting genuinely dead data.
 */
export const MAX_RANK_SNAPSHOT_AGE_DAYS = 14;

/**
 * Read the most recent keyword-level position for `keyword` from rank_snapshots.
 *
 * Returns a position-only BaselineSnapshot stamped with the snapshot's own date
 * (NOT "now" — the captured_at must be honest about when the reading was taken),
 * or null when the keyword has no snapshot entry within
 * {@link MAX_RANK_SNAPSHOT_AGE_DAYS}. Callers must treat null as unmeasurable
 * (`inconclusive`), never as position 0.
 */
export function readKeywordRankSnapshot(
  workspaceId: string,
  keyword: string,
): BaselineSnapshot | null {
  const trimmed = keyword.trim();
  if (!trimmed) return null;
  // 30 most recent snapshot days is plenty to find a reading inside the 14-day
  // freshness window; getRankHistory normalizes the keyword for matching.
  const history = getRankHistory(workspaceId, [trimmed], 30);
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const position = entry.positions[trimmed];
    if (position == null) continue;
    const ageMs = Date.now() - new Date(`${entry.date}T00:00:00.000Z`).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    if (ageDays > MAX_RANK_SNAPSHOT_AGE_DAYS) return null; // newest reading is already stale
    return {
      captured_at: new Date(`${entry.date}T00:00:00.000Z`).toISOString(),
      position,
    };
  }
  return null;
}

export interface RecordKeywordTrackingActionParams {
  workspaceId: string;
  /** Display keyword as the Hub received it (trimmed internally). */
  keyword: string;
  /** Optional page path the keyword is mapped to (request.pagePath or the tracked row's pagePath). */
  pagePath?: string | null;
}

/**
 * Record a tracked outcome action for a Keyword Hub lifecycle event
 * (TRACK / PROMOTE_EVIDENCE / ADD_TO_STRATEGY).
 *
 * Idempotent: shares A3's dedup space — `(STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
 * strategyPageKeywordSourceId(pagePath ?? '', keyword))`. Re-tracking the same
 * keyword (including decline → re-add round trips, bulk re-applies, and a later
 * strategy regeneration landing on the same (page, keyword) pair) records nothing.
 *
 * Baseline: keyword-level position from the freshest rank snapshot when one
 * exists (`baselineConfidence: 'exact'`); otherwise a metrics-empty
 * `{captured_at}` baseline with `baselineConfidence: 'estimated'` — the action is
 * still recorded for the activity trail, and measurement scores it `inconclusive`
 * rather than fabricating a delta (FM-2).
 *
 * Returns the new action, or null when an action for this (page, keyword) pair
 * already exists.
 */
export function recordKeywordTrackingAction(
  params: RecordKeywordTrackingActionParams,
): TrackedAction | null {
  const keyword = params.keyword.trim();
  if (!keyword || !params.workspaceId) return null;

  const pagePath = params.pagePath?.trim() ?? '';
  const sourceId = strategyPageKeywordSourceId(pagePath, keyword);
  if (getActionByWorkspaceAndSource(params.workspaceId, STRATEGY_PAGE_KEYWORD_SOURCE_TYPE, sourceId)) {
    return null; // already tracked — same dedup space as A3's strategy-regen writer
  }

  const baseline = readKeywordRankSnapshot(params.workspaceId, keyword);
  // Mirror A3's planned-page rule: `/planned/<slug>` placeholders are not live
  // URLs — store no pageUrl so the page-level GSC machinery never fetches them.
  const normalizedPath = pagePath ? normalizePageUrl(pagePath) : '';
  const pageUrl = normalizedPath && !normalizedPath.startsWith('/planned/') ? normalizedPath : null;

  const action = recordAction({ // recordAction-ok: params.workspaceId is required and checked above
    workspaceId: params.workspaceId,
    actionType: 'strategy_keyword_added',
    sourceType: STRATEGY_PAGE_KEYWORD_SOURCE_TYPE,
    sourceId,
    pageUrl,
    targetKeyword: keyword,
    baselineSnapshot: baseline ?? { captured_at: new Date().toISOString() },
    baselineConfidence: baseline ? 'exact' : 'estimated',
    attribution: 'platform_executed',
    sourceFlag: 'live',
  });
  log.info(
    { workspaceId: params.workspaceId, keyword, sourceId, hasBaseline: Boolean(baseline) },
    'Keyword Hub lifecycle action recorded for outcome tracking',
  );
  return action;
}
