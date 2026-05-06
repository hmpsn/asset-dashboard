import { addTrackedKeyword } from './rank-tracking.js';
import { queueLlmsTxtRegeneration } from './llms-txt-generator.js';
import { generateRecommendations } from './recommendations.js';
import { createLogger } from './logger.js';
import type { PageKeywordMap, KeywordStrategy } from '../shared/types/workspace.js';

const log = createLogger('keyword-strategy:follow-ons');

// Dedup guard: prevents concurrent background recommendation runs for the same workspace
// (e.g. rapid strategy re-generations). Final write wins via SQLite upsert; this just
// avoids wasted work and redundant broadcasts.
const recsInFlight = new Set<string>();

export interface SeedKeywordStrategyTrackedKeywordsOptions {
  workspaceId: string;
  workspaceName: string;
  keywordStrategy: Pick<KeywordStrategy, 'siteKeywords'>;
  pageMap: PageKeywordMap[];
}

export interface QueueKeywordStrategyPostUpdateFollowOnsOptions {
  workspaceId: string;
}

export function collectKeywordStrategySeedKeywords(
  keywordStrategy: Pick<KeywordStrategy, 'siteKeywords'>,
  pageMap: PageKeywordMap[],
): string[] {
  const seedKeywords = new Set<string>();
  for (const kw of keywordStrategy.siteKeywords || []) {
    const normalized = kw.toLowerCase().trim();
    if (normalized) seedKeywords.add(normalized); // skip empty strings
  }
  for (const pm of pageMap) {
    if (pm.primaryKeyword) seedKeywords.add(pm.primaryKeyword.toLowerCase().trim());
  }
  return [...seedKeywords];
}

export function seedKeywordStrategyTrackedKeywords(options: SeedKeywordStrategyTrackedKeywordsOptions): void {
  const { workspaceId, workspaceName, keywordStrategy, pageMap } = options;

  try {
    const seedKeywords = collectKeywordStrategySeedKeywords(keywordStrategy, pageMap);
    for (const kw of seedKeywords) addTrackedKeyword(workspaceId, kw);
    log.info(`Auto-seeded ${seedKeywords.length} keywords into rank tracking for ${workspaceName}`);
  } catch (seedErr) {
    log.warn({ err: seedErr }, 'Failed to auto-seed rank tracking keywords');
  }
}

export function queueKeywordStrategyPostUpdateFollowOns(options: QueueKeywordStrategyPostUpdateFollowOnsOptions): void {
  const { workspaceId } = options;

  // Trigger background llms.txt regeneration after strategy update
  queueLlmsTxtRegeneration(workspaceId, 'keyword_strategy_updated');

  // Refresh recommendations so quick wins / content gaps / ranking opportunities
  // reflect the new strategy immediately, without waiting for the next manual audit.
  if (!recsInFlight.has(workspaceId)) {
    recsInFlight.add(workspaceId);
    generateRecommendations(workspaceId)
      .catch(err => log.warn({ err, workspaceId }, 'Failed to refresh recommendations after strategy update'))
      .finally(() => recsInFlight.delete(workspaceId));
  }
}
