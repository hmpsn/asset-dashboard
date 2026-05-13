import { createLogger } from './logger.js';
import { getConfiguredProvider } from './seo-data-provider.js';
import { getWorkspace } from './workspaces.js';

const log = createLogger('provider-keyword-metrics');

export interface ProviderKeywordMetric {
  difficulty: number;
  volume: number;
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
    const metrics = await provider.getKeywordMetrics(cleanKeywords, workspaceId);
    for (const metric of metrics) {
      results.set(metric.keyword.toLowerCase(), { difficulty: metric.difficulty, volume: metric.volume });
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
  return metrics.get(trimmedKeyword.toLowerCase()) ?? null;
}
