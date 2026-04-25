import React from 'react';
import { cn } from '../../../lib/utils';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: DividerOrientation;
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ orientation = 'horizontal', className, ...rest }, ref) => {
    const base =
      orientation === 'vertical'
        ? 'border-r border-[var(--brand-border)] h-full'
        : 'border-b border-[var(--brand-border)] w-full';
    return (
      <div
        ref={ref}
        className={cn(base, className)}
        role="separator"
        aria-orientation={orientation}
        {...rest}
      />
    );
  }
);

Divider.displayName = 'Divider';
