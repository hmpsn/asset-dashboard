import type { ReactNode } from 'react';

interface SectionCardProps {
  title?: string;
  titleIcon?: ReactNode;
  titleExtra?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function SectionCard({ title, titleIcon, titleExtra, action, children, className, noPadding }: SectionCardProps) {
  const hasHeader = title || action;
  return (
    <div className={`bg-zinc-900 rounded-xl border border-zinc-800 ${hasHeader ? 'overflow-hidden' : ''} ${className ?? ''}`}>
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <div className="flex items-center gap-2 min-w-0">
            {titleIcon}
            <span className="text-sm font-medium text-zinc-300">{title}</span>
            {titleExtra}
          </div>
          {action}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>{children}</div>
    </div>
  );
}
