import { useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';
import { Icon, TrendBadge } from './ui';
import { CHART_SERIES_COLORS } from './ui/constants';

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
        <div key={i} className="bg-[var(--surface-3)] rounded-[var(--radius-lg)] px-3 py-2 border border-[var(--brand-border)]">
          <div className="t-caption-sm text-[var(--brand-text-muted)]">{m.label}</div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="t-caption font-semibold text-[var(--brand-text-bright)]">{fmtValue(m.value, m.format)}{m.unit || ''}</span>
            {m.change != null && (
              <TrendBadge
                value={m.change}
                suffix="%"
                showSign
                hideOnZero={false}
                className="t-caption-sm"
              />
            )}
          </div>
          {m.changeLabel && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5">{m.changeLabel}</div>}
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

const BAR_COLORS = [CHART_SERIES_COLORS.teal, CHART_SERIES_COLORS.blue, CHART_SERIES_COLORS.purple, CHART_SERIES_COLORS.amber, CHART_SERIES_COLORS.red, CHART_SERIES_COLORS.emerald, CHART_SERIES_COLORS.orange, '#14b8a6']; // chart-hex-ok — #14b8a6 is teal-500 for extra series variety

export function ChartBlock({ data }: { data: ChartBlockData }) {
  const max = Math.max(...data.data.map(d => d.value), 1);
  return (
    <div className="my-1.5 bg-[var(--surface-3)] rounded-[var(--radius-lg)] border border-[var(--brand-border)] p-2.5">
      {data.title && <div className="t-caption-sm font-medium text-[var(--brand-text)] mb-2">{data.title}</div>}
      <div className="space-y-1.5">
        {data.data.slice(0, 8).map((item, i) => {
          const pct = (item.value / max) * 100;
          const color = item.color || BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={i} className="flex items-center gap-2">
              <span className="t-caption-sm text-[var(--brand-text-muted)] w-24 truncate flex-shrink-0" title={item.label}>{item.label}</span>
              <div className="flex-1 h-4 bg-[var(--surface-2)] rounded-[var(--radius-sm)] overflow-hidden relative">
                <div className="h-full rounded-[var(--radius-sm)] transition-all" style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: color, opacity: 0.7 }} />
              </div>
              <span className="t-caption-sm text-[var(--brand-text-bright)] font-medium w-12 text-right flex-shrink-0">
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
    <div className="my-1.5 rounded-[var(--radius-lg)] border border-[var(--brand-border)] overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-[var(--surface-3)] border-b border-[var(--brand-border)]">
        {data.title && <span className="t-caption-sm font-medium text-[var(--brand-text)]">{data.title}</span>}
        <div className="flex items-center gap-1 ml-auto">
            <button onClick={handleCopy} title="Copy as CSV"
              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">
              {copied ? <Icon as={Check} size="sm" className="text-emerald-400/80" /> : <Icon as={Copy} size="sm" />}
            </button>
            <button onClick={handleDownload} title="Download CSV"
              className="p-1 rounded-[var(--radius-sm)] hover:bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors">
              <Icon as={Download} size="sm" />
            </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="t-caption-sm w-full border-collapse">
          <thead>
            <tr className="bg-[var(--surface-3)]">
              {data.headers.map((h, j) => (
                <th key={j} className="text-left px-2.5 py-1.5 text-[var(--brand-text-muted)] font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, j) => (
              <tr key={j} className={j < data.rows.length - 1 ? 'border-b border-[var(--brand-border)]' : ''}>
                {row.map((cell, k) => (
                  <td key={k} className="px-2.5 py-1.5 text-[var(--brand-text)] whitespace-nowrap">{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.footer && <div className="px-2.5 py-1 t-caption-sm text-[var(--brand-text-muted)] border-t border-[var(--brand-border)]">{data.footer}</div>}
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
      {data.label && <span className="t-caption-sm text-[var(--brand-text-muted)]">{data.label}</span>}
      <svg width={w} height={h} className="inline-block">
        <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} strokeLinejoin="round" />
      </svg>
    </span>
  );
}
