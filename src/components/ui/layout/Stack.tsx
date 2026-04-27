import React from 'react';
import { cn } from '../../../lib/utils';
import { gapMap, type GapSize } from './utils';

export type StackDir = 'col' | 'row';
export type StackAlign = 'start' | 'center' | 'end' | 'stretch';

// HTMLAttributes.dir (text direction: ltr/rtl/auto) conflicts with Stack's
// layout-direction prop; Omit the HTML attribute so `dir` here
// unambiguously controls flex-direction. Callers that need RTL text
// direction can apply it via className or on a wrapping element.
export interface StackProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'dir'> {
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
