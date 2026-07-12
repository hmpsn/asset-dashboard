// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { InternalLinkResult, LinkSuggestion, PageLinkHealth } from '../../../shared/types/internal-links';
import { toInternalLinkClientActionItem } from '../../lib/internal-link-client-action';
import { useSendInternalLinks } from '../../hooks/admin/useAdminLinks';
import {
  Badge,
  Button,
  ClickableRow,
  DataTable,
  Drawer,
  EmptyState,
  FormTextarea,
  GroupBlock,
  Icon,
  InlineBanner,
  Meter,
  MetricTile,
  SectionCard,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import { scoreColor } from '../ui/constants';
import type { InternalPriorityFilter, InternalViewMode } from './useLinksSurfaceState';
import { dateTimeOrDash } from './linksFormatters';
import { mutationErrorMessage } from './linksMutationFeedback';
import { useToast } from '../Toast';

interface InternalLinksLensProps {
  workspaceId: string;
  snapshot: UseQueryResult<InternalLinkResult | null, Error>;
  analyze: UseMutationResult<InternalLinkResult, Error, void, unknown>;
  priority: InternalPriorityFilter;
  onPriorityChange: (priority: InternalPriorityFilter) => void;
  viewMode: InternalViewMode;
  onViewModeChange: (mode: InternalViewMode) => void;
  search: string;
  clearSearch: () => void;
}

type SuggestionRecord = Record<string, unknown> & {
  source: LinkSuggestion;
  fromPage: string;
  toPage: string;
  anchorText: string;
  priority: string;
};

function priorityTone(priority: LinkSuggestion['priority']): 'red' | 'amber' | 'blue' {
  if (priority === 'high') return 'red';
  if (priority === 'medium') return 'amber';
  return 'blue';
}

function filterSuggestions(suggestions: LinkSuggestion[], priority: InternalPriorityFilter, search: string): LinkSuggestion[] {
  const q = search.trim().toLowerCase();
  return suggestions.filter((suggestion) => {
    const matchesPriority = priority === 'all' || suggestion.priority === priority;
    const matchesSearch = !q
      || suggestion.fromPage.toLowerCase().includes(q)
      || suggestion.toPage.toLowerCase().includes(q)
      || suggestion.fromTitle.toLowerCase().includes(q)
      || suggestion.toTitle.toLowerCase().includes(q)
      || suggestion.anchorText.toLowerCase().includes(q);
    return matchesPriority && matchesSearch;
  });
}

function toSuggestionRecord(suggestion: LinkSuggestion): SuggestionRecord {
  return {
    source: suggestion,
    fromPage: suggestion.fromPage,
    toPage: suggestion.toPage,
    anchorText: suggestion.anchorText,
    priority: suggestion.priority,
  };
}

function averageLinkScore(pageHealth: PageLinkHealth[] | undefined): number | null {
  if (!pageHealth || pageHealth.length === 0) return null;
  return Math.round(pageHealth.reduce((sum, page) => sum + page.score, 0) / pageHealth.length);
}

function htmlForSuggestion(suggestion: LinkSuggestion): string {
  return `<a href="${suggestion.toPage}">${suggestion.anchorText}</a>`;
}

function SuggestionDrawer({
  suggestion,
  onClose,
  onCopy,
}: {
  suggestion: LinkSuggestion | null;
  onClose: () => void;
  onCopy: (suggestion: LinkSuggestion) => void;
}) {
  return (
    <Drawer
      open={suggestion != null}
      onClose={onClose}
      title={suggestion?.anchorText ?? 'Internal link'}
      subtitle={suggestion ? `${suggestion.fromTitle} -> ${suggestion.toTitle}` : undefined}
      eyebrow="Internal link detail"
      width={520}
      footer={suggestion && (
        <Toolbar label="Internal link detail actions" className="w-full">
          <Button size="sm" variant="primary" onClick={() => onCopy(suggestion)}>
            <Icon name="copy" size="sm" />
            Copy HTML
          </Button>
          <ToolbarSpacer />
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </Toolbar>
      )}
    >
      {!suggestion ? (
        <InlineBanner tone="info" title="Suggestion unavailable">Pick another row to review its internal-link detail.</InlineBanner>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <MetricTile label="Priority" value={suggestion.priority} accent={`var(--${priorityTone(suggestion.priority)})`} />
            <MetricTile label="Anchor text" value={suggestion.anchorText} accent="var(--teal)" />
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <p className="t-label text-[var(--brand-text-muted)]">From page</p>
            <p className="mt-1 t-caption font-semibold text-[var(--brand-text-bright)]">{suggestion.fromTitle}</p>
            <p className="mt-1 break-all t-caption-sm text-[var(--brand-text-muted)]">{suggestion.fromPage}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <p className="t-label text-[var(--brand-text-muted)]">Link target</p>
            <p className="mt-1 t-caption font-semibold text-[var(--brand-text-bright)]">{suggestion.toTitle}</p>
            <p className="mt-1 break-all t-caption-sm text-[var(--brand-text-muted)]">{suggestion.toPage}</p>
          </div>
          <InlineBanner tone="info" title="Why this link">
            <p className="t-body text-[var(--brand-text-muted)]">{suggestion.reason}</p>
          </InlineBanner>
          <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2 t-caption-sm text-[var(--brand-text)]">
            {htmlForSuggestion(suggestion)}
          </pre>
        </div>
      )}
    </Drawer>
  );
}

function OrphanPages({ pageHealth }: { pageHealth: PageLinkHealth[] | undefined }) {
  const orphans = (pageHealth ?? []).filter((page) => page.isOrphan);
  if (orphans.length === 0) {
    return (
      <div data-testid="internal-orphans">
        <InlineBanner tone="success" title="No orphan pages detected">
          Every analyzed page has at least one inbound internal link.
        </InlineBanner>
      </div>
    );
  }
  return (
    <div data-testid="internal-orphans">
      <InlineBanner tone="warning" title={`${orphans.length} orphan page${orphans.length === 1 ? '' : 's'}`}>
        <p className="t-body text-[var(--brand-text-muted)]">
          These pages have no inbound internal links, so crawlers and visitors have a harder time finding them.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {orphans.slice(0, 6).map((page) => (
            <span key={page.path} className="max-w-full truncate rounded-[var(--radius-sm)] border border-[var(--amber)]/25 bg-[var(--surface-2)] px-2 py-1 t-caption-sm text-[var(--amber)]">
              {page.path}
            </span>
          ))}
          {orphans.length > 6 && (
            <span className="rounded-[var(--radius-sm)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-2 py-1 t-caption-sm text-[var(--brand-text-muted)]">
              +{orphans.length - 6} more in page health evidence
            </span>
          )}
        </div>
      </InlineBanner>
    </div>
  );
}

function PageHealthEvidence({ pageHealth }: { pageHealth: PageLinkHealth[] | undefined }) {
  if (!pageHealth || pageHealth.length === 0) return null;
  const average = averageLinkScore(pageHealth);
  return (
    <GroupBlock
      title="Page health evidence"
      meta="Inbound, outbound, and internal-link health from the latest analysis."
      stats={[
        { label: 'Average score', value: average ?? '—', color: average == null ? 'var(--brand-text-dim)' : scoreColor(average) },
        { label: 'Pages', value: pageHealth.length, color: 'var(--blue)' },
      ]}
      headingLevel="h2"
      collapsible
      defaultOpen={false}
    >
      <div className="divide-y divide-[var(--brand-border)]">
        {pageHealth.map((page) => (
          <div key={page.path} className="grid gap-2 px-2 py-3 sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center">
            <div className="min-w-0">
              <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{page.title}</p>
              <p className="truncate t-caption-sm text-[var(--brand-text-muted)]">{page.path}</p>
            </div>
            <Meter value={page.score} color={scoreColor(page.score)} showValue ariaLabel={`${page.title} link health score`} />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              {page.inboundLinks} inbound · {page.outboundLinks} outbound
            </span>
          </div>
        ))}
      </div>
    </GroupBlock>
  );
}

function GroupedSuggestions({
  suggestions,
  onOpen,
  onCopy,
}: {
  suggestions: LinkSuggestion[];
  onOpen: (suggestion: LinkSuggestion) => void;
  onCopy: (suggestion: LinkSuggestion) => void;
}) {
  const groups = useMemo(() => {
    const byPage = new Map<string, LinkSuggestion[]>();
    for (const suggestion of suggestions) {
      const current = byPage.get(suggestion.fromPage) ?? [];
      current.push(suggestion);
      byPage.set(suggestion.fromPage, current);
    }
    return [...byPage.entries()];
  }, [suggestions]);

  if (groups.length === 0) return null;

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {groups.map(([fromPage, group]) => (
        <GroupBlock
          key={fromPage}
          title={group[0]?.fromTitle ?? fromPage}
          meta={fromPage}
          stats={[{ label: 'Links', value: group.length, color: 'var(--teal)' }]}
          collapsible
          defaultOpen
        >
          <div className="grid gap-2">
            {group.map((suggestion, index) => (
              <ClickableRow
                key={`${suggestion.fromPage}-${suggestion.toPage}-${index}`}
                onClick={() => onOpen(suggestion)}
                className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{suggestion.toTitle}</p>
                    <p className="truncate t-caption-sm text-[var(--brand-text-muted)]">{suggestion.toPage}</p>
                    <p className="mt-1 truncate t-caption-sm text-[var(--teal)]">"{suggestion.anchorText}"</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Badge label={suggestion.priority} tone={priorityTone(suggestion.priority)} variant="soft" />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Copy HTML for ${suggestion.anchorText}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopy(suggestion);
                      }}
                    >
                      <Icon name="copy" size="sm" />
                    </Button>
                  </div>
                </div>
              </ClickableRow>
            ))}
          </div>
        </GroupBlock>
      ))}
    </div>
  );
}

