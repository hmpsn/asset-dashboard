import React from 'react';
import { cn } from '../../../lib/utils';

export type MonoSize = 'default' | 'micro';

export interface MonoProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: MonoSize;
}

const SIZE_CLASS: Record<MonoSize, string> = {
  default: 't-mono',
  micro: 't-micro',
};

export const Mono = React.forwardRef<HTMLSpanElement, MonoProps>(
  ({ size = 'default', className, children, ...rest }, ref) => {
    return (
      <span ref={ref} className={cn(SIZE_CLASS[size], className)} {...rest}>
        {children}
      </span>
    );
  }
);

Mono.displayName = 'Mono';
