import type { MetricsSource } from '../../../shared/types/keywords.js';

export interface KeywordPresence {
  inTitle: boolean;
  inMeta: boolean;
  inContent: boolean;
  inSlug: boolean;
}

export interface KeywordData {
  primaryKeyword: string;
  primaryKeywordPresence: KeywordPresence;
  secondaryKeywords: string[];
  longTailKeywords: string[];
  searchIntent: string;
  searchIntentConfidence: number;
  contentGaps: string[];
  competitorKeywords: string[];
  optimizationScore: number;
  optimizationIssues: string[];
  recommendations: string[];
  estimatedDifficulty: string;
  keywordDifficulty: number;
  monthlyVolume: number;
  topicCluster: string;
  metricsSource?: MetricsSource;
  hasProviderMetrics?: boolean;
}

export interface ContentScore {
  wordCount: number;
  sentenceCount: number;
  avgWordsPerSentence: number;
  readabilityScore: number;
  readabilityGrade: string;
  headings: { total: number; h1: number; h2: number; texts: string[] };
  topKeywords: Array<{ word: string; count: number; density: number }>;
  titleLength: number;
  descLength: number;
  titleOk: boolean;
  descOk: boolean;
}

export interface SeoCopy {
  seoTitle: string;
  metaDescription: string;
  h1: string;
  introParagraph: string;
  internalLinkSuggestions?: { targetPath: string; anchorText: string; context: string }[];
  changes?: string[];
}

export interface KeywordEditDraft {
  primary: string;
  secondary: string;
}

export type SortBy = 'priority' | 'position' | 'volume' | 'score';
export type SortDir = 'asc' | 'desc';

export interface BulkProgress {
  done: number;
  total: number;
}
