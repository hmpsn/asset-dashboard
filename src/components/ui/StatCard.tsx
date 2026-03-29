import type { LucideIcon } from 'lucide-react';

/* ── Stat Card: Default ── */
interface StatCardProps {
  label: React.ReactNode;
  value: string | number;
  icon?: LucideIcon;
  iconColor?: string;
  valueColor?: string;
  sub?: string;
  delta?: number;
  deltaLabel?: string;
  /** When true, negative delta = green (improvement), positive = red (regression). Use for metrics like bounce rate, avg position. */
  invertDelta?: boolean;
  onClick?: () => void;
  className?: string;
  /** Display size: 'default' for standard, 'hero' for top-of-page impact metrics */
  size?: 'default' | 'hero';
  /** Stagger animation index (0-based). Each index adds 60ms delay. */
  staggerIndex?: number;
}

export function StatCard({
  label, value, icon: Icon, iconColor, valueColor, sub,
  delta, deltaLabel, invertDelta, onClick, className,
  size = 'default', staggerIndex,
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div';
  const isHero = size === 'hero';

  const baseStyle = {
    borderRadius: '6px 12px 6px 12px',
    ...(staggerIndex !== undefined && {
      animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both',
      animationDelay: `${staggerIndex * 60}ms`,
    }),
  };

  return (
    <Tag
      onClick={onClick}
      className={`bg-zinc-900 ${isHero ? 'p-4' : 'p-3'} border border-zinc-800 text-left ${onClick ? 'hover:border-zinc-700 transition-colors cursor-pointer group' : ''} ${className ?? ''}`}
      style={baseStyle}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={iconColor ? { color: iconColor } : undefined} />}
        <span className="inline-flex items-center gap-0.5 text-[11px] text-zinc-500 uppercase tracking-wider font-medium leading-none">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <div
          className={`${isHero ? 'text-4xl' : 'text-2xl'} font-bold leading-none ${valueColor ?? 'text-zinc-100'}`}
          style={valueColor?.startsWith('#') ? { color: valueColor } : undefined}
        >
          {value}
        </div>
        {delta !== undefined && delta !== 0 && (
          <span className={`text-[11px] font-medium ${(invertDelta ? delta < 0 : delta > 0) ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
            {delta > 0 ? '+' : ''}{delta}{deltaLabel ?? ''}
          </span>
        )}
      </div>
      {sub && <div className="text-[11px] text-zinc-500 mt-1">{sub}</div>}
    </Tag>
  );
}

/* ── Stat Card: Compact (horizontal inline bar) ── */
interface CompactStatProps {
  label: string;
  value: string | number;
  valueColor?: string;
  sub?: string;
  subColor?: string;
}

export function CompactStatBar({ items, className }: { items: CompactStatProps[]; className?: string }) {
  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 px-5 py-3 flex items-center justify-between flex-wrap gap-3 ${className ?? ''}`}
      style={{ borderRadius: '6px 12px 6px 12px' }}
    >
      {items.map(m => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">{m.label}</span>
          <span className={`text-base font-bold ${m.valueColor ?? 'text-zinc-200'}`}>{m.value}</span>
          {m.sub && <span className={`text-[11px] font-medium ${m.subColor ?? 'text-zinc-500'}`}>{m.sub}</span>}
        </div>
      ))}
    </div>
  );
}
