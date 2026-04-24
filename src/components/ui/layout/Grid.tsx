import React from 'react';
import { cn } from '../../../lib/utils';
import { gapMap, type GapSize } from './utils';

/**
 * Valid column counts for Grid — 1-12 matches Tailwind's default grid-cols-*
 * utilities. Narrowed from `number` so Tailwind's static scanner always sees
 * a literal class string; passing an unsupported value is a TypeScript error.
 */
export type GridColCount = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export interface GridCols {
  sm?: GridColCount;
  md?: GridColCount;
  lg?: GridColCount;
  xl?: GridColCount;
}

export interface GridProps extends React.HTMLAttributes<HTMLDivElement> {
  cols: GridCols;
  gap?: GapSize;
}

// Static maps for each breakpoint — full literal strings so Tailwind's scanner
// can detect them at build time. Template literals like `grid-cols-${n}` are
// not visible to the Tailwind v4 static scanner and would be purged in
// production builds.

const baseColsMap: Record<GridColCount, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4',
  5: 'grid-cols-5', 6: 'grid-cols-6', 7: 'grid-cols-7', 8: 'grid-cols-8',
  9: 'grid-cols-9', 10: 'grid-cols-10', 11: 'grid-cols-11', 12: 'grid-cols-12',
};

const smColsMap: Record<GridColCount, string> = {
  1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7', 8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9', 10: 'sm:grid-cols-10', 11: 'sm:grid-cols-11', 12: 'sm:grid-cols-12',
};

const mdColsMap: Record<GridColCount, string> = {
  1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4',
  5: 'md:grid-cols-5', 6: 'md:grid-cols-6', 7: 'md:grid-cols-7', 8: 'md:grid-cols-8',
  9: 'md:grid-cols-9', 10: 'md:grid-cols-10', 11: 'md:grid-cols-11', 12: 'md:grid-cols-12',
};

const lgColsMap: Record<GridColCount, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7', 8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9', 10: 'lg:grid-cols-10', 11: 'lg:grid-cols-11', 12: 'lg:grid-cols-12',
};

const xlColsMap: Record<GridColCount, string> = {
  1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7', 8: 'xl:grid-cols-8',
  9: 'xl:grid-cols-9', 10: 'xl:grid-cols-10', 11: 'xl:grid-cols-11', 12: 'xl:grid-cols-12',
};

function buildColsClasses(cols: GridCols): Array<string | undefined> {
  // NOTE: The first defined breakpoint value is also applied as the
  // unresponsive base class (e.g. cols={{ sm: 2 }} emits both 'grid-cols-2'
  // and 'sm:grid-cols-2'). This is intentional: the base class covers
  // viewports narrower than the first explicit breakpoint so the grid is
  // never zero-column.
  const first = cols.sm ?? cols.md ?? cols.lg ?? cols.xl;
  return [
    first !== undefined ? baseColsMap[first] : undefined,
    cols.sm !== undefined ? smColsMap[cols.sm] : undefined,
    cols.md !== undefined ? mdColsMap[cols.md] : undefined,
    cols.lg !== undefined ? lgColsMap[cols.lg] : undefined,
    cols.xl !== undefined ? xlColsMap[cols.xl] : undefined,
  ];
}

export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  ({ cols, gap, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'grid',
          ...buildColsClasses(cols),
          gap && gapMap[gap],
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Grid.displayName = 'Grid';
