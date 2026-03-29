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
}

export function SectionCard({ title, titleIcon, titleExtra, action, children, className, noPadding, interactive, staggerIndex }: SectionCardProps) {
  const hasHeader = title || action;

  const staggerStyle = staggerIndex !== undefined
    ? { animation: 'staggerFadeIn 0.4s cubic-bezier(0.22,0.61,0.36,1) both', animationDelay: `${staggerIndex * 60}ms` }
    : undefined;

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 transition-colors duration-200 ${interactive ? 'hover:border-zinc-700 hover:border-l-teal-500/40 cursor-pointer' : ''} ${className ?? ''}`}
      style={{ borderRadius: '10px 24px 10px 24px', ...staggerStyle }}
    >
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800" style={{ borderRadius: '10px 24px 0 0' }}>
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
