/**
 * PagePicker — Page picker modal for single-page schema generation.
 * Extracted from SchemaSuggester.tsx page picker rendering.
 */
import { Search } from 'lucide-react';

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
    <div className="absolute right-0 top-full mt-1 w-72 bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-xl z-20">
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={pageSearch}
            onChange={e => onPageSearchChange(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map(p => {
          const alreadyGenerated = existingPageIds?.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => onSelectPage(p.id)}
              disabled={generatingSingle === p.id}
              className="w-full text-left px-4 py-2 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/30 last:border-b-0 disabled:opacity-50"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-300">{p.title}</span>
                {alreadyGenerated && <span className="text-[11px] text-zinc-500">exists</span>}
              </div>
              <span className="text-[11px] text-zinc-500">/{p.slug}</span>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <div className="px-4 py-3 text-xs text-zinc-500 text-center">No pages found</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-zinc-800">
        <button onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors">Close</button>
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
    <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden mt-2">
      <div className="px-3 py-2 border-b border-zinc-800">
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            value={pageSearch}
            onChange={e => onPageSearchChange(e.target.value)}
            placeholder="Search pages..."
            className="w-full pl-7 pr-3 py-1.5 bg-zinc-800 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-teal-500"
            autoFocus
          />
        </div>
      </div>
      <div className="max-h-[200px] overflow-y-auto">
        {filtered.map(p => (
          <button
            key={p.id}
            onClick={() => onSelectPage(p.id)}
            disabled={generatingSingle === p.id}
            className="w-full text-left px-4 py-2 hover:bg-zinc-800/50 transition-colors border-b border-zinc-800/30 last:border-b-0 disabled:opacity-50"
          >
            <span className="text-xs text-zinc-300 block">{p.title}</span>
            <span className="text-[11px] text-zinc-500">/{p.slug}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="px-4 py-3 text-xs text-zinc-500 text-center">No pages found</div>
        )}
      </div>
      <div className="px-3 py-2 border-t border-zinc-800">
        <button onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-400 transition-colors">Cancel</button>
      </div>
    </div>
  );
}
