import React from 'react';
import { cn } from '../../../lib/utils';

export type StatSize = 'hero' | 'default' | 'sm';

export interface StatProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: StatSize;
}

const SIZE_CLASS: Record<StatSize, string> = {
  hero: 't-stat-lg',
  default: 't-stat',
  sm: 't-stat-sm',
};

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ size = 'default', className, children, ...rest }, ref) => {
    return (
      <div ref={ref} className={cn(SIZE_CLASS[size], className)} {...rest}>
        {children}
      </div>
    );
  }
);

Stat.displayName = 'Stat';
