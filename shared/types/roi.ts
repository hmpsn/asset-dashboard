export interface PageROI {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  clicks: number;
  impressions: number;
  cpc: number;
  trafficValue: number;
  position: number | null;
}

export interface ContentItemROI {
  requestId: string;
  topic: string;
  targetKeyword: string;
  targetPageId: string;
  targetPageSlug?: string;
  status: string;
  clicks: number;
  impressions: number;
  trafficValue: number;
  source?: 'request' | 'matrix';
}

export interface ROIData {
  organicTrafficValue: number;
  adSpendEquivalent: number;
  growthPercent: number | null;
  pageBreakdown: PageROI[];
  totalClicks: number;
  totalImpressions: number;
  avgCPC: number;
  trackedPages: number;
  contentROI: {
    totalContentSpend: number;
    totalContentValue: number;
    roi: number;
    postsPublished: number;
  } | null;
  contentItems: ContentItemROI[];
  computedAt: string;
}
