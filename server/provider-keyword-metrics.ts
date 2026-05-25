import { createLogger } from './logger.js';
import { resolveWorkspaceLocationCode } from './local-seo.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';
import type { PageKeywordMap } from '../shared/types/workspace.js';
import { keywordComparisonKey } from '../shared/keyword-normalization.js';

const log = createLogger('provider-keyword-metrics');

export interface ProviderKeywordMetric {
  difficulty: number;
  volume: number;
}

export interface PersistedKeywordMetrics {
  /** Undefined means no provider-confirmed metric is available; store NULL, not an AI estimate. */
  keywordDifficulty: number | undefined;
  /** Undefined means no provider-confirmed metric is available; store NULL, not an AI estimate. */
  monthlyVolume: number | undefined;
}

export async function getProviderMetricsForKeywords(
  workspaceId: string,
  keywords: string[],
  context: string,
): Promise<Map<string, ProviderKeywordMetric>> {
  const cleanKeywords = Array.from(new Set(keywords.map(keyword => keyword.trim()).filter(Boolean)));
  const results = new Map<string, ProviderKeywordMetric>();
  if (cleanKeywords.length === 0) return results;

  const ws = getWorkspace(workspaceId);
  const provider = getConfiguredProvider(ws?.seoDataProvider);
  if (!provider) return results;

  try {
    const locationCode = resolveWorkspaceLocationCode(workspaceId) ?? undefined;
    const metrics = await provider.getKeywordMetrics(cleanKeywords, workspaceId, undefined, locationCode);
    for (const metric of metrics) {
      results.set(keywordComparisonKey(metric.keyword), { difficulty: metric.difficulty, volume: metric.volume });
    }
  } catch (err) {
    log.warn({ err, workspaceId, context }, 'keyword provider metrics lookup failed');
  }

  return results;
}

export async function getProviderMetricsForKeyword(
  workspaceId: string,
  keyword: string,
  context: string,
): Promise<ProviderKeywordMetric | null> {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) return null;

  const metrics = await getProviderMetricsForKeywords(workspaceId, [trimmedKeyword], context);
  return metrics.get(keywordComparisonKey(trimmedKeyword)) ?? null;
}

export function resolvePersistedKeywordMetrics(
  existing: Pick<PageKeywordMap, 'primaryKeyword' | 'keywordDifficulty' | 'monthlyVolume'> | undefined,
  resolvedPrimaryKeyword: string,
  providerMetrics: ProviderKeywordMetric | null | undefined,
): PersistedKeywordMetrics {
  if (providerMetrics) {
    return {
      keywordDifficulty: providerMetrics.difficulty,
      monthlyVolume: providerMetrics.volume,
    };
  }

  const normalizedExistingKeyword = keywordComparisonKey(existing?.primaryKeyword);
  const normalizedResolvedKeyword = keywordComparisonKey(resolvedPrimaryKeyword);
  const isSamePersistedKeyword = !!normalizedExistingKeyword && normalizedExistingKeyword === normalizedResolvedKeyword;
  const hasPersistedMetrics = existing?.keywordDifficulty != null || existing?.monthlyVolume != null;

  if (isSamePersistedKeyword && hasPersistedMetrics) {
    return {
      keywordDifficulty: existing.keywordDifficulty,
      monthlyVolume: existing.monthlyVolume,
    };
  }

  return {
    keywordDifficulty: undefined,
    monthlyVolume: undefined,
  };
}
