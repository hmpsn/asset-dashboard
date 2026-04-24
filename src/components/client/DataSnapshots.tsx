import {
  TrendingUp, TrendingDown, MousePointer, Eye, Smartphone, Monitor, Tablet,
  Globe, Users, ArrowRight,
} from 'lucide-react';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4Comparison, GA4NewVsReturning,
  GA4OrganicOverview, GA4LandingPage,
} from './types';
import { ResponsiveContainer, AreaChart, Area } from 'recharts';
import { fmtNum as formatNum } from '../../utils/formatNumbers';
import { SectionCard } from '../ui';

// ─── Helpers ───

function ChangeBadge({ value, suffix = '%', invert = false }: { value: number; suffix?: string; invert?: boolean }) {
  if (value === 0) return null;
  const positive = invert ? value < 0 : value > 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-medium ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
      {positive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(value)}{suffix}
    </span>
  );
}

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
  if (d === 'mobile') return <Smartphone className="w-3.5 h-3.5" />;
  if (d === 'tablet') return <Tablet className="w-3.5 h-3.5" />;
  return <Monitor className="w-3.5 h-3.5" />;
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
    <div className="bg-zinc-900 border border-zinc-800 p-4 space-y-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-500/15 flex items-center justify-center">
            <Globe className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <span className="text-xs font-medium text-zinc-300">Google Search</span>
        </div>
        <button onClick={onViewMore} className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-0.5">
          View details <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Key metrics with comparison */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <MousePointer className="w-3 h-3 text-blue-400" />
            <span className="text-[11px] text-zinc-500">Clicks</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-blue-400">{formatNum(overview.totalClicks)}</span>
            {comparison && <ChangeBadge value={comparison.changePercent.clicks} />}
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Eye className="w-3 h-3 text-blue-400" />
            <span className="text-[11px] text-zinc-500">Impressions</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-blue-400">{formatNum(overview.totalImpressions)}</span>
            {comparison && <ChangeBadge value={comparison.changePercent.impressions} />}
          </div>
        </div>
      </div>

      {/* Mini trend */}
      {trend.length > 3 && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1">Click trend</div>
          <MiniSparkline data={trend.map(t => t.clicks)} color="#60a5fa" />
        </div>
      )}

      {/* Top pages — simplified */}
      {overview.topPages.length > 0 && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1.5">Most visited pages</div>
          <div className="space-y-1">
            {overview.topPages.slice(0, 5).map((p, i) => {
              let pagePath: string;
              try { pagePath = new URL(p.page).pathname; } catch { pagePath = p.page; }
              if (pagePath === '/') pagePath = 'Homepage';
              return (
                <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                  <span className="text-zinc-300 truncate mr-2">{pagePath}</span>
                  <span className="text-blue-400 font-medium flex-shrink-0">{formatNum(p.clicks)} clicks</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Device split */}
      {devices.length > 0 && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1.5">How people find you</div>
          <div className="flex items-center gap-1.5 h-3 rounded-full overflow-hidden bg-zinc-800">
            {devices.map((d, i) => {
              const pct = (d.clicks / totalDevClicks) * 100;
              const colors = ['bg-blue-500', 'bg-teal-500', 'bg-amber-500'];
              return <div key={i} className={`h-full ${colors[i % colors.length]} first:rounded-l-full last:rounded-r-full`} style={{ width: `${pct}%` }} />;
            })}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
            {devices.map((d, i) => {
              const pct = Math.round((d.clicks / totalDevClicks) * 100);
              const colors = ['text-blue-400', 'text-teal-400', 'text-amber-400'];
              return (
                <span key={i} className={`flex items-center gap-1 text-[11px] ${colors[i % colors.length]}`}>
                  <DeviceIcon device={d.device} />
                  <span className="capitalize">{d.device.toLowerCase()}</span>
                  <span className="text-zinc-500">{pct}%</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
    <div className="bg-zinc-900 border border-zinc-800 p-4 space-y-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-teal-500/15 flex items-center justify-center">
            <Users className="w-3.5 h-3.5 text-teal-400" />
          </div>
          <span className="text-xs font-medium text-zinc-300">Website Visitors</span>
        </div>
        <button onClick={onViewMore} className="text-[11px] text-teal-400 hover:text-teal-300 flex items-center gap-0.5">
          View details <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      {/* Key metrics with comparison */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">Visitors</div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-teal-400">{formatNum(overview.totalUsers)}</span>
            {comparison && <ChangeBadge value={comparison.changePercent.users} />}
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">Sessions</div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-blue-400">{formatNum(overview.totalSessions)}</span>
            {comparison && <ChangeBadge value={comparison.changePercent.sessions} />}
          </div>
        </div>
        <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
          <div className="text-[11px] text-zinc-500 mb-0.5">Page Views</div>
          <div className="flex items-center gap-1.5">
            <span className="text-lg font-bold text-zinc-200">{formatNum(overview.totalPageviews)}</span>
            {comparison && <ChangeBadge value={comparison.changePercent.pageviews} />}
          </div>
        </div>
      </div>

      {/* Visitor trend */}
      {trend.length > 3 && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1">Visitor trend</div>
          <MiniSparkline data={trend.map(t => t.users)} color="#2dd4bf" />
        </div>
      )}

      {/* New vs Returning */}
      {newSeg && retSeg && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1.5">New vs returning visitors</div>
          <div className="flex items-center gap-1.5 h-3 rounded-full overflow-hidden bg-zinc-800">
            <div className="h-full bg-teal-500 rounded-l-full" style={{ width: `${newSeg.percentage}%` }} />
            <div className="h-full bg-blue-500 rounded-r-full" style={{ width: `${retSeg.percentage}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="flex items-center gap-1 text-[11px] text-teal-400">
              New <span className="text-zinc-500">{newSeg.percentage}%</span>
            </span>
            <span className="flex items-center gap-1 text-[11px] text-blue-400">
              Returning <span className="text-zinc-500">{retSeg.percentage}%</span>
            </span>
          </div>
        </div>
      )}

      {/* Top landing pages */}
      {topPages.length > 0 && (
        <div>
          <div className="text-[11px] text-zinc-500 mb-1.5">Top pages by views</div>
          <div className="space-y-1">
            {topPages.slice(0, 5).map((p, i) => {
              const label = p.path === '/' ? 'Homepage' : p.path;
              return (
                <div key={i} className="flex items-center justify-between text-[11px] py-1.5 px-2.5 rounded-lg bg-zinc-800/30">
                  <span className="text-zinc-300 truncate mr-2 font-mono">{label}</span>
                  <span className="text-teal-400 font-medium flex-shrink-0">{formatNum(p.pageviews)} views</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
      <SectionCard title="Organic Search Traffic" titleIcon={<Globe className="w-3.5 h-3.5 text-emerald-400" />} titleExtra={<span className="text-[11px] text-zinc-500">{organic.dateRange.start} — {organic.dateRange.end}</span>}>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">Organic visitors</div>
            <div className="text-lg font-bold text-emerald-400">{formatNum(organic.organicUsers)}</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">{organic.shareOfTotalUsers}% of all traffic</div>
          </div>
          <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">Organic sessions</div>
            <div className="text-lg font-bold text-blue-400">{formatNum(organic.organicSessions)}</div>
          </div>
          <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">Engagement rate</div>
            <div className="text-lg font-bold text-teal-400">{organic.engagementRate}%</div>
          </div>
          <div className="bg-zinc-800/40 rounded-lg px-3 py-2.5">
            <div className="text-[11px] text-zinc-500 mb-0.5">Avg time on site</div>
            <div className="text-lg font-bold text-amber-400">
              {Math.floor(organic.avgEngagementTime / 60)}m {Math.floor(organic.avgEngagementTime % 60)}s
            </div>
          </div>
        </div>

        {/* Organic share bar */}
        <div className="mt-4">
          <div className="text-[11px] text-zinc-500 mb-1.5">Share of total traffic from organic search</div>
          <div className="h-3 rounded-full overflow-hidden bg-zinc-800 flex">
            <div className="h-full bg-emerald-500 rounded-l-full transition-all" style={{ width: `${organic.shareOfTotalUsers}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[11px] text-emerald-400">Organic {organic.shareOfTotalUsers}%</span>
            <span className="text-[11px] text-zinc-500">Other {(100 - organic.shareOfTotalUsers).toFixed(1)}%</span>
          </div>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* New vs returning */}
        {newSeg && retSeg && (
          <SectionCard title="New vs Returning Visitors">
            <div className="flex items-center gap-6 mb-4">
              <div className="flex-1">
                <div className="text-[11px] text-teal-400 mb-0.5">New visitors</div>
                <div className="text-2xl font-bold text-teal-400">{newSeg.percentage}%</div>
                <div className="text-[11px] text-zinc-500">{formatNum(newSeg.users)} users</div>
              </div>
              <div className="flex-1">
                <div className="text-[11px] text-blue-400 mb-0.5">Returning visitors</div>
                <div className="text-2xl font-bold text-blue-400">{retSeg.percentage}%</div>
                <div className="text-[11px] text-zinc-500">{formatNum(retSeg.users)} users</div>
              </div>
            </div>
            <div className="h-4 rounded-full overflow-hidden bg-zinc-800 flex">
              <div className="h-full bg-teal-500 rounded-l-full" style={{ width: `${newSeg.percentage}%` }} />
              <div className="h-full bg-blue-500 rounded-r-full" style={{ width: `${retSeg.percentage}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4">
              <div className="bg-zinc-800/30 rounded-lg px-3 py-2">
                <div className="text-[11px] text-zinc-500 mb-0.5">New bounce rate</div>
                <div className={`text-sm font-bold ${newSeg.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400'}`}>{newSeg.bounceRate}%</div>
              </div>
              <div className="bg-zinc-800/30 rounded-lg px-3 py-2">
                <div className="text-[11px] text-zinc-500 mb-0.5">Returning bounce rate</div>
                <div className={`text-sm font-bold ${retSeg.bounceRate > 60 ? 'text-red-400' : 'text-emerald-400'}`}>{retSeg.bounceRate}%</div>
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
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg hover:bg-zinc-800/50 transition-colors">
                    <span className="text-[11px] text-zinc-600 w-4 text-right">{i + 1}</span>
                    <span className="text-xs text-zinc-300 flex-1 truncate font-mono">{label}</span>
                    <span className="text-xs text-emerald-400 font-medium tabular-nums flex-shrink-0">{formatNum(lp.sessions)}</span>
                    <span className={`text-[11px] flex-shrink-0 w-12 text-right ${lp.bounceRate > 70 ? 'text-red-400' : 'text-zinc-500'}`}>{lp.bounceRate}%</span>
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-4 mt-2 text-[11px] text-zinc-600">
              <span>Sessions</span>
              <span>Bounce</span>
            </div>
          </SectionCard>
        )}
      </div>
    </div>
  );
}
