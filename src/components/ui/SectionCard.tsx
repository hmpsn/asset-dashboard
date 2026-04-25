import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  titleIcon?: ReactNode;
  /**
   * Small adornment rendered INSIDE the left title cluster, immediately after the title
   * (e.g., a count badge "3 / 10", a tier pill, a status dot). Because it sits in the
   * left-aligned flex group, `ml-auto` on a child of `titleExtra` has no effect — the
   * cluster has no `flex-grow`, so it does not consume the remaining space.
   * For anything that should push to the right edge (date picker, export link, order
   * count, tier badge, "View all"), use `action` instead.
   */
  titleExtra?: ReactNode;
  /**
   * Right-aligned slot in the header row. The outer flex uses `justify-between`, so
   * `action` naturally hugs the right edge. Use this for buttons, toggles, date range
   * selectors, small muted counts/metadata, or anything that was previously marked with
   * `ml-auto` in a hand-rolled card.
   */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
  /** Enables teal left-border accent on hover for clickable cards */
  interactive?: boolean;
  /** Stagger animation index (0-based). Each index adds 60ms delay. */
  staggerIndex?: number;
  /**
   * Visual variant.
   * - `'default'` — solid `bg-[var(--surface-2)]` with the brand asymmetric `10px 24px 10px 24px` border-radius.
   *   Use for top-level page sections (the canonical look).
   * - `'subtle'` — semi-transparent `bg-[var(--surface-2)]/40` with standard symmetric `rounded-lg`.
   *   Use as a wrapper around dense tables / row lists where the asymmetric corners would clash
   *   with internal rows or where the card sits inside another section. Adds `overflow-hidden`
   *   so child tables clip cleanly against the rounded corners.
   */
  variant?: 'default' | 'subtle';
}

export function SectionCard({ title, titleIcon, titleExtra, action, children, className, noPadding, interactive, staggerIndex, variant = 'default' }: SectionCardProps) {
  const hasHeader = title || action || titleExtra;

  const staggerStyle = staggerIndex !== undefined
    ? { animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both', animationDelay: `${staggerIndex * 60}ms` }
    : undefined;

  const isSubtle = variant === 'subtle';
  const containerClasses = isSubtle
    ? 'bg-[var(--surface-2)]/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-[var(--surface-2)] border border-zinc-800 transition-colors duration-200';
  const interactiveClasses = interactive ? 'hover:border-zinc-700 hover:border-l-teal-500/40 cursor-pointer' : '';
  const containerStyle = isSubtle
    ? staggerStyle
    : { borderRadius: '10px 24px 10px 24px', ...staggerStyle };
  const headerStyle = isSubtle ? undefined : { borderRadius: '10px 24px 0 0' };

  return (
    <div
      className={`${containerClasses} ${interactiveClasses} ${className ?? ''}`}
      style={containerStyle}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800" style={headerStyle}>
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            <span className="text-sm font-semibold text-zinc-200">{title}</span>
            {titleExtra}
          </div>
          {action}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  );
}
