// @ds-rebuilt
import { useState, type CSSProperties, type ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * Small entity marker — a colored initials/image avatar, or (tone="zinc" +
 * icon) the calm surface-3 section icon-tile. Content precedence: src → icon →
 * initials. Default 6px-rounded; `shape="circle"` for round.
 */
export interface AvatarProps {
  initials?: string;
  /** Lucide icon (D5) shown when no `src` is provided. */
  icon?: LucideIcon;
  src?: string;
  /**
   * Identity tone, or 'zinc' for the calm icon-tile surface. Kit 'mint' → 'teal'
   * (D6 — teal is the canonical action word); kit 'purple' dropped (Four Laws).
   */
  tone?: 'teal' | 'blue' | 'amber' | 'emerald' | 'zinc';
  /** Explicit background (overrides tone). */
  color?: string;
  iconColor?: string;
  size?: 'sm' | 'md' | 'lg' | number;
  shape?: 'rounded' | 'circle';
  label?: string;
  className?: string;
  id?: string;
  style?: CSSProperties;
}

const TONE_BG: Record<NonNullable<AvatarProps['tone']>, string> = {
  teal: 'linear-gradient(135deg, var(--teal), var(--emerald))',
  blue: 'var(--blue)',
  amber: 'var(--amber)',
  emerald: 'var(--emerald)',
  zinc: 'var(--surface-3)',
};

const SIZE_PX: Record<'sm' | 'md' | 'lg', number> = {
  sm: 22,
  md: 28,
  lg: 36,
};

function deriveInitials(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

export function Avatar({
  initials,
  icon: Icon,
  src,
  tone = 'teal',
  color,
  iconColor,
  size = 'md',
  shape = 'rounded',
  label,
  className,
  id,
  style,
}: AvatarProps): ReactElement {
  const [imgFailed, setImgFailed] = useState(false);

  const px = typeof size === 'number' ? size : SIZE_PX[size] ?? SIZE_PX.md;
  const radius = shape === 'circle' ? '9999px' : 'var(--radius-md)';
  const bg = color ?? TONE_BG[tone] ?? TONE_BG.teal;
  const onZinc = tone === 'zinc' && !color;
  const resolvedInitials = (initials ?? (label ? deriveInitials(label) : '')).slice(0, 2).toUpperCase();

  const a11yProps = label
    ? { role: 'img' as const, 'aria-label': label }
    : { 'aria-hidden': true as const };

  const showImg = Boolean(src) && !imgFailed;

  let content: ReactElement | string | null;
  if (showImg) {
    content = (
      <img
        src={src}
        alt=""
        className="w-full h-full object-cover"
        onError={() => setImgFailed(true)}
      />
    );
  } else if (Icon) {
    content = (
      <Icon
        style={{
          width: px * 0.55,
          height: px * 0.55,
          color: iconColor ?? (onZinc ? 'var(--teal)' : 'currentColor'),
        }}
        aria-hidden="true"
      />
    );
  } else {
    content = resolvedInitials;
  }

  return (
    <span
      id={id}
      {...a11yProps}
      className={cn(
        'inline-flex items-center justify-center flex-shrink-0 overflow-hidden font-bold leading-none t-mono',
        onZinc ? 'text-[var(--brand-text-bright)]' : 'text-[var(--surface-1)]',
        className,
      )}
      style={{
        width: px,
        height: px,
        borderRadius: radius,
        background: bg,
        fontSize: px * 0.4,
        ...style,
      }}
    >
      {content}
    </span>
  );
}
