import type { MetricsSource } from '../../../shared/types/keywords.js';
import type { AdminKeywordFeedbackListRow } from '../../../shared/types/keyword-feedback';

/** Page→keyword mapping row as rendered by the Strategy page. Moved verbatim from KeywordStrategy.tsx. */
export interface PageKeywordMap {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent?: string;
  currentPosition?: number;
  impressions?: number;
  clicks?: number;
  volume?: number;
  difficulty?: number;
  cpc?: number;
  metricsSource?: MetricsSource;
  validated?: boolean;
  secondaryMetrics?: { keyword: string; volume: number; difficulty: number }[];
}

/** Derived metrics computed from a strategy + feedback rows. Pure function of inputs. */
export interface StrategyMetrics {
  pageMap: PageKeywordMap[];
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  avgPos: number;
  totalImpressions: number;
  totalClicks: number;
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  lowHangingFruit: PageKeywordMap[];
  intentCounts: Record<string, number>;
  declinedFeedback: AdminKeywordFeedbackListRow[];
  requestedFeedback: AdminKeywordFeedbackListRow[];
  approvedFeedback: AdminKeywordFeedbackListRow[];
  feedbackNewerThanStrategy: boolean;
}

/** Minimum monthly search volume to display a strategy card. Below this is noise. */
export const VOLUME_THRESHOLD = 10;

export type SeoDataMode = 'none' | 'quick' | 'full';

// ── Leaf component prop contracts (pre-committed; leaves import from here) ──

export interface StrategyHeaderProps {
  isRealStrategy: boolean;
  generatedAt: string | null | undefined;
  pageCount: number;
  generating: boolean;
  localSyncApplies: boolean;
  localNeedsRefresh: boolean;
  refreshPending: boolean;
  onIncremental: () => void;
  onFullRefresh: () => void;
  onGenerate: () => void;
}

export interface StrategyFeedbackNudgeProps {
  requestedCount: number;
  declinedCount: number;
}

export interface ClientKeywordFeedbackProps {
  rows: AdminKeywordFeedbackListRow[];
  requested: AdminKeywordFeedbackListRow[];
  declined: AdminKeywordFeedbackListRow[];
  approved: AdminKeywordFeedbackListRow[];
  addPending: boolean;
  addError: string | null;
  onAdd: (keyword: string) => void;
  onDismissError: () => void;
}

export interface StrategySettingsProps {
  workspaceId: string;
  isAuxLoading: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (v: boolean) => void;
  seoDataAvailable: boolean;
  seoDataMode: SeoDataMode;
  setSeoDataMode: (m: SeoDataMode) => void;
  maxPages: number;
  setMaxPages: (n: number) => void;
  competitors: string;
  setCompetitors: (v: string) => void;
  businessContext: string;
  setBusinessContext: (v: string) => void;
  contextOpen: boolean;
  setContextOpen: (v: boolean) => void;
  discoveringCompetitors: boolean;
  discoverError: string | null;
  onDiscoverCompetitors: () => void;
}

export interface StrategyStalenessNudgesProps {
  hasVolumeValidation: boolean;
  localSyncApplies: boolean;
  strategyStaleVsLocal: boolean;
  lastLocalRefreshAt: string | null | undefined;
  lastStrategyGeneratedAt: string | null | undefined;
  dismissedRefreshAt: string | null;
  onDismiss: () => void;
  onGenerate: () => void;
}

export interface StrategyStatGridProps {
  filteredPageMap: PageKeywordMap[];
  totalPageCount: number;
  totalImpressions: number;
  totalClicks: number;
  ranked: PageKeywordMap[];
  avgPos: number;
}

export interface RankingDistributionProps {
  filteredPageMap: PageKeywordMap[];
  ranked: PageKeywordMap[];
  top3: PageKeywordMap[];
  top10: PageKeywordMap[];
  top20: PageKeywordMap[];
  beyond20: PageKeywordMap[];
  notRankingCount: number;
  intentCounts: Record<string, number>;
}

export interface SiteTargetKeywordsProps {
  workspaceId: string;
  siteKeywords: string[];
  siteKeywordMetrics?: { keyword: string; volume: number; difficulty: number }[];
  trackedKeywords: Set<string>;
  trackingPending: Set<string>;
  trackingErrors: Map<string, string>;
  onTrack: (kw: string) => void;
}

export interface KeywordOpportunitiesProps {
  opportunities: string[];
}

export interface StrategyHowItWorksProps {
  displayedSeoDataMode?: string;
  hasAnyRanking: boolean;
}
