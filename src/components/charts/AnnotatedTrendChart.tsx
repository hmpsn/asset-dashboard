// src/components/charts/AnnotatedTrendChart.tsx
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { Plus, X } from 'lucide-react';
import type { Annotation } from '../../hooks/admin/useAnalyticsAnnotations';

// ── Category colors (matches AnalyticsAnnotations badges) ──
const ANNOTATION_COLORS: Record<string, string> = {
  site_change: '#3b82f6',
  algorithm_update: '#f59e0b',
  campaign: '#a855f7',
  other: '#71717a',
};

const CATEGORY_LABELS: Record<string, string> = {
  site_change: 'Site Change',
  algorithm_update: 'Algorithm',
  campaign: 'Campaign',
  other: 'Other',
};

// ── Types ──
export interface TrendLine {
  key: string;
  color: string;
  yAxisId: 'left' | 'right';
  label: string;
}

interface AnnotatedTrendChartProps {
  data: Record<string, unknown>[];
  lines: TrendLine[];
  annotations: Annotation[];
  dateKey?: string;
  height?: number;
  onCreateAnnotation?: (date: string, label: string, category: string) => void;
}

// ── Annotation dot (hover target at top of ReferenceLine) ──
function AnnotationDot({ x, annotation }: { x: number; annotation: Annotation }) {
  const [hovered, setHovered] = useState(false);
  const color = ANNOTATION_COLORS[annotation.category] ?? ANNOTATION_COLORS.other;
  const catLabel = CATEGORY_LABELS[annotation.category] ?? annotation.category;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <circle cx={x} cy={12} r={5} fill={color} stroke="#18181b" strokeWidth={2} style={{ cursor: 'pointer' }} />
      {hovered && (
        <foreignObject x={x - 100} y={20} width={200} height={80}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-2 shadow-lg text-center">
            <span className="text-[10px] font-mono text-zinc-500 block">{annotation.date}</span>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-md font-medium inline-block mt-0.5"
              style={{ backgroundColor: `${color}33`, color }}
            >
              {catLabel}
            </span>
            <span className="text-[11px] text-zinc-200 block mt-1 truncate">{annotation.label}</span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}

// ── Click-to-annotate popover ──
interface PopoverState {
  date: string;
  x: number;
  y: number;
}

type Category = 'site_change' | 'algorithm_update' | 'campaign' | 'other';

function CreatePopover({
  state,
  onSave,
  onClose,
}: {
  state: PopoverState;
  onSave: (date: string, label: string, category: string) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState<Category>('site_change');
  const popoverRef = useRef<HTMLDivElement>(null);

  // Click-outside dismissal
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSave = () => {
    if (!label.trim()) return;
    onSave(state.date, label.trim(), category);
    onClose();
  };

  return (
    <div
      ref={popoverRef}
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 w-64"
      style={{ left: Math.min(state.x, window.innerWidth - 280), top: state.y + 10 }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-zinc-500">{state.date}</span>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-0.5"><X className="w-3.5 h-3.5" /></button>
      </div>
      <input
        type="text"
        placeholder="e.g. Launched new pages"
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
        autoFocus
        className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 placeholder-zinc-600 mb-2"
      />
      <select
        value={category}
        onChange={e => setCategory(e.target.value as Category)}
        className="w-full px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-300 mb-2"
      >
        <option value="site_change">Site Change</option>
        <option value="algorithm_update">Algorithm</option>
        <option value="campaign">Campaign</option>
        <option value="other">Other</option>
      </select>
      <button
        onClick={handleSave}
        disabled={!label.trim()}
        className="flex items-center gap-1 w-full justify-center px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 disabled:opacity-50 transition-colors"
      >
        <Plus className="w-3 h-3" /> Add
      </button>
    </div>
  );
}

// ── Main chart ──
export function AnnotatedTrendChart({
  data,
  lines,
  annotations,
  dateKey = 'date',
  height = 220,
  onCreateAnnotation,
}: AnnotatedTrendChartProps) {
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine whether to show lines or dots-only (>10 visible = dots only)
  const showLines = annotations.length <= 10;

  const handleChartClick = useCallback(
    (chartState: { activeLabel?: string } | null, event?: React.MouseEvent) => {
      if (!onCreateAnnotation || !chartState?.activeLabel || !event) return;
      // Don't open popover if clicking on an existing annotation date
      const clickedDate = chartState.activeLabel;
      if (annotations.some(a => a.date === clickedDate)) return;

      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPopover({
        date: clickedDate,
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
    },
    [onCreateAnnotation, annotations],
  );

  return (
    <div ref={containerRef} className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} onClick={handleChartClick as unknown as (state: unknown) => void}>
          <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
          <XAxis
            dataKey={dateKey}
            tick={{ fill: '#71717a', fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: '#3f3f46' }}
            tickFormatter={v => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
          {/* Left Y-axis (only if we have a left-axis line) */}
          {lines.some(l => l.yAxisId === 'left') && (
            <YAxis
              yAxisId="left"
              tick={{ fill: '#71717a', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={45}
            />
          )}
          {/* Right Y-axis (only if we have a right-axis line) */}
          {lines.some(l => l.yAxisId === 'right') && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: '#71717a', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={45}
            />
          )}
          <Tooltip
            contentStyle={{
              backgroundColor: '#18181b',
              border: '1px solid #3f3f46',
              borderRadius: '0.5rem',
              fontSize: '11px',
            }}
            labelStyle={{ color: '#a1a1aa', fontFamily: 'monospace' }}
          />
          {lines.map(line => (
            <Area
              key={line.key}
              type="monotone"
              dataKey={line.key}
              yAxisId={line.yAxisId}
              stroke={line.color}
              fill={`${line.color}15`}
              strokeWidth={2}
              dot={false}
              name={line.label}
            />
          ))}
          {/* Annotation reference lines */}
          {annotations.map(ann => (
            <ReferenceLine
              key={ann.id}
              x={ann.date}
              yAxisId="left"
              stroke={showLines ? (ANNOTATION_COLORS[ann.category] ?? ANNOTATION_COLORS.other) : 'transparent'}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={({ viewBox }) => (
                <AnnotationDot x={(viewBox as { x: number }).x} annotation={ann} />
              )}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>

      {/* Click-to-annotate popover */}
      {popover && onCreateAnnotation && (
        <CreatePopover
          state={popover}
          onSave={onCreateAnnotation}
          onClose={() => setPopover(null)}
        />
      )}
    </div>
  );
}
