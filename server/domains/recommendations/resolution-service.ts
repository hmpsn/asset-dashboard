import { broadcastToWorkspace } from '../../broadcast.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { getPageState } from '../../page-edit-states.js';
import { triggerOpportunityRegen } from '../../scoring/opportunity-regen.js';
import { RECOMMENDATION_TRANSITIONS, validateTransition } from '../../state-machines.js';
import { WS_EVENTS } from '../../ws-events.js';
import { keywordComparisonKey } from '../../../shared/keyword-normalization.js';
import {
  computeRecommendationSummary,
  getRecSourceCategory,
  toPageSlug,
} from './rules.js';
import {
  loadRecommendationSet,
  replaceRecommendationItems,
} from './storage.js';

const log = createLogger('recommendations');

function saveRecommendationMutation(set: NonNullable<ReturnType<typeof loadRecommendationSet>>): void {
  replaceRecommendationItems(set, set.recommendations, set.summary);
}

/**
 * Resolve (complete) recommendations in-place when a workspace change touches
 * the pages they cover. Called from write sites that fix SEO issues directly
 * (approval apply, per-item approve/reject, work-order completion) so the
 * priority list reflects the change immediately — without waiting for the next
 * full audit-driven recommendation regen (which is GSC-lag-gated).
 *
 * @returns the number of recommendations transitioned to `completed`.
 */
export function resolveRecommendationsForChange(
  workspaceId: string,
  opts: { affectedPages: string[]; source?: string },
): number {
  const changedPages = new Set(
    (opts.affectedPages ?? [])
      .filter((p): p is string => typeof p === 'string' && p.length > 0)
      .map(toPageSlug),
  );
  if (changedPages.size === 0) return 0;

  const set = loadRecommendationSet(workspaceId);
  if (!set) return 0;

  // When a source filter is supplied, resolve it to its category so callers can
  // pass either a full source string ('audit:title') or a bare category ('audit').
  const sourceCategory = opts.source ? getRecSourceCategory(opts.source) : null;

  let resolved = 0;
  const now = new Date().toISOString();
  for (const rec of set.recommendations) {
    if (rec.status === 'completed' || rec.status === 'dismissed') continue;
    if (sourceCategory && getRecSourceCategory(rec.source) !== sourceCategory) continue;
    const intersects = rec.affectedPages.some(p => changedPages.has(toPageSlug(p)));
    if (!intersects) continue;
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'completed');
    rec.status = 'completed';
    rec.updatedAt = now;
    resolved++;
  }

  if (resolved === 0) return 0;

  // Recompute the summary so client-facing headline counts and Opportunity
  // Value totals reflect the resolved recs — otherwise the rendered list drops
  // the item but the numbers stay inflated until the next full regen.
  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendationMutation(set);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { resolved });
  log.info(`Resolved ${resolved} recommendation(s) in-place for ${workspaceId} (${changedPages.size} changed page(s))`);

  // Completing a rec frees its page; a debounced regen re-ranks the queue so the
  // next-best opportunity is promoted with fresh timing boosts. Never let the
  // regen trigger break the apply.
  try {
    triggerOpportunityRegen(workspaceId);
  } catch (err) {
    log.warn({ workspaceId, err: err instanceof Error ? err.message : String(err) }, 'opportunity regen trigger failed on apply (non-fatal)');
  }

  return resolved;
}

/**
 * Resolve recommendations covering a set of Webflow/CMS PAGE IDs. Recommendation
 * affectedPages are slugs, so each id is mapped to its slug via getPageState()
 * before matching.
 */
export function resolveRecommendationsForPageIds(
  workspaceId: string,
  pageIds: string[],
  opts: { source?: string } = {},
): number {
  const affectedSlugs = (pageIds ?? [])
    .map(id => getPageState(workspaceId, id)?.slug)
    .filter((s): s is string => typeof s === 'string' && s.length > 0);
  if (affectedSlugs.length === 0) return 0;
  return resolveRecommendationsForChange(workspaceId, { affectedPages: affectedSlugs, source: opts.source });
}

/**
 * Resolve active content recommendations whose target keyword matches a
 * just-published post. Called best-effort after a successful publish.
 *
 * @returns the number of recommendations transitioned to `completed`.
 */
export function resolveContentRecommendationsForPublishedPost(
  workspaceId: string,
  targetKeyword: string | null | undefined,
): number {
  const key = targetKeyword ? keywordComparisonKey(targetKeyword) : '';
  if (!key) return 0;

  const set = loadRecommendationSet(workspaceId);
  if (!set) return 0;

  let resolved = 0;
  const now = new Date().toISOString();
  for (const rec of set.recommendations) {
    if (rec.status === 'completed' || rec.status === 'dismissed') continue;
    if (rec.type !== 'content') continue;
    if (!rec.targetKeyword || keywordComparisonKey(rec.targetKeyword) !== key) continue;
    validateTransition('recommendation', RECOMMENDATION_TRANSITIONS, rec.status, 'completed');
    rec.status = 'completed';
    rec.updatedAt = now;
    resolved++;
  }

  if (resolved === 0) return 0;

  set.summary = computeRecommendationSummary(set.recommendations);
  saveRecommendationMutation(set);
  invalidateIntelligenceCache(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.RECOMMENDATIONS_UPDATED, { resolved });
  log.info(`Resolved ${resolved} content recommendation(s) for ${workspaceId} after publishing "${targetKeyword}"`);
  return resolved;
}
