import { ArrowLeft, FileText, Loader2, Maximize2, Sparkles } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import { Icon } from '../ui';
import { normalizePageUrl } from '../../lib/pathUtils';
import { getIndentLevel, type PageData, type SitemapPage } from './pageRewriteChatModel';

interface PageRewriteHeaderBarProps {
  pageData: PageData | null;
  pageUrl: string;
  loadingPage: boolean;
  focusMode?: boolean;
  onFocusModeToggle?: () => void;
  onBack: () => void;
  comboOpen: boolean;
  comboQuery: string;
  comboIdx: number;
  comboQueryIsUrl: boolean;
  filteredPages: SitemapPage[];
  sitemapPages: SitemapPage[];
  comboRef: RefObject<HTMLDivElement | null>;
  comboInputRef: RefObject<HTMLInputElement | null>;
  onOpenCombo: () => void;
  onComboQueryChange: (value: string) => void;
  onComboKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSelectPage: (page: SitemapPage) => void;
  onLoadTypedUrl: () => void;
  onSetComboIdx: (next: number | ((prev: number) => number)) => void;
}

export function PageRewriteHeaderBar({
  pageData,
  pageUrl,
  loadingPage,
  focusMode,
  onFocusModeToggle,
  onBack,
  comboOpen,
  comboQuery,
  comboIdx,
  comboQueryIsUrl,
  filteredPages,
  sitemapPages,
  comboRef,
  comboInputRef,
  onOpenCombo,
  onComboQueryChange,
  onComboKeyDown,
  onSelectPage,
  onLoadTypedUrl,
  onSetComboIdx,
}: PageRewriteHeaderBarProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/80 backdrop-blur-sm flex-shrink-0">
      <button
        onClick={onBack}
        className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)] transition-colors"
        title="Back"
      >
        <Icon as={ArrowLeft} size="md" />
      </button>
      <div className="flex items-center gap-2">
        <Icon as={Sparkles} size="md" className="text-accent-brand" />
        <h1 className="text-sm font-semibold text-[var(--brand-text-bright)]">AI Page Rewriter</h1>
      </div>

      <div className="flex-1 ml-4 relative" ref={comboRef}>
        {pageData && !comboOpen && (
          <div className="flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5">
            <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
            <span className="text-xs text-[var(--brand-text-bright)] flex-1 truncate">{pageData.slug ? normalizePageUrl(pageData.slug) : pageUrl}</span>
            <button onClick={onOpenCombo} className={"text-[10px] text-accent-brand hover:text-accent-brand font-medium flex-shrink-0" // arbitrary-text-ok
            }>Change</button>
          </div>
        )}

        {!pageData && !comboOpen && (
          <button
            onClick={onOpenCombo}
            className="w-full flex items-center gap-2 bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] px-3 py-1.5 text-xs text-[var(--brand-text-muted)] hover:border-teal-500/50 hover:text-[var(--brand-text-bright)] transition-colors"
          >
            <Icon as={FileText} size="sm" />
            Search pages or paste a URL…
          </button>
        )}

        {comboOpen && (
          <div className="flex flex-col bg-[var(--surface-3)] border border-teal-500/50 rounded-[var(--radius-lg)] overflow-hidden shadow-xl">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--brand-border)]">
              <Icon as={FileText} size="sm" className="text-[var(--brand-text-muted)] flex-shrink-0" />
              <input
                ref={comboInputRef}
                role="combobox"
                aria-expanded={filteredPages.length > 0}
                aria-activedescendant={filteredPages[comboIdx] ? `combo-opt-${comboIdx}` : undefined}
                aria-label="Search pages or paste a URL"
                autoFocus
                value={comboQuery}
                onChange={e => { onComboQueryChange(e.target.value); onSetComboIdx(0); }}
                onKeyDown={onComboKeyDown}
                placeholder="Search pages or paste a URL…"
                className="flex-1 bg-transparent text-xs text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none"
              />
              {loadingPage && <Loader2 className="w-3 h-3 animate-spin text-accent-brand flex-shrink-0" />}
            </div>

            {comboQueryIsUrl && (
              <div className="px-3 py-2">
                <button
                  onClick={onLoadTypedUrl}
                  className="text-xs text-accent-brand hover:text-accent-brand"
                >
                  Load {comboQuery.length > 60 ? `${comboQuery.slice(0, 60)}…` : comboQuery}
                </button>
              </div>
            )}

            {!comboQueryIsUrl && filteredPages.length > 0 && (
              <div className="max-h-[240px] overflow-y-auto">
                {filteredPages.map((page, i) => (
                  <button
                    key={`${page.slug}-${page.url}`}
                    id={`combo-opt-${i}`}
                    role="option"
                    aria-selected={i === comboIdx}
                    onClick={() => onSelectPage(page)}
                    onMouseEnter={() => onSetComboIdx(i)}
                    className={`w-full flex items-center gap-2 py-1.5 text-xs text-left transition-colors border-l-2 ${
                      i === comboIdx
                        ? 'bg-teal-500/10 text-[var(--brand-text-bright)] border-teal-500'
                        : 'text-[var(--brand-text)] hover:bg-[var(--surface-1)]/50 hover:text-[var(--brand-text-bright)] border-transparent'
                    }`}
                    style={{ paddingLeft: `${12 + getIndentLevel(page.slug) * 12}px` }}
                  >
                    <FileText className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{page.slug || '/'}</span>
                  </button>
                ))}
              </div>
            )}

            {!comboQueryIsUrl && filteredPages.length === 0 && (
              <div className="px-3 py-2 t-caption-sm text-[var(--brand-text-muted)]">
                {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap — paste a full URL above'}
              </div>
            )}
          </div>
        )}
      </div>

      {onFocusModeToggle && (
        <button
          onClick={onFocusModeToggle}
          title={focusMode ? 'Exit focus mode (Esc)' : 'Enter focus mode'}
          className={`p-1.5 rounded-[var(--radius-lg)] transition-colors flex-shrink-0 ${
            focusMode
              ? 'text-accent-brand bg-teal-500/10 hover:bg-teal-500/20'
              : 'text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]'
          }`}
        >
          <Icon as={Maximize2} size="md" className={`transition-transform ${focusMode ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
}
