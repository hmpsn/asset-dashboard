// src/components/charts/AnnotatedTrendChart.tsx
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  ReferenceLine, CartesianGrid,
} from 'recharts';
import { Plus, X } from 'lucide-react';
import type { Annotation } from '../../hooks/admin/useAnalyticsAnnotations';
import { chartGridColor, chartAxisColor, chartDotStroke, chartTooltipStyle, chartTooltipLabelStyle } from '../ui/constants';

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
  yAxisId: 'left' | 'right';  // kept for backward compat — overridden by dynamic assignment
  label: string;
  active?: boolean;  // whether this line is currently displayed (default true)
}

export interface ChartCallout {
  date: string;
  label: string;
  detail: string;
  color: string;
}

interface AnnotatedTrendChartProps {
  data: Record<string, unknown>[];
  lines: TrendLine[];              // ALL available lines (active + inactive)
  annotations: Annotation[];
  dateKey?: string;
  height?: number;
  onCreateAnnotation?: (date: string, label: string, category: string) => void;
  onToggleLine?: (key: string) => void;  // callback when a line chip is clicked
  /** @deprecated Toggle limit is now enforced by the parent via useToggleSet. Accepted for backward compat but not used. */
  maxActiveLines?: number;
  callouts?: ChartCallout[];              // optional chart callout bubbles
}

// ── Dynamic Y-axis assignment ──
// Uses the TrendLine.yAxisId hint as the primary grouping signal.
// When all active lines share the same hint, use scale-based splitting
// so different-magnitude metrics get independent axes.
// When lines have mixed hints (left + right), respect the hints directly.

function assignAxes(
  activeLines: TrendLine[],
  data: Record<string, unknown>[],
): Map<string, 'left' | 'right'> {
  const assignments = new Map<string, 'left' | 'right'>();
  if (activeLines.length === 0) return assignments;

  // If only 1 line, always left
  if (activeLines.length === 1) {
    assignments.set(activeLines[0].key, 'left');
    return assignments;
  }

  // Check if lines have mixed yAxisId hints (e.g., clicks=left, ctr=right)
  const hasLeftHint = activeLines.some(l => l.yAxisId === 'left');
  const hasRightHint = activeLines.some(l => l.yAxisId === 'right');

  if (hasLeftHint && hasRightHint) {
    // Mixed hints: start by respecting them
    for (const l of activeLines) assignments.set(l.key, l.yAxisId);

    // Check if left-hinted metrics have divergent scales — if so, move smaller to right
    // BUT only if that move won't create a scale conflict with existing right-hinted metrics.
    // Rule 13: rate metrics (ctr, position) must stay on right. When a volume metric is
    // moved right due to left-divergence, it must be scale-compatible with right occupants.
    const leftLines = activeLines.filter(l => l.yAxisId === 'left');
    if (leftLines.length >= 2) {
      // Compute max values for ALL active lines so we can cross-check right-axis scale
      const maxValues = new Map<string, number>();
      for (const line of activeLines) {
        let max = 0;
        for (const row of data) {
          const v = Number(row[line.key]) || 0;
          if (v > max) max = v;
        }
        maxValues.set(line.key, max || 1);
      }

      // Current right-axis peak (from right-hinted metrics, before any moves)
      const rightLines = activeLines.filter(l => l.yAxisId === 'right');
      const rightPeak = rightLines.reduce(
        (peak, rl) => Math.max(peak, maxValues.get(rl.key) ?? 0),
        0,
      );


      const sorted = [...leftLines].sort(
        (a, b) => (maxValues.get(b.key) ?? 0) - (maxValues.get(a.key) ?? 0),
      );
      for (let i = 1; i < sorted.length; i++) {
        const ratio = (maxValues.get(sorted[0].key) ?? 1) / (maxValues.get(sorted[i].key) ?? 1);
        if (ratio >= 10) {
          // Only move if the candidate is scale-compatible with existing right-axis metrics.
          // If right has rate metrics (e.g., ctr ~0.05, position ~10-50) and the candidate
          // is a volume metric (e.g., clicks ~1000), the right axis would be unreadable.
          const candidatePeak = maxValues.get(sorted[i].key) ?? 1;
          const rightConflict = rightPeak > 0 && (
            candidatePeak / rightPeak >= 10 || rightPeak / candidatePeak >= 10
          );
          if (!rightConflict) {
            assignments.set(sorted[i].key, 'right');
          }
          // else: leave on left — compression is preferable to breaking the right axis
        }
      }
    }

    return assignments;
  }

  // All lines share the same hint — use scale-based splitting
  const maxValues = new Map<string, number>();
  for (const line of activeLines) {
    let max = 0;
    for (const row of data) {
      const v = Number(row[line.key]) || 0;
      if (v > max) max = v;
    }
    maxValues.set(line.key, max || 1);
  }

  const sorted = [...activeLines].sort(
    (a, b) => (maxValues.get(b.key) ?? 0) - (maxValues.get(a.key) ?? 0),
  );

  assignments.set(sorted[0].key, 'left');
  const ratio = (maxValues.get(sorted[0].key) ?? 1) / (maxValues.get(sorted[1].key) ?? 1);
  assignments.set(sorted[1].key, ratio < 10 ? 'left' : 'right');

  if (sorted.length >= 3) {
    const leftMax = maxValues.get(sorted[0].key) ?? 1;
    const thirdMax = maxValues.get(sorted[2].key) ?? 1;
    const ratioToLeft = leftMax / thirdMax;
    assignments.set(sorted[2].key, ratioToLeft < 10 ? 'left' : 'right');
  }

  return assignments;
}

