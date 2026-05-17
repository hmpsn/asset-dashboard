import { AlertTriangle, Copy, ExternalLink, FileText, Loader2 } from 'lucide-react';
import type { RefObject } from 'react';
import { Button, ClickableRow, Icon } from '../ui';
import { normalizePageUrl } from '../../lib/pathUtils';
import type { PageData } from './pageRewriteChatModel';

type ExportMode = 'copy' | 'download' | 'docx';

interface PageRewriteDocumentPaneProps {
  pageData: PageData | null;
  pageUrl: string;
  loadingPage: boolean;
  pageError: string;
  docPanelRef: RefObject<HTMLDivElement | null>;
  docBodyRefCallback: (el: HTMLDivElement | null) => void;
  toolbarPos: { top: number; left: number } | null;
  exportOpen: boolean;
  onToggleExport: () => void;
  onExport: (mode: ExportMode) => void;
  exportPopoverRef: RefObject<HTMLDivElement | null>;
  exportBtnRef: RefObject<HTMLButtonElement | null>;
  onBold: () => void;
  onItalic: () => void;
  onHeading2: () => void;
  onHeading3: () => void;
  onClearFormatting: () => void;
}

export function PageRewriteDocumentPane({
  pageData,
  pageUrl,
  loadingPage,
  pageError,
  docPanelRef,
  docBodyRefCallback,
  toolbarPos,
  exportOpen,
  onToggleExport,
  onExport,
  exportPopoverRef,
  exportBtnRef,
  onBold,
  onItalic,
  onHeading2,
  onHeading3,
  onClearFormatting,
}: PageRewriteDocumentPaneProps) {
  return (
    <div ref={docPanelRef} className="flex flex-col w-1/2 overflow-hidden bg-[var(--surface-1)]/50 relative">
      {!pageData && !loadingPage && !pageError && (
        <div className="flex flex-col items-center justify-center h-full text-center space-y-3 px-8">
          <Icon as={FileText} size="2xl" className="text-[var(--brand-text-dim)]" />
          <div>
            <h3 className="text-sm font-medium text-[var(--brand-text)]">No page loaded</h3>
            <p className="text-xs text-[var(--brand-text-dim)] mt-1">Search for a page above or paste a URL to see the content here.</p>
          </div>
        </div>
      )}

      {loadingPage && (
        <div className="flex flex-col items-center justify-center h-full gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-accent-brand" />
          <span className="text-xs text-[var(--brand-text)]">Loading page content...</span>
        </div>
      )}

      {pageError && (
        <div className="flex flex-col items-center justify-center h-full gap-3 px-8">
          <AlertTriangle className="w-6 h-6 text-accent-warning" />
          <p className="text-xs text-[var(--brand-text)] text-center">{pageError}</p>
        </div>
      )}

      {pageData && !loadingPage && (
        <>
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/60">
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 t-caption-sm text-[var(--brand-text)] hover:text-accent-brand transition-colors flex-1 min-w-0"
            >
              <span className="truncate">{pageData.slug ? normalizePageUrl(pageData.slug) : pageUrl}</span>
              <Icon as={ExternalLink} size="sm" className="flex-shrink-0" />
            </a>
            <div className="relative flex-shrink-0" ref={exportPopoverRef}>
              <Button
                ref={exportBtnRef}
                onClick={onToggleExport}
                variant="ghost"
                size="sm"
                className={"t-micro text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] hover:bg-[var(--surface-3)]" // arbitrary-text-ok
                }
              >
                Export brief
              </Button>
              {exportOpen && (
                <div className="absolute right-0 top-7 z-[var(--z-modal)] bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl p-1 flex flex-col gap-0.5 min-w-[170px]">
                  <ClickableRow
                    onClick={() => onExport('copy')}
                    className="flex items-center gap-2 px-3 py-1.5 rounded t-caption-sm text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]"
                  >
                    <Icon as={Copy} size="sm" /> Copy as Markdown
                  </ClickableRow>
                  <ClickableRow
                    onClick={() => onExport('download')}
                    className="flex items-center gap-2 px-3 py-1.5 rounded t-caption-sm text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]"
                  >
                    <Icon as={FileText} size="sm" /> Download .md
                  </ClickableRow>
                  <ClickableRow
                    onClick={() => onExport('docx')}
                    className="flex items-center gap-2 px-3 py-1.5 rounded t-caption-sm text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)]"
                  >
                    <Icon as={FileText} size="sm" /> Download .docx
                  </ClickableRow>
                </div>
              )}
            </div>
          </div>

          {pageData.issues.length > 0 && (
            <div className="flex-shrink-0 flex flex-wrap gap-1.5 px-4 py-2 border-b border-[var(--brand-border)] bg-[var(--surface-2)]/30">
              {pageData.issues.slice(0, 20).map((issue, i) => (
                <span
                  key={i}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded t-micro border ${ // arbitrary-text-ok
                    issue.severity === 'error'
                      ? 'bg-red-950/40 border-red-500/40 text-accent-danger'
                      : issue.severity === 'warning'
                      ? 'bg-amber-950/40 border-amber-500/40 text-accent-warning'
                      : 'bg-blue-950/40 border-blue-500/40 text-accent-info'
                  }`}
                >
                  {issue.severity === 'error' ? '✕' : '⚠'} {issue.message}
                </span>
              ))}
            </div>
          )}

          <div
            ref={docBodyRefCallback}
            role="textbox"
            aria-multiline="true"
            aria-label="Page content editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            className="flex-1 overflow-y-auto px-6 py-5 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
          />

          {toolbarPos && (
            <div
              className="absolute z-[var(--z-modal)] flex items-center gap-0.5 bg-[var(--surface-3)] border border-[var(--brand-border-hover)] rounded-[var(--radius-md)] shadow-xl px-1 py-0.5 pointer-events-auto"
              style={{ top: toolbarPos.top, left: toolbarPos.left }}
              onMouseDown={e => e.preventDefault()}
            >
              <Button onClick={onBold} variant="ghost" size="sm" className="!px-2 !py-1 t-caption-sm font-bold text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded">
                B
              </Button>
              <Button onClick={onItalic} variant="ghost" size="sm" className="!px-2 !py-1 t-caption-sm italic text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded">
                I
              </Button>
              <div className="w-px h-3 bg-[var(--brand-border-hover)] mx-0.5" />
              <Button onClick={onHeading2} variant="ghost" size="sm" className={"!px-2 !py-1 t-micro text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded" // arbitrary-text-ok
              }>H2</Button>
              <Button onClick={onHeading3} variant="ghost" size="sm" className={"!px-2 !py-1 t-micro text-[var(--brand-text-bright)] hover:bg-[var(--surface-1)] rounded" // arbitrary-text-ok
              }>H3</Button>
              <div className="w-px h-3 bg-[var(--brand-border-hover)] mx-0.5" />
              <Button onClick={onClearFormatting} variant="ghost" size="sm" className="!px-2 !py-1 t-caption-sm text-[var(--brand-text-muted)] hover:bg-[var(--surface-1)] rounded">
                &times;
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
