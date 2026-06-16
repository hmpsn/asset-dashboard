/**
 * AssetFilters — Search, sort, and multi-select filter controls for asset browser.
 * Extracted from AssetBrowser.tsx toolbar section.
 */
import { Search, ChevronDown } from 'lucide-react';
import { FormInput, FormSelect, Icon, Button, cn } from '../ui';

type SortField = 'fileName' | 'fileSize' | 'createdOn';
type FilterType = 'missing-alt' | 'oversized' | 'images' | 'svg' | 'unused' | 'used' | 'cms-images' | 'cms-missing-alt';

const FILTER_PILLS: Array<{ value: FilterType; label: string }> = [
  { value: 'missing-alt', label: 'Missing Alt' },
  { value: 'oversized', label: 'Oversized' },
  { value: 'images', label: 'Images' },
  { value: 'svg', label: 'SVG' },
  { value: 'unused', label: 'Unused' },
  { value: 'used', label: 'Used' },
];

const CMS_FILTER_PILLS: Array<{ value: FilterType; label: string }> = [
  { value: 'cms-images', label: 'CMS Images' },
  { value: 'cms-missing-alt', label: 'CMS Missing Alt' },
];

export interface AssetFiltersProps {
  search: string;
  activeFilters: Set<string>;
  sort: SortField;
  hasCmsData?: boolean;
  onSearchChange: (value: string) => void;
  onFilterToggle: (value: FilterType) => void;
  onFilterClear: () => void;
  onSortChange: (value: SortField) => void;
}

function PillButton({ label, isActive, onClick }: { label: string; isActive: boolean; onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`Filter: ${label}`}
      className={cn(
        'rounded-[var(--radius-md)] px-2.5 py-1 t-caption font-medium transition-colors',
        isActive
          ? 'bg-teal-600 text-white hover:bg-teal-600'
          : 'bg-[var(--surface-2)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]',
      )}
    >
      {label}
    </Button>
  );
}

export function AssetFilters({
  search, activeFilters, sort, hasCmsData,
  onSearchChange, onFilterToggle, onFilterClear, onSortChange,
}: AssetFiltersProps) {
  const hasActiveFilter = activeFilters.size > 0;

  return (
    <div className="sticky top-0 z-[var(--z-sticky)] bg-[var(--surface-1)]/95 backdrop-blur-sm -mx-1 px-1 pb-2">
      {/* Search + sort row */}
      <div className="flex items-center gap-3 py-2">
        <div className="relative flex-1">
          <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <FormInput
            type="text"
            value={search}
            onChange={onSearchChange}
            placeholder="Search by name or alt text..."
            className="w-full pl-10 pr-4"
          />
        </div>
        <div className="relative">
          <FormSelect
            value={sort}
            onChange={value => onSortChange(value as SortField)}
            options={[
              { value: 'createdOn', label: 'Newest' },
              { value: 'fileName', label: 'Name' },
              { value: 'fileSize', label: 'Size' },
            ]}
            className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 cursor-pointer"
          />
          <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
        </div>
      </div>

      {/* Multi-select filter pills */}
      <div role="group" aria-label="Asset filters" className="flex items-center gap-1.5 flex-wrap">
        <PillButton label="All" isActive={!hasActiveFilter} onClick={onFilterClear} />
        {FILTER_PILLS.map(pill => (
          <PillButton
            key={pill.value}
            label={pill.label}
            isActive={activeFilters.has(pill.value)}
            onClick={() => onFilterToggle(pill.value)}
          />
        ))}
        {hasCmsData && (
          <>
            <div aria-hidden="true" className="w-px h-4 bg-[var(--brand-border)] mx-0.5 self-center" />
            {CMS_FILTER_PILLS.map(pill => (
              <PillButton
                key={pill.value}
                label={pill.label}
                isActive={activeFilters.has(pill.value)}
                onClick={() => onFilterToggle(pill.value)}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
