import type { ReactNode } from 'react';
import type { InboxFilter } from './inbox-filter';
import type { InboxMode } from './useInboxTabShell';

interface NewFilterChip {
  id: InboxFilter;
  label: string;
  count?: number;
}

interface LegacyFilterChip {
  id: InboxFilter;
  label: string;
  count?: number;
}

interface NewInboxLayoutProps {
  mode: InboxMode;
  filter: InboxFilter;
  setFilter: (value: InboxFilter) => void;
  filterChips: NewFilterChip[];
  children: ReactNode;
}

interface LegacyInboxLayoutProps {
  mode: InboxMode;
  filter: InboxFilter;
  setFilter: (value: InboxFilter) => void;
  filterChips: LegacyFilterChip[];
  children: ReactNode;
}

function Chip({
  selected,
  label,
  count,
  onClick,
}: {
  selected: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-[var(--radius-pill)] t-caption-sm font-medium transition-colors ${
        selected
          ? 'bg-teal-500/15 border border-teal-500/30 text-accent-brand'
          : 'bg-[var(--surface-3)]/50 border border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded-[var(--radius-pill)] t-caption-sm font-semibold ${
          selected ? 'bg-teal-500/20 text-accent-brand' : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)]'
        }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function NewInboxLayout({
  mode,
  filter,
  setFilter,
  filterChips,
  children,
}: NewInboxLayoutProps) {
  return (
    <>
      {mode === 'active' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map((chip) => (
            <Chip
              key={chip.id}
              selected={filter === chip.id}
              label={chip.label}
              count={chip.count}
              onClick={() => setFilter(chip.id)}
            />
          ))}
        </div>
      )}
      {children}
    </>
  );
}

export function LegacyInboxLayout({
  mode,
  filter,
  setFilter,
  filterChips,
  children,
}: LegacyInboxLayoutProps) {
  return (
    <>
      {mode === 'active' && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {filterChips.map((chip) => (
            <Chip
              key={chip.id}
              selected={filter === chip.id}
              label={chip.label}
              count={chip.count}
              onClick={() => setFilter(chip.id)}
            />
          ))}
        </div>
      )}
      {children}
    </>
  );
}
