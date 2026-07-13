import db from '../../db/index.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { addKeywordToPageInTxn, deletePageKeyword } from '../../page-keywords.js';
import {
  getTrackedKeywords,
  deleteKeywordRankHistory,
  removeTrackedKeyword,
  updateTrackedKeywords,
  type AddTrackedKeywordOptions,
} from '../../rank-tracking.js';
import { listTrackedKeywordRows } from '../../tracked-keywords-store.js';
import { recordKeywordTrackingAction } from '../../outcome-measurement-keywords.js';
import { InvalidTransitionError, TRACKED_KEYWORD_TRANSITIONS, validateTransition } from '../../state-machines.js';
import { getWorkspace } from '../../workspaces.js';
import { createLogger } from '../../logger.js';
import { invalidateKeywordStrategyGenerationInputs } from '../../keyword-strategy-generation-store.js';
import { WS_EVENTS } from '../../ws-events.js';
import { keywordIdentityKeyV2 } from '../../../shared/keyword-normalization.js';
import type { TrackedKeywordIdentityMetadata } from '../../../shared/types/keyword-identity.js';
import {
  KEYWORD_COMMAND_CENTER_ACTIONS,
  type KeywordCommandCenterActionRequest,
  type KeywordCommandCenterActionResult,
  type KeywordCommandCenterBulkActionItem,
  type KeywordCommandCenterBulkActionRequest,
  type KeywordCommandCenterBulkActionResult,
} from '../../../shared/types/keyword-command-center.js';
import {
  TRACKED_KEYWORD_SOURCE,
  TRACKED_KEYWORD_STATUS,
  type TrackedKeyword,
} from '../../../shared/types/rank-tracking.js';
import { deleteFeedbackByKeywordKey, readFeedback, upsertFeedback } from './feedback-store.js';
import { protectedReason } from './row-lifecycle.js';

const log = createLogger('keyword-command-center');

type ProvenanceTrackedKeyword = TrackedKeyword & TrackedKeywordIdentityMetadata;

