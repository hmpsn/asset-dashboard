import React from 'react';
import { cn } from '../../../lib/utils';

export type CaptionSize = 'default' | 'sm';

export interface CaptionProps extends React.HTMLAttributes<HTMLSpanElement> {
  size?: CaptionSize;
}

const SIZE_CLASS: Record<CaptionSize, string> = {
  default: 't-caption',
  sm: 't-caption-sm',
};

export const Caption = React.forwardRef<HTMLSpanElement, CaptionProps>(
  ({ size = 'default', className, children, ...rest }, ref) => {
    return (
      <span ref={ref} className={cn(SIZE_CLASS[size], className)} {...rest}>
        {children}
      </span>
    );
  }
);

Caption.displayName = 'Caption';
