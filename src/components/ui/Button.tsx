import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconPosition?: 'left' | 'right';
  loading?: boolean;
  children?: React.ReactNode;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-r from-[var(--teal)] to-[var(--emerald)] text-[var(--button-primary-text)] font-semibold shadow-sm hover:shadow-md',
  secondary:
    'bg-[var(--surface-3)] hover:bg-[var(--surface-active)] border border-[var(--brand-border-hover)] text-[var(--brand-text-bright)]',
  ghost:
    'bg-transparent hover:bg-[var(--surface-3)]/70 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]',
  danger: 'bg-[var(--red)] hover:opacity-90 text-white',
  link: 'text-[var(--teal)] hover:opacity-90 underline underline-offset-2 bg-transparent p-0',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 t-caption-sm',
  md: 'px-4 py-2 t-caption',
  lg: 'px-5 py-2.5 t-body',
};

const ICON_SIZE: Record<ButtonSize, string> = {
  sm: 'w-3 h-3',
  md: 'w-3.5 h-3.5',
  lg: 'w-4 h-4',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    icon: Icon,
    iconPosition = 'left',
    loading = false,
    disabled,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  const showIcon = Icon && !loading;
  const iconClass = ICON_SIZE[size];
  const isLink = variant === 'link';
  const sizeClass = isLink ? '' : SIZE[size];

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors',
        sizeClass,
        VARIANT[variant],
        isDisabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className={cn(iconClass, 'animate-spin')} aria-hidden="true" />}
      {showIcon && iconPosition === 'left' && <Icon className={iconClass} aria-hidden="true" />}
      {children}
      {showIcon && iconPosition === 'right' && <Icon className={iconClass} aria-hidden="true" />}
    </button>
  );
});

Button.displayName = 'Button';
