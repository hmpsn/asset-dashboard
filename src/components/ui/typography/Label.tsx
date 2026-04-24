import React from 'react';

export interface LabelProps {
  className?: string;
  children?: React.ReactNode;
}

export const Label = React.forwardRef<HTMLSpanElement, LabelProps>(
  ({ className, children }, ref) => {
    const combinedClass = ['t-label', className].filter(Boolean).join(' ');
    return (
      <span ref={ref} className={combinedClass}>
        {children}
      </span>
    );
  }
);

Label.displayName = 'Label';
