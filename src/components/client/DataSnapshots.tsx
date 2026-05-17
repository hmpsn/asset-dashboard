import {
  MousePointer, Eye, Smartphone, Monitor, Tablet,
  Globe, Users, ArrowRight,
} from 'lucide-react';
import { Icon } from '../ui/Icon';
import { CHART_SERIES_COLORS } from '../ui/constants';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4Comparison, GA4NewVsReturning,
  GA4OrganicOverview, GA4LandingPage,
} from './types';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { fmtNum as formatNum } from '../../utils/formatNumbers';
import { Button, SectionCard, TrendBadge } from '../ui';

// ─── Helpers ───

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 3) return null;
  const chartData = data.map((v, i) => ({ i, v }));
  return (
    <ResponsiveContainer width="100%" height={32}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`spark-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.08} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#spark-${color.replace('#', '')})`} dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function DeviceIcon({ device }: { device: string }) {
  const d = device.toLowerCase();
  if (d === 'mobile') return <Icon as={Smartphone} size="md" />;
  if (d === 'tablet') return <Icon as={Tablet} size="md" />;
  return <Icon as={Monitor} size="md" />;
}

// ─── Search Snapshot ───

interface SearchSnapshotProps {
  overview: SearchOverview;
  trend: PerformanceTrend[];
  comparison: SearchComparison | null;
  devices: { device: string; clicks: number; impressions: number; ctr: number; position: number }[];
  onViewMore: () => void;
}

