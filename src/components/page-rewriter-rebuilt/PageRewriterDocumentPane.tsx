// @ds-rebuilt
import { normalizePageUrl } from '../../lib/pathUtils';
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Icon,
  InlineBanner,
  Meter,
  MetricTile,
  Popover,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import type { BadgeTone } from '../ui';
import type { PageRewriterExportMode, PageRewriterIssue } from './pageRewriterTypes';
import type { usePageRewriterSurfaceState } from './usePageRewriterSurfaceState';

type PageRewriterState = ReturnType<typeof usePageRewriterSurfaceState>;

interface PageRewriterDocumentPaneProps {
  state: PageRewriterState;
  onOpenPicker: () => void;
}

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

const ISSUE_TONE: Record<PageRewriterIssue['severity'], BadgeTone> = {
  error: 'red',
  warning: 'amber',
  info: 'blue',
};

function formatNumber(value: number | undefined | null): string {
  return typeof value === 'number' ? NUMBER_FORMAT.format(value) : '—';
}

function formatRank(value: number | undefined | null): string {
  return typeof value === 'number' ? `#${value}` : '—';
}

function EmptyDocIcon({ className }: { className?: string }) {
  return <Icon name="doc" className={className} />;
}

function exportLabel(mode: PageRewriterExportMode): string {
  if (mode === 'copyMarkdown') return 'Copy as Markdown';
  if (mode === 'copyHtml') return 'Copy as HTML';
  if (mode === 'downloadMarkdown') return 'Download .md';
  if (mode === 'docx') return 'Download .docx';
  return 'Download PDF';
}

function ExportMenu({ onExport }: { onExport: (mode: PageRewriterExportMode) => void }) {
  const item = (mode: PageRewriterExportMode, icon: string) => (
    <Popover.Item key={mode} onClick={() => onExport(mode)}>
      <span className="flex items-center gap-2">
        <Icon name={icon} size="sm" className="text-[var(--brand-text-muted)]" />
        {exportLabel(mode)}
      </span>
    </Popover.Item>
  );

  return (
    <Popover
      placement="bottom-end"
      trigger={(
        <Button size="sm" variant="secondary">
          <Icon name="download" size="sm" />
          Export
        </Button>
      )}
    >
      {item('copyMarkdown', 'copy')}
      {item('copyHtml', 'copy')}
      <Popover.Separator />
      {item('downloadMarkdown', 'download')}
      {item('docx', 'doc')}
      {item('pdf', 'file')}
    </Popover>
  );
}

function AuditChips({ issues }: { issues: PageRewriterIssue[] }) {
  if (issues.length === 0) {
    return (
      <InlineBanner tone="success" size="sm" title="No page audit issues on this snapshot">
        The loaded audit snapshot did not return issues for this page.
      </InlineBanner>
    );
  }

  const visibleIssues = issues.slice(0, 20);
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Page audit issues">
      {visibleIssues.map((issue, index) => (
        <Badge
          key={`${issue.check}-${index}`}
          label={`${issue.severity}: ${issue.message}`}
          tone={ISSUE_TONE[issue.severity]}
          variant="outline"
          shape="pill"
        />
      ))}
      {issues.length > visibleIssues.length && (
        <Badge
          label={`+${issues.length - visibleIssues.length} more`}
          tone="zinc"
          variant="outline"
          shape="pill"
        />
      )}
    </div>
  );
}

