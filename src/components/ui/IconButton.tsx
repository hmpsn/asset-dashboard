import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'solid' | 'accent' | 'danger';

export interface IconButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'> {
  icon: LucideIcon;
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  /** Required for accessibility — describes the action. */
  label: string;
}

const SIZE: Record<IconButtonSize, string> = {
  sm: 'w-6 h-6',
  md: 'w-8 h-8',
  lg: 'w-10 h-10',
};

const ICON_SIZE: Record<IconButtonSize, string> = {
  sm: 'w-3.5 h-3.5',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
};

const VARIANT: Record<IconButtonVariant, string> = {
  ghost:
    'bg-transparent hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]',
  solid:
    'bg-[var(--surface-3)] hover:bg-[var(--surface-active)] text-[var(--brand-text-bright)]',
  accent:
    'bg-gradient-to-r from-[var(--teal)] to-[var(--emerald)] text-[var(--button-primary-text)] hover:brightness-105',
  danger:
    'bg-transparent hover:bg-[color:color-mix(in_srgb,var(--red)_10%,transparent)] text-[var(--brand-text-muted)] hover:text-[var(--red)]',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, size = 'md', variant = 'ghost', label, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-colors',
        SIZE[size],
        VARIANT[variant],
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className,
      )}
      {...rest}
    >
      <Icon className={ICON_SIZE[size]} aria-hidden="true" />
    </button>
  );
});

IconButton.displayName = 'IconButton';
