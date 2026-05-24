import type { ReactNode } from 'react';

import { cn } from '../../lib/utils';

interface KeywordDetailPanelProps {
  children: ReactNode;
  className?: string;
  tone?: 'default' | 'amber' | 'blue';
}

export function KeywordDetailPanel({ children, className, tone = 'default' }: KeywordDetailPanelProps) {
  const toneClass = {
    default: 'border-[var(--brand-border)] bg-[var(--surface-3)]/40',
    amber: 'border-amber-400/30 bg-amber-400/5',
    blue: 'border-blue-500/20 bg-blue-500/8',
  }[tone];

  return (
    <div className={cn('rounded-[var(--radius-lg)] border p-3', toneClass, className)}>
      {children}
    </div>
  );
}
