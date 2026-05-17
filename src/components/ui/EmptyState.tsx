import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 gap-3 ${className ?? ''}`}>
      <div className="w-16 h-16 rounded-[var(--radius-xl)] bg-[var(--surface-3)] flex items-center justify-center">
        <Icon className="w-8 h-8 text-[var(--brand-text-muted)]" />
      </div>
      <p className="text-sm font-medium text-[var(--brand-text)]">{title}</p>
      {description && <p className="text-xs text-[var(--brand-text-muted)] max-w-md text-center">{description}</p>}
      {action}
    </div>
  );
}
