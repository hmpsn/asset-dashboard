import { getTrackedKeywords } from '../../rank-tracking.js';
import { getTaxonomyForIndustry } from '../../service-taxonomy.js';
import { getWorkspace } from '../../workspaces.js';
import {
  LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_MARKET_STATUS,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
  LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
  LOCAL_SEO_POSTURE,
  LOCAL_SEO_VISIBILITY_POSTURE,
  type LocalSeoMarket,
  type LocalSeoReadResponse,
  type LocalSeoRepeatCompetitor,
  type LocalSeoReportSummary,
  type LocalSeoServiceGap,
  type LocalSeoWorkspaceSettings,
  type LocalVisibilitySnapshot,
} from '../../../shared/types/local-seo.js';
import {
  LOCAL_SEO_MAX_MARKETS,
  listLocalSeoMarkets,
} from './configuration-service.js';
import {
  buildMarketKeywordVisibilityFromSnapshots,
  listLocalSeoCompetitorSnapshots,
} from './snapshot-store.js';

export function getLocalSeoCompetitorBrands(workspaceId: string, lookbackDays = 30): LocalSeoRepeatCompetitor[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const snapshots = listLocalSeoCompetitorSnapshots(workspaceId, lookbackDays);

  const TOP_LIMIT = 10;
  const MIN_APPEARANCES = 2;

  interface Accumulator {
    domain: string | undefined;
    totalAppearances: number;
    winsAgainstClient: number;
    markets: Set<string>;
  }

  const map = new Map<string, Accumulator>();
  const titleMap = new Map<string, string>();

  for (const row of snapshots) {
    const clientLost = !row.businessFound && row.localPackPresent;
    for (const competitor of row.topCompetitors) {
      const key = competitor.title.toLowerCase().trim();
      if (!key) continue;
      const existing = map.get(key);
      if (existing) {
        existing.totalAppearances += 1;
        if (clientLost) existing.winsAgainstClient += 1;
        existing.markets.add(row.marketLabel);
        if (!existing.domain && competitor.domain) existing.domain = competitor.domain;
      } else {
        map.set(key, {
          domain: competitor.domain,
          totalAppearances: 1,
          winsAgainstClient: clientLost ? 1 : 0,
          markets: new Set([row.marketLabel]),
        });
        titleMap.set(key, competitor.title);
      }
    }
  }

  const activeMarketCity = listLocalSeoMarkets(workspaceId)
    .find(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE)?.city;

  const results: LocalSeoRepeatCompetitor[] = [];
  for (const [key, acc] of map.entries()) {
    if (acc.totalAppearances < MIN_APPEARANCES) continue;
    const title = titleMap.get(key) ?? key;
    const suggestedTrackingKeywords: string[] = [
      `${title} reviews`,
    ];
    if (workspace.name.trim()) {
      suggestedTrackingKeywords.push(`${title} vs ${workspace.name.trim()}`);
    }
    if (activeMarketCity) suggestedTrackingKeywords.push(`${title} ${activeMarketCity}`);
    results.push({
      title,
      domain: acc.domain,
      totalAppearances: acc.totalAppearances,
      winsAgainstClient: acc.winsAgainstClient,
      markets: Array.from(acc.markets),
      suggestedTrackingKeywords,
    });
  }

  results.sort((a, b) =>
    b.winsAgainstClient - a.winsAgainstClient
    || b.totalAppearances - a.totalAppearances,
  );

  return results.slice(0, TOP_LIMIT);
}

export function getLocalSeoServiceGaps(workspaceId: string): LocalSeoServiceGap[] {
  const workspace = getWorkspace(workspaceId);
  if (!workspace) return [];
  const taxonomy = getTaxonomyForIndustry(workspace.intelligenceProfile?.industry);
  if (!taxonomy) return [];
  const tracked = getTrackedKeywords(workspaceId);
  const activeQueries = tracked.map(keyword => keyword.query.toLowerCase());
  return taxonomy
    .filter(service =>
      !service.matchTerms.some(term => activeQueries.some(query => query.includes(term)))
    )
    .map(service => ({
      serviceId: service.id,
      serviceLabel: service.label,
      starterKeywords: service.starterKeywords,
    }));
}

export function buildLocalSeoReportSummary(input: {
  featureEnabled: boolean;
  settings: LocalSeoWorkspaceSettings;
  markets: LocalSeoMarket[];
  suggestedMarkets: LocalSeoMarket[];
  latestSnapshots: LocalVisibilitySnapshot[];
}): LocalSeoReportSummary {
  const activeMarketCount = input.markets.filter(market => market.status === LOCAL_SEO_MARKET_STATUS.ACTIVE).length;
  const latestByMarketKeyword = buildMarketKeywordVisibilityFromSnapshots(input.latestSnapshots);
  const visibility = [...latestByMarketKeyword.values()];
  const visibleCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length;
  const possibleMatchCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length;
  const notVisibleCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE || item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT).length;
  const degradedCount = visibility.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length;
  const lastCapturedAt = input.latestSnapshots
    .map(snapshot => snapshot.capturedAt)
    .sort()
    .at(-1);

  let setupState: LocalSeoReportSummary['setupState'] = 'has_data';
  let setupLabel = 'Local visibility reporting is active';
  let setupDetail = 'Market-specific local-pack visibility is available for reviewed local-intent keywords.';
  if (!input.featureEnabled) {
    setupState = 'feature_disabled';
    setupLabel = 'Local SEO visibility is not enabled';
    setupDetail = 'The reporting layer is dark-launched behind the local SEO visibility feature flag.';
  } else if (input.settings.posture === LOCAL_SEO_POSTURE.NON_LOCAL) {
    setupState = 'non_local';
    setupLabel = 'Workspace marked non-local';
    setupDetail = 'Local-pack visibility is hidden because this workspace is not currently managed as a local SEO account.';
  } else if (activeMarketCount === 0) {
    setupState = 'needs_market';
    setupLabel = 'Market setup needed';
    setupDetail = 'Configure at least one reviewed local market before refreshing local visibility.';
  } else if (input.latestSnapshots.length === 0) {
    setupState = 'ready_no_data';
    setupLabel = 'Ready for first refresh';
    setupDetail = 'Markets are configured. Run a local visibility refresh to collect local-pack evidence.';
  }

  return {
    workspacePosture: input.settings.posture,
    suggestedPosture: input.settings.suggestedPosture,
    activeMarketCount,
    configuredMarketCount: input.markets.length,
    suggestedMarketCount: input.suggestedMarkets.length,
    latestSnapshotCount: input.latestSnapshots.length,
    checkedKeywordCount: latestByMarketKeyword.size,
    visibleCount,
    possibleMatchCount,
    notVisibleCount,
    localPackPresentCount: visibility.filter(item => item.localPackPresent).length,
    degradedCount,
    lastCapturedAt,
    setupState,
    setupLabel,
    setupDetail,
  };
}

export function buildLocalSeoCaps(settings: LocalSeoWorkspaceSettings): LocalSeoReadResponse['caps'] {
  return {
    maxMarkets: LOCAL_SEO_MAX_MARKETS,
    maxKeywordsPerRefresh: settings.keywordsPerRefresh ?? LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
    keywordsPerRefreshMin: LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
    keywordsPerRefreshMax: LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
    keywordsPerRefreshDefault: LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH,
  };
}
