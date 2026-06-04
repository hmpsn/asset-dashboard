/**
 * HubAdvancedFilters — a "Filters" dropdown for the non-primary
 * KEYWORD_COMMAND_CENTER_FILTERS not surfaced as segment pills.
 *
 * Non-primary filters (per plan P1-T2):
 *   content · page_assigned · raw_evidence · local_candidates
 *   visible_locally · possible_match · not_visible · not_checked
 *   provider_degraded · requested · declined · lost_visibility
 *
 * ARIA: <details>/<summary> pattern with role="listbox" + aria-expanded.
 * - No violet/indigo/rose/pink; no green-* success colors — emerald only (Four Laws of Color).
 * - Uses only src/components/ui primitives.
 *
 * Owned by P1-T2. Must NOT touch KeywordHub.tsx or useKeywordHubState.ts.
 */
import { useRef, useEffect, useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import type { KeywordCommandCenterFilter, KeywordCommandCenterFilterMeta } from '../../../shared/types/keyword-command-center';
import { KEYWORD_COMMAND_CENTER_FILTERS } from '../../../shared/types/keyword-command-center';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The 6 segment filters that are already surfaced as primary pills. */
const PRIMARY_FILTER_IDS = new Set<KeywordCommandCenterFilter>([
  KEYWORD_COMMAND_CENTER_FILTERS.ALL,
  KEYWORD_COMMAND_CENTER_FILTERS.IN_STRATEGY,
  KEYWORD_COMMAND_CENTER_FILTERS.TRACKED,
  KEYWORD_COMMAND_CENTER_FILTERS.NEEDS_REVIEW,
  KEYWORD_COMMAND_CENTER_FILTERS.RETIRED,
  KEYWORD_COMMAND_CENTER_FILTERS.LOCAL,
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HubAdvancedFiltersProps {
  activeAdvancedFilter: KeywordCommandCenterFilter | null;
  /** summary.filters — filtered to non-primary by this component. */
  filterMetas: KeywordCommandCenterFilterMeta[];
  onChange: (f: KeywordCommandCenterFilter | null) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function HubAdvancedFilters({
  activeAdvancedFilter,
  filterMetas,
  onChange,
}: HubAdvancedFiltersProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  // Mirror the native <details> open state into React so `aria-expanded` stays
  // reactive (reading detailsRef.current?.open during render is stale — the ref
  // does not trigger a re-render when the element toggles).
  const [open, setOpen] = useState(false);

  // Non-primary filters only
  const nonPrimaryFilters = filterMetas.filter(
    (f) => !PRIMARY_FILTER_IDS.has(f.id),
  );

  const activeFilterMeta = nonPrimaryFilters.find(
    (f) => f.id === activeAdvancedFilter,
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        detailsRef.current &&
        !detailsRef.current.contains(event.target as Node)
      ) {
        detailsRef.current.removeAttribute('open');
        setOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelect(filterId: KeywordCommandCenterFilter) {
    onChange(filterId);
    detailsRef.current?.removeAttribute('open');
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onChange(null);
  }

  const hasActiveFilter = activeAdvancedFilter !== null && activeFilterMeta !== undefined;

  return (
    <div className="relative inline-block">
      <details ref={detailsRef} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={hasActiveFilter ? `Filters: ${activeFilterMeta.label}` : 'Filters'}
          className={cn(
            'inline-flex items-center gap-1.5 cursor-pointer select-none list-none',
            'rounded-[var(--radius-pill)] px-3 py-1.5 t-caption font-medium transition-colors',
            hasActiveFilter
              ? 'bg-teal-600/15 text-teal-400 border border-teal-500/25'
              : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--brand-text)]',
          )}
        >
          <SlidersHorizontal aria-hidden="true" className="w-3 h-3 shrink-0" />
          <span>{hasActiveFilter ? activeFilterMeta.label : 'Filters'}</span>
          {hasActiveFilter ? (
            <IconButton
              icon={X}
              size="sm"
              variant="ghost"
              onClick={handleClear}
              label="Clear filter"
              className="ml-0.5 w-5 h-5 hover:bg-teal-500/20 text-teal-400"
            />
          ) : (
            <ChevronDown aria-hidden="true" className="w-3 h-3 shrink-0" />
          )}
        </summary>

        {/* Dropdown list */}
        <div
          role="listbox"
          aria-label="Advanced filters"
          className={cn(
            'absolute left-0 top-full mt-1 z-[var(--z-dropdown)]',
            'min-w-[180px] rounded-[var(--radius-md)]',
            'bg-[var(--surface-2)] border border-[var(--brand-border)]',
            'shadow-[var(--shadow-md)] overflow-hidden',
          )}
        >
          {nonPrimaryFilters.length === 0 ? (
            <div className="px-3 py-2 t-caption text-[var(--brand-text-muted)]">
              No additional filters available.
            </div>
          ) : (
            nonPrimaryFilters.map((meta) => {
              const isSelected = meta.id === activeAdvancedFilter;
              return (
                <Button
                  key={meta.id}
                  variant="ghost"
                  size="sm"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => handleSelect(meta.id)}
                  className={cn(
                    'w-full justify-between gap-2 rounded-none',
                    'px-3 py-2 t-caption text-left',
                    isSelected
                      ? 'bg-teal-600/10 text-teal-400 hover:bg-teal-600/10'
                      : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]',
                  )}
                >
                  <span>{meta.label}</span>
                  {meta.count > 0 && (
                    <span
                      className={cn(
                        't-caption-sm tabular-nums',
                        isSelected
                          ? 'text-teal-400/70'
                          : 'text-[var(--brand-text-muted)]',
                      )}
                    >
                      {meta.count}
                    </span>
                  )}
                </Button>
              );
            })
          )}
        </div>
      </details>
    </div>
  );
}
