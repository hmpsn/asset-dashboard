import {
  TrendingUp, TrendingDown, MousePointer, Eye, Smartphone, Monitor, Tablet,
  Globe, Users, ArrowRight,
} from 'lucide-react';
import type {
  SearchOverview, PerformanceTrend, SearchComparison,
  GA4Overview, GA4DailyTrend, GA4TopPage, GA4Comparison, GA4NewVsReturning,
} from './types';

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
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 120, h = 32;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - 2 - ((v - min) / range) * (h - 4)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <polygon fill={color} fillOpacity="0.08" points={`0,${h} ${points} ${w},${h}`} />
    </svg>
  );
}

function DeviceIcon({ device }: { device: string }) {
  const d = device.toLowerCase();
  if (d === 'mobile') return <Smartphone className="w-3.5 h-3.5" />;
  if (d === 'tablet') return <Tablet className="w-3.5 h-3.5" />;
  return <Monitor className="w-3.5 h-3.5" />;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
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
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
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
            <Eye className="w-3 h-3 text-purple-400" />
            <span className="text-[11px] text-zinc-500">Impressions</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-bold text-purple-400">{formatNum(overview.totalImpressions)}</span>
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
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 space-y-4">
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
