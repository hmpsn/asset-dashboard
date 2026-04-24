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
  start: 'border-teal-500/30 bg-teal-500/10 text-teal-400 hover:bg-teal-500/15',
  approve: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/15',
  decline: 'border-red-500/30 bg-red-500/10 text-red-400 hover:bg-red-500/15',
  send: 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/15',
  'request-changes':
    'border-amber-500/30 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15',
};

export const ActionPill = React.forwardRef<HTMLButtonElement, ActionPillProps>(function ActionPill(
  { variant, icon: Icon, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={rest.type ?? 'button'}
      disabled={disabled}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 border rounded-md text-[11px] font-medium transition-colors',
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
