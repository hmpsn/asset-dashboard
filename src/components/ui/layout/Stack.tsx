import React from 'react';
import { cn } from '../../../lib/utils';
import { gapMap, type GapSize } from './utils';

export type StackDir = 'col' | 'row';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: GapSize;
  dir?: StackDir;
  align?: StackAlign;
}

const alignMap: Record<StackAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ gap, dir = 'col', align, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex',
          dir === 'col' ? 'flex-col' : 'flex-row',
          gap && gapMap[gap],
          align && alignMap[align],
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Stack.displayName = 'Stack';
