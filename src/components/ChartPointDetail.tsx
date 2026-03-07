import { X } from 'lucide-react';

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
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl shadow-black/40 min-w-[160px] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-200">{date}</span>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 -mr-1">
            <X className="w-3 h-3" />
          </button>
        </div>
        <div className="px-3 py-2 space-y-1.5">
          {metrics.map((m, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-1.5">
                {m.color && <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />}
                <span className="text-[11px] text-zinc-500">{m.label}</span>
              </div>
              <span className="text-[11px] font-medium text-zinc-200">{typeof m.value === 'number' ? m.value.toLocaleString() : m.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
