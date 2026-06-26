import type { LocalSeoKeywordIntent } from '../../../shared/types/local-seo.js';

export interface LocalSeoKeywordCandidate {
  keyword: string;
  normalizedKeyword: string;
  source: 'explicit' | 'strategy' | 'tracking' | 'page_assignment' | 'content_gap' | 'local_variant';
  sourceLabel: string;
  detail?: string;
  pagePath?: string;
  pageTitle?: string;
  /**
   * The local market this candidate was generated for, when the source is
   * market-scoped (i.e. local variants tied to a specific market's city/state,
   * or intent-modifier variants tied to the primary market). Market-agnostic
   * sources (explicit, strategy, tracking, page assignments, content gaps) leave
   * this `null`/undefined — never fabricate a market for them. Threaded onto the
   * `localSeo` intelligence slice so per-market relevance (stratified prompt
   * sampling, market-scoped candidate selection) works instead of falling back
   * to flat top-N. See docs/rules/local-seo-visibility.md (intelligence boundary).
   */
  marketId?: string | null;
  volume?: number;
  difficulty?: number;
  selected: boolean;
  score: number;
  reasons: string[];
  intent: LocalSeoKeywordIntent;
}
