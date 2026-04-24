import React from 'react';

export type MonoSize = 'default' | 'micro';

export interface MonoProps {
  size?: MonoSize;
  className?: string;
  children?: React.ReactNode;
}

const SIZE_CLASS: Record<MonoSize, string> = {
  default: 't-mono',
  micro: 't-micro',
};

export const Mono = React.forwardRef<HTMLSpanElement, MonoProps>(
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

Mono.displayName = 'Mono';
