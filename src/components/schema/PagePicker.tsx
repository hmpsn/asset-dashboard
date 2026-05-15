/**
 * PagePicker — Page picker modal for single-page schema generation.
 * Extracted from SchemaSuggester.tsx page picker rendering.
 */
import { Search } from 'lucide-react';
import { Button, ClickableRow, Icon } from '../ui';

export interface PagePickerProps {
  availablePages: Array<{ id: string; title: string; slug: string }>;
  pageSearch: string;
  generatingSingle: string | null;
  existingPageIds?: Set<string>;
  onPageSearchChange: (value: string) => void;
  onSelectPage: (pageId: string) => void;
  onClose: () => void;
}

export function PagePicker({
  availablePages, pageSearch, generatingSingle, existingPageIds,
  onPageSearchChange, onSelectPage, onClose,
}: PagePickerProps) {
  const filtered = availablePages.filter(
    p => !pageSearch || p.title.toLowerCase().includes(pageSearch.toLowerCase()) || p.slug.toLowerCase().includes(pageSearch.toLowerCase())
  );

  return (
    // pr-check-disable-next-line -- dropdown popover
    <div className="absolute right-0 top-full mt-1 w-72 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] overflow-hidden shadow-xl z-[var(--z-dropdown)]">
      <div className="px-3 py-2 border-b border-[var(--brand-border)]">
        <div className="relative">
          <Icon as={Search} size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={pageSearch}
            onChange={e => onPageSearchChange(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map(p => {
          const alreadyGenerated = existingPageIds?.has(p.id);
          return (
            <ClickableRow
              key={p.id}
              onClick={() => onSelectPage(p.id)}
              disabled={generatingSingle === p.id}
              className="text-left px-4 py-2 border-b border-[var(--brand-border)]/30 last:border-b-0 disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="t-caption text-[var(--brand-text)]">{p.title}</span>
                {alreadyGenerated && <span className="t-caption-sm text-[var(--brand-text-muted)]">exists</span>}
              </div>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">/{p.slug}</span>
            </ClickableRow>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-3 t-caption text-[var(--brand-text-muted)] text-center">No pages found</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--brand-border)]">
        <Button
          onClick={onClose}
          variant="ghost"
          size="sm"
          className="px-0 py-0 h-auto min-h-0 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        >
          Close
        </Button>
      </div>
    </div>
  );
}

/**
 * InitialPagePicker — Full-width picker shown in the initial "not started" state.
 */
export interface InitialPagePickerProps {
  availablePages: Array<{ id: string; title: string; slug: string }>;
  pageSearch: string;
  generatingSingle: string | null;
  onPageSearchChange: (value: string) => void;
  onSelectPage: (pageId: string) => void;
  onClose: () => void;
}

export function InitialPagePicker({
  availablePages, pageSearch, generatingSingle,
  onPageSearchChange, onSelectPage, onClose,
}: InitialPagePickerProps) {
  const filtered = availablePages.filter(
    p => !pageSearch || p.title.toLowerCase().includes(pageSearch.toLowerCase()) || p.slug.toLowerCase().includes(pageSearch.toLowerCase())
  );

  return (
    // pr-check-disable-next-line -- full-page picker view container; not a section card
    <div className="w-full max-w-md bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] overflow-hidden mt-2">
      <div className="px-3 py-2 border-b border-[var(--brand-border)]">
        <div className="relative">
          <Icon as={Search} size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--brand-text-muted)]" />
          <input
            type="text"
            value={pageSearch}
            onChange={e => onPageSearchChange(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-md)] t-caption text-[var(--brand-text-bright)] focus:outline-none focus:border-teal-500"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map(p => (
          <ClickableRow
            key={p.id}
            onClick={() => onSelectPage(p.id)}
            disabled={generatingSingle === p.id}
            className="text-left px-4 py-2 border-b border-[var(--brand-border)]/30 last:border-b-0 disabled:opacity-50"
          >
            <span className="t-caption text-[var(--brand-text)] block">{p.title}</span>
            <span className="t-caption-sm text-[var(--brand-text-muted)]">/{p.slug}</span>
          </ClickableRow>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-3 t-caption text-[var(--brand-text-muted)] text-center">No pages found</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--brand-border)]">
        <Button
          onClick={onClose}
          variant="ghost"
          size="sm"
          className="px-0 py-0 h-auto min-h-0 t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
