import React from 'react';
import type { GapSize } from './Row';

export type StackDir = 'col' | 'row';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

export interface StackProps {
  gap?: GapSize;
  dir?: StackDir;
  align?: StackAlign;
  className?: string;
  children?: React.ReactNode;
}

const gapMap: Record<GapSize, string> = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
};

const alignMap: Record<StackAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  stretch: 'items-stretch',
};

export const Stack = React.forwardRef<HTMLDivElement, StackProps>(
  ({ gap, dir = 'col', align, className, children }, ref) => {
    const classes = [
      'flex',
      dir === 'col' ? 'flex-col' : 'flex-row',
      gap ? gapMap[gap] : '',
      align ? alignMap[align] : '',
      className ?? '',
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div ref={ref} className={classes}>
        {children}
      </div>
    );
  }
);

Stack.displayName = 'Stack';
