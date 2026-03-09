import { useState } from 'react';
import { TrendingUp, TrendingDown, Minus, Download, Copy, Check } from 'lucide-react';

// --- Metric Card ---
interface MetricBlockData {
  label: string;
  value: number | string;
  change?: number;
  changeLabel?: string;
  unit?: string;
  format?: 'number' | 'percent' | 'currency';
}

function fmtValue(v: number | string, format?: string): string {
  if (typeof v === 'string') return v;
  if (format === 'percent') return `${v.toFixed(1)}%`;
  if (format === 'currency') return `$${v.toLocaleString()}`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString();
}

export function MetricBlock({ data }: { data: MetricBlockData | MetricBlockData[] }) {
  const items = Array.isArray(data) ? data : [data];
  return (
    <div className={`grid ${items.length > 1 ? `grid-cols-${Math.min(items.length, 3)}` : ''} gap-2 my-1.5`}>
      {items.map((m, i) => (
        <div key={i} className="bg-zinc-800/60 rounded-lg px-3 py-2 border border-zinc-700/50">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{m.label}</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-sm font-semibold text-zinc-200">{fmtValue(m.value, m.format)}{m.unit || ''}</span>
            {m.change != null && (
              <span className={`flex items-center gap-0.5 text-[10px] font-medium ${m.change > 0 ? 'text-green-400' : m.change < 0 ? 'text-red-400' : 'text-zinc-500'}`}>
                {m.change > 0 ? <TrendingUp className="w-2.5 h-2.5" /> : m.change < 0 ? <TrendingDown className="w-2.5 h-2.5" /> : <Minus className="w-2.5 h-2.5" />}
                {m.change > 0 ? '+' : ''}{typeof m.change === 'number' ? m.change.toFixed(1) : m.change}%
              </span>
            )}
          </div>
          {m.changeLabel && <div className="text-[10px] text-zinc-600 mt-0.5">{m.changeLabel}</div>}
        </div>
      ))}
    </div>
  );
}

// --- Bar Chart ---
interface ChartBlockData {
  type?: 'bar' | 'horizontal';
  title?: string;
  data: Array<{ label: string; value: number; color?: string }>;
  valueFormat?: 'number' | 'percent';
}

const BAR_COLORS = ['#2dd4bf', '#60a5fa', '#a78bfa', '#f59e0b', '#f87171', '#34d399', '#818cf8', '#fb923c'];

export function ChartBlock({ data }: { data: ChartBlockData }) {
  const max = Math.max(...data.data.map(d => d.value), 1);
  return (
    <div className="my-1.5 bg-zinc-800/40 rounded-lg border border-zinc-700/50 p-2.5">
      {data.title && <div className="text-[11px] font-medium text-zinc-300 mb-2">{data.title}</div>}
      <div className="space-y-1.5">
        {data.data.slice(0, 8).map((item, i) => {
          const pct = (item.value / max) * 100;
          const color = item.color || BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-400 w-24 truncate flex-shrink-0" title={item.label}>{item.label}</span>
              <div className="flex-1 h-4 bg-zinc-800 rounded-sm overflow-hidden relative">
                <div className="h-full rounded-sm transition-all" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color, opacity: 0.7 }} />
              </div>
              <span className="text-[10px] text-zinc-300 font-medium w-12 text-right flex-shrink-0">
                {data.valueFormat === 'percent' ? `${item.value.toFixed(1)}%` : fmtValue(item.value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Data Table with export ---
interface DataTableBlockData {
  title?: string;
  headers: string[];
  rows: (string | number)[][];
  footer?: string;
}

function tableToCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(escape).join(','), ...rows.map(r => r.map(escape).join(','))].join('\n');
}

export function DataTableBlock({ data }: { data: DataTableBlockData }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const csv = tableToCsv(data.headers, data.rows);
    navigator.clipboard.writeText(csv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const csv = tableToCsv(data.headers, data.rows);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(data.title || 'data').replace(/\s+/g, '_').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-1.5 rounded-lg border border-zinc-700/50 overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/60 border-b border-zinc-700/50">
        {data.title && <span className="text-[11px] font-medium text-zinc-300">{data.title}</span>}
        <div className="flex items-center gap-1 ml-auto">
            <button onClick={handleCopy} title="Copy as CSV"
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            </button>
            <button onClick={handleDownload} title="Download CSV"
              className="p-1 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors">
              <Download className="w-3 h-3" />
            </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[11px] w-full border-collapse">
          <thead>
            <tr className="bg-zinc-800/30">
              {data.headers.map((h, j) => (
                <th key={j} className="text-left px-2.5 py-1.5 text-zinc-400 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, j) => (
              <tr key={j} className={j < data.rows.length - 1 ? 'border-b border-zinc-800/30' : ''}>
                {row.map((cell, k) => (
                  <td key={k} className="px-2.5 py-1.5 text-zinc-300 whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.footer && <div className="px-2.5 py-1 text-[10px] text-zinc-600 border-t border-zinc-800/30">{data.footer}</div>}
    </div>
  );
}

// --- Sparkline (inline mini chart) ---
interface SparklineBlockData {
  label?: string;
  values: number[];
  color?: string;
}

export function SparklineBlock({ data }: { data: SparklineBlockData }) {
  const vals = data.values;
  if (vals.length < 2) return null;
  const max = Math.max(...vals), min = Math.min(...vals), range = max - min || 1;
  const w = 80, h = 24;
  const points = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  const color = data.color || '#2dd4bf';
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {data.label && <span className="text-[10px] text-zinc-500">{data.label}</span>}
      <svg width={w} height={h} className="inline-block">
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinejoin="round" />
      </svg>
    </span>
  );
}

