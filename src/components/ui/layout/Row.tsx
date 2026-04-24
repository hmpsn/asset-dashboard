import React from 'react';

export type GapSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type RowAlign = 'start' | 'center' | 'end' | 'baseline';
export type RowJustify = 'start' | 'center' | 'end' | 'between' | 'around';

export interface RowProps {
  gap?: GapSize;
  align?: RowAlign;
  justify?: RowJustify;
  wrap?: boolean;
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

const alignMap: Record<RowAlign, string> = {
  start: 'items-start',
  center: 'items-center',
  end: 'items-end',
  baseline: 'items-baseline',
};

const justifyMap: Record<RowJustify, string> = {
  start: 'justify-start',
  center: 'justify-center',
  end: 'justify-end',
  between: 'justify-between',
  around: 'justify-around',
};

export const Row = React.forwardRef<HTMLDivElement, RowProps>(
  ({ gap, align = 'center', justify, wrap, className, children }, ref) => {
    const classes = [
      'flex flex-row',
      alignMap[align],
      gap ? gapMap[gap] : '',
      justify ? justifyMap[justify] : '',
      wrap !== undefined ? (wrap ? 'flex-wrap' : 'flex-nowrap') : '',
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

Row.displayName = 'Row';
