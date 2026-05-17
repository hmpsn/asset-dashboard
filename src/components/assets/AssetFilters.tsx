/**
 * AssetFilters — Search, filter, sort controls for asset browser.
 * Extracted from AssetBrowser.tsx toolbar section.
 */
import { Search, ChevronDown } from 'lucide-react';
import { FormInput, FormSelect, Icon } from '../ui';

type SortField = 'fileName' | 'fileSize' | 'createdOn';
type FilterType = 'all' | 'missing-alt' | 'oversized' | 'images' | 'svg' | 'unused' | 'used' | 'cms-images' | 'cms-missing-alt';

export interface AssetFiltersProps {
  search: string;
  filter: FilterType;
  sort: SortField;
  hasCmsData?: boolean;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: FilterType) => void;
  onSortChange: (value: SortField) => void;
}

export function AssetFilters({
  search, filter, sort, hasCmsData,
  onSearchChange, onFilterChange, onSortChange,
}: AssetFiltersProps) {
  return (
    <div className="flex items-center gap-3 sticky top-0 z-[var(--z-sticky)] bg-[var(--surface-1)]/95 backdrop-blur-sm py-2 -mx-1 px-1">
      <div className="relative flex-1">
        <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
        <FormInput
          type="text"
          value={search}
          onChange={onSearchChange}
          placeholder="Search by name or alt text..."
          className="w-full pl-10 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      </div>

      <div className="relative">
        <FormSelect
          value={filter}
          onChange={value => onFilterChange(value as FilterType)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'missing-alt', label: 'Missing Alt' },
            { value: 'oversized', label: 'Oversized' },
            { value: 'images', label: 'Images' },
            { value: 'svg', label: 'SVG' },
            { value: 'unused', label: 'Unused' },
            { value: 'used', label: 'Used' },
            ...(hasCmsData ? [
              { value: 'cms-images', label: 'CMS Images' },
              { value: 'cms-missing-alt', label: 'CMS Missing Alt' },
            ] : []),
          ]}
          className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none cursor-pointer"
        />
        <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
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
          className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none cursor-pointer"
        />
        <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
      </div>
    </div>
  );
}
