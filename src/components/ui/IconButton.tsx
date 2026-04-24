import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'ghost' | 'solid';

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
  ghost: 'bg-transparent hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200',
  solid: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200',
};

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, size = 'md', variant = 'ghost', label, disabled, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
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
