import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  titleIcon?: ReactNode;
  titleExtra?: ReactNode;
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
   * - `'default'` — solid `bg-zinc-900` with the brand asymmetric `10px 24px 10px 24px` border-radius.
   *   Use for top-level page sections (the canonical look).
   * - `'subtle'` — semi-transparent `bg-zinc-900/40` with standard symmetric `rounded-lg`.
   *   Use as a wrapper around dense tables / row lists where the asymmetric corners would clash
   *   with internal rows or where the card sits inside another section. Adds `overflow-hidden`
   *   so child tables clip cleanly against the rounded corners.
   */
  variant?: 'default' | 'subtle';
}

export function SectionCard({ title, titleIcon, titleExtra, action, children, className, noPadding, interactive, staggerIndex, variant = 'default' }: SectionCardProps) {
  const hasHeader = title || action;

  const staggerStyle = staggerIndex !== undefined
    ? { animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both', animationDelay: `${staggerIndex * 60}ms` }
    : undefined;

  const isSubtle = variant === 'subtle';
  const containerClasses = isSubtle
    ? 'bg-zinc-900/40 border border-zinc-800 rounded-lg overflow-hidden transition-colors duration-200'
    : 'bg-zinc-900 border border-zinc-800 transition-colors duration-200';
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
