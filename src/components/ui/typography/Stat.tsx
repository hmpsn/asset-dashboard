import React from 'react';

export type StatSize = 'hero' | 'default' | 'sm';

export interface StatProps {
  size?: StatSize;
  className?: string;
  children?: React.ReactNode;
}

const SIZE_CLASS: Record<StatSize, string> = {
  hero: 't-stat-lg',
  default: 't-stat',
  sm: 't-stat-sm',
};

export const Stat = React.forwardRef<HTMLDivElement, StatProps>(
  ({ size = 'default', className, children }, ref) => {
    const typeClass = SIZE_CLASS[size];
    const combinedClass = [typeClass, className].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={combinedClass}>
        {children}
      </div>
    );
  }
);

Stat.displayName = 'Stat';
