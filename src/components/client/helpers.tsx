import type { PerformanceTrend } from './types';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';
import { SectionCard } from '../ui/SectionCard';
import { chartDotStroke, CHART_SERIES_COLORS, scoreColor } from '../ui/constants';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DarkTooltip({ active, payload, label, metrics }: { active?: boolean; payload?: Array<{ value: number; payload: Record<string, any> }>; label?: string; metrics?: { label: string; key: string; color: string; fmt?: (v: number) => string }[] }) {
  if (!active || !payload?.length || !metrics) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-[var(--brand-border)] t-caption-sm font-semibold text-[var(--brand-text-bright)]">{label || row.date}</div>
      <div className="px-3 py-1.5 space-y-1">
        {metrics.map(m => (
          <div key={m.key} className="flex justify-between t-caption-sm">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] inline-block" style={{ backgroundColor: m.color }} />{m.label}</span>
            <span className="text-[var(--brand-text-bright)] font-medium">{m.fmt ? m.fmt(row[m.key]) : (typeof row[m.key] === 'number' ? row[m.key].toLocaleString() : row[m.key])}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TrendChart({ data, metric, color }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string }) {
  if (data.length < 2) return null;
  return (
    <ResponsiveContainer width="100%" height={80}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`cg-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.2} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="date" hide />
        <YAxis hide domain={['dataMin', 'dataMax']} />
        <Tooltip content={<DarkTooltip metrics={[
          { label: 'Clicks', key: 'clicks', color: CHART_SERIES_COLORS.blue },
          { label: 'Impressions', key: 'impressions', color: CHART_SERIES_COLORS.blue },
          { label: 'CTR', key: 'ctr', color: CHART_SERIES_COLORS.emerald, fmt: v => `${v}%` },
          { label: 'Position', key: 'position', color: CHART_SERIES_COLORS.amber },
        ]} />} />
        <Area type="monotone" dataKey={metric as string} stroke={color} strokeWidth={1.5} fill={`url(#cg-${metric})`} dot={false} activeDot={{ r: 3, fill: color, stroke: chartDotStroke(), strokeWidth: 1.5 }} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DualTrendChart({ data, annotations: anns }: { data: PerformanceTrend[]; annotations?: { id: string; date: string; label: string; color?: string }[] }) {
  if (data.length < 2) return null;
  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded-[var(--radius-sm)] bg-blue-400" /><span className="t-caption-sm text-accent-info">Clicks</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded-[var(--radius-sm)] bg-blue-400/60" /><span className="t-caption-sm text-accent-info">Impressions</span></div>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cg-clicks-dual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SERIES_COLORS.blue} stopOpacity={0.15} />
              <stop offset="100%" stopColor={CHART_SERIES_COLORS.blue} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cg-imps-dual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SERIES_COLORS.blue} stopOpacity={0.1} />
              <stop offset="100%" stopColor={CHART_SERIES_COLORS.blue} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis yAxisId="clicks" hide domain={['dataMin', 'dataMax']} />
          <YAxis yAxisId="imps" hide domain={['dataMin', 'dataMax']} orientation="right" />
          <Tooltip content={<DarkTooltip metrics={[
            { label: 'Clicks', key: 'clicks', color: CHART_SERIES_COLORS.blue },
            { label: 'Impressions', key: 'impressions', color: CHART_SERIES_COLORS.blue },
            { label: 'CTR', key: 'ctr', color: CHART_SERIES_COLORS.emerald, fmt: v => `${v}%` },
            { label: 'Position', key: 'position', color: CHART_SERIES_COLORS.amber },
          ]} />} />
          <Area yAxisId="imps" type="monotone" dataKey="impressions" stroke={CHART_SERIES_COLORS.blue} strokeWidth={1.2} strokeOpacity={0.6} fill="url(#cg-imps-dual)" dot={false} activeDot={{ r: 3, fill: CHART_SERIES_COLORS.blue, stroke: chartDotStroke(), strokeWidth: 1.5 }} isAnimationActive={false} />
          <Area yAxisId="clicks" type="monotone" dataKey="clicks" stroke={CHART_SERIES_COLORS.blue} strokeWidth={1.5} fill="url(#cg-clicks-dual)" dot={false} activeDot={{ r: 3, fill: CHART_SERIES_COLORS.blue, stroke: chartDotStroke(), strokeWidth: 1.5 }} isAnimationActive={false} />
          {anns?.map(ann => {
            const idx = data.findIndex(d => d.date === ann.date);
            if (idx < 0) return null;
            return <ReferenceLine key={ann.id} x={data[idx].date} stroke={ann.color || CHART_SERIES_COLORS.teal} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} label={{ value: '', position: 'top' }} />;
          })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScoreHistoryChart({ history }: { history: Array<{ id: string; createdAt: string; siteScore: number }> }) {
  if (history.length < 2) return null;
  const chartData = history.slice().reverse().map(h => ({
    date: new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    dateFull: new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }),
    siteScore: h.siteScore,
  }));
  return (
    <div>
      <ResponsiveContainer width="100%" height={60}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="sh-g" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_SERIES_COLORS.emerald} stopOpacity={0.15} />
              <stop offset="100%" stopColor={CHART_SERIES_COLORS.emerald} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, 100]} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload;
            if (!row) return null;
            const score = row.siteScore as number;
            const sc = scoreColor(score);
            return (
              <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl shadow-black/40 min-w-[120px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-[var(--brand-border)] t-caption-sm font-semibold text-[var(--brand-text-bright)]">{row.dateFull}</div>
                <div className="px-3 py-1.5">
                  <div className="flex justify-between t-caption-sm">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-[var(--radius-pill)] inline-block" style={{ backgroundColor: sc }} />Score</span>
                    <span className="text-[var(--brand-text-bright)] font-medium">{score}/100</span>
                  </div>
                </div>
              </div>
            );
          }} />
          <Area type="monotone" dataKey="siteScore" stroke={CHART_SERIES_COLORS.emerald} strokeWidth={2} fill="url(#sh-g)" dot={false} activeDot={{ r: 3, fill: CHART_SERIES_COLORS.emerald, stroke: chartDotStroke(), strokeWidth: 1.5 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-between t-caption-sm text-[var(--brand-text-muted)] mt-1">
        <span>{chartData[0]?.date}</span>
        <span>{chartData[chartData.length - 1]?.date}</span>
      </div>
    </div>
  );
}

// InsightCard needs icon prop typed loosely to avoid importing every icon
export function InsightCard({ icon: Icon, color, title, count, desc, items }: {
  icon: React.ComponentType<{ className?: string }>; color: string; title: string; count: number; desc: string;
  items: Array<{ label: string; value: string; sub: string }>;
}) {
  const colorMap: Record<string, { text: string }> = {
    amber: { text: 'text-accent-warning' }, emerald: { text: 'text-accent-success' },
    teal: { text: 'text-accent-brand' }, blue: { text: 'text-accent-info' },
    red: { text: 'text-accent-danger' },
  };
  const c = colorMap[color] || colorMap.amber;
  return (
    <SectionCard>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-4 h-4 ${c.text}`} />
        <span className={`t-ui font-medium ${c.text}`}>{title}</span>
        <span className="t-caption-sm text-[var(--brand-text-muted)] ml-auto">{count} queries</span>
      </div>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-2">{desc}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between t-caption-sm py-1 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-3)]/30">
            <span className="text-[var(--brand-text)] truncate mr-2">{item.label}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[var(--brand-text-muted)]">{item.sub}</span>
              <span className={`${c.text} font-medium`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
