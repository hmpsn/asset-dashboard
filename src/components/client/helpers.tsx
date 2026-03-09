import { useState } from 'react';
import { ChartPointDetail } from '../ChartPointDetail';
import { MetricBlock, ChartBlock, DataTableBlock, SparklineBlock } from '../ChatBlocks';
import type { PerformanceTrend } from './types';

export function TrendChart({ data, metric, color }: { data: PerformanceTrend[]; metric: keyof PerformanceTrend; color: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (data.length < 2) return null;
  const values = data.map(d => d[metric] as number);
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1, w = 100;
  const pointCoords = values.map((v, i) => ({ x: (i / (values.length - 1)) * w, y: 100 - ((v - min) / range) * 90 - 5 }));
  const points = pointCoords.map(p => `${p.x},${p.y}`).join(' ');
  const bandW = w / data.length;
  return (
    <div className="relative" onMouseLeave={() => setSelected(null)}>
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 80 }} preserveAspectRatio="none">
        <defs><linearGradient id={`cg-${metric}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.2" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
        <polygon fill={`url(#cg-${metric})`} points={`0,100 ${points} ${w},100`} />
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pointCoords.map((p, i) => (
          <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onMouseEnter={() => setSelected(i)} />
        ))}
        {selected !== null && pointCoords[selected] && (
          <>
            <line x1={pointCoords[selected].x} y1={0} x2={pointCoords[selected].x} y2={100} stroke={color} strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
            <circle cx={pointCoords[selected].x} cy={pointCoords[selected].y} r="3" fill={color} stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {selected !== null && data[selected] && (
        <ChartPointDetail
          date={data[selected].date}
          xPct={(selected / (data.length - 1)) * 100}
          onClose={() => setSelected(null)}
          metrics={[
            { label: 'Clicks', value: data[selected].clicks, color: '#60a5fa' },
            { label: 'Impressions', value: data[selected].impressions, color: '#a78bfa' },
            { label: 'CTR', value: `${data[selected].ctr}%`, color: '#34d399' },
            { label: 'Position', value: data[selected].position, color: '#fbbf24' },
          ]}
        />
      )}
    </div>
  );
}

export function DualTrendChart({ data, annotations: anns }: { data: PerformanceTrend[]; annotations?: { id: string; date: string; label: string; color?: string }[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (data.length < 2) return null;
  const clicks = data.map(d => d.clicks);
  const imps = data.map(d => d.impressions);
  const cMax = Math.max(...clicks), cMin = Math.min(...clicks), cRange = cMax - cMin || 1;
  const iMax = Math.max(...imps), iMin = Math.min(...imps), iRange = iMax - iMin || 1;
  const w = 100;
  const cCoords = clicks.map((v, i) => ({ x: (i / (clicks.length - 1)) * w, y: 100 - ((v - cMin) / cRange) * 85 - 7 }));
  const iCoords = imps.map((v, i) => ({ x: (i / (imps.length - 1)) * w, y: 100 - ((v - iMin) / iRange) * 85 - 7 }));
  const cPoints = cCoords.map(p => `${p.x},${p.y}`).join(' ');
  const iPoints = iCoords.map(p => `${p.x},${p.y}`).join(' ');
  const bandW = w / data.length;
  return (
    <div className="relative" onMouseLeave={() => setSelected(null)}>
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-blue-400" /><span className="text-[11px] text-blue-400">Clicks</span></div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-0.5 rounded bg-teal-400" /><span className="text-[11px] text-teal-400">Impressions</span></div>
      </div>
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 120 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg-clicks-dual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity="0.15" /><stop offset="100%" stopColor="#60a5fa" stopOpacity="0" /></linearGradient>
          <linearGradient id="cg-imps-dual" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2dd4bf" stopOpacity="0.1" /><stop offset="100%" stopColor="#2dd4bf" stopOpacity="0" /></linearGradient>
        </defs>
        <polygon fill="url(#cg-imps-dual)" points={`0,100 ${iPoints} ${w},100`} />
        <polyline fill="none" stroke="#2dd4bf" strokeWidth="1.2" points={iPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeOpacity="0.6" />
        <polygon fill="url(#cg-clicks-dual)" points={`0,100 ${cPoints} ${w},100`} />
        <polyline fill="none" stroke="#60a5fa" strokeWidth="1.5" points={cPoints} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {anns?.map(ann => {
          const idx = data.findIndex(d => d.date === ann.date);
          if (idx < 0) return null;
          const x = (idx / (data.length - 1)) * w;
          return <g key={ann.id}><line x1={x} y1={2} x2={x} y2={98} stroke={ann.color || '#2dd4bf'} strokeWidth="0.8" strokeDasharray="2,1.5" opacity="0.7" vectorEffect="non-scaling-stroke" /><circle cx={x} cy={3} r="1.5" fill={ann.color || '#2dd4bf'} vectorEffect="non-scaling-stroke" /><title>{ann.label}</title></g>;
        })}
        {/* Hover hit areas */}
        {cCoords.map((p, i) => (
          <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onMouseEnter={() => setSelected(i)} />
        ))}
        {/* Selected point indicators */}
        {selected !== null && cCoords[selected] && (
          <>
            <line x1={cCoords[selected].x} y1={2} x2={cCoords[selected].x} y2={98} stroke="#a1a1aa" strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.5" vectorEffect="non-scaling-stroke" />
            <circle cx={cCoords[selected].x} cy={cCoords[selected].y} r="3" fill="#60a5fa" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <circle cx={iCoords[selected].x} cy={iCoords[selected].y} r="3" fill="#2dd4bf" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {selected !== null && data[selected] && (
        <ChartPointDetail
          date={data[selected].date}
          xPct={(selected / (data.length - 1)) * 100}
          onClose={() => setSelected(null)}
          metrics={[
            { label: 'Clicks', value: data[selected].clicks, color: '#60a5fa' },
            { label: 'Impressions', value: data[selected].impressions, color: '#2dd4bf' },
            { label: 'CTR', value: `${data[selected].ctr}%`, color: '#34d399' },
            { label: 'Position', value: data[selected].position, color: '#fbbf24' },
          ]}
        />
      )}
    </div>
  );
}

export function ScoreHistoryChart({ history }: { history: Array<{ id: string; createdAt: string; siteScore: number }> }) {
  const [selected, setSelected] = useState<number | null>(null);
  if (history.length < 2) return null;
  const reversed = history.slice().reverse();
  const scores = reversed.map(h => h.siteScore);
  const max = Math.max(...scores, 100), min = Math.min(...scores, 0), range = max - min || 1, w = 100;
  const pointCoords = scores.map((v, i) => ({ x: (i / (scores.length - 1)) * w, y: 100 - ((v - min) / range) * 85 - 5 }));
  const points = pointCoords.map(p => `${p.x},${p.y}`).join(' ');
  const bandW = w / scores.length;
  return (
    <div className="relative" onMouseLeave={() => setSelected(null)}>
      <svg viewBox={`0 0 ${w} 100`} className="w-full" style={{ height: 60 }} preserveAspectRatio="none">
        <defs><linearGradient id="sh-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#34d399" stopOpacity="0.15" /><stop offset="100%" stopColor="#34d399" stopOpacity="0" /></linearGradient></defs>
        <polygon fill="url(#sh-g)" points={`0,100 ${points} ${w},100`} />
        <polyline fill="none" stroke="#34d399" strokeWidth="2" points={points} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        {pointCoords.map((p, i) => (
          <rect key={i} x={p.x - bandW / 2} y={0} width={bandW} height={100} fill="transparent" className="cursor-pointer" onMouseEnter={() => setSelected(i)} />
        ))}
        {selected !== null && pointCoords[selected] && (
          <>
            <line x1={pointCoords[selected].x} y1={0} x2={pointCoords[selected].x} y2={100} stroke="#34d399" strokeWidth="0.5" strokeDasharray="2,1.5" opacity="0.6" vectorEffect="non-scaling-stroke" />
            <circle cx={pointCoords[selected].x} cy={pointCoords[selected].y} r="3" fill="#34d399" stroke="#18181b" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {selected !== null && reversed[selected] && (
        <ChartPointDetail
          date={new Date(reversed[selected].createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
          xPct={(selected / (scores.length - 1)) * 100}
          onClose={() => setSelected(null)}
          metrics={[
            { label: 'Audit Score', value: `${reversed[selected].siteScore}/100`, color: reversed[selected].siteScore >= 80 ? '#34d399' : reversed[selected].siteScore >= 60 ? '#fbbf24' : '#f87171' },
          ]}
        />
      )}
      <div className="flex justify-between text-[11px] text-zinc-500 mt-1">
        {reversed.map((h, i) => (i === 0 || i === history.length - 1)
          ? <span key={h.id}>{new Date(h.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
          : <span key={h.id} />
        )}
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
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
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
