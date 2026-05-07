/** @deprecated No consumers — remove if still unused by 2026-06-01. */
import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ActionPillVariant =
  | 'start'
  | 'approve'
  | 'decline'
  | 'send'
  | 'request-changes';

export interface ActionPillProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant: ActionPillVariant;
  icon?: LucideIcon;
  children?: React.ReactNode;
}

const VARIANT: Record<ActionPillVariant, string> = {
  start:
    'border-[color:color-mix(in_srgb,var(--teal)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--teal)_10%,transparent)] text-[var(--teal)] hover:bg-[color:color-mix(in_srgb,var(--teal)_15%,transparent)]',
  approve:
    'border-[color:color-mix(in_srgb,var(--emerald)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--emerald)_10%,transparent)] text-[var(--emerald)] hover:bg-[color:color-mix(in_srgb,var(--emerald)_15%,transparent)]',
  decline:
    'border-[color:color-mix(in_srgb,var(--red)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--red)_10%,transparent)] text-[var(--red)] hover:bg-[color:color-mix(in_srgb,var(--red)_15%,transparent)]',
  send:
    'border-[color:color-mix(in_srgb,var(--blue)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--blue)_10%,transparent)] text-[var(--blue)] hover:bg-[color:color-mix(in_srgb,var(--blue)_15%,transparent)]',
  'request-changes':
    'border-[color:color-mix(in_srgb,var(--amber)_30%,transparent)] bg-[color:color-mix(in_srgb,var(--amber)_10%,transparent)] text-[var(--amber)] hover:bg-[color:color-mix(in_srgb,var(--amber)_15%,transparent)]',
};

export const ActionPill = React.forwardRef<HTMLButtonElement, ActionPillProps>(function ActionPill(
  { variant, icon: Icon, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 border rounded-md t-caption-sm font-medium transition-colors',
        VARIANT[variant],
        disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
      {children}
    </button>
  );
});

ActionPill.displayName = 'ActionPill';
