import type { LucideIcon } from 'lucide-react';

/* ── MiniSparkline (inline SVG sparkline for stat cards) ── */
function MiniSparkline({ data, color = '#2dd4bf' }: { data: number[]; color?: string }) {
  if (data.length < 3) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 48, h = 20;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`);
  return (
    <svg width={w} height={h} className="flex-shrink-0 opacity-60">
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ── Stat Card: Default ── */
interface StatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;
  valueColor?: string;
  sub?: string;
  sparklineData?: number[];
  sparklineColor?: string;
  delta?: number;
  deltaLabel?: string;
  onClick?: () => void;
  className?: string;
}

export function StatCard({
  label, value, icon: Icon, iconColor, valueColor, sub,
  sparklineData, sparklineColor, delta, deltaLabel, onClick, className,
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      className={`bg-zinc-900 rounded-xl p-4 border border-zinc-800 text-left ${onClick ? 'hover:border-zinc-700 transition-colors cursor-pointer group' : ''} ${className ?? ''}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          {Icon && <Icon className="w-4 h-4" style={iconColor ? { color: iconColor } : undefined} />}
          <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">{label}</span>
        </div>
        {sparklineData && sparklineData.length > 2 && (
          <MiniSparkline data={sparklineData} color={sparklineColor ?? iconColor} />
        )}
      </div>
      <div className="flex items-end gap-2">
        <div
          className={`text-2xl font-bold ${valueColor ?? 'text-zinc-100'}`}
          style={valueColor?.startsWith('#') ? { color: valueColor } : undefined}
        >
          {value}
        </div>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-xs font-medium pb-0.5 ${delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {delta > 0 ? '+' : ''}{delta}{deltaLabel ?? ''}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-zinc-500 mt-0.5">{sub}</div>}
    </Tag>
  );
}

/* ── Stat Card: Compact (horizontal inline bar) ── */
interface CompactStatProps {
  label: string;
  value: string | number;
  valueColor?: string;
}

export function CompactStatBar({ items, className }: { items: CompactStatProps[]; className?: string }) {
  return (
    <div className={`bg-zinc-900 rounded-xl border border-zinc-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3 ${className ?? ''}`}>
      {items.map(m => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 uppercase tracking-wider">{m.label}</span>
          <span className={`text-sm font-bold ${m.valueColor ?? 'text-zinc-200'}`}>{m.value}</span>
        </div>
      ))}
    </div>
  );
}
