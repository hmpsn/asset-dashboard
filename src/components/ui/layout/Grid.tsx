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

const colsClass = (n: number): string => `grid-cols-${n}`;

function buildColsClasses(cols: GridCols): string[] {
  const classes: string[] = [];
  // Base grid-cols from the first defined breakpoint (used as the unresponsive base)
  const first = cols.sm ?? cols.md ?? cols.lg ?? cols.xl;
  if (first !== undefined) {
    classes.push(colsClass(first));
  }
  if (cols.sm !== undefined) classes.push(`sm:${colsClass(cols.sm)}`);
  if (cols.md !== undefined) classes.push(`md:${colsClass(cols.md)}`);
  if (cols.lg !== undefined) classes.push(`lg:${colsClass(cols.lg)}`);
  if (cols.xl !== undefined) classes.push(`xl:${colsClass(cols.xl)}`);
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
