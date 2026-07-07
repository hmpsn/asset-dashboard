// @ds-rebuilt
import type { CompetitorAlertView, CompetitorAlertsResponse } from '../../../shared/types/competitor-alerts';

export interface DomainOverview {
  domain: string;
  organicKeywords: number;
  organicTraffic: number;
  organicCost: number;
  paidKeywords: number;
  paidTraffic: number;
  paidCost: number;
}

export interface BacklinksOverview {
  totalBacklinks: number;
  referringDomains: number;
}

export interface DomainKeyword {
  keyword: string;
  position: number;
  volume: number;
  difficulty: number;
  url: string;
  traffic: number;
}

export interface KeywordGap {
  keyword: string;
  volume: number;
  difficulty: number;
  competitorPosition: number;
  competitorDomain: string;
}

export interface CompetitiveDomain {
  domain: string;
  isOwn: boolean;
  overview: DomainOverview | null;
  backlinks: BacklinksOverview | null;
  topKeywords: DomainKeyword[];
  authorityRank?: number | null;
  top3Keywords?: number | null;
}

export interface CompetitiveIntelProviderFailure {
  area: 'overview' | 'backlinks' | 'keyword_gap' | 'top_keywords' | 'authority';
  provider: string;
  domain?: string;
}

export interface CompetitiveIntelResponse {
  domains: CompetitiveDomain[];
  keywordGaps: KeywordGap[];
  fetchedAt: string;
  degraded?: boolean;
  providerFailures?: CompetitiveIntelProviderFailure[];
}

export type CompetitorAlertWithInsight = CompetitorAlertView & {
  insightId?: string | null;
};

export type CompetitorAlertsResponseWithSnapshot = CompetitorAlertsResponse & {
  alerts: CompetitorAlertWithInsight[];
  lastSnapshotDate?: string | null;
};