function compareRawBinary(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function plannedPathForKeyword(identityV2: string): string {
  const semanticSegment = encodeURIComponent(identityV2).replace(/%20/g, '-');
  return `/planned/${semanticSegment || 'keyword'}`;
}

function canModifyProtected(keyword: ProvenanceTrackedKeyword | undefined, force?: boolean): { ok: true } | { ok: false; reason: string } {
  const reason = protectedReason(keyword);
  if (!reason || force) return { ok: true };
  return { ok: false, reason: `${reason} requires explicit confirmation before this action.` };
}

function trackedSourceForMerge(existing: TrackedKeyword, options: AddTrackedKeywordOptions, preferSource: boolean): TrackedKeyword['source'] {
  const existingSource = existing.source ?? TRACKED_KEYWORD_SOURCE.UNKNOWN;
  const existingStatus = existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
  const nextStatus = options.status ?? existingStatus;
  if (protectedReason(existing) && !preferSource) return existingSource;
  if (preferSource && options.source && !protectedReason(existing)) return options.source;
  if (existingStatus !== TRACKED_KEYWORD_STATUS.ACTIVE && nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE) {
    return options.source ?? existingSource;
  }
  if (existingSource === TRACKED_KEYWORD_SOURCE.UNKNOWN) return options.source ?? existingSource;
  return existingSource;
}

function upsertTrackedKeywordByKey(
  workspaceId: string,
  keyword: string,
  options: AddTrackedKeywordOptions,
  opts: { preferSource?: boolean } = {},
): TrackedKeyword[] {
  const normalized = keywordIdentityKeyV2(keyword);
  if (!normalized) return getTrackedKeywords(workspaceId, { includeInactive: true });

  return updateTrackedKeywords(workspaceId, keywords => {
    const equivalents = keywords.filter(entry => keywordIdentityKeyV2(entry.query) === normalized);
    const existing = equivalents[0];
    const now = new Date().toISOString();
    const next = keywords.filter(entry => keywordIdentityKeyV2(entry.query) !== normalized);

    if (existing) {
      const nextStatus = options.status ?? existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE;
      const definedOptions = Object.fromEntries(
        Object.entries(options).filter(([, value]) => value !== undefined),
      ) as AddTrackedKeywordOptions;
      next.push({
        ...existing,
        ...definedOptions,
        query: keyword.trim(),
        pinned: equivalents.some(entry => entry.pinned) || Boolean(options.pinned),
        addedAt: existing.addedAt || now,
        status: nextStatus,
        source: trackedSourceForMerge(existing, options, Boolean(opts.preferSource)),
        replacedBy: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.replacedBy ?? existing.replacedBy,
        deprecatedAt: nextStatus === TRACKED_KEYWORD_STATUS.ACTIVE ? undefined : definedOptions.deprecatedAt ?? existing.deprecatedAt,
      });
      return next;
    }

    next.push({
      query: keyword.trim(),
      pinned: Boolean(options.pinned),
      addedAt: now,
      source: options.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
      status: options.status ?? TRACKED_KEYWORD_STATUS.ACTIVE,
      pagePath: options.pagePath,
      pageTitle: options.pageTitle,
      strategyGeneratedAt: options.strategyGeneratedAt,
      lastStrategySeenAt: options.lastStrategySeenAt,
      intent: options.intent,
      volume: options.volume,
      difficulty: options.difficulty,
      cpc: options.cpc,
      authorityPosture: options.authorityPosture,
      baselinePosition: options.baselinePosition,
      baselineClicks: options.baselineClicks,
      baselineImpressions: options.baselineImpressions,
      replacedBy: options.replacedBy,
      deprecatedAt: options.deprecatedAt,
    });
    return next;
  });
}

function retireTrackedKeyword(workspaceId: string, keyword: string, status: typeof TRACKED_KEYWORD_STATUS.PAUSED | typeof TRACKED_KEYWORD_STATUS.DEPRECATED): TrackedKeyword[] {
  const normalized = keywordIdentityKeyV2(keyword);
  const now = new Date().toISOString();
  return updateTrackedKeywords(workspaceId, keywords => keywords.map(entry => {
    if (keywordIdentityKeyV2(entry.query) !== normalized) return entry;
    return {
      ...entry,
      query: keyword.trim(),
      status,
      deprecatedAt: status === TRACKED_KEYWORD_STATUS.DEPRECATED ? now : entry.deprecatedAt,
    };
  }));
}

interface ApplyKeywordCommandCenterActionOptions {
  skipBroadcast?: boolean;
  skipActivity?: boolean;
}

function broadcastKeywordCommandCenterAction(
  workspaceId: string,
  request: Pick<KeywordCommandCenterActionRequest, 'action'>,
  payload: Record<string, unknown>,
): void {
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE
  ) {
    broadcastToWorkspace(workspaceId, WS_EVENTS.STRATEGY_UPDATED, payload);
    broadcastToWorkspace(workspaceId, WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED, {
      workspaceId,
      reason: 'keyword_command_center',
      updatedAt: payload.updatedAt,
    });
  }
  broadcastToWorkspace(workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, payload);
}

