import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  as: LucideIcon;
  size?: IconSize;
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
 * Inline icon wrapper around any Lucide component. Renders a <span> so it is
 * safe inside <p>, <li>, or any inline-flow container. The wrapper is
 * `inline-flex` so the SVG sits flush with surrounding text.
 *
 * Accessibility: the inner SVG is marked `aria-hidden="true"` (decorative
 * default — screen readers skip the icon). For a semantic icon that conveys
 * meaning on its own, pass `aria-label` as a prop — it is forwarded to the
 * <span> wrapper via the HTMLAttributes rest spread, and assistive tech
 * will announce the label instead of ignoring the icon.
 */
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { as: Component, size = 'md', className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn('inline-flex items-center justify-center', SIZE_MAP[size], className)}
      {...rest}
    >
      <Component className="w-full h-full" aria-hidden="true" />
    </span>
  );
});

Icon.displayName = 'Icon';
