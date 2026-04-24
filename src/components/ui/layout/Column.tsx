import React from 'react';
import { Stack } from './Stack';
import type { StackAlign } from './Stack';
import type { GapSize } from './Row';

export interface ColumnProps {
  gap?: GapSize;
  align?: StackAlign;
  className?: string;
  children?: React.ReactNode;
}

export const Column = React.forwardRef<HTMLDivElement, ColumnProps>(
  ({ gap, align, className, children }, ref) => {
    return (
      <Stack ref={ref} dir="col" gap={gap} align={align} className={className}>
        {children}
      </Stack>
    );
  }
);

Column.displayName = 'Column';
