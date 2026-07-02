/**
 * SectionLabel — canonical top-level page section kicker.
 *
 * Usage convention:
 *   - Top-level page sections use <SectionLabel> (this component).
 *   - SectionCard headers are for cards WITHIN a section (see SectionCard's `title` prop).
 *   - <summary> is only for use inside <Disclosure> (collapsible) elements.
 */
import React from 'react';
import { cn } from '../../lib/utils';

export function SectionLabel({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        't-label',
        'uppercase',
        'tracking-wider',
        'text-[var(--brand-text-muted)]',
        className,
      )}
    >
      {children}
    </p>
  );
}
