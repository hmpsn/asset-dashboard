// @ds-rebuilt
import type { KeyboardEvent } from 'react';
import { getIndentLevel } from '../page-rewrite-chat/pageRewriteChatModel';
import { normalizePageUrl } from '../../lib/pathUtils';
import { Button, ClickableRow, FormInput, Icon, InlineBanner } from '../ui';
import type { PageRewriterSitemapPage } from './pageRewriterTypes';
import { decodePageText } from './pageRewriterFormatters';
import type { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

type PageRewriterState = ReturnType<typeof usePageRewriterSurfaceState>;

interface PageRewriterPagePickerProps {
  pageData: PageRewriterState['pageData'];
  pageUrl: string;
  loadingPage: boolean;
  comboOpen: boolean;
  comboQuery: string;
  comboIdx: number;
  comboQueryIsUrl: boolean;
  filteredPages: PageRewriterSitemapPage[];
  sitemapPages: PageRewriterSitemapPage[];
  pagesQuery: PageRewriterState['pagesQuery'];
  comboInputRef: PageRewriterState['comboInputRef'];
  onOpenCombo: () => void;
  onComboQueryChange: (value: string) => void;
  onComboKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  onSelectPage: (page: PageRewriterSitemapPage) => void;
  onLoadTypedUrl: () => void;
  onSetComboIdx: (next: number | ((prev: number) => number)) => void;
  onCloseCombo: () => void;
}

const LISTBOX_ID = 'page-rewriter-page-options';

function pageLabel(page: PageRewriterSitemapPage): string {
  return page.slug || page.title || page.url;
}

function formatPageAddress(value: string): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.host}${parsed.pathname}${parsed.search}`;
  } catch {
    return normalizePageUrl(value);
  }
}

export function PageRewriterPagePicker({
  pageData,
  pageUrl,
  loadingPage,
  comboOpen,
  comboQuery,
  comboIdx,
  comboQueryIsUrl,
  filteredPages,
  sitemapPages,
  pagesQuery,
  comboInputRef,
  onOpenCombo,
  onComboQueryChange,
  onComboKeyDown,
  onSelectPage,
  onLoadTypedUrl,
  onSetComboIdx,
  onCloseCombo,
}: PageRewriterPagePickerProps) {
  const activeOptionId = filteredPages[comboIdx] ? `page-rewriter-option-${comboIdx}` : undefined;
  const currentTitle = pageData?.title ? decodePageText(pageData.title) : 'Choose a page to rewrite';
  const currentAddress = pageData
    ? formatPageAddress(pageUrl || pageData.url || pageData.slug)
    : 'Search the sitemap or paste a full URL';
  const pickerLabel = pageData
    ? `${currentTitle}. ${currentAddress}. Change page`
    : 'Choose page';

  return (
    <div className="relative flex w-full min-w-0 flex-col gap-2">
      <Button
        size="md"
        variant="secondary"
        aria-label={pickerLabel}
        aria-haspopup="listbox"
        aria-expanded={comboOpen}
        onClick={onOpenCombo}
        className="group w-full min-w-0 justify-start gap-3 rounded-[var(--radius-xl)] border-[var(--brand-border)] bg-[var(--surface-2)] px-4 py-2.5 text-left hover:border-[var(--brand-border-hover)] hover:bg-[var(--surface-3)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-mint-glow)]"
        style={{ transitionDuration: 'var(--dur-fast)' }}
      >
        <span
          className="flex h-8 w-8 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--purple)]"
          style={{ background: 'color-mix(in srgb, var(--purple) 12%, transparent)' }}
          aria-hidden="true"
        >
          <Icon name="doc" size="sm" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate t-ui font-semibold text-[var(--brand-text-bright)]">{currentTitle}</span>
          <span className="block truncate t-mono text-[var(--brand-text-muted)]">{currentAddress}</span>
        </span>
        {loadingPage ? (
          <Icon name="refresh" size="sm" className="flex-none animate-spin text-[var(--teal)]" />
        ) : (
          <span className="flex flex-none items-center gap-1.5 t-caption text-[var(--brand-text-muted)] group-hover:text-[var(--brand-text-bright)]">
            {pageData ? 'Change page' : 'Choose'}
            <Icon name="chevronDown" size="sm" />
          </span>
        )}
      </Button>

      {comboOpen && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+var(--space-2))] rounded-[var(--radius-lg)] border border-[var(--teal)] bg-[var(--surface-2)] shadow-[var(--shadow-lg)]"
          style={{ zIndex: 'var(--z-dropdown)' }}
        >
          <div className="flex items-center gap-2 border-b border-[var(--brand-border)] px-3 py-2">
            <Icon name="search" size="sm" className="flex-none text-[var(--brand-text-dim)]" />
            <FormInput
              ref={comboInputRef}
              role="combobox"
              aria-expanded={filteredPages.length > 0}
              aria-controls={LISTBOX_ID}
              aria-activedescendant={activeOptionId}
              aria-label="Search pages or paste a full URL"
              value={comboQuery}
              onChange={(value) => {
                onComboQueryChange(value);
                onSetComboIdx(0);
              }}
              onKeyDown={onComboKeyDown}
              placeholder="Search pages or paste a full URL"
              className="border-transparent bg-transparent px-0 py-1"
            />
            {loadingPage && <Icon name="refresh" size="sm" className="animate-spin text-[var(--teal)]" />}
            <Button size="sm" variant="ghost" onClick={onCloseCombo}>Close</Button>
          </div>

          {pagesQuery.isError && (
            <div className="px-3 pt-3">
              <InlineBanner tone="warning" size="sm" title="Sitemap pages did not load">
                Paste a full URL, or retry after the latest site snapshot is available.
              </InlineBanner>
            </div>
          )}

          {comboQueryIsUrl && (
            <div className="px-3 py-3">
              <Button size="sm" variant="secondary" onClick={onLoadTypedUrl}>
                Load {comboQuery.length > 70 ? `${comboQuery.slice(0, 70)}...` : comboQuery}
              </Button>
            </div>
          )}

          {!comboQueryIsUrl && filteredPages.length > 0 && (
            <div id={LISTBOX_ID} role="listbox" className="max-h-[260px] overflow-y-auto py-1">
              {filteredPages.map((page, index) => (
                <ClickableRow
                  key={`${page.slug}-${page.url}`}
                  id={`page-rewriter-option-${index}`}
                  role="option"
                  aria-selected={index === comboIdx}
                  onClick={() => onSelectPage(page)}
                  onMouseEnter={() => onSetComboIdx(index)}
                  className="flex items-center gap-2 border-l-2 border-transparent px-3 py-2 t-ui text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]"
                  style={{
                    paddingLeft: 12 + getIndentLevel(page.slug) * 12,
                    borderLeftColor: index === comboIdx ? 'var(--teal)' : 'transparent',
                    background: index === comboIdx ? 'var(--brand-mint-dim)' : undefined,
                  }}
                >
                  <Icon name="file" size="sm" className="flex-none text-[var(--brand-text-dim)]" />
                  <span className="min-w-0 flex-1 truncate">{pageLabel(page)}</span>
                  {page.title && <span className="hidden max-w-[260px] truncate t-caption-sm text-[var(--brand-text-muted)] md:inline">{decodePageText(page.title)}</span>}
                </ClickableRow>
              ))}
            </div>
          )}

          {!comboQueryIsUrl && filteredPages.length === 0 && (
            <div className="px-3 py-3 t-ui text-[var(--brand-text-muted)]">
              {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap - paste a full URL above'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
