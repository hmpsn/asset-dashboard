import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Icon } from './Icon';

export type BadgeTone = 'teal' | 'blue' | 'emerald' | 'amber' | 'red' | 'orange' | 'zinc';
export type BadgeVariant = 'soft' | 'outline' | 'solid';
export type BadgeSize = 'sm' | 'md';
export type BadgeShape = 'sm' | 'pill';

interface BadgeProps {
  label: string;
  /** Compatibility alias. Prefer `tone` for new call sites. */
  color?: BadgeTone;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  size?: BadgeSize;
  shape?: BadgeShape;
  icon?: LucideIcon;
  dot?: boolean;
  ariaLabel?: string;
  className?: string;
}

const BADGE_TONE_CLASSES: Record<BadgeTone, Record<BadgeVariant, string>> = {
  teal: {
    soft: 'bg-teal-500/10 text-teal-400',
    outline: 'bg-teal-500/5 text-teal-300 border border-teal-500/25',
    solid: 'bg-teal-600 text-white',
  },
  blue: {
    soft: 'bg-blue-500/10 text-blue-400',
    outline: 'bg-blue-500/5 text-blue-300 border border-blue-500/25',
    solid: 'bg-blue-600 text-white',
  },
  emerald: {
    soft: 'bg-emerald-500/8 text-emerald-400/80',
    outline: 'bg-emerald-500/5 text-emerald-300 border border-emerald-500/25',
    solid: 'bg-emerald-600 text-white',
  },
  amber: {
    soft: 'bg-amber-500/8 text-amber-400/80',
    outline: 'bg-amber-500/5 text-amber-300 border border-amber-500/25',
    solid: 'bg-amber-600 text-white',
  },
  red: {
    soft: 'bg-red-500/8 text-red-400/80',
    outline: 'bg-red-500/5 text-red-300 border border-red-500/25',
    solid: 'bg-red-600 text-white',
  },
  orange: {
    soft: 'bg-orange-500/10 text-orange-400',
    outline: 'bg-orange-500/5 text-orange-300 border border-orange-500/25',
    solid: 'bg-orange-600 text-white',
  },
  zinc: {
    soft: 'bg-zinc-800 text-zinc-500', // raw-zinc-ok — Badge zinc variant is intentional
    outline: 'bg-[var(--surface-2)] text-[var(--brand-text-muted)] border border-[var(--brand-border)]',
    solid: 'bg-zinc-700 text-zinc-100', // raw-zinc-ok — Badge zinc variant is intentional
  },
};

const BADGE_DOT_CLASSES: Record<BadgeTone, string> = {
  teal: 'bg-teal-400',
  blue: 'bg-blue-400',
  emerald: 'bg-emerald-400/80',
  amber: 'bg-amber-400/80',
  red: 'bg-red-400/80',
  orange: 'bg-orange-400',
  zinc: 'bg-zinc-500', // raw-zinc-ok — Badge zinc variant is intentional
};

const SIZE_CLASSES: Record<BadgeSize, string> = {
  sm: 't-caption-sm px-1.5 py-0.5 gap-1',
  md: 't-caption px-2 py-1 gap-1.5',
};

const SHAPE_CLASSES: Record<BadgeShape, string> = {
  sm: 'rounded-[var(--radius-sm)]',
  pill: 'rounded-[var(--radius-pill)]',
};

export function Badge({
  label,
  color,
  tone,
  variant = 'soft',
  size = 'sm',
  shape = 'sm',
  icon,
  dot = false,
  ariaLabel,
  className,
}: BadgeProps) {
  const resolvedTone = tone ?? color ?? 'zinc';
  const IconComponent = icon;

  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap font-medium normal-case tracking-normal',
        SIZE_CLASSES[size],
        SHAPE_CLASSES[shape],
        BADGE_TONE_CLASSES[resolvedTone]?.[variant] ?? BADGE_TONE_CLASSES.zinc.soft,
        className,
      )}
      aria-label={ariaLabel}
    >
      {dot && (
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-[var(--radius-pill)]', BADGE_DOT_CLASSES[resolvedTone])}
        />
      )}
      {IconComponent && <Icon as={IconComponent} size="sm" aria-hidden="true" />}
      {label}
    </span>
  );
}