function applyKeywordCommandCenterActionInternal(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
  options: ApplyKeywordCommandCenterActionOptions = {},
): KeywordCommandCenterActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const keyword = keywordIdentityKeyV2(request.keyword);
  if (!keyword) throw new Error('keyword required');
  const displayKeyword = request.keyword.trim();

  // Resolve from the PROVENANCE-BEARING table read (listTrackedKeywordRows), NOT
  // getTrackedKeywords — the latter strips `sourceGapKey` via stripUndefinedKeys,
  // which makes protectedReason()'s "Gap-approved keyword" arm unreachable and
  // silently allows unforced retire/decline/pause of client-approved gap keywords.
  // See deleteKeywordHard for the documented trap this mirrors.
  let existing: ProvenanceTrackedKeyword | undefined;
  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] | undefined;
  let message = '';
  // M3/I1: compute plannedPath before the transaction so it's available for DECLINE cleanup.
  const plannedPath = plannedPathForKeyword(keyword);

  const run = db.transaction(() => {
    // Read lifecycle/protection state only after the outer BEGIN IMMEDIATE lock is
    // held, so another connection cannot change provenance between guard and write.
    existing = listTrackedKeywordRows(workspace.id).find(
      entry => keywordIdentityKeyV2(entry.query) === keyword,
    );
    const protectedCheck = canModifyProtected(existing, request.force);
    switch (request.action) {
      case KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY:
        upsertFeedback(workspace.id, displayKeyword, 'approved', request.reason ?? 'Added to strategy from Keyword Command Center');
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: TRACKED_KEYWORD_SOURCE.STRATEGY_SITE_KEYWORD,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        }, { preferSource: true });
        // M6: write the page_keywords artifact INSIDE the same transaction as the feedback
        // write — if either fails, the whole transaction rolls back (no phantom approved rows).
        {
          const pagePath = request.pagePath?.trim()
            ? request.pagePath.trim()
            : plannedPath;
          // titleOverride: for planned pages use the displayKeyword (human-readable); for
          // explicit paths the helper derives a clean title from the slug.
          const titleOverride = !request.pagePath?.trim() ? displayKeyword : undefined;
          addKeywordToPageInTxn(workspace.id, pagePath, displayKeyword, titleOverride);
        }
        message = `"${displayKeyword}" was added to the strategy operating loop.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE:
      case KEYWORD_COMMAND_CENTER_ACTIONS.TRACK:
        deleteFeedbackByKeywordKey(workspace.id, displayKeyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
            ? TRACKED_KEYWORD_SOURCE.RECOMMENDATION
            : TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          pagePath: request.pagePath,
        });
        message = `"${displayKeyword}" is now active in keyword tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        // protection guard → transition guard → write. `existing.status` (read pre-txn
        // via listTrackedKeywordRows) is the authoritative `from`; an illegal move throws
        // inside the txn so retireTrackedKeyword never runs (no partial write, no broadcast).
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.PAUSED);
        trackedKeywords = retireTrackedKeyword(workspace.id, displayKeyword, TRACKED_KEYWORD_STATUS.PAUSED);
        message = `"${displayKeyword}" was paused from active tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE:
        if (!existing) throw new Error('Keyword is not tracked');
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
        trackedKeywords = retireTrackedKeyword(workspace.id, displayKeyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        message = `"${displayKeyword}" was retired from active strategy-owned tracking.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE:
        if (!protectedCheck.ok) throw new Error(protectedCheck.reason);
        upsertFeedback(workspace.id, displayKeyword, 'declined', request.reason ?? 'Declined from Keyword Command Center');
        // Only the tracked-branch of DECLINE changes an existing row's status; guard it.
        if (existing && !protectedReason(existing)) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.DEPRECATED);
          trackedKeywords = retireTrackedKeyword(workspace.id, displayKeyword, TRACKED_KEYWORD_STATUS.DEPRECATED);
        }
        // Remove only this semantic identity's planned artifact. Keeping this in
        // the outer transaction prevents a concurrent re-add from being deleted.
        deletePageKeyword(workspace.id, plannedPath);
        message = `"${displayKeyword}" was declined for future strategy consideration.`;
        break;
      case KEYWORD_COMMAND_CENTER_ACTIONS.RESTORE:
        // RESTORE revives a paused/deprecated row to active (an insert-style upsert when
        // not tracked). Guard the transition only when restoring an EXISTING inactive row.
        if (existing && (existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE) !== TRACKED_KEYWORD_STATUS.ACTIVE) {
          validateTransition('tracked_keyword', TRACKED_KEYWORD_TRANSITIONS, existing.status ?? TRACKED_KEYWORD_STATUS.ACTIVE, TRACKED_KEYWORD_STATUS.ACTIVE);
        }
        deleteFeedbackByKeywordKey(workspace.id, displayKeyword);
        trackedKeywords = upsertTrackedKeywordByKey(workspace.id, displayKeyword, {
          source: existing?.source ?? TRACKED_KEYWORD_SOURCE.MANUAL,
          status: TRACKED_KEYWORD_STATUS.ACTIVE,
          deprecatedAt: undefined,
          replacedBy: undefined,
        });
        message = `"${displayKeyword}" was restored to the active keyword loop.`;
        break;
    }
  });
  run.immediate();

  // Mutation helpers operate on provenance-bearing rows internally. Action DTOs
  // must reread through the stripping resolver before serialization.
  if (trackedKeywords !== undefined) {
    trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  }

  // A4 (audit #15): Hub track/promote/add-to-strategy actions enter outcome
  // tracking. recordKeywordTrackingAction is idempotent (shares A3's
  // strategy_page_keyword dedup space), captures a keyword-level rank-snapshot
  // baseline when one is fresh, and never fabricates a baseline (FM-2). Runs
  // after the lifecycle transaction so a recording failure cannot roll back the
  // user-visible action, and a failed transaction never records a phantom action.
  if (
    request.action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK
    || request.action === KEYWORD_COMMAND_CENTER_ACTIONS.PROMOTE_EVIDENCE
  ) {
    // Outcome tracking is a side-channel: the user-visible action committed above,
    // so a recording failure must log, never surface as an error to the caller.
    try {
      recordKeywordTrackingAction({
        workspaceId: workspace.id,
        keyword: displayKeyword,
        pagePath: request.pagePath ?? existing?.pagePath,
      });
    } catch (err) {
      log.error({ err, workspaceId: workspace.id, keyword: displayKeyword, action: request.action }, 'keyword outcome recording failed — Hub action already committed');
    }
  }

  invalidateIntelligenceCache(workspace.id);
  const payload = { keyword: displayKeyword, action: request.action, source: 'keyword_command_center', updatedAt: now };
  if (!options.skipBroadcast) {
    broadcastKeywordCommandCenterAction(workspace.id, request, payload);
  }
  if (!options.skipActivity) {
    addActivity(workspace.id, 'rank_tracking_updated', 'Keyword lifecycle updated', message, {
      keyword: displayKeyword,
      action: request.action,
      source: 'keyword_command_center',
    });
  }

  return {
    ok: true,
    action: request.action,
    keyword: displayKeyword,
    protectedKeyword: Boolean(protectedReason(existing)),
    message,
    trackedKeywords,
  };
}

