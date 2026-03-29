import { MetricBlock, ChartBlock, DataTableBlock, SparklineBlock } from '../ChatBlocks';
import type { PerformanceTrend } from './types';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DarkTooltip({ active, payload, label, metrics }: { active?: boolean; payload?: Array<{ value: number; payload: Record<string, any> }>; label?: string; metrics?: { label: string; key: string; color: string; fmt?: (v: number) => string }[] }) {
  if (!active || !payload?.length || !metrics) return null;
  const row = payload[0]?.payload;
  if (!row) return null;
  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[140px] overflow-hidden">
      <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{label || row.date}</div>
      <div className="px-3 py-1.5 space-y-1">
        {metrics.map(m => (
          <div key={m.key} className="flex justify-between text-[11px]">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: m.color }} />{m.label}</span>
            <span className="text-zinc-200 font-medium">{m.fmt ? m.fmt(row[m.key]) : (typeof row[m.key] === 'number' ? row[m.key].toLocaleString() : row[m.key])}</span>
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
          { label: 'Clicks', key: 'clicks', color: '#60a5fa' },
          { label: 'Impressions', key: 'impressions', color: '#60a5fa' },
          { label: 'CTR', key: 'ctr', color: '#34d399', fmt: v => `${v}%` },
          { label: 'Position', key: 'position', color: '#fbbf24' },
        ]} />} />
        <Area type="monotone" dataKey={metric as string} stroke={color} strokeWidth={1.5} fill={`url(#cg-${metric})`} dot={false} activeDot={{ r: 3, fill: color, stroke: '#18181b', strokeWidth: 1.5 }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DualTrendChart({ data, annotations: anns }: { data: PerformanceTrend[]; annotations?: { id: string; date: string; label: string; color?: string }[] }) {
  if (data.length < 2) return null;
  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-blue-400" /><span className="text-[11px] text-blue-400">Clicks</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-teal-400" /><span className="text-[11px] text-teal-400">Impressions</span></div>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cg-clicks-dual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#60a5fa" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#60a5fa" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="cg-imps-dual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.1} />
              <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis yAxisId="clicks" hide domain={['dataMin', 'dataMax']} />
          <YAxis yAxisId="imps" hide domain={['dataMin', 'dataMax']} orientation="right" />
          <Tooltip content={<DarkTooltip metrics={[
            { label: 'Clicks', key: 'clicks', color: '#60a5fa' },
            { label: 'Impressions', key: 'impressions', color: '#2dd4bf' },
            { label: 'CTR', key: 'ctr', color: '#34d399', fmt: v => `${v}%` },
            { label: 'Position', key: 'position', color: '#fbbf24' },
          ]} />} />
          <Area yAxisId="imps" type="monotone" dataKey="impressions" stroke="#2dd4bf" strokeWidth={1.2} strokeOpacity={0.6} fill="url(#cg-imps-dual)" dot={false} activeDot={{ r: 3, fill: '#2dd4bf', stroke: '#18181b', strokeWidth: 1.5 }} />
          <Area yAxisId="clicks" type="monotone" dataKey="clicks" stroke="#60a5fa" strokeWidth={1.5} fill="url(#cg-clicks-dual)" dot={false} activeDot={{ r: 3, fill: '#60a5fa', stroke: '#18181b', strokeWidth: 1.5 }} />
          {anns?.map(ann => {
            const idx = data.findIndex(d => d.date === ann.date);
            if (idx < 0) return null;
            return <ReferenceLine key={ann.id} x={data[idx].date} stroke={ann.color || '#2dd4bf'} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} label={{ value: '', position: 'top' }} />;
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
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, 100]} />
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.length) return null;
            const row = payload[0]?.payload;
            if (!row) return null;
            const score = row.siteScore as number;
            const scoreColor = score >= 80 ? '#34d399' : score >= 60 ? '#fbbf24' : '#f87171';
            return (
              <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[120px] overflow-hidden">
                <div className="px-3 py-1.5 border-b border-zinc-800 text-[11px] font-semibold text-zinc-200">{row.dateFull}</div>
                <div className="px-3 py-1.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: scoreColor }} />Score</span>
                    <span className="text-zinc-200 font-medium">{score}/100</span>
                  </div>
                </div>
              </div>
            );
          }} />
          <Area type="monotone" dataKey="siteScore" stroke="#34d399" strokeWidth={2} fill="url(#sh-g)" dot={false} activeDot={{ r: 3, fill: '#34d399', stroke: '#18181b', strokeWidth: 1.5 }} />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
        <span>{chartData[0]?.date}</span>
        <span>{chartData[chartData.length - 1]?.date}</span>
      </div>
    </div>
  );
}