export function InternalLinksLens({
  workspaceId,
  snapshot,
  analyze,
  priority,
  onPriorityChange,
  viewMode,
  onViewModeChange,
  search,
  clearSearch,
}: InternalLinksLensProps) {
  const { toast } = useToast();
  const data = analyze.data ?? snapshot.data ?? null;
  const sendToClient = useSendInternalLinks(workspaceId);
  const [note, setNote] = useState('');
  const [selectedSuggestion, setSelectedSuggestion] = useState<LinkSuggestion | null>(null);
  const filtered = useMemo(() => filterSuggestions(data?.suggestions ?? [], priority, search), [data?.suggestions, priority, search]);
  const rows = useMemo(() => filtered.map(toSuggestionRecord), [filtered]);
  const counts = {
    high: data?.suggestions.filter((suggestion) => suggestion.priority === 'high').length ?? 0,
    medium: data?.suggestions.filter((suggestion) => suggestion.priority === 'medium').length ?? 0,
    low: data?.suggestions.filter((suggestion) => suggestion.priority === 'low').length ?? 0,
  };
  const filters = [
    { id: 'all' as const, label: 'All', count: data?.suggestions.length ?? 0 },
    { id: 'high' as const, label: 'High', count: counts.high },
    { id: 'medium' as const, label: 'Medium', count: counts.medium },
    { id: 'low' as const, label: 'Low', count: counts.low },
  ];

  const copyHtml = useCallback((suggestion: LinkSuggestion) => {
    void navigator.clipboard.writeText(htmlForSuggestion(suggestion));
    toast('Internal link HTML copied', 'success');
  }, [toast]);

  const sendSuggestions = () => {
    if (!data || filtered.length === 0) return;
    const highCount = filtered.filter((suggestion) => suggestion.priority === 'high').length;
    sendToClient.mutate({
      sourceId: `internal-links:${data.analyzedAt}`,
      title: `Internal link recommendations (${filtered.length})`,
      summary: `Review ${filtered.length} internal link recommendation${filtered.length !== 1 ? 's' : ''}. ${highCount} high-priority link${highCount !== 1 ? 's' : ''} ${highCount === 1 ? 'needs' : 'need'} attention first.`,
      priority: highCount > 0 ? 'high' : 'medium',
      clientNote: note.trim() || undefined,
      payload: {
        analyzedAt: data.analyzedAt,
        suggestions: filtered.map(toInternalLinkClientActionItem),
        summary: {
          pageCount: data.pageCount,
          existingLinkCount: data.existingLinkCount,
          orphanCount: data.orphanCount ?? 0,
        },
      },
    }, {
      onSuccess: () => toast('Internal-link recommendations sent to client', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Internal-link send failed'), 'error'),
    });
  };

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'fromPage',
      label: 'From',
      width: 'minmax(220px, 1.2fr)',
      sortable: true,
      render: (_value, record) => {
        const suggestion = (record as SuggestionRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{suggestion.fromTitle}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{suggestion.fromPage}</span>
          </div>
        );
      },
    },
    {
      key: 'toPage',
      label: 'To',
      width: 'minmax(220px, 1.2fr)',
      sortable: true,
      render: (_value, record) => {
        const suggestion = (record as SuggestionRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{suggestion.toTitle}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{suggestion.toPage}</span>
          </div>
        );
      },
    },
    {
      key: 'anchorText',
      label: 'Anchor',
      width: 'minmax(170px, 0.8fr)',
      sortable: true,
      render: (_value, record) => <span className="truncate text-[var(--teal)]">"{(record as SuggestionRecord).source.anchorText}"</span>,
    },
    {
      key: 'priority',
      label: 'Priority',
      width: '104px',
      sortable: true,
      render: (_value, record) => {
        const suggestion = (record as SuggestionRecord).source;
        return <Badge label={suggestion.priority} tone={priorityTone(suggestion.priority)} variant="soft" />;
      },
    },
    {
      key: 'copy',
      label: 'Copy',
      width: '82px',
      render: (_value, record) => {
        const suggestion = (record as SuggestionRecord).source;
        return (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Button size="sm" variant="ghost" aria-label={`Copy HTML for ${suggestion.anchorText}`} onClick={() => copyHtml(suggestion)}>
              <Icon name="copy" size="sm" />
            </Button>
          </div>
        );
      },
    },
  ], [copyHtml]);

  if (!data && (snapshot.isLoading || analyze.isPending)) {
    return (
      <div className="flex flex-col gap-3" aria-label="Analyzing internal links">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  if (!data && snapshot.isError) {
    return (
      <EmptyState
        icon={() => <Icon name="alert" size="2xl" />}
        title="Internal-link snapshot did not load"
        description="Retry the saved snapshot or run a fresh analysis."
        action={<Button size="sm" variant="primary" onClick={() => analyze.mutate()}>Analyze internal links</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={() => <Icon name="link" size="2xl" />}
        title="No internal-link analysis yet"
        description="Analyze page content to find missing contextual links and orphan pages."
        action={<Button size="sm" variant="primary" onClick={() => analyze.mutate()}>Analyze internal links</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {analyze.isError && (
        <InlineBanner tone="error" title="Internal-link analysis failed">
          <div className="flex flex-wrap items-center gap-2">
            <span>{mutationErrorMessage(analyze.error, 'Internal-link analysis failed')}</span>
            <Button size="sm" variant="secondary" onClick={() => analyze.mutate()}>
              Retry analysis
            </Button>
          </div>
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-3" data-testid="internal-metrics">
        <MetricTile label="Linking opportunities" value={data.suggestions.length} accent="var(--blue)" />
        <MetricTile label="High priority" value={counts.high} accent="var(--red)" />
        <MetricTile label="Orphan pages" value={data.orphanCount ?? 0} accent="var(--amber)" />
      </div>

      <OrphanPages pageHealth={data.pageHealth} />

      <div data-testid="internal-primary">
        <SectionCard
          title="Internal linking opportunities"
          subtitle="Pass authority to pages that need it — highest priority first."
          titleIcon={<Icon name="link" size="sm" className="text-[var(--teal)]" />}
          iconChip
          titleExtra={<span className="hidden sm:inline-flex"><Badge label={`${filtered.length} shown`} tone="teal" variant="soft" /></span>}
          action={(
            <Segmented
              value={viewMode}
              onChange={(value) => onViewModeChange(value as InternalViewMode)}
              options={[
                { value: 'list', label: 'List' },
                { value: 'grouped', label: 'By source' },
              ]}
            />
          )}
          noPadding
          variant="subtle"
        >
          <Toolbar label="Internal-link priority controls" className="border-b border-[var(--brand-border)] px-3 py-2">
            <div className="flex flex-wrap gap-1.5" aria-label="Internal-link priority filters">
              {filters.map((item) => (
                <Button
                  key={item.id}
                  size="sm"
                  variant={priority === item.id ? 'secondary' : 'ghost'}
                  onClick={() => onPriorityChange(item.id)}
                  aria-pressed={priority === item.id}
                >
                  {item.label} <span className="t-micro text-[var(--brand-text-dim)]">{item.count}</span>
                </Button>
              ))}
            </div>
            <ToolbarSpacer />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">
              Last analyzed {dateTimeOrDash(data.analyzedAt)}
            </span>
          </Toolbar>

          <div className="p-2">
            {viewMode === 'grouped' ? (
              filtered.length === 0 ? (
                <EmptyState
                  icon={() => <Icon name="search" size="2xl" />}
                  title="No internal-link suggestions match this view"
                  description="Clear search or choose a broader priority filter."
                  action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
                />
              ) : (
                <GroupedSuggestions suggestions={filtered} onOpen={setSelectedSuggestion} onCopy={copyHtml} />
              )
            ) : (
              <DataTable
                columns={columns}
                rows={rows}
                getRowKey={(record, index) => `${(record as SuggestionRecord).source.fromPage}:${(record as SuggestionRecord).source.toPage}:${index}`}
                onRowClick={(record) => setSelectedSuggestion((record as SuggestionRecord).source)}
                empty={(
                  <EmptyState
                    icon={() => <Icon name="search" size="2xl" />}
                    title="No internal-link suggestions match this view"
                    description="Clear search or choose a broader priority filter."
                    action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
                  />
                )}
              />
            )}
          </div>
        </SectionCard>
      </div>

      <PageHealthEvidence pageHealth={data.pageHealth} />

      {data.attemptedPageCount && data.attemptedPageCount !== data.pageCount && (
        <InlineBanner tone={data.pageCount < data.attemptedPageCount * 0.5 ? 'warning' : 'info'} title="Partial page fetch">
          <p className="t-body text-[var(--brand-text-muted)]">
            Analyzed {data.pageCount} of {data.attemptedPageCount} attempted pages. Password gates or unreachable pages can make results incomplete.
          </p>
        </InlineBanner>
      )}

      {workspaceId && data.suggestions.length > 0 && (
        <GroupBlock
          title="Send recommendations to client"
          meta="Sends the currently filtered suggestions as one internal-link action."
          stats={[{ label: 'Included', value: filtered.length, color: 'var(--teal)' }]}
          collapsible
          defaultOpen={false}
        >
          <div className="flex flex-col gap-3">
            <FormTextarea
              value={note}
              onChange={setNote}
              rows={2}
              maxLength={2000}
              placeholder="Add a note for your client (optional)"
              disabled={sendToClient.isPending}
            />
            <Button size="sm" variant="primary" disabled={sendToClient.isPending || filtered.length === 0} onClick={sendSuggestions}>
              <Icon name="send" size="sm" />
              Send to client
            </Button>
          </div>
        </GroupBlock>
      )}

      {data.suggestions.length === 0 && (
        <InlineBanner tone="success" title="No internal-link gaps detected">
          <p className="t-body text-[var(--brand-text-muted)]">
            Your site has good internal-link coverage for the pages that were analyzed.
          </p>
        </InlineBanner>
      )}

      {data.suggestions.length > 0 && (
        <InlineBanner tone="info" title="How to implement">
          <p className="t-body text-[var(--brand-text-muted)]">
            Copy the generated HTML, open the source page in Webflow or the SEO Editor, and place the link naturally in the body copy.
          </p>
        </InlineBanner>
      )}

      <SuggestionDrawer
        suggestion={selectedSuggestion}
        onClose={() => setSelectedSuggestion(null)}
        onCopy={copyHtml}
      />
    </div>
  );
}
