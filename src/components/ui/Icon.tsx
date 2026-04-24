import React from 'react';
import type { LucideIcon } from 'lucide-react';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
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

/**
 * Inline icon wrapper around any Lucide component. Renders a <span> so it can
 * be used inline within text or layout-flow containers (e.g. inside <p>, <li>,
 * or alongside text in flex rows). The wrapper is `inline-flex` so the SVG
 * sits flush with surrounding text.
 */
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(
  ({ as: Component, size = 'md', className = '', ...rest }, ref) => {
    const sizeClass = SIZE_MAP[size];
    const combined = `inline-flex items-center justify-center ${sizeClass}${className ? ' ' + className : ''}`;

    return (
      <span ref={ref} className={combined} {...rest}>
        <Component className="w-full h-full" />
      </span>
    );
  }
);