export function PageRewriterDocumentPane({ state, onOpenPicker }: PageRewriterDocumentPaneProps) {
  const pageData = state.pageData;
  const pageAddress = pageData ? (pageData.slug ? normalizePageUrl(pageData.slug) : state.pageUrl) : state.pageUrl;
  const title = pageData?.title || pageAddress || 'Draft document';

  return (
    <section className="flex min-h-[620px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)]">
      <div className="border-b border-[var(--brand-border)] px-4 py-3">
        <Toolbar label="Document controls" className="w-full">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate t-body font-semibold text-[var(--brand-text-bright)]">{title}</h2>
              {state.pageUrl && (
                <a
                  href={state.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 t-ui text-[var(--teal)] hover:opacity-90"
                >
                  Open live page
                  <Icon name="external" size="sm" />
                </a>
              )}
            </div>
            <p className="mt-1 truncate t-ui text-[var(--brand-text-muted)]">{pageAddress || 'Search pages or paste a URL above.'}</p>
          </div>
          <ToolbarSpacer />
          {pageData && (
            <>
              <Button size="sm" variant="ghost" onClick={state.handleFormatBold} aria-label="Bold selection">
                <span className="font-bold">B</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={state.handleFormatItalic} aria-label="Italic selection">
                <span className="italic">I</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={state.handleHeading2}>H2</Button>
              <Button size="sm" variant="ghost" onClick={state.handleHeading3}>H3</Button>
              <Button size="sm" variant="ghost" onClick={state.handleClearFormatting}>
                <Icon name="x" size="sm" />
                Clear
              </Button>
            </>
          )}
        </Toolbar>
      </div>

      {state.loadingPage && (
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="page-rewriter-loading">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
      )}

      {Boolean(state.pageError) && !state.loadingPage && (
        <div className="p-4">
          <ErrorState
            type={state.pageErrorStatus === 502 ? 'network' : 'data'}
            title="Page did not load"
            message={state.pageErrorStatus ? `${state.pageErrorMessage} (HTTP ${state.pageErrorStatus})` : state.pageErrorMessage}
            action={{ label: 'Retry page load', onClick: state.retryPageLoad }}
          />
        </div>
      )}

      {!pageData && !state.loadingPage && !state.pageError && (
        <EmptyState
          icon={EmptyDocIcon}
          title="No page loaded"
          description="Choose a sitemap page or paste a full URL to load editable page content."
          action={<Button size="sm" variant="secondary" onClick={onOpenPicker}>Choose page</Button>}
          className="min-h-[440px]"
        />
      )}

      {pageData && !state.loadingPage && (
        <>
          <div className="grid gap-3 border-b border-[var(--brand-border)] p-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile
              label="Primary Keyword"
              value={pageData.primaryKeyword ?? '—'}
              accent="var(--blue)"
            />
            <MetricTile
              label="Rank"
              value={formatRank(pageData.rank)}
              sub="Current GSC position"
              accent="var(--blue)"
            />
            <MetricTile
              label="Monthly Traffic"
              value={formatNumber(pageData.monthlyTraffic)}
              sub="Organic sessions"
              accent="var(--blue)"
            />
            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-[15px] py-[13px]">
              <Meter
                value={pageData.optimizationScore ?? 0}
                label="Optimization Score"
                showValue={pageData.optimizationScore != null}
                ariaLabel="Optimization score"
                gradient
              />
              {pageData.optimizationScore == null && (
                <p className="mt-2 t-body text-[var(--brand-text-muted)]">No optimization score is available for this page yet.</p>
              )}
            </div>
          </div>

          <div className="border-b border-[var(--brand-border)] px-4 py-3">
            <AuditChips issues={pageData.issues} />
          </div>

          <div
            ref={state.docBodyRefCallback}
            role="textbox"
            aria-multiline="true"
            aria-label="Page rewrite document editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            className="min-h-[440px] flex-1 overflow-y-auto px-6 py-5 t-body text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-mint-glow)]"
          />

          <div className="flex flex-col gap-3 border-t border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-3 sm:flex-row sm:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <Icon name="check" size="sm" className="mt-0.5 flex-none text-[var(--brand-text-muted)]" />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="t-ui font-semibold text-[var(--brand-text-bright)]">Export-only draft</span>
                  <Badge label="Not live" tone="zinc" variant="soft" size="sm" />
                </div>
                <p className="mt-0.5 t-body text-[var(--brand-text-muted)]">Not saved or published to the CMS.</p>
              </div>
            </div>
            <div className="flex flex-none items-center justify-start sm:justify-end">
              <ExportMenu onExport={state.handleExport} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}
