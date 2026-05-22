export type LocalSeoKeywordIntent = 'transactional' | 'commercial' | 'navigational' | 'informational' | 'comparison';

export const LOCAL_SEO_POSTURE = {
  LOCAL: 'local',
  NON_LOCAL: 'non_local',
  HYBRID: 'hybrid',
  UNKNOWN: 'unknown',
} as const;

export type LocalSeoPosture = typeof LOCAL_SEO_POSTURE[keyof typeof LOCAL_SEO_POSTURE];

export const LOCAL_SEO_POSTURE_SOURCE = {
  ADMIN_OVERRIDE: 'admin_override',
  BUSINESS_PROFILE: 'business_profile',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
} as const;

export type LocalSeoPostureSource = typeof LOCAL_SEO_POSTURE_SOURCE[keyof typeof LOCAL_SEO_POSTURE_SOURCE];

export const LOCAL_SEO_MARKET_SOURCE = {
  BUSINESS_PROFILE: 'business_profile',
  ADMIN_OVERRIDE: 'admin_override',
  INFERRED: 'inferred',
  UNKNOWN: 'unknown',
} as const;

export type LocalSeoMarketSource = typeof LOCAL_SEO_MARKET_SOURCE[keyof typeof LOCAL_SEO_MARKET_SOURCE];

export const LOCAL_SEO_MARKET_STATUS = {
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  NEEDS_REVIEW: 'needs_review',
} as const;

export type LocalSeoMarketStatus = typeof LOCAL_SEO_MARKET_STATUS[keyof typeof LOCAL_SEO_MARKET_STATUS];

export const LOCAL_SEO_DEVICE = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
} as const;

export type LocalSeoDevice = typeof LOCAL_SEO_DEVICE[keyof typeof LOCAL_SEO_DEVICE];

export const LOCAL_VISIBILITY_SOURCE_ENDPOINT = {
  GOOGLE_ORGANIC_SERP: 'google_organic_serp',
  GOOGLE_LOCAL_FINDER: 'google_local_finder',
  GOOGLE_MAPS: 'google_maps',
} as const;

export type LocalVisibilitySourceEndpoint = typeof LOCAL_VISIBILITY_SOURCE_ENDPOINT[keyof typeof LOCAL_VISIBILITY_SOURCE_ENDPOINT];

export const LOCAL_BUSINESS_MATCH_CONFIDENCE = {
  VERIFIED: 'verified',
  STRONG_MATCH: 'strong_match',
  POSSIBLE_MATCH: 'possible_match',
  NOT_FOUND: 'not_found',
  UNKNOWN: 'unknown',
} as const;

export type LocalBusinessMatchConfidence = typeof LOCAL_BUSINESS_MATCH_CONFIDENCE[keyof typeof LOCAL_BUSINESS_MATCH_CONFIDENCE];

export const LOCAL_VISIBILITY_STATUS = {
  SUCCESS: 'success',
  DEGRADED: 'degraded',
  PROVIDER_FAILED: 'provider_failed',
  SKIPPED: 'skipped',
} as const;

export type LocalVisibilityStatus = typeof LOCAL_VISIBILITY_STATUS[keyof typeof LOCAL_VISIBILITY_STATUS];

export const LOCAL_SEO_VISIBILITY_POSTURE = {
  VISIBLE: 'visible',
  POSSIBLE_MATCH: 'possible_match',
  NOT_VISIBLE: 'not_visible',
  LOCAL_PACK_PRESENT: 'local_pack_present',
  PROVIDER_DEGRADED: 'provider_degraded',
} as const;

export type LocalSeoVisibilityPosture =
  typeof LOCAL_SEO_VISIBILITY_POSTURE[keyof typeof LOCAL_SEO_VISIBILITY_POSTURE];

export interface LocalSeoMarket {
  id: string;
  workspaceId: string;
  label: string;
  city: string;
  stateOrRegion?: string;
  country: string;
  latitude?: number;
  longitude?: number;
  providerLocationCode?: number;
  providerLocationName?: string;
  source: LocalSeoMarketSource;
  status: LocalSeoMarketStatus;
  createdAt: string;
  updatedAt: string;
}