export function applyKeywordCommandCenterAction(
  workspaceId: string,
  request: KeywordCommandCenterActionRequest,
): KeywordCommandCenterActionResult {
  return applyKeywordCommandCenterActionInternal(workspaceId, request);
}

/**
 * Narrow hard-delete eligibility predicate (P3-3c). DELIBERATELY NOT a blind
 * `protectedReason` reuse: `protectedReason` flags MANUAL as protected, but MANUAL is
 * the design's delete-eligible class (genuine mistakes the operator wants gone). Hard
 * delete drops rank history too and is irreversible, so it is ONLY allowed for a MANUAL,
 * UNPINNED keyword with NO strategy/client provenance. Everything else (pinned /
 * CLIENT_REQUESTED / a gap-provenanced row via sourceGapKey) must be RETIRED (soft,
 * restorable), never deleted — `force` overrides for the dedicated route.
 */
export function isHardDeleteEligible(
  existing: ProvenanceTrackedKeyword | undefined,
  options: { hasStrategyFeedbackProvenance?: boolean } = {},
): boolean {
  if (!existing) return false;
  if (existing.pinned) return false;
  if (existing.source === TRACKED_KEYWORD_SOURCE.CLIENT_REQUESTED) return false;
  if (existing.sourceGapKey || existing.sourceGapKeyV2) return false;
  if (existing.strategyOwned === true) return false;
  if (options.hasStrategyFeedbackProvenance === true) return false;
  return existing.source === TRACKED_KEYWORD_SOURCE.MANUAL;
}

/**
 * Hard-delete a tracked keyword (P3-3c) — the THIRD, Hub-specific wrapper over
 * `removeTrackedKeyword`. Unlike the bare rank-tracking function (which broadcasts/logs
 * nothing — the rank route wraps it) this wrapper owns BOTH halves of the data-flow
 * contract: RANK_TRACKING_UPDATED action='deleted' broadcast + an activity row. This is a
 * SEPARATE channel from the lifecycle action enum — it is never a default/bulk action and
 * never lands in `KEYWORD_COMMAND_CENTER_ACTIONS`. Ineligible rows (see
 * `isHardDeleteEligible`) throw without `force`. Delete also drops rank history.
 */
export function deleteKeywordHard(
  workspaceId: string,
  keyword: string,
  options: { force?: boolean } = {},
): { ok: true; keyword: string; trackedKeywords: TrackedKeyword[] } {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  const normalized = keywordIdentityKeyV2(keyword);
  if (!normalized) throw new Error('keyword required');

  const now = new Date().toISOString();
  let trackedKeywords: TrackedKeyword[] = [];
  const run = db.transaction(() => {
    // Resolve eligibility after the write lock is held. The general reader strips
    // both gap keys, so permanent-delete guards must use the table-bearing row.
    const existing = listTrackedKeywordRows(workspace.id).find(
      entry => keywordIdentityKeyV2(entry.query) === normalized,
    );
    if (!existing) throw new Error('Keyword is not tracked');
    const feedback = readFeedback(workspace.id).get(keyword);
    const hasStrategyFeedbackProvenance = feedback?.status === 'approved' || feedback?.status === 'requested';
    if (!options.force && !isHardDeleteEligible(existing, { hasStrategyFeedbackProvenance })) {
      throw new Error('Keyword is not eligible for permanent deletion — retire it instead.');
    }
    removeTrackedKeyword(workspace.id, keyword);
    deleteKeywordRankHistory(workspace.id, keyword);
    invalidateKeywordStrategyGenerationInputs(workspace.id);
    trackedKeywords = getTrackedKeywords(workspace.id, { includeInactive: true });
  });
  run.immediate();

  invalidateIntelligenceCache(workspace.id);
  broadcastToWorkspace(workspace.id, WS_EVENTS.RANK_TRACKING_UPDATED, {
    keyword: keyword.trim(),
    action: 'deleted',
    source: 'keyword_hub',
    updatedAt: now,
  });
  addActivity(workspace.id, 'rank_tracking_updated', 'Keyword permanently deleted', `"${normalized}" was permanently deleted (rank history dropped).`, {
    keyword: keyword.trim(),
    action: 'deleted',
    source: 'keyword_hub',
  });

  return { ok: true, keyword: keyword.trim(), trackedKeywords };
}

