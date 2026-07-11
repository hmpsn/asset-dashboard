// @ds-rebuilt
import {
  Badge,
  Button,
  CompactStatBar,
  EmptyState,
  ErrorState,
  Icon,
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
      <Badge label="No current audit issues" tone="emerald" variant="soft" shape="pill" />
    );
  }

  const visibleIssues = issues.slice(0, 20);
  return (
    <div className="flex min-w-0 gap-1.5 overflow-x-auto" aria-label="Page audit issues">
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

function EvidenceBand({ pageData }: { pageData: NonNullable<PageRewriterState['pageData']> }) {
  return (
    <div
      data-testid="page-rewriter-evidence-band"
      className="flex-none border-b border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2.5"
    >
      <CompactStatBar
        items={[
          { label: 'Keyword', value: pageData.primaryKeyword ?? '—', valueColor: 'text-[var(--blue)]' },
          { label: 'Rank', value: formatRank(pageData.rank), valueColor: 'text-[var(--blue)]' },
          { label: 'Traffic', value: formatNumber(pageData.monthlyTraffic), valueColor: 'text-[var(--blue)]' },
          { label: 'Optimization', value: pageData.optimizationScore == null ? '—' : `${pageData.optimizationScore}/100`, valueColor: 'text-[var(--blue)]' },
        ]}
        className="border-0 bg-transparent px-0 py-0 [&>div]:min-w-0"
      />
      <div className="mt-2 flex min-w-0 items-center gap-2 border-t border-[var(--brand-border)] pt-2">
        <span className="flex-none t-label text-[var(--brand-text-dim)]">Issues</span>
        <AuditChips issues={pageData.issues} />
      </div>
    </div>
  );
}

export function PageRewriterDocumentPane({ state, onOpenPicker }: PageRewriterDocumentPaneProps) {
  const pageData = state.pageData;

  return (
    <section className="flex min-h-[560px] flex-col overflow-hidden rounded-[var(--radius-xl)] border border-[var(--brand-border)] bg-[var(--surface-2)] shadow-[var(--shadow-md)] lg:h-full lg:min-h-0">
      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-[var(--brand-border)] px-4 py-2.5">
        <span
          className="flex h-7 w-7 flex-none items-center justify-center rounded-[var(--radius-md)] text-[var(--blue)]"
          style={{ background: 'color-mix(in srgb, var(--blue) 12%, transparent)' }}
          aria-hidden="true"
        >
          <Icon name="pencil" size="sm" />
        </span>
        <div className="mr-auto min-w-0">
          <h2 className="t-ui font-bold text-[var(--brand-text-bright)]">Live document</h2>
          <p className="truncate t-caption text-[var(--brand-text-muted)]">Edit inline — rewrites land here</p>
        </div>
        {pageData && state.pageUrl && (
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
        {pageData && <ExportMenu onExport={state.handleExport} />}
      </div>

      {pageData && (
        <div className="flex-none border-b border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-1.5">
          <Toolbar label="Document formatting" className="w-full" wrap={false} gap={4}>
            <Button size="sm" variant="ghost" onClick={state.handleFormatBold} aria-label="Bold selection" className="min-w-8 px-2">
              <span className="font-bold">B</span>
            </Button>
            <Button size="sm" variant="ghost" onClick={state.handleFormatItalic} aria-label="Italic selection" className="min-w-8 px-2">
              <span className="italic">I</span>
            </Button>
            <span className="mx-1 h-5 w-px flex-none bg-[var(--brand-border)]" aria-hidden="true" />
            <Button size="sm" variant="ghost" onClick={state.handleHeading2}>H2</Button>
            <Button size="sm" variant="ghost" onClick={state.handleHeading3}>H3</Button>
            <ToolbarSpacer />
            <Button size="sm" variant="ghost" onClick={state.handleClearFormatting}>
              <Icon name="x" size="sm" />
              Clear
            </Button>
          </Toolbar>
        </div>
      )}

      {state.loadingPage && (
        <div className="grid min-h-0 flex-1 gap-3 p-4 sm:grid-cols-2" data-testid="page-rewriter-loading">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 w-full" />)}
        </div>
      )}

      {Boolean(state.pageError) && !state.loadingPage && (
        <div className="flex min-h-0 flex-1 items-center p-4">
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
          className="min-h-0 flex-1"
        />
      )}

      {pageData && !state.loadingPage && (
        <>
          <EvidenceBand pageData={pageData} />

          <div
            ref={state.docBodyRefCallback}
            role="textbox"
            aria-multiline="true"
            aria-label="Page rewrite document editor"
            contentEditable
            suppressContentEditableWarning
            spellCheck
            className="min-h-0 flex-1 overflow-y-auto px-6 py-5 t-page text-[var(--brand-text-bright)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-mint-glow)]"
          />

          <div className="flex flex-none flex-wrap items-center gap-2 border-t border-[var(--brand-border)] bg-[var(--surface-1)] px-4 py-2">
            <Icon name="info" size="sm" className="flex-none text-[var(--brand-text-muted)]" />
            <span className="t-ui font-semibold text-[var(--brand-text-bright)]">Export-only draft</span>
            <Badge label="Not live" tone="zinc" variant="soft" size="sm" />
            <span className="t-caption text-[var(--brand-text-muted)]">Not saved or published to the CMS.</span>
          </div>
        </>
      )}
    </section>
  );
}