export const LOCAL_SEO_LOCATION_LOOKUP_STATUS = {
  MATCHED: 'matched',
  AMBIGUOUS: 'ambiguous',
  NOT_FOUND: 'not_found',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
  PROVIDER_FAILED: 'provider_failed',
} as const;

export type LocalSeoLocationLookupStatus =
  typeof LOCAL_SEO_LOCATION_LOOKUP_STATUS[keyof typeof LOCAL_SEO_LOCATION_LOOKUP_STATUS];

export interface LocalSeoLocationLookupRequest {
  city: string;
  stateOrRegion?: string;
  country: string;
}

export interface LocalSeoLocationLookupCandidate {
  providerLocationCode: number;
  providerLocationName: string;
  countryIsoCode?: string;
  locationType?: string;
  score: number;
}

export interface LocalSeoLocationLookupResponse {
  query: LocalSeoLocationLookupRequest;
  status: LocalSeoLocationLookupStatus;
  candidates: LocalSeoLocationLookupCandidate[];
  bestCandidate?: LocalSeoLocationLookupCandidate;
  degradedReason?: string;
}

export interface LocalSeoWorkspaceSettings {
  workspaceId: string;
  posture: LocalSeoPosture;
  postureSource: LocalSeoPostureSource;
  suggestedPosture?: LocalSeoPosture;
  suggestionReasons: string[];
  updatedAt: string;
  /**
   * Per-workspace override for how many keywords the refresh job sends to
   * DataForSEO per market on each refresh. `null` means "use the global
   * default" (`LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH`, currently 100).
   *
   * Bounded server-side to [LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH,
   * LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP]. Higher values give better
   * local-pack coverage on local-first workspaces (multi-market service
   * businesses) at a small marginal DataForSEO cost (~$0.002/keyword).
   */
  keywordsPerRefresh: number | null;
}

/**
 * Minimum allowed keywords-per-refresh override. Below this and the
 * snapshot coverage stops being useful for trend analysis.
 */
export const LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH = 25;

/**
 * Hard ceiling on the keywords-per-refresh override. Above this we
 * approach the candidate hard cap (1000) and refresh duration starts
 * eating into the background-job budget.
 */
export const LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP = 300;

/**
 * Global default used when a workspace doesn't override
 * `keywordsPerRefresh`. Raised from 50 → 100 as part of the Tier 2 refactor —
 * with the Evaluated builder filling the slots, 100 high-quality keywords
 * cost ~$0.20 per refresh and give meaningfully broader local-pack
 * coverage than the old 50-keyword default.
 */
export const LOCAL_SEO_DEFAULT_KEYWORDS_PER_REFRESH = 100;

export interface LocalVisibilityBusinessResult {
  title: string;
  rank?: number;
  domain?: string;
  url?: string;
  phone?: string;
  address?: string;
  cid?: string;
}

export interface LocalVisibilityProviderRequest {
  keyword: string;
  market: LocalSeoMarket;
  device: LocalSeoDevice;
  languageCode: string;
  maxResults: number;
}

export interface LocalVisibilityProviderResult {
  keyword: string;
  marketId: string;
  provider: string;
  sourceEndpoint: LocalVisibilitySourceEndpoint;
  capturedAt: string;
  localPackPresent: boolean;
  results: LocalVisibilityBusinessResult[];
  status: LocalVisibilityStatus;
  degradedReason?: string;
}

export interface LocalVisibilitySnapshot {
  id: string;
  workspaceId: string;
  keyword: string;
  normalizedKeyword: string;
  marketId: string;
  marketLabel: string;
  capturedAt: string;
  localPackPresent: boolean;
  businessFound: boolean;
  businessMatchConfidence: LocalBusinessMatchConfidence;
  businessMatchReason?: string;
  localRank?: number;
  topCompetitors: LocalVisibilityBusinessResult[];
  sourceEndpoint: LocalVisibilitySourceEndpoint;
  provider: string;
  device: LocalSeoDevice;
  languageCode: string;
  status: LocalVisibilityStatus;
  degradedReason?: string;
}

