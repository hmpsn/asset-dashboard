import { TrendingUp } from 'lucide-react';

// ── Shared position color helper ──
export function positionColor(pos: number): string {
  if (pos <= 3) return 'text-emerald-400/80 font-semibold';
  if (pos <= 10) return 'text-emerald-400/80';
  if (pos <= 20) return 'text-amber-400/80';
  return 'text-red-400/80';
}

// ── Rank History Chart ──
interface RankHistoryChartProps {
  rankHistory: { date: string; positions: Record<string, number> }[];
  maxKeywords?: number;
  height?: string;
}

const CHART_COLORS = ['#2dd4bf', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa'];

export function RankHistoryChart({ rankHistory, maxKeywords = 5, height = 'h-28' }: RankHistoryChartProps) {
  if (rankHistory.length < 2) return null;
  const allKws = Object.keys(rankHistory[rankHistory.length - 1]?.positions || {}).slice(0, maxKeywords);
  if (allKws.length === 0) return null;
  const maxPos = Math.max(...rankHistory.flatMap(s => allKws.map(k => s.positions[k] || 0)), 20);
  const W = 400, H = 120, PAD = 8;

  return (
    <div className="mb-3">
      <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${height}`} preserveAspectRatio="none">
        {allKws.map((kw, ki) => {
          const pts = rankHistory.map((s, i) => {
            const x = PAD + (i / Math.max(rankHistory.length - 1, 1)) * (W - PAD * 2);
            const pos = s.positions[kw];
            if (pos === undefined) return null;
            const y = PAD + ((pos - 1) / Math.max(maxPos - 1, 1)) * (H - PAD * 2);
            return `${x},${y}`;
          }).filter(Boolean);
          if (pts.length < 2) return null;
          return <path key={kw} d={`M${pts.join(' L')}`} fill="none" stroke={CHART_COLORS[ki % CHART_COLORS.length]} strokeWidth="2" opacity="0.8" />;
        })}
      </svg>
      <div className="flex flex-wrap gap-3 mt-1">
        {allKws.map((kw, ki) => (
          <span key={kw} className="flex items-center gap-1.5 text-[11px] text-zinc-500">
            <span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: CHART_COLORS[ki % CHART_COLORS.length] }} />
            <span className="truncate max-w-[120px]">{kw}</span>
          </span>
        ))}
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-1">
        <span>Position 1 (top)</span>
        <span>Position {maxPos} (bottom)</span>
      </div>
    </div>
  );
}

// ── Rank Table ──
export interface RankRow {
  query: string;
  position: number;
  change?: number;
  clicks?: number;
  impressions?: number;
}

interface RankTableProps {
  ranks: RankRow[];
  limit?: number;
  showClicks?: boolean;
  showImpressions?: boolean;
  /** Render extra columns after the standard ones */
  renderActions?: (rank: RankRow) => React.ReactNode;
}

export function RankTable({ ranks, limit = 10, showClicks = true, showImpressions = false, renderActions }: RankTableProps) {
  if (ranks.length === 0) return null;
  const visible = ranks.slice(0, limit);

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-800">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-zinc-950/50">
            <th className="text-left py-2 px-3 text-zinc-500 font-medium">Keyword</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Position</th>
            <th className="text-right py-2 px-3 text-zinc-500 font-medium">Change</th>
            {showClicks && <th className="text-right py-2 px-3 text-zinc-500 font-medium">Clicks</th>}
            {showImpressions && <th className="text-right py-2 px-3 text-zinc-500 font-medium">Impressions</th>}
            {renderActions && <th className="w-10" />}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i} className="border-t border-zinc-800/50">
              <td className="py-1.5 px-3 text-zinc-300 truncate max-w-[200px]">{r.query}</td>
              <td className="py-1.5 px-3 text-right">
                <span className={positionColor(r.position)}>#{Math.round(r.position)}</span>
              </td>
              <td className="py-1.5 px-3 text-right">
                <RankChange change={r.change} />
              </td>
              {showClicks && <td className="py-1.5 px-3 text-right text-blue-400">{r.clicks ?? 0}</td>}
              {showImpressions && <td className="py-1.5 px-3 text-right text-zinc-400">{(r.impressions ?? 0).toLocaleString()}</td>}
              {renderActions && <td className="py-1.5 px-3 text-right">{renderActions(r)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Rank Change Indicator ──
export function RankChange({ change }: { change?: number }) {
  if (change === undefined) return <span className="text-zinc-500">—</span>;
  if (change === 0) return <span className="text-zinc-500">—</span>;
  return (
    <span className={change > 0 ? 'text-emerald-400/80' : 'text-red-400/80'}>
      {change > 0 ? '↑' : '↓'}{Math.abs(change)}
    </span>
  );
}

// ── Rank Tracking Section (chart + table combined) ──
interface RankTrackingSectionProps {
  rankHistory: { date: string; positions: Record<string, number> }[];
  latestRanks: RankRow[];
  limit?: number;
  showClicks?: boolean;
  title?: string;
}

export function RankTrackingSection({ rankHistory, latestRanks, limit = 10, showClicks = true, title = 'Keyword Rank Tracking' }: RankTrackingSectionProps) {
  if (rankHistory.length < 2 && latestRanks.length === 0) return null;

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-teal-400" />
        <span className="text-sm font-semibold text-zinc-200">{title}</span>
        <span className="text-[11px] text-zinc-500 ml-auto">{rankHistory.length} snapshots</span>
      </div>
      <RankHistoryChart rankHistory={rankHistory} />
      <RankTable ranks={latestRanks} limit={limit} showClicks={showClicks} />
    </div>
  );
}