export function RenderMarkdown({ text }: { text: string }) {
  const inlineMd = (s: string) =>
    s.replace(/\*\*(.+?)\*\*/g, '<b class="text-zinc-200">$1</b>')
     .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em class="text-zinc-400">$1</em>')
     .replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 py-0.5 rounded text-zinc-300 text-[11px]">$1</code>');
  const stripBold = (s: string) => s.replace(/\*\*/g, '').trim();
  const lines = text.split('\n');
  const elements: React.ReactElement[] = [];
  let idx = 0;

  while (idx < lines.length) {
    const line = lines[idx];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;

    // Fenced code blocks: ```lang ... ```
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim().toLowerCase();
      idx++;
      const blockLines: string[] = [];
      while (idx < lines.length && !lines[idx].trimStart().startsWith('```')) {
        blockLines.push(lines[idx]);
        idx++;
      }
      if (idx < lines.length) idx++; // skip closing ```
      const blockContent = blockLines.join('\n').trim();

      // Rich blocks: metric, chart, datatable, sparkline
      if (lang === 'metric' || lang === 'chart' || lang === 'datatable' || lang === 'sparkline') {
        let parsed: unknown = null;
        try { parsed = JSON.parse(blockContent); } catch { /* invalid JSON */ }

        if (parsed !== null) {
          if (lang === 'metric') elements.push(<MetricBlock key={elements.length} data={parsed as Parameters<typeof MetricBlock>[0]['data']} />);
          else if (lang === 'chart') elements.push(<ChartBlock key={elements.length} data={parsed as Parameters<typeof ChartBlock>[0]['data']} />);
          else if (lang === 'datatable') elements.push(<DataTableBlock key={elements.length} data={parsed as Parameters<typeof DataTableBlock>[0]['data']} />);
          else if (lang === 'sparkline') elements.push(<SparklineBlock key={elements.length} data={parsed as Parameters<typeof SparklineBlock>[0]['data']} />);
        } else {
          elements.push(
            <pre key={elements.length} className="text-[11px] bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-2 overflow-x-auto text-zinc-300 my-1">
              <code>{blockContent}</code>
            </pre>
          );
        }
        continue;
      }

      // Regular code block
      elements.push(
        <pre key={elements.length} className="text-[11px] bg-zinc-800/60 border border-zinc-700/50 rounded-lg p-2 overflow-x-auto text-zinc-300 my-1">
          <code>{blockContent}</code>
        </pre>
      );
      continue;
    }

    // Table: consecutive lines starting and ending with |
    if (trimmed.startsWith('|') && trimmed.includes('|', 1)) {
      const tableLines: string[] = [];
      while (idx < lines.length) {
        const tl = lines[idx].trim();
        if (tl.startsWith('|') && tl.includes('|', 1)) { tableLines.push(tl); idx++; }
        else break;
      }
      if (tableLines.length >= 2) {
        const parseRow = (row: string) =>
          row.split('|').slice(1, -1).map(c => c.trim());
        const isSep = (row: string) => /^\|[\s\-:]+\|/.test(row);
        const headers = parseRow(tableLines[0]);
        const dataStart = tableLines.length > 1 && isSep(tableLines[1]) ? 2 : 1;
        const rows = tableLines.slice(dataStart).filter(r => !isSep(r)).map(parseRow);
        elements.push(
          <div key={elements.length} className="overflow-x-auto my-1.5 rounded-lg border border-zinc-800">
            <table className="text-[11px] w-full border-collapse">
              <thead>
                <tr className="bg-zinc-800/50">
                  {headers.map((h, j) => (
                    <th key={j} className="text-left px-2.5 py-1.5 text-zinc-400 font-medium whitespace-nowrap"
                      dangerouslySetInnerHTML={{ __html: inlineMd(h) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, j) => (
                  <tr key={j} className={j < rows.length - 1 ? 'border-b border-zinc-800/50' : ''}>
                    {row.map((cell, k) => (
                      <td key={k} className="px-2.5 py-1.5 text-zinc-300 whitespace-nowrap"
                        dangerouslySetInnerHTML={{ __html: inlineMd(cell) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
        continue;
      }
    }

    // Headings — strip bold markers inside (GPT sends ## **Overview**)
    if (trimmed.startsWith('### ')) {
      elements.push(<h4 key={elements.length} className="text-xs font-semibold text-zinc-200 mt-3 mb-0.5">{stripBold(trimmed.slice(4))}</h4>);
      idx++; continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(<h3 key={elements.length} className="text-sm font-semibold text-zinc-200 mt-3 mb-0.5">{stripBold(trimmed.slice(3))}</h3>);
      idx++; continue;
    }
    if (trimmed.startsWith('# ')) {
      elements.push(<h3 key={elements.length} className="text-sm font-bold text-zinc-200 mt-3 mb-0.5">{stripBold(trimmed.slice(2))}</h3>);
      idx++; continue;
    }

    // Bullet lists: - or • (handle both to avoid double-bullet)
    if (trimmed.startsWith('- ') || trimmed.startsWith('• ')) {
      const content = trimmed.slice(2);
      elements.push(
        <div key={elements.length} className="flex gap-1.5 text-[11px] text-zinc-400" style={{ marginLeft: indent > 0 ? 12 : 0 }}>
          <span className="text-zinc-500 shrink-0 mt-px">•</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
        </div>
      );
      idx++; continue;
    }

    // Numbered lists
    if (trimmed.match(/^\d+\.\s/)) {
      const content = trimmed.replace(/^\d+\.\s/, '');
      const num = trimmed.match(/^(\d+)\./)?.[1];
      elements.push(
        <div key={elements.length} className="flex gap-1.5 text-[11px] text-zinc-400 mt-0.5" style={{ marginLeft: indent > 0 ? 12 : 0 }}>
          <span className="text-zinc-500 shrink-0 w-4 text-right">{num}.</span>
          <span dangerouslySetInnerHTML={{ __html: inlineMd(content) }} />
        </div>
      );
      idx++; continue;
    }

    // Empty line → small spacer
    if (trimmed === '') { elements.push(<div key={elements.length} className="h-1" />); idx++; continue; }

    // Regular paragraph
    elements.push(
      <p key={elements.length} className="text-[11px] text-zinc-400 leading-relaxed" dangerouslySetInnerHTML={{ __html: inlineMd(trimmed) }} />
    );
    idx++;
  }

  return <div className="space-y-1">{elements}</div>;
}

// InsightCard needs icon prop typed loosely to avoid importing every icon
export function InsightCard({ icon: Icon, color, title, count, desc, items }: {
  icon: React.ComponentType<{ className?: string }>; color: string; title: string; count: number; desc: string;
  items: Array<{ label: string; value: string; sub: string }>;
}) {
  const colorMap: Record<string, { text: string }> = {
    amber: { text: 'text-amber-400' }, green: { text: 'text-green-400' },
    red: { text: 'text-red-400' }, orange: { text: 'text-orange-400' },
  };
  const c = colorMap[color] || colorMap.amber;
  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4" style={{ borderRadius: '10px 24px 10px 24px' }}>
      <div className="flex items-center gap-1.5 mb-3">
        <Icon className={`w-4 h-4 ${c.text}`} />
        <span className={`text-xs font-medium ${c.text}`}>{title}</span>
        <span className="text-[11px] text-zinc-500 ml-auto">{count} queries</span>
      </div>
      <p className="text-[11px] text-zinc-500 mb-2">{desc}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-[11px] py-1 px-2 rounded bg-zinc-800/30">
            <span className="text-zinc-300 truncate mr-2">{item.label}</span>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-zinc-500">{item.sub}</span>
              <span className={`${c.text} font-medium`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