// ── Annotation dot (hover target at top of ReferenceLine) ──
function AnnotationDot({ x, annotation }: { x: number; annotation: Annotation }) {
  const [hovered, setHovered] = useState(false);
  const color = ANNOTATION_COLORS[annotation.category] ?? ANNOTATION_COLORS.other;
  const catLabel = CATEGORY_LABELS[annotation.category] ?? annotation.category;

  return (
    <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <circle cx={x} cy={12} r={5} fill={color} stroke={chartDotStroke()} strokeWidth={2} style={{ cursor: 'pointer' }} />
      {hovered && (
        <foreignObject x={x - 100} y={20} width={200} height={80}>
          {/* pr-check-disable-next-line -- chart tooltip inside SVG foreignObject */}
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
  containerWidth,
}: {
  state: PopoverState;
  onSave: (date: string, label: string, category: string) => void;
  onClose: () => void;
  containerWidth?: number;
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
    // pr-check-disable-next-line -- absolute-positioned chart annotation tooltip; not a section card
    <div
      ref={popoverRef}
      className="absolute z-50 bg-zinc-900 border border-zinc-700 rounded-xl shadow-xl p-3 w-64"
      style={{ left: Math.min(state.x, (containerWidth ?? 600) - 270), top: state.y + 10 }}
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
  onToggleLine: _onToggleLine,
  maxActiveLines: _maxActiveLines,
  callouts,
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

  const activeLines = useMemo(
    () => lines.filter(l => l.active !== false),
    // Stable dependency: serialize active keys instead of comparing array reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lines.map(l => `${l.key}:${l.active}`).join(',')],
  );

  // Dynamic Y-axis assignment based on data scale
  const axisAssignments = useMemo(
    () => assignAxes(activeLines, data),
    [activeLines, data],
  );

  const hasLeftAxis = [...axisAssignments.values()].includes('left');
  const hasRightAxis = [...axisAssignments.values()].includes('right');

  // Color-code Y-axis labels: use the color of the first active line on that axis
  const leftAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'left')?.color ?? chartAxisColor();
  const rightAxisColor = activeLines.find(l => axisAssignments.get(l.key) === 'right')?.color ?? chartAxisColor();

  return (
    <div ref={containerRef} className="relative">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} onClick={handleChartClick as unknown as (state: unknown) => void}>
          <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor()} />
          <XAxis
            dataKey={dateKey}
            tick={{ fill: chartAxisColor(), fontSize: 10 }}
            tickLine={false}
            axisLine={{ stroke: chartGridColor() }}
            tickFormatter={v => {
              const [, m, d] = String(v).split('-');
              return m && d ? `${Number(m)}/${Number(d)}` : v;
            }}
          />
          {/* Left Y-axis (dynamically assigned) */}
          {hasLeftAxis && (
            <YAxis
              yAxisId="left"
              tick={{ fill: leftAxisColor, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={45}
              stroke={leftAxisColor}
            />
          )}
          {/* Right Y-axis (dynamically assigned) */}
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fill: rightAxisColor, fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={45}
              stroke={rightAxisColor}
            />
          )}
          <Tooltip
            contentStyle={chartTooltipStyle()}
            labelStyle={chartTooltipLabelStyle()}
          />
          {activeLines.map(line => (
            <Area
              key={line.key}
              type="monotone"
              dataKey={line.key}
              yAxisId={axisAssignments.get(line.key) ?? 'left'}
              stroke={line.color}
              fill={`${line.color}15`}
              strokeWidth={2}
              dot={false}
              name={line.label}
            />
          ))}
          {/* Annotation reference lines — use whichever Y-axis is present */}
          {annotations.map(ann => (
            <ReferenceLine
              key={ann.id}
              x={ann.date}
              yAxisId={hasLeftAxis ? 'left' : 'right'}
              stroke={showLines ? (ANNOTATION_COLORS[ann.category] ?? ANNOTATION_COLORS.other) : 'transparent'}
              strokeDasharray="4 4"
              strokeWidth={1}
              label={({ viewBox }) => (
                <AnnotationDot x={(viewBox as { x: number }).x} annotation={ann} />
              )}
            />
          ))}
          {/* Callout bubbles — dashed reference lines with tooltip-style labels */}
          {callouts?.map((callout, i) => (
            <ReferenceLine
              key={`callout-${i}`}
              x={callout.date}
              yAxisId={hasLeftAxis ? 'left' : 'right'}
              stroke={callout.color}
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={({ viewBox }) => {
                const vx = (viewBox as { x: number }).x;
                return (
                  <foreignObject x={vx - 70} y={24} width={140} height={56}>
                    <div
                      className="rounded-lg px-2 py-1.5 shadow-lg text-center border"
                      style={{
                        backgroundColor: `${callout.color}18`,
                        borderColor: `${callout.color}40`,
                      }}
                    >
                      <span
                        className="text-[10px] font-semibold block truncate"
                        style={{ color: callout.color }}
                      >
                        {callout.label}
                      </span>
                      <span className="text-[9px] text-zinc-400 block truncate">
                        {callout.detail}
                      </span>
                    </div>
                  </foreignObject>
                );
              }}
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
          containerWidth={containerRef.current?.offsetWidth}
        />
      )}
    </div>
  );
}
