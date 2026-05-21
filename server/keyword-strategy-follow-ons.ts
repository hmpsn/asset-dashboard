import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { hasStrategyOwnedTrackedKeywords, reconcileStrategyRankTracking, summarizeStrategyRankTrackingChangeSet } from './rank-tracking-reconciliation.js';
import { queueLlmsTxtRegeneration } from './llms-txt-generator.js';
import { generateRecommendations } from './recommendations.js';
import { createLogger } from './logger.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { WS_EVENTS } from './ws-events.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy:follow-ons');
const RECOMMENDATION_REFRESH_DELAY_MS = 30_000;

// Dedup guard: prevents concurrent background recommendation runs for the same workspace
// (e.g. rapid strategy re-generations). Final write wins via SQLite upsert; this just
// avoids wasted work and redundant broadcasts.
const recsInFlight = new Set<string>();

export interface SeedKeywordStrategyTrackedKeywordsOptions {
  workspaceId: string;
  workspaceName: string;
  keywordStrategy: Pick<KeywordStrategy, 'siteKeywords' | 'siteKeywordMetrics' | 'generatedAt'>;
  pageMap: PageKeywordMap[];
}

export interface QueueKeywordStrategyPostUpdateFollowOnsOptions {
  workspaceId: string;
}

export function workspaceHasStrategyOwnedRankTracking(workspaceId: string): boolean {
  return hasStrategyOwnedTrackedKeywords(workspaceId);
}

export function seedKeywordStrategyTrackedKeywords(options: SeedKeywordStrategyTrackedKeywordsOptions): void {
  const { workspaceId, workspaceName, keywordStrategy, pageMap } = options;

  try {
    const changeSet = reconcileStrategyRankTracking({
      workspaceId,
      keywordStrategy,
      pageMap,
      generatedAt: keywordStrategy.generatedAt,
    });
    const summary = summarizeStrategyRankTrackingChangeSet(changeSet);
    const structuralChanged = summary.added + summary.reassigned + summary.deprecated + summary.replaced;
    const touched = structuralChanged + summary.retained;
    log.info({ workspaceId, summary }, `Reconciled strategy rank tracking for ${workspaceName}`);
    if (touched > 0) {
      if (structuralChanged > 0) {
        addActivity(
          workspaceId,
          'rank_tracking_updated',
          'Rank tracking updated from keyword strategy',
          `${summary.added} added, ${summary.reassigned} reassigned, ${summary.deprecated + summary.replaced} retired`,
          summary,
        );
      }
      broadcastToWorkspace(workspaceId, WS_EVENTS.RANK_TRACKING_UPDATED, {
        source: 'keyword_strategy',
        ...summary,
      });
      invalidateIntelligenceCache(workspaceId);
      invalidateSubCachePrefix(workspaceId, 'slice:seoContext');
    }
  } catch (seedErr) {
    log.warn({ err: seedErr }, 'Failed to reconcile strategy rank tracking keywords');
  }
}

export function queueKeywordStrategyPostUpdateFollowOns(options: QueueKeywordStrategyPostUpdateFollowOnsOptions): void {
  const { workspaceId } = options;

  // Trigger background llms.txt regeneration after strategy update
  queueLlmsTxtRegeneration(workspaceId, 'keyword_strategy_updated');

  // Refresh recommendations after the strategy response settles. Keeping this
  // out of the same resource spike as provider-backed strategy generation makes
  // staging less likely to restart under peak load; recommendations are best-effort.
  if (!recsInFlight.has(workspaceId)) {
    recsInFlight.add(workspaceId);
    setTimeout(() => {
      generateRecommendations(workspaceId)
        .catch(err => log.warn({ err, workspaceId }, 'Failed to refresh recommendations after strategy update'))
        .finally(() => recsInFlight.delete(workspaceId));
    }, RECOMMENDATION_REFRESH_DELAY_MS);
  }
}
