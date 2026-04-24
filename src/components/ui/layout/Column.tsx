import React from 'react';
import { Stack, type StackAlign } from './Stack';
import type { GapSize } from './utils';

// HTMLAttributes.dir (text direction) conflicts with Stack's StackDir prop;
// Omit it here since Column locks the layout direction to 'col' regardless.
// Callers that need text-direction control can still pass it via className.
export interface ColumnProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'dir'> {
  gap?: GapSize;
  align?: StackAlign;
}

/**
 * Semantic alias for `<Stack dir="col">`. Stack's default `dir` is already
 * 'col', so `<Column>` and `<Stack>` with no props render identically —
 * Column exists to make vertical-stack intent explicit in call sites where
 * a horizontal Stack alternative is nearby.
 */
export const Column = React.forwardRef<HTMLDivElement, ColumnProps>(
  ({ gap, align, className, children, ...rest }, ref) => {
    return (
      <Stack ref={ref} dir="col" gap={gap} align={align} className={className} {...rest}>
        {children}
      </Stack>
    );
  }
);

Column.displayName = 'Column';
