import { X } from 'lucide-react';
import { Icon } from './ui';

export interface ChartMetric {
  label: string;
  value: string | number;
  color?: string;
}

interface Props {
  date: string;
  metrics: ChartMetric[];
  onClose: () => void;
  /** horizontal position as % of container width (0-100) */
  xPct: number;
}

export function ChartPointDetail({ date, metrics, onClose, xPct }: Props) {
  // Flip popover to left side when point is past 65% to avoid overflow
  const alignRight = xPct > 65;

  return (
    <div
      className="absolute z-30 top-0 mt-1 pointer-events-auto"
      style={{ left: alignRight ? undefined : `${xPct}%`, right: alignRight ? `${100 - xPct}%` : undefined }}
    >
      <div className="bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-sm)] shadow-xl shadow-black/40 min-w-[160px] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--brand-border)]">
          <span className="t-caption-sm font-semibold text-[var(--brand-text-bright)]">{date}</span>
          <button onClick={onClose} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] -mr-1" aria-label="Close">
            <Icon as={X} size="xs" />
          </button>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                {m.color && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />}
                <span className="t-caption-sm text-[var(--brand-text-muted)]">{m.label}</span>
              </div>
              <span className="t-caption-sm font-medium text-[var(--brand-text-bright)]">{typeof m.value === 'number' ? m.value.toLocaleString() : m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