export interface LocalSeoKeywordVisibility {
  keyword: string;
  normalizedKeyword: string;
  marketId: string;
  marketLabel: string;
  capturedAt: string;
  posture: LocalSeoVisibilityPosture;
  label: string;
  detail: string;
  localPackPresent: boolean;
  businessFound: boolean;
  businessMatchConfidence: LocalBusinessMatchConfidence;
  localRank?: number;
  sourceEndpoint: LocalVisibilitySourceEndpoint;
  provider: string;
  topCompetitors?: LocalVisibilityBusinessResult[];
  degradedReason?: string;
}

export interface LocalSeoKeywordVisibilitySummary extends LocalSeoKeywordVisibility {
  marketCount: number;
  markets: LocalSeoKeywordVisibility[];
  visibleMarketCount: number;
  possibleMatchMarketCount: number;
  localPackOnlyMarketCount: number;
  notVisibleMarketCount: number;
  degradedMarketCount: number;
}

export function localSeoKeywordVisibilityFromSnapshot(snapshot: LocalVisibilitySnapshot): LocalSeoKeywordVisibility {
  if (snapshot.status === LOCAL_VISIBILITY_STATUS.PROVIDER_FAILED || snapshot.status === LOCAL_VISIBILITY_STATUS.DEGRADED) {
    return {
      keyword: snapshot.keyword,
      normalizedKeyword: snapshot.normalizedKeyword,
      marketId: snapshot.marketId,
      marketLabel: snapshot.marketLabel,
      capturedAt: snapshot.capturedAt,
      posture: LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED,
      label: 'Provider degraded',
      detail: snapshot.degradedReason ?? 'Local visibility data could not be refreshed cleanly.',
      localPackPresent: snapshot.localPackPresent,
      businessFound: snapshot.businessFound,
      businessMatchConfidence: snapshot.businessMatchConfidence,
      localRank: snapshot.localRank,
      sourceEndpoint: snapshot.sourceEndpoint,
      provider: snapshot.provider,
      topCompetitors: snapshot.topCompetitors,
      degradedReason: snapshot.degradedReason,
    };
  }

  if (snapshot.businessFound && snapshot.businessMatchConfidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.VERIFIED) {
    return {
      keyword: snapshot.keyword,
      normalizedKeyword: snapshot.normalizedKeyword,
      marketId: snapshot.marketId,
      marketLabel: snapshot.marketLabel,
      capturedAt: snapshot.capturedAt,
      posture: LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE,
      label: snapshot.localRank ? `Visible #${snapshot.localRank}` : 'Visible locally',
      detail: snapshot.businessMatchReason ?? 'Business appears in local results with verified match evidence.',
      localPackPresent: snapshot.localPackPresent,
      businessFound: snapshot.businessFound,
      businessMatchConfidence: snapshot.businessMatchConfidence,
      localRank: snapshot.localRank,
      sourceEndpoint: snapshot.sourceEndpoint,
      provider: snapshot.provider,
      topCompetitors: snapshot.topCompetitors,
    };
  }

  if (
    snapshot.businessFound
    && (
      snapshot.businessMatchConfidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.STRONG_MATCH
      || snapshot.businessMatchConfidence === LOCAL_BUSINESS_MATCH_CONFIDENCE.POSSIBLE_MATCH
    )
  ) {
    return {
      keyword: snapshot.keyword,
      normalizedKeyword: snapshot.normalizedKeyword,
      marketId: snapshot.marketId,
      marketLabel: snapshot.marketLabel,
      capturedAt: snapshot.capturedAt,
      posture: LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH,
      label: snapshot.localRank ? `Possible match #${snapshot.localRank}` : 'Possible match',
      detail: snapshot.businessMatchReason ?? 'Possible business match; review before treating this as verified local visibility.',
      localPackPresent: snapshot.localPackPresent,
      businessFound: snapshot.businessFound,
      businessMatchConfidence: snapshot.businessMatchConfidence,
      localRank: snapshot.localRank,
      sourceEndpoint: snapshot.sourceEndpoint,
      provider: snapshot.provider,
      topCompetitors: snapshot.topCompetitors,
    };
  }

  if (snapshot.localPackPresent) {
    return {
      keyword: snapshot.keyword,
      normalizedKeyword: snapshot.normalizedKeyword,
      marketId: snapshot.marketId,
      marketLabel: snapshot.marketLabel,
      capturedAt: snapshot.capturedAt,
      posture: LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT,
      label: 'Local pack present',
      detail: snapshot.businessMatchReason ?? 'A local pack appeared, but this business was not confidently matched.',
      localPackPresent: snapshot.localPackPresent,
      businessFound: snapshot.businessFound,
      businessMatchConfidence: snapshot.businessMatchConfidence,
      localRank: snapshot.localRank,
      sourceEndpoint: snapshot.sourceEndpoint,
      provider: snapshot.provider,
      topCompetitors: snapshot.topCompetitors,
    };
  }

  return {
    keyword: snapshot.keyword,
    normalizedKeyword: snapshot.normalizedKeyword,
    marketId: snapshot.marketId,
    marketLabel: snapshot.marketLabel,
    capturedAt: snapshot.capturedAt,
    posture: LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE,
    label: 'Not found locally',
    detail: snapshot.businessMatchReason ?? 'No likely business match found in local results for this market.',
    localPackPresent: snapshot.localPackPresent,
    businessFound: snapshot.businessFound,
    businessMatchConfidence: snapshot.businessMatchConfidence,
    localRank: snapshot.localRank,
    sourceEndpoint: snapshot.sourceEndpoint,
    provider: snapshot.provider,
    topCompetitors: snapshot.topCompetitors,
  };
}