export function SearchSnapshot({ overview, trend, comparison, devices, onViewMore }: SearchSnapshotProps) {
  const totalDevClicks = devices.reduce((s, d) => s + d.clicks, 0) || 1;

  return (
    <SectionCard
      title="Google Search"
      titleIcon={<Icon as={Globe} size="md" className="text-accent-info" />}
      action={
        <Button
          onClick={onViewMore}
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-h-0 p-0 gap-0.5 rounded-[var(--radius-sm)] t-caption-sm text-accent-brand hover:text-accent-brand hover:bg-transparent"
        >
          View details <Icon as={ArrowRight} size="sm" />
        </Button>
      }
    >
      <div className="space-y-4">

      {/* Key metrics with comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon as={MousePointer} size="sm" className="text-accent-info" />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Clicks</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="t-stat-sm text-accent-info">{formatNum(overview.totalClicks)}</span>
            {comparison && <TrendBadge value={comparison.changePercent.clicks} />}
          </div>
        </div>
        <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Icon as={Eye} size="sm" className="text-accent-info" />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Impressions</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="t-stat-sm text-accent-info">{formatNum(overview.totalImpressions)}</span>
            {comparison && <TrendBadge value={comparison.changePercent.impressions} />}
          </div>
        </div>
      </div>

      {/* Mini trend */}
      {trend.length > 3 && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Click trend</div>
          <MiniSparkline data={trend.map(t => t.clicks)} color={CHART_SERIES_COLORS.blue} />
        </div>
      )}

      {/* Top pages — simplified */}
      {overview.topPages.length > 0 && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">Most visited pages</div>
          <div className="space-y-1">
            {overview.topPages.slice(0, 5).map((p, i) => {
              let pagePath: string;
              try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
              if (pagePath === '/') pagePath = 'Homepage';
              return (
                <div key={i} className="flex items-center justify-between t-caption-sm py-1.5 px-2.5 rounded-[var(--radius-md)] bg-[var(--surface-3)]/30">
                  <span className="text-[var(--brand-text-bright)] truncate mr-2">{pagePath}</span>
                  <span className="text-accent-info font-medium flex-shrink-0">{formatNum(p.clicks)} clicks</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Device split */}
      {devices.length > 0 && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">How people find you</div>
          <div className="flex items-center gap-1.5 h-3 rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-3)]">
            {devices.map((d, i) => {
              const pct = (d.clicks / totalDevClicks) * 100;
              const colors = ['bg-blue-500', 'bg-teal-500', 'bg-amber-500'];
              return <div key={i} className={`h-full ${colors[i % colors.length]} first:rounded-l-[var(--radius-pill)] last:rounded-r-[var(--radius-pill)]`} style={{ width: `${pct}%` }} />;
            })}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {devices.map((d, i) => {
              const pct = Math.round((d.clicks / totalDevClicks) * 100);
              const colors = ['text-accent-info', 'text-accent-brand', 'text-accent-warning'];
              return (
                <span key={i} className={`flex items-center gap-1 t-caption-sm ${colors[i % colors.length]}`}>
                  <DeviceIcon device={d.device} />
                  <span className="capitalize">{d.device.toLowerCase()}</span>
                  <span className="text-[var(--brand-text-muted)]">{pct}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </SectionCard>
  );
}

// ─── Analytics Snapshot ───

interface AnalyticsSnapshotProps {
  overview: GA4Overview;
  trend: GA4DailyTrend[];
  topPages: GA4TopPage[];
  comparison: GA4Comparison | null;
  newVsReturning: GA4NewVsReturning[];
  onViewMore: () => void;
}

export function AnalyticsSnapshot({ overview, trend, topPages, comparison, newVsReturning, onViewMore }: AnalyticsSnapshotProps) {
  const newSeg = newVsReturning.find(s => s.segment === 'new');
  const retSeg = newVsReturning.find(s => s.segment === 'returning');

  return (
    <SectionCard
      title="Website Visitors"
      titleIcon={<Icon as={Users} size="md" className="text-accent-brand" />}
      action={
        <Button
          onClick={onViewMore}
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto min-h-0 p-0 gap-0.5 rounded-[var(--radius-sm)] t-caption-sm text-accent-brand hover:text-accent-brand hover:bg-transparent"
        >
          View details <Icon as={ArrowRight} size="sm" />
        </Button>
      }
    >
      <div className="space-y-4">

      {/* Key metrics with comparison */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Visitors</div>
          <div className="flex items-center gap-1.5">
            <span className="t-stat-sm text-accent-info">{formatNum(overview.totalUsers)}</span>
            {comparison && <TrendBadge value={comparison.changePercent.users} />}
          </div>
        </div>
        <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Sessions</div>
          <div className="flex items-center gap-1.5">
            <span className="t-stat-sm text-accent-info">{formatNum(overview.totalSessions)}</span>
            {comparison && <TrendBadge value={comparison.changePercent.sessions} />}
          </div>
        </div>
        <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Page Views</div>
          <div className="flex items-center gap-1.5">
            <span className="t-stat-sm text-[var(--brand-text-bright)]">{formatNum(overview.totalPageviews)}</span>
            {comparison && <TrendBadge value={comparison.changePercent.pageviews} />}
          </div>
        </div>
      </div>

      {/* Visitor trend */}
      {trend.length > 3 && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1">Visitor trend</div>
          <MiniSparkline data={trend.map(t => t.users)} color={CHART_SERIES_COLORS.blue} />
        </div>
      )}

      {/* New vs Returning */}
      {newSeg && retSeg && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">New vs returning visitors</div>
          <div className="flex items-center gap-1.5 h-3 rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-3)]">
            <div className="h-full bg-teal-500 rounded-l-[var(--radius-pill)]" style={{ width: `${newSeg.percentage}%` }} />
            <div className="h-full bg-blue-500 rounded-r-[var(--radius-pill)]" style={{ width: `${retSeg.percentage}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 t-caption-sm text-accent-brand">
              New <span className="text-[var(--brand-text-muted)]">{newSeg.percentage}%</span>
            </span>
            <span className="flex items-center gap-1 t-caption-sm text-accent-info">
              Returning <span className="text-[var(--brand-text-muted)]">{retSeg.percentage}%</span>
            </span>
          </div>
        </div>
      )}

      {/* Top landing pages */}
      {topPages.length > 0 && (
        <div>
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">Top pages by views</div>
          <div className="space-y-1">
            {topPages.slice(0, 5).map((p, i) => {
              const label = p.path === '/' ? 'Homepage' : p.path;
              return (
                <div key={i} className="flex items-center justify-between t-caption-sm py-1.5 px-2.5 rounded-[var(--radius-md)] bg-[var(--surface-3)]/30">
                  <span className="text-[var(--brand-text-bright)] truncate mr-2 font-mono">{label}</span>
                  <span className="text-accent-brand font-medium flex-shrink-0">{formatNum(p.pageviews)} views</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </SectionCard>
  );
}

// ─── Organic Insight Panel (for Analytics tab) ───

interface OrganicInsightProps {
  organic: GA4OrganicOverview;
  landingPages: GA4LandingPage[];
  newVsReturning: GA4NewVsReturning[];
}

export function OrganicInsight({ organic, landingPages, newVsReturning }: OrganicInsightProps) {
  const newSeg = newVsReturning.find(s => s.segment === 'new');
  const retSeg = newVsReturning.find(s => s.segment === 'returning');

  return (
    <div className="space-y-6">
      {/* Organic overview row */}
      <SectionCard title="Organic Search Traffic" titleIcon={<div className="w-6 h-6 rounded-[var(--radius-md)] bg-emerald-500/15 flex items-center justify-center"><Icon as={Globe} size="md" className="text-accent-success" /></div>} action={<span className="t-caption-sm text-[var(--brand-text-muted)]">{organic.dateRange.start} — {organic.dateRange.end}</span>}>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Organic visitors</div>
            <div className="t-stat-sm text-accent-success">{formatNum(organic.organicUsers)}</div>
            <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{organic.shareOfTotalUsers}% of all traffic</div>
          </div>
          <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Organic sessions</div>
            <div className="t-stat-sm text-accent-info">{formatNum(organic.organicSessions)}</div>
          </div>
          <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Engagement rate</div>
            <div className="t-stat-sm text-accent-brand">{organic.engagementRate}%</div>
          </div>
          <div className="bg-[var(--surface-3)]/40 rounded-[var(--radius-md)] px-3 py-2.5">
            <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Avg time on site</div>
            <div className="t-stat-sm text-accent-warning">
              {Math.floor(organic.avgEngagementTime / 60)}m {Math.floor(organic.avgEngagementTime % 60)}s
            </div>
          </div>
        </div>

        {/* Organic share bar */}
        <div className="mt-4">
          <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">Share of total traffic from organic search</div>
          <div className="h-3 rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-3)] flex">
            <div className="h-full bg-emerald-500 rounded-l-[var(--radius-pill)] transition-all" style={{ width: `${organic.shareOfTotalUsers}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="t-caption-sm text-accent-success">Organic {organic.shareOfTotalUsers}%</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">Other {(100 - organic.shareOfTotalUsers).toFixed(1)}%</span>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* New vs returning */}
        {newSeg && retSeg && (
          <SectionCard title="New vs Returning Visitors">
            <div className="flex items-center gap-6 mb-4">
              <div className="flex-1">
                <div className="t-caption-sm text-accent-brand mb-0.5">New visitors</div>
                <div className="t-stat text-accent-brand">{newSeg.percentage}%</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{formatNum(newSeg.users)} users</div>
              </div>
              <div className="flex-1">
                <div className="t-caption-sm text-accent-info mb-0.5">Returning visitors</div>
                <div className="t-stat text-accent-info">{retSeg.percentage}%</div>
                <div className="t-caption-sm text-[var(--brand-text-muted)]">{formatNum(retSeg.users)} users</div>
              </div>
            </div>
            <div className="h-4 rounded-[var(--radius-pill)] overflow-hidden bg-[var(--surface-3)] flex">
              <div className="h-full bg-teal-500 rounded-l-[var(--radius-pill)]" style={{ width: `${newSeg.percentage}%` }} />
              <div className="h-full bg-blue-500 rounded-r-[var(--radius-pill)]" style={{ width: `${retSeg.percentage}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-md)] px-3 py-2">
                <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">New bounce rate</div>
                <div className={`t-stat-sm ${newSeg.bounceRate > 60 ? 'text-accent-danger' : 'text-accent-success'}`}>{newSeg.bounceRate}%</div>
              </div>
              <div className="bg-[var(--surface-3)]/30 rounded-[var(--radius-md)] px-3 py-2">
                <div className="t-caption-sm text-[var(--brand-text-muted)] mb-0.5">Returning bounce rate</div>
                <div className={`t-stat-sm ${retSeg.bounceRate > 60 ? 'text-accent-danger' : 'text-accent-success'}`}>{retSeg.bounceRate}%</div>
              </div>
            </div>
          </SectionCard>
        )}

        {/* Top organic landing pages */}
        {landingPages.length > 0 && (
          <SectionCard title="Top Organic Landing Pages">

            <div className="space-y-1 max-h-[350px] overflow-y-auto">
              {landingPages.slice(0, 15).map((lp, i) => {
                const label = lp.landingPage === '/' ? 'Homepage' : lp.landingPage;
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)]/50 transition-colors">
                    <span className="t-caption-sm text-[var(--brand-text-muted)] w-4 text-right">{i + 1}</span>
                    <span className="t-caption text-[var(--brand-text-bright)] flex-1 truncate font-mono">{label}</span>
                    <span className="t-caption text-accent-success font-medium tabular-nums flex-shrink-0">{formatNum(lp.sessions)}</span>
                    <span className={`t-caption-sm flex-shrink-0 w-12 text-right ${lp.bounceRate > 70 ? 'text-accent-danger' : 'text-[var(--brand-text-muted)]'}`}>{lp.bounceRate}%</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-4 mt-2 t-caption-sm text-[var(--brand-text-muted)]">
              <span>Sessions</span>
              <span>Bounce</span>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
