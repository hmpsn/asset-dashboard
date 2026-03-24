/**
 * AssetFilters — Search, filter, sort controls for asset browser.
 * Extracted from AssetBrowser.tsx toolbar section.
 */
import { Search, ChevronDown } from 'lucide-react';

type SortField = 'fileName' | 'fileSize' | 'createdOn';
type FilterType = 'all' | 'missing-alt' | 'oversized' | 'images' | 'svg' | 'unused' | 'used';

export interface AssetFiltersProps {
  search: string;
  filter: FilterType;
  sort: SortField;
  onSearchChange: (value: string) => void;
  onFilterChange: (value: FilterType) => void;
  onSortChange: (value: SortField) => void;
}

export function AssetFilters({
  search, filter, sort,
  onSearchChange, onFilterChange, onSortChange,
}: AssetFiltersProps) {
  return (
    <div className="flex items-center gap-3 sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm py-2 -mx-1 px-1">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          type="text"
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Search by name or alt text..."
          className="w-full pl-10 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-zinc-600"
        />
      </div>

      <div className="relative">
        <select
          value={filter}
          onChange={e => onFilterChange(e.target.value as FilterType)}
          className="appearance-none pl-3 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none cursor-pointer"
        >
          <option value="all">All</option>
          <option value="missing-alt">Missing Alt</option>
          <option value="oversized">Oversized</option>
          <option value="images">Images</option>
          <option value="svg">SVG</option>
          <option value="unused">Unused</option>
          <option value="used">Used</option>
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
      </div>

      <div className="relative">
        <select
          value={sort}
          onChange={e => onSortChange(e.target.value as SortField)}
          className="appearance-none pl-3 pr-8 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm focus:outline-none cursor-pointer"
        >
          <option value="createdOn">Newest</option>
          <option value="fileName">Name</option>
          <option value="fileSize">Size</option>
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-500 pointer-events-none" />
      </div>
    </div>
  );
}
