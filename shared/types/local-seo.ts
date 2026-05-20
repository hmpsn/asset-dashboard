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

export interface LocalSeoWorkspaceSettings {
  workspaceId: string;
  posture: LocalSeoPosture;
  postureSource: LocalSeoPostureSource;
  suggestedPosture?: LocalSeoPosture;
  suggestionReasons: string[];
  updatedAt: string;
}

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

export interface LocalSeoReadResponse {
  featureEnabled: boolean;
  settings: LocalSeoWorkspaceSettings;
  markets: LocalSeoMarket[];
  suggestedMarkets: LocalSeoMarket[];
  latestSnapshots: LocalVisibilitySnapshot[];
  caps: {
    maxMarkets: number;
    maxKeywordsPerRefresh: number;
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
    latitude?: number;
    longitude?: number;
    providerLocationCode?: number;
    providerLocationName?: string;
    status?: LocalSeoMarketStatus;
  }>;
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
