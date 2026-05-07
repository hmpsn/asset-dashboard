import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ClickableRowProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  active?: boolean;
  chevron?: boolean;
  children: React.ReactNode;
}

export const ClickableRow = React.forwardRef<HTMLButtonElement, ClickableRowProps>(
  function ClickableRow(
    { active = false, chevron = false, className, children, disabled, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        className={cn(
          'w-full text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-mint)]',
          active
            ? 'bg-[var(--surface-3)]/60'
            : 'hover:bg-[var(--surface-3)]/40',
          disabled && 'opacity-50 cursor-not-allowed pointer-events-none',
          chevron && 'flex items-start gap-3',
          className,
        )}
        {...rest}
      >
        {children}
        {chevron && (
          <ChevronDown
            className={cn(
              'w-4 h-4 text-[var(--brand-text-muted)] flex-shrink-0 mt-1 transition-transform',
              active && 'rotate-180',
            )}
            aria-hidden="true"
          />
        )}
      </button>
    );
  },
);

ClickableRow.displayName = 'ClickableRow';
