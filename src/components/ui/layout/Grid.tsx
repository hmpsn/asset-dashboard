import React from 'react';
import type { GapSize } from './Row';

export interface GridCols {
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

export interface GridProps {
  cols: GridCols;
  gap?: GapSize;
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

// Static maps for each breakpoint — full literal strings so Tailwind's scanner
// can detect them at build time. Template literals like `grid-cols-${n}` are
// not visible to the Tailwind v4 static scanner and would be purged in production.

const baseColsMap: Record<number, string> = {
  1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4',
  5: 'grid-cols-5', 6: 'grid-cols-6', 7: 'grid-cols-7', 8: 'grid-cols-8',
  9: 'grid-cols-9', 10: 'grid-cols-10', 11: 'grid-cols-11', 12: 'grid-cols-12',
};

const smColsMap: Record<number, string> = {
  1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3', 4: 'sm:grid-cols-4',
  5: 'sm:grid-cols-5', 6: 'sm:grid-cols-6', 7: 'sm:grid-cols-7', 8: 'sm:grid-cols-8',
  9: 'sm:grid-cols-9', 10: 'sm:grid-cols-10', 11: 'sm:grid-cols-11', 12: 'sm:grid-cols-12',
};

const mdColsMap: Record<number, string> = {
  1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4',
  5: 'md:grid-cols-5', 6: 'md:grid-cols-6', 7: 'md:grid-cols-7', 8: 'md:grid-cols-8',
  9: 'md:grid-cols-9', 10: 'md:grid-cols-10', 11: 'md:grid-cols-11', 12: 'md:grid-cols-12',
};

const lgColsMap: Record<number, string> = {
  1: 'lg:grid-cols-1', 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6', 7: 'lg:grid-cols-7', 8: 'lg:grid-cols-8',
  9: 'lg:grid-cols-9', 10: 'lg:grid-cols-10', 11: 'lg:grid-cols-11', 12: 'lg:grid-cols-12',
};

const xlColsMap: Record<number, string> = {
  1: 'xl:grid-cols-1', 2: 'xl:grid-cols-2', 3: 'xl:grid-cols-3', 4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5', 6: 'xl:grid-cols-6', 7: 'xl:grid-cols-7', 8: 'xl:grid-cols-8',
  9: 'xl:grid-cols-9', 10: 'xl:grid-cols-10', 11: 'xl:grid-cols-11', 12: 'xl:grid-cols-12',
};

function buildColsClasses(cols: GridCols): string[] {
  const classes: string[] = [];
  // NOTE: The first defined breakpoint value is also applied as the unresponsive
  // base class (e.g. cols={{ sm: 2 }} emits both 'grid-cols-2' and 'sm:grid-cols-2').
  // This is intentional: the base class covers viewports narrower than the first
  // explicit breakpoint so the grid is never zero-column.
  const first = cols.sm ?? cols.md ?? cols.lg ?? cols.xl;
  if (first !== undefined) {
    classes.push(baseColsMap[first] ?? `grid-cols-${first}`);
  }
  if (cols.sm !== undefined) classes.push(smColsMap[cols.sm] ?? `sm:grid-cols-${cols.sm}`);
  if (cols.md !== undefined) classes.push(mdColsMap[cols.md] ?? `md:grid-cols-${cols.md}`);
  if (cols.lg !== undefined) classes.push(lgColsMap[cols.lg] ?? `lg:grid-cols-${cols.lg}`);
  if (cols.xl !== undefined) classes.push(xlColsMap[cols.xl] ?? `xl:grid-cols-${cols.xl}`);
  return classes;
}

export const Grid = React.forwardRef<HTMLDivElement, GridProps>(
  ({ cols, gap, className, children }, ref) => {
    const classes = [
      'grid',
      ...buildColsClasses(cols),
      gap ? gapMap[gap] : '',
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

Grid.displayName = 'Grid';
