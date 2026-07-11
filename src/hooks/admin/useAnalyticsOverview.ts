// src/hooks/admin/useAnalyticsOverview.ts
import { useMemo } from 'react';
import { useAdminSearch, type AdminSearchData } from './useAdminSearch';
import { useAdminGA4, type AdminGA4Data } from './useAdminGA4';
import { useAnalyticsAnnotations, useCreateAnnotation } from './useAnalyticsAnnotations';
import type { Annotation } from './useAnalyticsAnnotations';

const OVERVIEW_GSC_METRICS = ['overview', 'trend', 'comparison'] as const;
const OVERVIEW_GA4_METRICS = ['overview', 'trend', 'comparison'] as const;

export interface AnalyticsOverviewData {
  // GSC headline
  gscClicks: number;
  gscImpressions: number;
  gscPosition: number;
  gscClicksDelta: number | null;
  gscImpressionsDelta: number | null;
  gscPositionDelta: number | null;
  // GA4 headline
  ga4Users: number;
  ga4Sessions: number;
  ga4BounceRate: number;
  ga4UsersDelta: number | null;
  ga4SessionsDelta: number | null;
  ga4BounceRateDelta: number | null;
  // Trend data (merged for chart)
  trendData: Array<{
    date: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    users: number;
    sessions: number;
    pageviews: number;
  }>;
  // Annotations
  annotations: Annotation[];
  createAnnotation: ReturnType<typeof useCreateAnnotation>;
  // Loading state
  isLoading: boolean;
  hasGsc: boolean;
  hasGa4: boolean;
}

interface AnalyticsOverviewConnections {
  gsc: boolean;
  ga4: boolean;
}

export function useAnalyticsOverviewFromData(
  workspaceId: string,
  gsc: AdminSearchData | null,
  ga4: AdminGA4Data | null,
  connections: AnalyticsOverviewConnections,
): AnalyticsOverviewData {
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const hasGsc = connections.gsc && !!gsc?.overview;
  const hasGa4 = connections.ga4 && !!ga4?.overview;

  // Merge GSC trend + GA4 trend into unified date-keyed array
  const trendData = useMemo(() => {
    const byDate = new Map<string, {
      date: string;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
      users: number;
      sessions: number;
      pageviews: number;
    }>();

    for (const t of connections.gsc ? gsc?.trend ?? [] : []) {
      byDate.set(t.date, {
        date: t.date,
        clicks: t.clicks,
        impressions: t.impressions,
        ctr: Math.round(t.ctr * 10) / 10, // Already a percentage from GSC API, just round
        position: Math.round(t.position * 10) / 10, // Round to 1 decimal
        users: 0,
        sessions: 0,
        pageviews: 0,
      });
    }
    for (const t of connections.ga4 ? ga4?.trend ?? [] : []) {
      const existing = byDate.get(t.date);
      if (existing) {
        existing.users = t.users;
        existing.sessions = t.sessions;
        existing.pageviews = t.pageviews;
      } else {
        byDate.set(t.date, {
          date: t.date,
          clicks: 0,
          impressions: 0,
          ctr: 0,
          position: 0,
          users: t.users,
          sessions: t.sessions,
          pageviews: t.pageviews,
        });
      }
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [connections.ga4, connections.gsc, ga4?.trend, gsc?.trend]);

  return {
    gscClicks: connections.gsc ? gsc?.overview?.totalClicks ?? 0 : 0,
    gscImpressions: connections.gsc ? gsc?.overview?.totalImpressions ?? 0 : 0,
    gscPosition: connections.gsc ? gsc?.overview?.avgPosition ?? 0 : 0,
    gscClicksDelta: connections.gsc ? gsc?.comparison?.changePercent.clicks ?? null : null,
    gscImpressionsDelta: connections.gsc ? gsc?.comparison?.changePercent.impressions ?? null : null,
    gscPositionDelta: connections.gsc ? gsc?.comparison?.change.position ?? null : null,
    ga4Users: connections.ga4 ? ga4?.overview?.totalUsers ?? 0 : 0,
    ga4Sessions: connections.ga4 ? ga4?.overview?.totalSessions ?? 0 : 0,
    ga4BounceRate: connections.ga4 ? ga4?.overview?.bounceRate ?? 0 : 0,
    ga4UsersDelta: connections.ga4 ? ga4?.comparison?.changePercent.users ?? null : null,
    ga4SessionsDelta: connections.ga4 ? ga4?.comparison?.changePercent.sessions ?? null : null,
    ga4BounceRateDelta: connections.ga4 && ga4?.comparison
      ? Math.round((ga4.comparison.current.bounceRate - ga4.comparison.previous.bounceRate) * 10) / 10
      : null,
    trendData,
    annotations,
    createAnnotation,
    isLoading: (connections.gsc && !!gsc?.isLoading) || (connections.ga4 && !!ga4?.isLoading),
    hasGsc,
    hasGa4,
  };
}

export function useAnalyticsOverview(
  workspaceId: string,
  siteId: string | undefined,
  gscPropertyUrl: string | undefined,
  ga4PropertyId: string | undefined,
  days: number,
): AnalyticsOverviewData {
  const gsc = useAdminSearch(workspaceId, siteId ?? '', gscPropertyUrl, days, {
    metrics: OVERVIEW_GSC_METRICS,
  });
  const ga4 = useAdminGA4(workspaceId, days, !!ga4PropertyId, OVERVIEW_GA4_METRICS);
  return useAnalyticsOverviewFromData(workspaceId, gsc, ga4, {
    gsc: !!gscPropertyUrl,
    ga4: !!ga4PropertyId,
  });
}
