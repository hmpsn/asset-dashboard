import { CheckCircle2, Circle, Clock } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Priority, Status } from './roadmapFilters';

type BadgeColor = 'red' | 'orange' | 'amber' | 'green' | 'zinc';

export const PRIORITY_BADGE: Record<Priority, { label: string; color: BadgeColor }> = {
  P0: { label: 'P0', color: 'red' },
  P1: { label: 'P1', color: 'orange' },
  P2: { label: 'P2', color: 'amber' },
  P3: { label: 'P3', color: 'green' },
  P4: { label: 'P4', color: 'zinc' },
};

export const STATUS_ICON: Record<Status, ReactNode> = {
  done: <CheckCircle2 className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />,
  in_progress: <Clock className="w-3.5 h-3.5 text-teal-400 animate-pulse flex-shrink-0" />,
  pending: <Circle className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" />,
};

interface ChipProps {
  children: ReactNode;
  nowrap?: boolean;
}

export function FeatureChip({ children, nowrap }: ChipProps) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/10 text-teal-400 border border-teal-500/20${nowrap ? ' whitespace-nowrap' : ''}`}
    >
      {children}
    </span>
  );
}

export function TagChip({ children, nowrap }: ChipProps) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700${nowrap ? ' whitespace-nowrap' : ''}`}
    >
      {children}
    </span>
  );
}
