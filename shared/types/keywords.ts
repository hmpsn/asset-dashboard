// shared/types/keywords.ts

export const KEYWORD_SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational'] as const;
export type KeywordSearchIntent = typeof KEYWORD_SEARCH_INTENTS[number];

export function isKeywordSearchIntent(value: unknown): value is KeywordSearchIntent {
  return typeof value === 'string' && (KEYWORD_SEARCH_INTENTS as readonly string[]).includes(value);
}

/**
 * Canonical source values for keyword metrics.
 * Use these constants — never raw string literals.
 *
 * pr-check enforces: no bare 'bulk_lookup' or 'ai_estimate' strings outside this file.
 */
export const METRICS_SOURCE = {
  /** Exact keyword match from SEMRush bulk lookup. */
  EXACT: 'exact',
  /** Page-specific provider data from a URL-level organic keyword report. */
  URL_LEVEL: 'url_level',
  /** Partial/fuzzy match from SEMRush. */
  PARTIAL_MATCH: 'partial_match',
  /** SEMRush bulk domain organic data lookup. */
  BULK_LOOKUP: 'bulk_lookup',
  /** AI-estimated metrics (no SEMRush data available). */
  AI_ESTIMATE: 'ai_estimate',
} as const;

export type MetricsSource = typeof METRICS_SOURCE[keyof typeof METRICS_SOURCE];

export const KEYWORD_SOURCE_KIND = {
  KEYWORD_IDEAS: 'keyword_ideas',
  KEYWORDS_FOR_SITE: 'keywords_for_site',
  KEYWORD_SUGGESTIONS: 'keyword_suggestions',
  GOOGLE_ADS_KEYWORDS_FOR_KEYWORDS: 'google_ads_keywords_for_keywords',
  RELATED_KEYWORDS: 'related_keywords',
  RANKED_KEYWORDS: 'ranked_keywords',
  GSC_QUERY: 'gsc_query',
  CLIENT_REQUESTED: 'client_requested',
  UNKNOWN: 'unknown',
} as const;

export type KeywordSourceKind = typeof KEYWORD_SOURCE_KIND[keyof typeof KEYWORD_SOURCE_KIND];

export interface KeywordSourceEvidence {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  competition?: number;
  trend?: number[];
  provider: string;
  sourceKind: KeywordSourceKind;
  seed?: string;
  sourceTarget?: string;
  confidence?: 'high' | 'medium' | 'low';
  intent?: string;
  serpFeatures?: string;
}

export interface UrlLevelKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  cpc: number;
  traffic?: number;
  url?: string;
}

export interface PageOptimizationScoreSnapshot {
  score: number;
  recordedAt: string;
  source: 'page-analysis' | 'bulk-analysis' | 'strategy' | 'unknown';
}
