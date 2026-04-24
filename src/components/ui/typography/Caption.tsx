import React from 'react';

export type CaptionSize = 'default' | 'sm';

export interface CaptionProps {
  size?: CaptionSize;
  className?: string;
  children?: React.ReactNode;
}

const SIZE_CLASS: Record<CaptionSize, string> = {
  default: 't-caption',
  sm: 't-caption-sm',
};

export const Caption = React.forwardRef<HTMLSpanElement, CaptionProps>(
  ({ size = 'default', className, children }, ref) => {
    const typeClass = SIZE_CLASS[size];
    const combinedClass = [typeClass, className].filter(Boolean).join(' ');
    return (
      <span ref={ref} className={combinedClass}>
        {children}
      </span>
    );
  }
);

Caption.displayName = 'Caption';
