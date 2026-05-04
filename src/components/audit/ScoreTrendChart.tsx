/**
 * Score trend chart — extracted from SeoAudit.tsx
 */
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import type { SnapshotSummary } from './types';
import { chartGridColor, chartAxisColor, chartDotStroke, chartDotFill, scoreColor } from '../ui/constants';

export function ScoreTrendChart({ history }: { history: SnapshotSummary[] }) {
  const points = [...history].reverse().slice(-12);
  if (points.length < 2) return null;

  const scores = points.map(p => p.siteScore);
  const minS = Math.max(0, Math.min(...scores) - 10);
  const maxS = Math.min(100, Math.max(...scores) + 10);

  const chartData = points.map(p => ({
    date: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    dateFull: new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    score: p.siteScore,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: 32 }}>
        <defs>
          <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2ed9c3" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#2ed9c3" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={chartGridColor()} horizontal vertical={false} />
        <XAxis dataKey="date" tick={{ fill: chartAxisColor(), fontSize: 8 }} tickLine={false} axisLine={false} interval={points.length <= 6 ? 0 : 'preserveStartEnd'} />
        <YAxis domain={[minS, maxS]} tick={{ fill: chartAxisColor(), fontSize: 9 }} tickLine={false} axisLine={false} width={28} />
        <Tooltip content={({ active, payload }) => {
          if (!active || !payload?.length) return null;
          const row = payload[0]?.payload;
          if (!row) return null;
          const s = row.score as number;
          const sc = scoreColor(s);
          return (
            <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl shadow-black/40 min-w-[120px] overflow-hidden">
              <div className="px-3 py-1.5 border-b border-[var(--brand-border)] t-caption-sm font-semibold text-[var(--brand-text-bright)]">{row.dateFull}</div>
              <div className="px-3 py-1.5">
                <div className="flex justify-between t-caption-sm"><span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] inline-block" style={{ backgroundColor: sc }} />Score</span><span className="text-[var(--brand-text-bright)] font-medium">{s}/100</span></div>
              </div>
            </div>
          );
        }} />
        {/* chart-hex-ok — #2ed9c3 is a bespoke teal for audit score trend line */}
        <Area type="monotone" dataKey="score" stroke="#2ed9c3" strokeWidth={2.5} fill="url(#trendGrad)" dot={{ r: 3.5, fill: chartDotFill(), stroke: '#2ed9c3', strokeWidth: 2 }} activeDot={{ r: 4, fill: '#2ed9c3', stroke: chartDotStroke(), strokeWidth: 2 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
