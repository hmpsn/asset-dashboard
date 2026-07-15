// @ds-rebuilt
import type {
  GA4Comparison,
  GA4ConversionSummary,
  GA4CountryBreakdown,
  GA4DailyTrend,
  GA4DeviceBreakdown,
  GA4LandingPage,
  GA4NewVsReturning,
  GA4OrganicOverview,
  GA4Overview,
  GA4TopPage,
  GA4TopSource,
  PerformanceTrend,
  SearchComparison,
  SearchCountryBreakdown,
  SearchDeviceBreakdown,
  SearchOverview,
  SearchTypeBreakdown,
} from '../../../shared/types/analytics';

export type SearchTrafficLens = 'overview' | 'search' | 'traffic' | 'annotations';

export type SearchTrafficTableMode = 'queries' | 'pages';

export type AnnotationCategory = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

export interface RebuiltAnnotation {
  id: string;
  workspaceId: string;
  date: string;
  label: string;
  category: string;
  createdBy?: string;
  createdAt: string;
  pageUrl?: string | null;
}

export type BrandedDemandStatus = 'ready' | 'unavailable' | 'error';

export interface BrandedDemandSplit {
  status: BrandedDemandStatus;
  /** Branded impressions divided by all Search Console impressions, expressed as a percentage. */
  denominator: 'impressions';
  tokens?: string[];
  queryRowsSampled?: number;
  total?: { clicks: number; impressions: number };
  branded?: { clicks: number; impressions: number; sharePct: number };
  nonBranded?: { clicks: number; impressions: number; sharePct: number };
  error?: string;
}

export type SearchOverviewWithDemand = SearchOverview & {
  brandedDemand?: BrandedDemandSplit;
};

export interface SearchTrafficSearchData {
  overview: SearchOverviewWithDemand | null;
  trend: PerformanceTrend[];
  priorTrend: PerformanceTrend[];
  devices: SearchDeviceBreakdown[];
  countries: SearchCountryBreakdown[];
  searchTypes: SearchTypeBreakdown[];
  comparison: SearchComparison | null;
  isLoading: boolean;
  priorIsLoading: boolean;
  error: string | null;
  refetchPriorTrend: () => void;
}

export interface SearchTrafficGa4Data {
  overview: GA4Overview | null;
  trend: GA4DailyTrend[];
  topPages: GA4TopPage[];
  sources: GA4TopSource[];
  devices: GA4DeviceBreakdown[];
  countries: GA4CountryBreakdown[];
  comparison: GA4Comparison | null;
  newVsReturning: GA4NewVsReturning[];
  organic: GA4OrganicOverview | null;
  landingPages: GA4LandingPage[];
  conversions: GA4ConversionSummary[];
  isLoading: boolean;
  error: string | null;
}

