import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { SectionCard } from './SectionCard';
import { ClickableRow } from './ClickableRow';
import { Badge } from './Badge';
import { Icon } from './Icon';

export type AttentionSeverity = 'critical' | 'warning' | 'info';

export interface AttentionItem {
  id: string;
  label: string;
  sub?: string;
  severity: AttentionSeverity;
  icon?: LucideIcon;
  href?: string;
  onClick?: () => void;
  meta?: string;
  badge?: string;
}

export interface NeedsAttentionProps {
  items: AttentionItem[];
  title?: string;
  cap?: number;
  showCount?: boolean;
}

/** ONE severity → token map. INFO IS BLUE, never mint. */
const SEVERITY_COLOR: Record<AttentionSeverity, string> = {
  critical: 'text-accent-danger',
  warning: 'text-accent-warning',
  info: 'text-accent-info',
};

const SEVERITY_BADGE_TONE = {
  critical: 'red',
  warning: 'amber',
  info: 'blue',
} as const satisfies Record<AttentionSeverity, 'red' | 'amber' | 'blue'>;

function AttentionRow({ item }: { item: AttentionItem }) {
  const colorClass = SEVERITY_COLOR[item.severity];

  const inner = (
    <>
      {/* Leading icon */}
      {item.icon && (
        <span className={cn('flex-shrink-0', colorClass)}>
          <Icon as={item.icon} size="md" aria-hidden="true" />
        </span>
      )}

      {/* Label + sub */}
      <span className="flex-1 min-w-0 text-left">
        <span className="t-caption font-medium text-[var(--brand-text-bright)] block truncate">
          {item.label}
        </span>
        {item.sub && (
          <span className="t-caption-sm text-[var(--brand-text-muted)] block truncate">
            {item.sub}
          </span>
        )}
      </span>

      {/* Right side: meta + badge + chevron */}
      <span className="flex items-center gap-2 flex-shrink-0">
        {item.meta && (
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{item.meta}</span>
        )}
        {item.badge && (
          <Badge label={item.badge} tone={SEVERITY_BADGE_TONE[item.severity]} size="sm" />
        )}
        {/* Always-visible trailing chevron */}
        <Icon as={ChevronRight} size="sm" className="text-[var(--brand-text-muted)]" aria-hidden="true" />
      </span>
    </>
  );

  // Internal links render as a real react-router <Link> — client-side navigation
  // (no full-page reload, preserves React Query cache; middle-click / open-in-new-tab work).
  if (item.href) {
    return (
      <Link
        to={item.href}
        onClick={item.onClick}
        className="flex items-center gap-3 px-4 py-3 w-full text-left transition-colors hover:bg-[var(--surface-3)]/40 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brand-mint)]"
      >
        {inner}
      </Link>
    );
  }

  // Action rows (no href) stay as a ClickableRow button.
  return (
    <ClickableRow onClick={item.onClick} className="flex items-center gap-3 px-4 py-3">
      {inner}
    </ClickableRow>
  );
}

export function NeedsAttention({
  items,
  title = 'Needs Attention',
  cap,
  showCount = false,
}: NeedsAttentionProps) {
  const [expanded, setExpanded] = useState(false);

  const hasCritical = items.some(item => item.severity === 'critical');
  const hasWarning = !hasCritical && items.some(item => item.severity === 'warning');

  const accentAttr = hasCritical ? 'critical' : hasWarning ? 'warning' : undefined;

  // Which items to display
  const effectiveCap = cap !== undefined ? cap : items.length;
  const visibleItems = expanded ? items : items.slice(0, effectiveCap);
  const hiddenCount = items.length - effectiveCap;
  const canToggle = hiddenCount > 0;

  const displayTitle = showCount ? `${title} · ${items.length}` : title;

  // Accent left-border style when critical or warning items exist
  const accentStyle: React.CSSProperties | undefined = hasCritical
    ? { borderLeft: '3px solid var(--red)' }
    : hasWarning
    ? { borderLeft: '3px solid var(--amber)' }
    : undefined;

  return (
    <div
      data-attention-accent={accentAttr}
      style={accentStyle}
    >
      <SectionCard title={displayTitle} noPadding>
        <div className="divide-y divide-[var(--brand-border)]">
          {visibleItems.map(item => (
            <AttentionRow key={item.id} item={item} />
          ))}
        </div>

        {canToggle && (
          <div className="px-4 py-2 border-t border-[var(--brand-border)]">
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className={cn(
                'w-full text-left t-caption text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors',
              )}
            >
              {expanded ? 'Show less' : `Show ${hiddenCount} more`}
            </button>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
