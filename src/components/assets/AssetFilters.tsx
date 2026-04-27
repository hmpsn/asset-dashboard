/**
 * AssetFilters — Search, filter, sort controls for asset browser.
 * Extracted from AssetBrowser.tsx toolbar section.
 */
import { Search, ChevronDown } from 'lucide-react';
import { Icon } from '../ui';

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
    <div className="flex items-center gap-3 sticky top-0 z-10 bg-[var(--surface-1)]/95 backdrop-blur-sm py-2 -mx-1 px-1">
      <div className="relative flex-1">
        <Icon as={Search} size="md" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search by name or alt text..."
          className="w-full pl-10 pr-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none focus:border-[var(--brand-border-hover)]"
        />
      </div>

      <div className="relative">
        <select
          value={filter}
          onChange={e => onFilterChange(e.target.value as FilterType)}
          className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none cursor-pointer"
        >
          <option value="all">All</option>
          <option value="missing-alt">Missing Alt</option>
          <option value="oversized">Oversized</option>
          <option value="images">Images</option>
          <option value="svg">SVG</option>
          <option value="unused">Unused</option>
          <option value="used">Used</option>
          {hasCmsData && <option value="cms-images">CMS Images</option>}
          {hasCmsData && <option value="cms-missing-alt">CMS Missing Alt</option>}
        </select>
        <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
      </div>

      <div className="relative">
        <select
          value={sort}
          onChange={e => onSortChange(e.target.value as SortField)}
          className="appearance-none pl-3 pr-8 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-md)] text-sm focus:outline-none cursor-pointer"
        >
          <option value="createdOn">Newest</option>
          <option value="fileName">Name</option>
          <option value="fileSize">Size</option>
        </select>
        <Icon as={ChevronDown} size="md" className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)] pointer-events-none" />
      </div>
    </div>
  );
}
