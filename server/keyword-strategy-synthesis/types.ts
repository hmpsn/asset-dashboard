import type { KeywordPoolCandidate } from '../keyword-strategy-helpers.js';
import type { KeywordSearchIntent } from '../../shared/types/keywords.js';

export interface StrategyPageMapEntry {
  pagePath: string;
  pageTitle?: string;
  primaryKeyword: string;
  secondaryKeywords?: string[];
  intent?: KeywordSearchIntent;
  searchIntent?: KeywordSearchIntent;
  intentSource?: string;
  rationale?: string;
  impressions?: number;
  clicks?: number;
  currentPosition?: number;
  previousPosition?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  validated?: boolean;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  cpcSource?: string;
  metricsSource?: string;
  urlLevelKeywords?: { keyword: string; position: number; volume: number; difficulty: number; cpc: number; traffic?: number; url?: string }[];
  urlLevelKeywordSource?: 'semrush' | 'dataforseo';
  gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[];
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
  analysisGeneratedAt?: string;
}

export interface StrategyContentGap {
  topic?: string;
  targetKeyword: string;
  intent?: KeywordSearchIntent;
  priority?: string;
  rationale?: string;
  suggestedPageType?: string;
  competitorProof?: string;
  impressions?: number;
  volume?: number;
  difficulty?: number;
  trendDirection?: string;
  serpFeatures?: string[];
  serpTargeting?: string[];
  questionKeywords?: string[];
  opportunityScore?: number;
  /** Cost-per-click from SEO provider; feeds commercial value in downstream scoring. */
  cpc?: number;
  cpcSource?: string;
  intentSource?: string;
  /** SEO Generation Quality P2: re-admitted by the deterministic backfill floor. */
  backfilled?: boolean;
  /**
   * Transient marker for client-requested gaps injected by the hard guarantee.
   * It is intentionally omitted from persistence field lists.
   */
  requested?: boolean;
}

export interface StrategyQuickWin {
  pagePath: string;
  action: string;
  estimatedImpact?: string;
  rationale?: string;
  roiScore?: number;
}

export interface StrategyKeywordFix {
  pagePath: string;
  newPrimaryKeyword: string;
}

export interface StrategyOutput {
  siteKeywords?: string[];
  opportunities?: string[];
  contentGaps?: StrategyContentGap[];
  quickWins?: StrategyQuickWin[];
  keywordFixes?: StrategyKeywordFix[];
  pageMap?: StrategyPageMapEntry[];
}

export type KeywordStrategyKeywordPool = Map<string, KeywordPoolCandidate>;

export interface PageMapping {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: KeywordSearchIntent;
  intentSource?: string;
  currentPosition?: number;
  previousPosition?: number;
  impressions?: number;
  clicks?: number;
  gscKeywords?: { query: string; clicks: number; impressions: number; position: number }[];
  volume?: number;
  difficulty?: number;
  cpc?: number;
  cpcSource?: string;
  metricsSource?: string;
  urlLevelKeywords?: { keyword: string; position: number; volume: number; difficulty: number; cpc: number; traffic?: number; url?: string }[];
  urlLevelKeywordSource?: 'semrush' | 'dataforseo';
  serpFeatures?: string[];
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
  validated?: boolean;
  analysisGeneratedAt?: string;
  _parseError?: boolean;
}

export interface MasterStrategyData {
  siteKeywords?: string[];
  opportunities?: string[];
  contentGaps?: Array<StrategyContentGap & { targetKeyword: string; topic: string }>;
  quickWins?: StrategyQuickWin[];
  keywordFixes?: StrategyKeywordFix[];
}
