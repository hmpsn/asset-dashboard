export const TRACKED_KEYWORD_SOURCE = {
  MANUAL: 'manual',
  STRATEGY_PRIMARY: 'strategy_primary',
  STRATEGY_SITE_KEYWORD: 'strategy_site_keyword',
  CLIENT_REQUESTED: 'client_requested',
  CONTENT_GAP: 'content_gap',
  RECOMMENDATION: 'recommendation',
  UNKNOWN: 'unknown',
} as const;

export type TrackedKeywordSource = typeof TRACKED_KEYWORD_SOURCE[keyof typeof TRACKED_KEYWORD_SOURCE];

export const TRACKED_KEYWORD_STATUS = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  DEPRECATED: 'deprecated',
  REPLACED: 'replaced',
} as const;

export type TrackedKeywordStatus = typeof TRACKED_KEYWORD_STATUS[keyof typeof TRACKED_KEYWORD_STATUS];

export type TrackedKeywordAuthorityPosture =
  | 'authority_unknown'
  | 'within_current_authority_range'
  | 'requires_authority_building';

export interface TrackedKeyword {
  query: string;
  pinned: boolean;
  addedAt: string;
  source?: TrackedKeywordSource;
  status?: TrackedKeywordStatus;
  pagePath?: string;
  pageTitle?: string;
  strategyGeneratedAt?: string;
  lastStrategySeenAt?: string;
  intent?: string;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  authorityPosture?: TrackedKeywordAuthorityPosture;
  baselinePosition?: number;
  baselineClicks?: number;
  baselineImpressions?: number;
  replacedBy?: string;
  deprecatedAt?: string;
  /**
   * Wave 3d-i ADDITIVE provenance pointer — the content-addressed gap key this
   * keyword was approved from (content_gap / keyword_gap surface). Equals
   * keywordComparisonKey(displayKeyword), matching content_gaps PK
   * (workspace_id, target_keyword). Persisted in the tracked_keywords TABLE and
   * read ONLY via the admin path (listTrackedKeywordRows / KCC) — getTrackedKeywords
   * and the public serializers STRIP it (behavior-preserving). FILL-IF-EMPTY: once
   * set, it is never overwritten by a later status-only/reconcile write.
   *
   * NOTE: the sibling provenance pointer `sourcePageId` is DEFERRED. The contract
   * wanted a STABLE page_keywords PK, but page_keywords has PRIMARY KEY
   * (workspace_id, page_path) with no surrogate id (migration 024) — the only
   * stable id is the mutable page_path, which the contract forbids. The column is
   * written NULL and intentionally NOT projected pending a stable page id.
   */
  sourceGapKey?: string;
}

export interface RankHistoryEntry {
  date: string;
  positions: Record<string, number>;
}

export interface LatestRank {
  query: string;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number;
  change?: number;
  pinned?: boolean;
  source?: TrackedKeywordSource;
  status?: TrackedKeywordStatus;
  pagePath?: string;
  pageTitle?: string;
}
