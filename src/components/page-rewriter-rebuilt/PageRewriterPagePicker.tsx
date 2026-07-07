// @ds-rebuilt
import type { KeyboardEvent } from 'react';
import { getIndentLevel } from '../page-rewrite-chat/pageRewriteChatModel';
import { normalizePageUrl } from '../../lib/pathUtils';
import { Button, ClickableRow, FormInput, Icon, InlineBanner } from '../ui';
import type { PageRewriterSitemapPage } from './pageRewriterTypes';
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
  const currentLabel = pageData
    ? (pageData.slug ? normalizePageUrl(pageData.slug) : pageUrl)
    : 'No page selected';

  return (
    <div className="flex min-w-[280px] flex-1 flex-col gap-2">
      <div className="flex items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2">
        <Icon name="doc" size="sm" className="flex-none text-[var(--brand-text-dim)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{currentLabel}</p>
          {pageData?.title && <p className="truncate t-caption-sm text-[var(--brand-text-muted)]">{pageData.title}</p>}
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenCombo}>
          {pageData ? 'Change' : 'Choose page'}
        </Button>
      </div>

      {comboOpen && (
        <div className="rounded-[var(--radius-lg)] border border-[var(--teal)] bg-[var(--surface-2)] shadow-[var(--shadow-lg)]">
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
                  className="flex items-center gap-2 border-l-2 border-transparent px-3 py-2 t-caption-sm text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]"
                  style={{
                    paddingLeft: 12 + getIndentLevel(page.slug) * 12,
                    borderLeftColor: index === comboIdx ? 'var(--teal)' : 'transparent',
                    background: index === comboIdx ? 'var(--brand-mint-dim)' : undefined,
                  }}
                >
                  <Icon name="file" size="sm" className="flex-none text-[var(--brand-text-dim)]" />
                  <span className="min-w-0 flex-1 truncate">{pageLabel(page)}</span>
                  {page.title && <span className="hidden max-w-[260px] truncate text-[var(--brand-text-muted)] md:inline">{page.title}</span>}
                </ClickableRow>
              ))}
            </div>
          )}

          {!comboQueryIsUrl && filteredPages.length === 0 && (
            <div className="px-3 py-3 t-caption-sm text-[var(--brand-text-muted)]">
              {sitemapPages.length > 0 ? `No pages match "${comboQuery}"` : 'No sitemap - paste a full URL above'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
