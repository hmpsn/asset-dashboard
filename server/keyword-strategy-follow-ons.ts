import { addActivity } from './activity-log.js';
import { broadcastToWorkspace } from './broadcast.js';
import { invalidateSubCachePrefix } from './bridge-infrastructure.js';
import { hasStrategyOwnedTrackedKeywords, reconcileStrategyRankTracking, summarizeStrategyRankTrackingChangeSet } from './rank-tracking-reconciliation.js';
import { queueLlmsTxtRegeneration } from './llms-txt-generator.js';
import { queueDelayedRecommendationRegen, RECOMMENDATION_REFRESH_DELAY_MS } from './recommendation-regen-scheduler.js';
import { enqueueIntelligenceRecompute } from './intelligence-recompute-job.js';
import { createLogger } from './logger.js';
import { invalidateIntelligenceCache } from './workspace-intelligence.js';
import { WS_EVENTS } from './ws-events.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy:follow-ons');

export interface SeedKeywordStrategyTrackedKeywordsOptions {
  workspaceId: string;
  workspaceName: string;
  // Wave 3b-ii strip (table-as-truth): siteKeywordMetrics is no longer read here — it
  // forwards to reconcileStrategyRankTracking, whose Pick is ('siteKeywords' |
  // 'generatedAt'); reconcile self-sources metrics from the site_keyword_metrics table.
  keywordStrategy: Pick<KeywordStrategy, 'siteKeywords' | 'generatedAt'>;
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
  queueDelayedRecommendationRegen(workspaceId, 'keyword_strategy_follow_on', RECOMMENDATION_REFRESH_DELAY_MS);

  // Phase 5c: a strategy/content mutation changes the data insights derive from — refresh signals.
  // No-ops unless the signal-auto-recompute flag is on; deduped via hasActiveJob.
  enqueueIntelligenceRecompute(workspaceId);
}
