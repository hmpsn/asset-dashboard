import React from 'react';
import { cn } from '../../../lib/utils';
import { gapMap, type GapSize } from './utils';

export type { GapSize } from './utils';
export type RowAlign = 'start' | 'center' | 'end' | 'baseline';
export type RowJustify = 'start' | 'center' | 'end' | 'between' | 'around';

export interface RowProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: GapSize;
  align?: RowAlign;
  justify?: RowJustify;
  wrap?: boolean;
}

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
  ({ gap, align = 'center', justify, wrap, className, children, ...rest }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          'flex flex-row',
          alignMap[align],
          gap && gapMap[gap],
          justify && justifyMap[justify],
          wrap !== undefined && (wrap ? 'flex-wrap' : 'flex-nowrap'),
          className,
        )}
        {...rest}
      >
        {children}
      </div>
    );
  }
);

Row.displayName = 'Row';
