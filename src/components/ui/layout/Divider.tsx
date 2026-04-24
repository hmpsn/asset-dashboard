import React from 'react';

export type DividerOrientation = 'horizontal' | 'vertical';

export interface DividerProps {
  orientation?: DividerOrientation;
  className?: string;
}

export const Divider = React.forwardRef<HTMLDivElement, DividerProps>(
  ({ orientation = 'horizontal', className }, ref) => {
    if (orientation === 'vertical') {
      const classes = [
        'border-r border-[var(--brand-border)] h-full',
        className ?? '',
      ]
        .filter(Boolean)
        .join(' ');
      return <div ref={ref} className={classes} role="separator" aria-orientation="vertical" />;
    }

    const classes = [
      'border-b border-[var(--brand-border)] w-full',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');
    return <div ref={ref} className={classes} role="separator" aria-orientation="horizontal" />;
  }
);

Divider.displayName = 'Divider';
