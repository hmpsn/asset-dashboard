import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  variant?: 'default' | 'rebuilt-admin';
}

export function PageHeader({ title, subtitle, icon, actions, className, variant = 'default' }: PageHeaderProps) {
  if (variant === 'rebuilt-admin') {
    return (
      <div className={`flex flex-wrap items-start justify-between gap-5 ${className ?? ''}`}>
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="t-h1 break-words text-[var(--brand-text-bright)]">{title}</h2>
            {subtitle && (
              <p className="mt-2 max-w-prose whitespace-normal t-body text-[var(--brand-text-muted)]">{subtitle}</p>
            )}
          </div>
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between ${className ?? ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 className="t-h2 text-[var(--brand-text-bright)] truncate">{title}</h2>
          {subtitle && <p className="t-caption-sm text-[var(--brand-text-muted)] mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
