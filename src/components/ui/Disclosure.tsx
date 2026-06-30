import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Badge } from './Badge';
import type { BadgeTone } from './Badge';
import { Icon } from './Icon';

export type { BadgeTone };

export interface DisclosureProps {
  summary: React.ReactNode;
  badges?: Array<{ label: string; tone?: BadgeTone }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
}

/**
 * Accessible disclosure widget built on native `<details>`/`<summary>`.
 *
 * - Keyboard operability (Space/Enter/click) comes for free from the browser.
 * - Uses `--radius-lg` (NOT `--radius-signature` which is reserved for StatCard/SectionCard).
 * - Chevron rotation is gated under `motion-safe:` so reduced-motion users skip the animation.
 * - Respects Tailwind's `group` / `group-open` mechanism for the open state chevron.
 */
export function Disclosure({
  summary,
  badges,
  defaultOpen,
  children,
  className,
}: DisclosureProps) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        // Surface + border using tokens only
        'group bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)]',
        className,
      )}
    >
      {/* Native <summary> provides free keyboard operability */}
      <summary
        className={cn(
          'flex cursor-pointer list-none items-center gap-2 px-4 py-3',
          't-ui text-[var(--brand-text-bright)] font-semibold',
          // Focus ring using the brand mint token
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-mint)]',
          // Remove default disclosure marker in WebKit
          '[&::-webkit-details-marker]:hidden',
        )}
      >
        {/* Summary label */}
        <span className="flex-1 min-w-0">{summary}</span>

        {/* Inline badges */}
        {badges && badges.length > 0 && (
          <span className="flex items-center gap-1.5">
            {badges.map((badge, i) => (
              <Badge key={i} label={badge.label} tone={badge.tone} />
            ))}
          </span>
        )}

        {/* Trailing chevron — rotation gated under motion-safe: */}
        <Icon
          as={ChevronDown}
          size="md"
          aria-hidden="true"
          data-disclosure-chevron=""
          className={cn(
            'flex-shrink-0 text-[var(--brand-text-muted)]',
            // Transition only for users who haven't opted into reduced motion
            'motion-safe:transition-transform',
            // Rotate when <details> is open (group-open targets the <details> ancestor)
            'group-open:rotate-180',
          )}
        />
      </summary>

      {/* Disclosure body */}
      <div className="px-4 pb-4 pt-0">{children}</div>
    </details>
  );
}

Disclosure.displayName = 'Disclosure';
