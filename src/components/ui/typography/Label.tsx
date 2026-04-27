import React from 'react';
import { cn } from '../../../lib/utils';

export interface LabelProps extends React.HTMLAttributes<HTMLSpanElement> {}

export const Label = React.forwardRef<HTMLSpanElement, LabelProps>(
  ({ className, children, ...rest }, ref) => {
    return (
      <span ref={ref} className={cn('t-label', className)} {...rest}>
        {children}
      </span>
    );
  }
);

Label.displayName = 'Label';
