// src/hooks/admin/useAnalyticsOverview.ts
import { useMemo } from 'react';
import { useAdminSearch } from './useAdminSearch';
import { useAdminGA4 } from './useAdminGA4';
import { useAnalyticsAnnotations, useCreateAnnotation } from './useAnalyticsAnnotations';
import type { Annotation } from './useAnalyticsAnnotations';

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

export function useAnalyticsOverview(
  workspaceId: string,
  siteId: string | undefined,
  gscPropertyUrl: string | undefined,
  ga4PropertyId: string | undefined,
  days: number,
): AnalyticsOverviewData {
  const gsc = useAdminSearch(siteId ?? '', gscPropertyUrl, days);
  const ga4 = useAdminGA4(workspaceId, days, !!ga4PropertyId);
  const { data: annotations = [] } = useAnalyticsAnnotations(workspaceId);
  const createAnnotation = useCreateAnnotation(workspaceId);

  const hasGsc = !!gscPropertyUrl && !!gsc.overview;
  const hasGa4 = !!ga4PropertyId && !!ga4.overview;

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

    for (const t of gsc.trend) {
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
    for (const t of ga4.trend) {
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
  }, [gsc.trend, ga4.trend]);

  return {
    gscClicks: gsc.overview?.totalClicks ?? 0,
    gscImpressions: gsc.overview?.totalImpressions ?? 0,
    gscPosition: gsc.overview?.avgPosition ?? 0,
    gscClicksDelta: gsc.comparison?.changePercent.clicks ?? null,
    gscImpressionsDelta: gsc.comparison?.changePercent.impressions ?? null,
    gscPositionDelta: gsc.comparison?.change.position ?? null,
    ga4Users: ga4.overview?.totalUsers ?? 0,
    ga4Sessions: ga4.overview?.totalSessions ?? 0,
    ga4BounceRate: ga4.overview?.bounceRate ?? 0,
    ga4UsersDelta: ga4.comparison?.changePercent.users ?? null,
    ga4SessionsDelta: ga4.comparison?.changePercent.sessions ?? null,
    ga4BounceRateDelta: ga4.comparison
      ? Math.round((ga4.comparison.current.bounceRate - ga4.comparison.previous.bounceRate) * 10) / 10
      : null,
    trendData,
    annotations,
    createAnnotation,
    isLoading: gsc.isLoading || ga4.isLoading,
    hasGsc,
    hasGa4,
  };
}
