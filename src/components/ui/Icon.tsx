import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import { ICON_NAMES } from './iconNames';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

export interface IconProps extends React.HTMLAttributes<HTMLSpanElement> {
  /**
   * Semantic key from ICON_NAMES → a Font Awesome Sharp Regular glyph (the icon
   * system of record). Preferred for new code.
   */
  name?: string;
  /** Raw Font Awesome classes, e.g. "fa-sharp fa-solid fa-star". Overrides `name`. */
  fa?: string;
  /** FA family prefix used with `name`. Default "fa-sharp fa-regular". */
  family?: string;
  /**
   * A lucide-react component. Supported during the incremental lucide→FA
   * migration; existing call sites keep working unchanged. Prefer `name`.
   */
  as?: LucideIcon;
  size?: IconSize;
}

// Tailwind box classes for the lucide (`as`) path.
const SIZE_MAP: Record<IconSize, string> = {
  xs: 'w-2 h-2',
  sm: 'w-3 h-3',
  md: 'w-4 h-4',
  lg: 'w-5 h-5',
  xl: 'w-6 h-6',
  '2xl': 'w-8 h-8',
};

// Pixel font-size for the Font Awesome (`name`/`fa`) path — matches SIZE_MAP's rem box.
const SIZE_PX: Record<IconSize, number> = {
  xs: 8, sm: 12, md: 16, lg: 20, xl: 24, '2xl': 32,
};

/**
 * Inline icon wrapper. Renders a `<span>` so it is safe inside `<p>`, `<li>`, or
 * any inline-flow container. Two glyph sources:
 *   1. `name` (from ICON_NAMES) or `fa` → a Font Awesome Sharp Regular glyph
 *      (`<i class="fa-sharp fa-regular fa-…">`). The icon system of record (D5).
 *   2. `as` → a lucide-react component (supported during the migration).
 *
 * Accessibility: the glyph is `aria-hidden` (decorative) by default. Pass
 * `aria-label` for a semantic icon — it is forwarded to the `<span>` and the
 * wrapper gains `role="img"` so screen readers announce it.
 */
export const Icon = React.forwardRef<HTMLSpanElement, IconProps>(function Icon(
  { name, fa, family = 'fa-sharp fa-regular', as: Component, size = 'md', className, ...rest },
  ref,
) {
  // When the consumer passes aria-label / aria-labelledby, the <span> becomes a
  // semantic image. role="img" so all screen readers announce it — a bare <span>
  // with aria-label is not guaranteed to be announced per ARIA.
  const isSemantic = 'aria-label' in rest || 'aria-labelledby' in rest;

  // Font Awesome path (name / fa) — the icon system of record.
  if (fa || name) {
    const glyphClass = fa ?? `${family} fa-${ICON_NAMES[name as keyof typeof ICON_NAMES] ?? name}`;
    return (
      <span
        ref={ref}
        role={isSemantic ? 'img' : undefined}
        className={cn('inline-flex items-center justify-center leading-none', className)}
        {...rest}
      >
        <i className={glyphClass} style={{ fontSize: SIZE_PX[size] }} aria-hidden="true" />
      </span>
    );
  }

  // lucide path (`as`) — migration compatibility.
  if (Component) {
    return (
      <span
        ref={ref}
        role={isSemantic ? 'img' : undefined}
        className={cn('inline-flex items-center justify-center', SIZE_MAP[size], className)}
        {...rest}
      >
        <Component className="w-full h-full" aria-hidden="true" />
      </span>
    );
  }

  // Nothing to render (no name/fa/as) — return an empty, correctly-sized span
  // rather than throwing, so a missing icon never crashes a surface.
  return (
    <span
      ref={ref}
      role={isSemantic ? 'img' : undefined}
      className={cn('inline-flex items-center justify-center', SIZE_MAP[size], className)}
      {...rest}
    />
  );
});

Icon.displayName = 'Icon';
