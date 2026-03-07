import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PageHeader({ title, subtitle, icon, actions, className }: PageHeaderProps) {
  return (
    <div className={`flex items-center justify-between ${className ?? ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-zinc-200 truncate">{title}</h2>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