function bulkActionLabel(action: KeywordCommandCenterBulkActionRequest['action']): string {
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.ADD_TO_STRATEGY) return 'added to strategy';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.TRACK) return 'activated in tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.PAUSE_TRACKING) return 'paused from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.RETIRE) return 'retired from active tracking';
  if (action === KEYWORD_COMMAND_CENTER_ACTIONS.DECLINE) return 'declined from future strategy consideration';
  return String(action).replace(/_/g, ' ');
}

export function applyKeywordCommandCenterBulkAction(
  workspaceId: string,
  request: KeywordCommandCenterBulkActionRequest,
): KeywordCommandCenterBulkActionResult {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) throw new Error('Workspace not found');
  if (!Array.isArray(request.keywords) || request.keywords.length === 0) {
    throw new Error('keywords required');
  }

  const grouped = request.keywords.reduce((deduped, rawKeyword) => {
      const keyword = rawKeyword.trim();
      const key = keywordIdentityKeyV2(keyword);
      if (keyword && key) {
        const current = deduped.get(key);
        if (current === undefined || compareRawBinary(keyword, current) < 0) deduped.set(key, keyword);
      }
      return deduped;
    }, new Map<string, string>());
  const uniqueKeywords = [...grouped.entries()]
    .sort(([a], [b]) => compareRawBinary(a, b))
    .map(([, keyword]) => keyword);
  if (uniqueKeywords.length === 0) throw new Error('keywords required');

  const items: KeywordCommandCenterBulkActionItem[] = [];
  let applied = 0;
  let skipped = 0;
  let failed = 0;
  const now = new Date().toISOString();

  for (const keyword of uniqueKeywords) {
    try {
      applyKeywordCommandCenterActionInternal(workspace.id, {
        action: request.action,
        keyword,
        reason: request.reason,
        force: request.force,
      }, { skipBroadcast: true, skipActivity: true });
      items.push({ keyword, status: 'applied' });
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof InvalidTransitionError) {
        // The keyword is already in — or cannot legally leave — the target state
        // (e.g. RETIRE/PAUSE/DECLINE over a selection that already contains a
        // retired keyword: deprecated→deprecated). A bulk action over a mixed
        // selection routinely includes such no-ops; pre-P3 they were silent
        // idempotent successes. The P3 state-machine guard turned them into a
        // spurious "N failed". Classify as a benign skip, never a failure.
        items.push({ keyword, status: 'skipped_noop', error: message });
        skipped++;
      } else if (message.includes('requires explicit confirmation')) {
        items.push({ keyword, status: 'skipped_protected', error: message });
        skipped++;
      } else if (message === 'Keyword is not tracked') {
        items.push({ keyword, status: 'skipped_not_tracked', error: message });
        skipped++;
      } else {
        items.push({ keyword, status: 'error', error: message });
        failed++;
      }
    }
  }

  const actionLabel = bulkActionLabel(request.action);
  const message = `${applied} keyword${applied === 1 ? '' : 's'} ${actionLabel}${skipped > 0 ? `, ${skipped} skipped` : ''}${failed > 0 ? `, ${failed} failed` : ''}`;

  if (applied > 0) {
    addActivity(
      workspace.id,
      'rank_tracking_updated',
      'Keyword lifecycle updated (bulk)',
      message,
      {
        action: request.action,
        applied,
        skipped,
        failed,
        source: 'keyword_command_center_bulk',
      },
    );

    broadcastKeywordCommandCenterAction(workspace.id, request, {
      action: request.action,
      keywords: uniqueKeywords,
      applied,
      skipped,
      failed,
      source: 'keyword_command_center_bulk',
      updatedAt: now,
    });
  }

  return { action: request.action, applied, skipped, failed, items, message };
}