export function summarizeLocalSeoKeywordVisibility(
  items: LocalSeoKeywordVisibility[],
): LocalSeoKeywordVisibilitySummary | undefined {
  if (items.length === 0) return undefined;
  const sorted = [...items].sort((a, b) => a.marketLabel.localeCompare(b.marketLabel));
  const visibleMarketCount = sorted.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE).length;
  const possibleMatchMarketCount = sorted.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH).length;
  const localPackOnlyMarketCount = sorted.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT).length;
  const notVisibleMarketCount = sorted.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE).length;
  const degradedMarketCount = sorted.filter(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED).length;
  const primary = sorted.find(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE)
    ?? sorted.find(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH)
    ?? sorted.find(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT)
    ?? sorted.find(item => item.posture === LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE)
    ?? sorted[0];

  if (sorted.length === 1) {
    return {
      ...primary,
      marketCount: 1,
      markets: sorted,
      visibleMarketCount,
      possibleMatchMarketCount,
      localPackOnlyMarketCount,
      notVisibleMarketCount,
      degradedMarketCount,
    };
  }

  const marketCount = sorted.length;
  const posture = visibleMarketCount > 0
    ? LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE
    : possibleMatchMarketCount > 0
      ? LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH
      : localPackOnlyMarketCount > 0
        ? LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT
        : degradedMarketCount === marketCount
          ? LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED
          : LOCAL_SEO_VISIBILITY_POSTURE.NOT_VISIBLE;
  const label = posture === LOCAL_SEO_VISIBILITY_POSTURE.VISIBLE
    ? `Visible in ${visibleMarketCount}/${marketCount} markets`
    : posture === LOCAL_SEO_VISIBILITY_POSTURE.POSSIBLE_MATCH
      ? `Possible in ${possibleMatchMarketCount}/${marketCount} markets`
      : posture === LOCAL_SEO_VISIBILITY_POSTURE.LOCAL_PACK_PRESENT
        ? `Local pack in ${localPackOnlyMarketCount}/${marketCount} markets`
        : posture === LOCAL_SEO_VISIBILITY_POSTURE.PROVIDER_DEGRADED
          ? `Provider degraded in ${marketCount} markets`
          : `Not found in ${notVisibleMarketCount}/${marketCount} markets`;
  const detail = sorted
    .slice(0, 3)
    .map(item => `${item.marketLabel}: ${item.label}`)
    .join(' · ');

  return {
    ...primary,
    marketLabel: `${marketCount} markets`,
    posture,
    label,
    detail: sorted.length > 3 ? `${detail} · +${sorted.length - 3} more` : detail,
    localPackPresent: sorted.some(item => item.localPackPresent),
    businessFound: sorted.some(item => item.businessFound),
    localRank: primary.localRank,
    marketCount,
    markets: sorted,
    visibleMarketCount,
    possibleMatchMarketCount,
    localPackOnlyMarketCount,
    notVisibleMarketCount,
    degradedMarketCount,
    topCompetitors: primary.topCompetitors,
  };
}

