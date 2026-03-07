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
      <div className="w-16 h-16 rounded-2xl bg-zinc-800 flex items-center justify-center">
        <Icon className="w-8 h-8 text-zinc-400" />
      </div>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      {description && <p className="text-xs text-zinc-400 max-w-md text-center">{description}</p>}
      {action}
    </div>
  );
}
