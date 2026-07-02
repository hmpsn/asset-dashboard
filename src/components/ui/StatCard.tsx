import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/* ── Tone gradient map ── */
type StatCardTone = 'neutral' | 'teal' | 'emerald' | 'blue' | 'amber';

/**
 * Returns the canonical tinted-gradient + matching-border class string for the given tone.
 * Use this wherever a "tinted gradient card" treatment is needed so every surface shares
 * one canonical opacity (bg: /8, border: /20).
 *
 * Exported so custom card shells outside StatCard can reuse the exact same treatment without
 * hand-rolling inline class strings (design-x-gradient-card-variant normalization).
 */
export function cardToneClasses(tone: 'teal' | 'emerald' | 'blue' | 'amber'): string {
  const map: Record<'teal' | 'emerald' | 'blue' | 'amber', string> = {
    teal:    'bg-gradient-to-br from-teal-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border-teal-500/20',
    emerald: 'bg-gradient-to-br from-emerald-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border-emerald-500/20',
    blue:    'bg-gradient-to-br from-blue-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border-blue-500/20',
    amber:   'bg-gradient-to-br from-amber-500/8 via-[var(--surface-2)] to-[var(--surface-2)] border-amber-500/20',
  };
  return map[tone];
}

/** Internal map consumed by the StatCard tone prop — delegates to cardToneClasses so there
 *  is exactly ONE source for the canonical gradient/border pair. */
const TONE_GRADIENT: Record<Exclude<StatCardTone, 'neutral'>, { bg: string; border: string }> = {
  teal:    { bg: 'bg-gradient-to-br from-teal-500/8 via-[var(--surface-2)] to-[var(--surface-2)]',    border: 'border-teal-500/20' },
  emerald: { bg: 'bg-gradient-to-br from-emerald-500/8 via-[var(--surface-2)] to-[var(--surface-2)]', border: 'border-emerald-500/20' },
  blue:    { bg: 'bg-gradient-to-br from-blue-500/8 via-[var(--surface-2)] to-[var(--surface-2)]',    border: 'border-blue-500/20' },
  amber:   { bg: 'bg-gradient-to-br from-amber-500/8 via-[var(--surface-2)] to-[var(--surface-2)]',   border: 'border-amber-500/20' },
};

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
  /** When true, renders an explicit zero delta such as "+0 pts". */
  showZeroDelta?: boolean;
  /** When true, negative delta = green (improvement), positive = red (regression). Use for metrics like bounce rate, avg position. */
  invertDelta?: boolean;
  trailing?: ReactNode;
  onClick?: () => void;
  className?: string;
  /** Display size: 'default' for standard, 'hero' for top-of-page impact metrics */
  size?: 'default' | 'hero';
  /** Stagger index for entrance animation. Cards appear sequentially with 60ms delays. */
  staggerIndex?: number;
  /** Optional tone: applies a subtle gradient tint to the card surface. 'neutral' (default) preserves the existing appearance exactly. */
  tone?: StatCardTone;
}

export function StatCard({
  label, value, icon: Icon, iconColor, valueColor, sub,
  delta, deltaLabel, showZeroDelta, invertDelta, trailing, onClick, className,
  size = 'default', staggerIndex, tone = 'neutral',
}: StatCardProps) {
  const Tag = onClick ? 'button' : 'div';
  const isHero = size === 'hero';

  const toneClasses = tone !== 'neutral' ? TONE_GRADIENT[tone] : null;
  const bgClass = toneClasses ? toneClasses.bg : 'bg-[var(--surface-2)]';
  const borderClass = toneClasses ? toneClasses.border : 'border-[var(--brand-border)]';

  const baseStyle = {
    borderRadius: 'var(--radius-signature)',
    ...(staggerIndex !== undefined && {
      animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both',
      animationDelay: `${staggerIndex * 60}ms`,
    }),
  };

  return (
    <Tag
      onClick={onClick}
      className={`${bgClass} ${isHero ? 'p-4' : 'p-3'} border ${borderClass} text-left ${onClick ? 'hover:border-[var(--brand-border-hover)] transition-colors cursor-pointer group' : ''} ${className ?? ''}`}
      style={baseStyle}
    >
      <div className="flex items-center gap-1.5 mb-2">
        {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" style={iconColor ? { color: iconColor } : undefined} />}
        <span className="inline-flex items-center gap-0.5 t-label text-[var(--brand-text-muted)]">{label}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1.5">
            <div
              className={`${isHero ? 't-stat-lg' : 't-stat'} ${valueColor ?? 'text-[var(--brand-text-bright)]'}`}
              style={valueColor?.startsWith('#') ? { color: valueColor } : undefined}
            >
              {value}
            </div>
            {delta !== undefined && (delta !== 0 || showZeroDelta) && (
              <span className={`t-caption-sm font-medium ${delta === 0 || (invertDelta ? delta < 0 : delta > 0) ? 'text-emerald-400/80' : 'text-red-400/80'}`}>
                {delta >= 0 ? '+' : ''}{delta}{deltaLabel ?? ''}
              </span>
            )}
          </div>
          {sub && <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{sub}</div>}
        </div>
        {trailing && <div className="flex-shrink-0">{trailing}</div>}
      </div>
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
      className={`bg-[var(--surface-2)] border border-[var(--brand-border)] px-5 py-3 flex items-center justify-between flex-wrap gap-3 ${className ?? ''}`}
      style={{ borderRadius: 'var(--radius-signature)' }}
    >
      {items.map(m => (
        <div key={m.label} className="flex items-center gap-2">
          <span className="t-label text-[var(--brand-text-muted)]">{m.label}</span>
          <span className={`t-stat-sm ${m.valueColor ?? 'text-[var(--brand-text-bright)]'}`}>{m.value}</span>
          {m.sub && <span className={`t-caption-sm font-medium ${m.subColor ?? 'text-[var(--brand-text-muted)]'}`}>{m.sub}</span>}
        </div>
      ))}
    </div>
  );
}
