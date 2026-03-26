import { useQuery } from '@tanstack/react-query';
import { get } from '../../api/client';
import { queryKeys } from '../../lib/queryKeys';

interface PageROI {
  pagePath: string;
  pageTitle: string;
  primaryKeyword: string;
  clicks: number;
  impressions: number;
  cpc: number;
  trafficValue: number;
  position: number | null;
}

interface ContentItemROI {
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

interface ROIData {
  organicTrafficValue: number;
  adSpendEquivalent: number;
  growthPercent: number | null;
  pageBreakdown: PageROI[];
  totalClicks: number;
  totalImpressions: number;
  avgCPC: number;
  trackedPages: number;
  contentROI: { totalContentSpend: number; totalContentValue: number; roi: number; postsPublished: number } | null;
  contentItems: ContentItemROI[];
  computedAt: string;
}

export function useAdminROI(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.admin.roi(workspaceId),
    queryFn: () => get<ROIData>(`/api/public/roi/${workspaceId}`),
    staleTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    enabled: !!workspaceId,
  });
}
