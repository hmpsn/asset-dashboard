import React from 'react';
import type { LucideIcon } from 'lucide-react';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface IconProps extends React.HTMLAttributes<HTMLDivElement> {
  as: LucideIcon;
  size?: IconSize;
  className?: string;
}

const SIZE_MAP: Record<IconSize, string> = {
  xs: 'w-2 h-2',
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
  '2xl': 'w-8 h-8',
};

export const Icon = React.forwardRef<HTMLDivElement, IconProps>(
  ({ as: Component, size = 'md', className = '', ...rest }, ref) => {
    const sizeClass = SIZE_MAP[size];
    const combined = `${sizeClass}${className ? ' ' + className : ''}`;

    return (
      <div ref={ref} className={combined} {...rest}>
        <Component className="w-full h-full" />
      </div>
    );
  }
);