export function localSeoKeywordVisibilitySummaryFromSnapshots(
  snapshots: LocalVisibilitySnapshot[],
): LocalSeoKeywordVisibilitySummary | undefined {
  return summarizeLocalSeoKeywordVisibility(snapshots.map(localSeoKeywordVisibilityFromSnapshot));
}

export interface LocalSeoReportSummary {
  workspacePosture: LocalSeoPosture;
  suggestedPosture?: LocalSeoPosture;
  activeMarketCount: number;
  configuredMarketCount: number;
  suggestedMarketCount: number;
  latestSnapshotCount: number;
  checkedKeywordCount: number;
  visibleCount: number;
  possibleMatchCount: number;
  notVisibleCount: number;
  localPackPresentCount: number;
  degradedCount: number;
  lastCapturedAt?: string;
  setupState: 'feature_disabled' | 'non_local' | 'needs_market' | 'ready_no_data' | 'has_data';
  setupLabel: string;
  setupDetail: string;
}

export interface LocalSeoRepeatCompetitor {
  title: string;
  domain?: string;
  totalAppearances: number;
  winsAgainstClient: number;
  markets: string[];
  suggestedTrackingKeywords: string[];
}

export interface LocalSeoReadResponse {
  featureEnabled: boolean;
  settings: LocalSeoWorkspaceSettings;
  markets: LocalSeoMarket[];
  suggestedMarkets: LocalSeoMarket[];
  /** Empty on summary-only reads. Request snapshot-inclusive reads only when rendering keyword-level local annotations. */
  latestSnapshots: LocalVisibilitySnapshot[];
  report: LocalSeoReportSummary;
  competitorBrands: LocalSeoRepeatCompetitor[];
  caps: {
    maxMarkets: number;
    /**
     * The CURRENT effective keywords-per-refresh budget for this workspace —
     * the override if set, otherwise the global default. The UI displays this
     * value and uses it as the initial state for any "edit budget" control.
     */
    maxKeywordsPerRefresh: number;
    /** Lower bound for a custom override. UI input minimum. */
    keywordsPerRefreshMin: number;
    /** Upper bound for a custom override. UI input maximum. */
    keywordsPerRefreshMax: number;
    /** Global default — used to render "Reset to default" + a hint. */
    keywordsPerRefreshDefault: number;
  };
}

export interface LocalSeoMarketUpdateRequest {
  posture?: LocalSeoPosture;
  markets?: Array<{
    id?: string;
    label: string;
    city: string;
    stateOrRegion?: string;
    country: string;
    latitude?: number | null;
    longitude?: number | null;
    providerLocationCode?: number | null;
    providerLocationName?: string | null;
    status?: LocalSeoMarketStatus;
  }>;
  /**
   * Optional per-workspace override for the refresh keyword budget. Pass
   * `null` to clear the override (revert to global default). Pass an integer
   * in [LOCAL_SEO_MIN_KEYWORDS_PER_REFRESH, LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP]
   * to set a custom value. Omit the field to leave the existing value
   * unchanged.
   */
  keywordsPerRefresh?: number | null;
}

export interface LocalSeoRefreshRequest {
  marketIds?: string[];
  keywords?: string[];
  device?: LocalSeoDevice;
  languageCode?: string;
}

export interface LocalSeoRefreshStartResponse {
  jobId: string;
  selectedKeywordCount: number;
  selectedMarketCount: number;
}

export interface LocalSeoRefreshResult {
  workspaceId: string;
  refreshed: number;
  skipped: number;
  failed: number;
  markets: string[];
  keywords: string[];
}
