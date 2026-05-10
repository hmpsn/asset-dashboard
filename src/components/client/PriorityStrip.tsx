// src/components/client/PriorityStrip.tsx
import type { LucideIcon } from 'lucide-react';
import { CheckCircle } from 'lucide-react';
import { Icon } from '../ui';

const SECTION_LABELS: Record<string, string> = {
  decisions: 'Decisions',
  conversations: 'Conversations',
  reviews: 'Reviews',
};

const SECTION_CHIP_CLASS: Record<string, string> = {
  decisions: 'bg-amber-500/15 text-accent-warning border-amber-500/30',
  conversations: 'bg-blue-500/15 text-accent-info border-blue-500/30',
  reviews: 'bg-blue-500/15 text-accent-info border-blue-500/30',
};

const SECTION_ICON_CLASS: Record<string, string> = {
  decisions: 'text-accent-warning',
  conversations: 'text-accent-info',
  reviews: 'text-accent-info',
};

export interface PriorityItem {
  id: string;
  icon: LucideIcon;
  title: string;
  section: 'decisions' | 'conversations' | 'reviews';
  ctaLabel: string;
  onCta: () => void;
}

interface PriorityStripProps {
  items: PriorityItem[];
  /** When true (and items is empty), renders the green "all caught up" state */
  showAllCaughtUp?: boolean;
}

export function PriorityStrip({ items, showAllCaughtUp = false }: PriorityStripProps) {
  if (items.length === 0 && !showAllCaughtUp) return null;

  if (items.length === 0 && showAllCaughtUp) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-[var(--radius-xl)] bg-emerald-500/10 border border-emerald-500/25">
        <Icon as={CheckCircle} size="sm" className="text-accent-success flex-shrink-0" />
        <p className="t-ui font-medium text-accent-success">You're all caught up</p>
        <p className="t-caption text-[var(--brand-text-muted)]">No pending items need your attention right now.</p>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--brand-border)]">
        <p className="t-caption font-semibold text-[var(--brand-text-muted)] uppercase tracking-wider">Needs your attention</p>
      </div>
      <ul className="divide-y divide-[var(--brand-border)]">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-3 px-4 py-3">
            <Icon as={item.icon} size="sm" className={`${SECTION_ICON_CLASS[item.section] ?? 'text-accent-warning'} flex-shrink-0`} />
            <span className="t-ui text-[var(--brand-text)] flex-1 min-w-0 truncate">{item.title}</span>
            <span
              className={`flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-[var(--radius-pill)] t-caption-sm font-medium border ${SECTION_CHIP_CLASS[item.section] ?? ''}`}
            >
              {SECTION_LABELS[item.section] ?? item.section}
            </span>
            <button
              type="button"
              onClick={item.onCta}
              aria-label={`${item.ctaLabel} ${item.title}`}
              className="flex-shrink-0 t-caption font-medium text-accent-brand hover:text-[var(--brand-text-bright)] transition-colors min-h-[36px] px-2"
            >
              {item.ctaLabel}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
