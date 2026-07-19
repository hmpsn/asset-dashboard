// @ds-rebuilt
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type {
  PageStatus,
  RedirectChain,
  RedirectScanResult,
  RedirectSnapshot,
} from '../../hooks/admin/useAdminLinks';
import { useSendRedirectProposal } from '../../hooks/admin/useAdminLinks';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import {
  Badge,
  Button,
  ClickableRow,
  DataTable,
  EmptyState,
  FormInput,
  FormTextarea,
  GroupBlock,
  Icon,
  InlineBanner,
  MetricTile,
  SectionCard,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import type { RedirectStatusFilter } from './useLinksSurfaceState';
import { dateTimeOrDash, downloadCsv, numberOrDash, truncateMiddle } from './linksFormatters';
import { mutationErrorMessage } from './linksMutationFeedback';
import { useToast } from '../Toast';
import { useSnapshotSendLatch } from './InternalLinksLens';

interface RedirectRule {
  from: string;
  to: string;
  reason: string;
  accepted: boolean;
}

interface RedirectsLensProps {
  workspaceId: string;
  snapshot: UseQueryResult<RedirectSnapshot | null, Error>;
  scan: UseMutationResult<RedirectScanResult, Error, void, unknown>;
  filter: RedirectStatusFilter;
  onFilterChange: (filter: RedirectStatusFilter) => void;
  search: string;
  clearSearch: () => void;
}

type RedirectPageRecord = Record<string, unknown> & {
  source: PageStatus;
  path: string;
  title: string;
  statusSort: number;
  sourceType: string;
  clicks: number | null;
  impressions: number | null;
  matchScore: number | null;
};

function ruleKey(path: string): string {
  return path.trim().toLowerCase();
}

function buildRules(data: RedirectScanResult | null): RedirectRule[] {
  if (!data) return [];
  return data.pageStatuses
    .filter((page) => page.recommendedTarget)
    .map((page) => ({
      from: page.path,
      to: page.recommendedTarget ?? '',
      reason: page.recommendedReason || 'Suggested from the closest available URL match.',
      accepted: false,
    }));
}

function statusTone(status: PageStatus['status']): 'emerald' | 'amber' | 'red' | 'zinc' {
  if (status === 'error') return 'red';
  if (status >= 200 && status < 300) return 'emerald';
  if (status >= 300 && status < 400) return 'amber';
  if (status >= 400) return 'red';
  return 'zinc';
}

function StatusBadge({ status }: { status: PageStatus['status'] }) {
  return (
    <Badge
      label={status === 'error' ? 'ERR' : String(status)}
      tone={statusTone(status)}
      variant="soft"
      size="sm"
      className="font-mono"
    />
  );
}

function filterPages(pages: PageStatus[], filter: RedirectStatusFilter, search: string): PageStatus[] {
  const q = search.trim().toLowerCase();
  return pages.filter((page) => {
    const matchesSearch = !q
      || page.path.toLowerCase().includes(q)
      || page.title.toLowerCase().includes(q)
      || page.url.toLowerCase().includes(q);
    if (!matchesSearch) return false;
    if (filter === 'redirects') return typeof page.status === 'number' && page.status >= 300 && page.status < 400;
    if (filter === '404s') return typeof page.status === 'number' && page.status >= 400 && page.status < 500;
    if (filter === 'errors') return page.status === 'error' || (typeof page.status === 'number' && page.status >= 500);
    return true;
  });
}

function toPageRecord(page: PageStatus): RedirectPageRecord {
  return {
    source: page,
    path: page.path,
    title: page.title,
    statusSort: page.status === 'error' ? 999 : page.status,
    sourceType: page.source,
    clicks: page.clicks ?? null,
    impressions: page.impressions ?? null,
    matchScore: page.matchScore ?? null,
  };
}

function RedirectRecommendations({
  workspaceId,
  data,
  rules,
  setRules,
}: {
  workspaceId: string;
  data: RedirectScanResult;
  rules: RedirectRule[];
  setRules: Dispatch<SetStateAction<RedirectRule[]>>;
}) {
  const { toast } = useToast();
  const sendToClient = useSendRedirectProposal(workspaceId);
  const sendLatch = useSnapshotSendLatch(data.scannedAt);
  const [editingRule, setEditingRule] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [note, setNote] = useState('');
  const acceptedRules = rules.filter((rule) => rule.accepted);

  const acceptRule = (from: string) => {
    setRules((current) => current.map((rule) => rule.from === from ? { ...rule, accepted: true } : rule));
  };

  const dismissRule = (from: string) => {
    setRules((current) => current.filter((rule) => rule.from !== from));
  };

  const saveTarget = (from: string) => {
    const target = editDraft.trim();
    if (!target) return;
    setRules((current) => current.map((rule) => rule.from === from ? { ...rule, to: target, accepted: true } : rule));
    setEditingRule(null);
    setEditDraft('');
  };

  const copyAccepted = () => {
    void navigator.clipboard.writeText(acceptedRules.map((rule) => `${rule.from} -> ${rule.to}`).join('\n'));
    toast('Redirect rules copied', 'success');
  };

  const exportAccepted = () => {
    downloadCsv('webflow-redirects.csv', [
      ['Old Path', 'Redirect To'],
      ...acceptedRules.map((rule) => [rule.from, rule.to]),
    ]);
    toast('Redirect CSV exported', 'success');
  };

  const sendAccepted = () => {
    if (acceptedRules.length === 0) return;
    sendToClient.mutate({
      sourceId: `redirects:${data.scannedAt}`,
      title: `Redirect recommendations (${acceptedRules.length})`,
      summary: `Review ${acceptedRules.length} redirect proposal${acceptedRules.length !== 1 ? 's' : ''}. These are reviewed here, then exported or sent for approval before implementation.`,
      priority: acceptedRules.length > 3 ? 'high' : 'medium',
      clientNote: note.trim() || undefined,
      payload: {
        scannedAt: data.scannedAt,
        redirects: acceptedRules.map((rule) => ({
          source: rule.from,
          target: rule.to,
          rationale: rule.reason,
        })),
        summary: data.summary,
      },
    }, {
      onSuccess: () => {
        sendLatch.markSent();
        toast('Redirect proposal sent to client', 'success');
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Redirect proposal send failed'), 'error'),
    });
  };

  if (rules.length === 0) {
    return (
      <div data-testid="redirects-primary">
        <SectionCard
          title="Suggested 301 redirects"
          subtitle="Recover link equity and stop visitors reaching dead ends."
          titleIcon={<Icon name="arrowRight" size="sm" className="text-[var(--teal)]" />}
          iconChip
          noPadding
          variant="subtle"
        >
          <div className="px-4 py-7 text-center">
            <p className="t-ui font-semibold text-[var(--brand-text-bright)]">No suggested targets in this scan</p>
            <p className="mt-1 t-caption text-[var(--brand-text-muted)]">The saved crawl has no redirect recommendations to review or export.</p>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[14px]" data-testid="redirects-primary">
      <SectionCard
        title="Suggested 301 redirects"
        subtitle="Recover link equity and stop visitors reaching dead ends."
        titleIcon={<Icon name="arrowRight" size="sm" className="text-[var(--teal)]" />}
        iconChip
        titleExtra={<span className="hidden sm:inline-flex"><Badge label={`${acceptedRules.length} accepted`} tone={acceptedRules.length > 0 ? 'emerald' : 'zinc'} variant="soft" /></span>}
        action={(
          <Button size="sm" variant="primary" aria-label={`Export CSV (${acceptedRules.length})`} disabled={acceptedRules.length === 0} onClick={exportAccepted}>
            <Icon name="download" size="sm" />
            <span className="hidden sm:inline">Export CSV ({acceptedRules.length})</span>
          </Button>
        )}
        noPadding
        variant="subtle"
      >
        <div className="divide-y divide-[var(--brand-border)]">
          {rules.map((rule) => (
            <div key={rule.from} className="grid gap-2 px-4 py-3 transition-colors hover:bg-[var(--surface-3)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge label="404" tone="red" variant="soft" size="sm" className="font-mono" />
                  <span className="truncate t-caption font-semibold text-[var(--red)]">{rule.from}</span>
                </div>
                {editingRule === rule.from ? (
                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">
                    <FormInput
                      value={editDraft}
                      onChange={setEditDraft}
                      aria-label={`Edit target for ${rule.from}`}
                      className="min-w-[240px] flex-1"
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') saveTarget(rule.from);
                        if (event.key === 'Escape') {
                          setEditingRule(null);
                          setEditDraft('');
                        }
                      }}
                    />
                    <Button size="sm" variant="primary" onClick={() => saveTarget(rule.from)}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingRule(null)}>Cancel</Button>
                  </div>
                ) : (
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <Icon name="arrowRight" size="sm" className="shrink-0 text-[var(--brand-text-dim)]" />
                    <span className="truncate t-caption font-semibold text-[var(--emerald)]">{rule.to}</span>
                    {rule.accepted && <Badge label="Accepted" tone="emerald" variant="soft" size="sm" />}
                  </div>
                )}
                <p className="mt-1 truncate t-caption-sm text-[var(--brand-text-muted)]">{rule.reason}</p>
              </div>
              {editingRule !== rule.from && (
                <div className="flex shrink-0 items-center gap-1.5 sm:justify-end">
                  {!rule.accepted && (
                    <Button size="sm" variant="secondary" onClick={() => acceptRule(rule.from)}>
                      <Icon name="check" size="sm" />
                      Accept
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditingRule(rule.from);
                      setEditDraft(rule.to);
                    }}
                  >
                    <Icon name="pencil" size="sm" />
                    Edit target
                  </Button>
                  {!rule.accepted && (
                    <Button size="sm" variant="ghost" aria-label={`Dismiss ${rule.from}`} onClick={() => dismissRule(rule.from)}>
                      <Icon name="x" size="sm" />
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>

      {acceptedRules.length > 0 && (
        <GroupBlock
          title="Accepted redirect batch"
          meta="Copy the rules or send the reviewed proposal to the client."
          stats={[{ label: 'Accepted', value: acceptedRules.length, color: 'var(--emerald)' }]}
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
            <Toolbar label="Accepted redirect rule actions">
              <Button size="sm" variant="secondary" onClick={copyAccepted}>
                <Icon name="copy" size="sm" />
                Copy accepted
              </Button>
              <ToolbarSpacer />
              <Button size="sm" variant="primary" disabled={sendToClient.isPending || sendLatch.sent} onClick={sendAccepted}>
                <Icon name={sendLatch.sent ? 'check' : 'send'} size="sm" />
                {sendLatch.sent ? 'Sent' : 'Send to client'}
              </Button>
            </Toolbar>
          </div>
        </GroupBlock>
      )}
    </div>
  );
}

function RedirectChains({ chains }: { chains: RedirectChain[] }) {
  const [expandedChains, toggleChain] = useToggleSet<number>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  if (chains.length === 0) return null;

  return (
    <GroupBlock
      title="Redirect chains"
      meta="Multi-hop redirects slow page loads and waste crawl budget. Aim for one hop."
      stats={[{ label: 'Chains', value: chains.length, color: 'var(--amber)' }]}
      collapsible
      defaultOpen={false}
    >
      <div className="flex flex-col gap-2">
        {chains.map((chain, index) => {
          const open = expandedChains.has(index);
          return (
            <div key={`${chain.originalUrl}-${index}`} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
              <ClickableRow
                onClick={() => toggleChain(index)}
                active={open}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Icon name={open ? 'chevronDown' : 'arrowRight'} size="sm" className="text-[var(--brand-text-dim)]" />
                  <span className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">
                    {truncateMiddle(chain.originalUrl)}
                  </span>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <Badge label={`${chain.totalHops} hops`} tone="amber" variant="soft" />
                  {chain.isLoop && <Badge label="Loop" tone="red" variant="soft" />}
                  <Badge label={chain.type} tone={chain.type === 'internal' ? 'teal' : 'zinc'} variant="outline" />
                </div>
              </ClickableRow>
              {open && (
                <div className="border-t border-[var(--brand-border)] px-4 py-3">
                  <div className="flex flex-col gap-1.5">
                    {chain.hops.map((hop, hopIndex) => (
                      <div key={`${hop.url}-${hopIndex}`} className="flex min-w-0 items-center gap-2 t-caption-sm">
                        <StatusBadge status={hop.status} />
                        <span className="truncate text-[var(--brand-text)]">{hop.url}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 truncate t-caption-sm text-[var(--brand-text-muted)]">
                    Final destination: <span className="text-[var(--brand-text-bright)]">{chain.finalUrl}</span>
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </GroupBlock>
  );
}

export function RedirectsLens({
  workspaceId,
  snapshot,
  scan,
  filter,
  onFilterChange,
  search,
  clearSearch,
}: RedirectsLensProps) {
  const data = scan.data ?? snapshot.data?.result ?? null;
  const scanTime = snapshot.data?.createdAt ?? data?.scannedAt ?? null;
  const [rules, setRules] = useState<RedirectRule[]>([]);

  useEffect(() => {
    setRules(buildRules(data));
  }, [data]);

  const filteredPages = useMemo(() => filterPages(data?.pageStatuses ?? [], filter, search), [data?.pageStatuses, filter, search]);
  const tableRows = useMemo(() => filteredPages.map(toPageRecord), [filteredPages]);
  const ruleMap = useMemo(() => new Map(rules.map((rule) => [ruleKey(rule.from), rule])), [rules]);
  const summary = data?.summary;
  const notFoundPages = data?.pageStatuses.filter((page) => typeof page.status === 'number' && page.status >= 400 && page.status < 500) ?? [];
  const hasClickEvidence = notFoundPages.some((page) => typeof page.clicks === 'number');
  const atRiskClicks = hasClickEvidence
    ? notFoundPages.reduce((sum, page) => sum + (page.clicks ?? 0), 0)
    : '—';
  const filters = [
    { id: 'all' as const, label: 'All pages', count: data?.pageStatuses.length ?? 0 },
    { id: 'redirects' as const, label: 'Redirects', count: summary?.redirecting ?? 0 },
    { id: '404s' as const, label: '404s', count: summary?.notFound ?? 0 },
    { id: 'errors' as const, label: 'Errors', count: summary?.errors ?? 0 },
  ];

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'statusSort',
      label: 'Status',
      width: '82px',
      sortable: true,
      render: (_value, record) => <StatusBadge status={(record as RedirectPageRecord).source.status} />,
    },
    {
      key: 'path',
      label: 'Path',
      width: 'minmax(240px, 1.6fr)',
      sortable: true,
      render: (_value, record) => {
        const page = (record as RedirectPageRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{page.path}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{page.title || page.url}</span>
          </div>
        );
      },
    },
    {
      key: 'sourceType',
      label: 'Source',
      width: '92px',
      sortable: true,
      render: (_value, record) => {
        const source = (record as RedirectPageRecord).source.source;
        return <Badge label={source === 'gsc' ? 'GSC' : source} tone={source === 'gsc' ? 'amber' : source === 'cms' ? 'teal' : 'zinc'} variant="soft" />;
      },
    },
    {
      key: 'clicks',
      label: 'Clicks',
      width: '86px',
      align: 'right',
      sortable: true,
      render: (_value, record) => numberOrDash((record as RedirectPageRecord).clicks),
    },
    {
      key: 'impressions',
      label: 'Impr.',
      width: '92px',
      align: 'right',
      sortable: true,
      render: (_value, record) => numberOrDash((record as RedirectPageRecord).impressions),
    },
    {
      key: 'matchScore',
      label: 'Match',
      width: '86px',
      align: 'right',
      sortable: true,
      // matchScore is a raw keyword-overlap score (bestScore, accept threshold ≥3), not a 0-100
      // percentage — render it unitless so a strong 5-token match can't read as a weak "5%".
      render: (_value, record) => numberOrDash((record as RedirectPageRecord).matchScore),
    },
    {
      key: 'target',
      label: 'Redirect target',
      width: 'minmax(220px, 1.4fr)',
      render: (_value, record) => {
        const page = (record as RedirectPageRecord).source;
        const rule = ruleMap.get(ruleKey(page.path));
        const target = page.redirectsTo ?? rule?.to;
        if (!target) return <span className="t-caption-sm text-[var(--brand-text-muted)]">—</span>;
        return (
          <div className="min-w-0">
            <span className="block truncate t-caption text-[var(--brand-text-bright)]">{target}</span>
            {rule && <span className="block truncate t-caption-sm text-[var(--teal)]">Suggested redirect</span>}
          </div>
        );
      },
    },
  ], [ruleMap]);

  if (!data && (snapshot.isLoading || scan.isPending)) {
    return (
      <div className="flex flex-col gap-3" aria-label="Scanning redirects">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-[92px] w-full" />)}
        </div>
        <Skeleton className="h-[280px] w-full" />
      </div>
    );
  }

  if (!data && snapshot.isError) {
    return (
      <EmptyState
        icon={() => <Icon name="alert" size="2xl" />}
        title="Redirect snapshot did not load"
        description="Retry the saved snapshot or run a fresh redirect scan."
        action={<Button size="sm" variant="primary" onClick={() => scan.mutate()}>Run redirect scan</Button>}
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={() => <Icon name="link" size="2xl" />}
        title="No redirect scan yet"
        description="Scan the Webflow site for redirects, 404s, chains, and suggested repair targets."
        action={<Button size="sm" variant="primary" onClick={() => scan.mutate()}>Run redirect scan</Button>}
      />
    );
  }

  return (
    <div className="flex flex-col gap-[14px]">
      {scan.isError && (
        <InlineBanner tone="error" title="Redirect scan failed">
          <div className="flex flex-wrap items-center gap-2">
            <span>{mutationErrorMessage(scan.error, 'Redirect scan failed')}</span>
            <Button size="sm" variant="secondary" onClick={() => scan.mutate()}>
              Retry scan
            </Button>
          </div>
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-3" data-testid="redirects-metrics">
        <MetricTile label="404 URLs" value={summary?.notFound ?? notFoundPages.length} accent="var(--red)" />
        <MetricTile label="Search clicks at risk" value={atRiskClicks} accent="var(--blue)" />
        <MetricTile label="Rules ready to export" value={rules.filter((rule) => rule.accepted).length} accent="var(--emerald)" />
      </div>

      <div data-testid="redirects-how-it-works">
        <InlineBanner tone="info" title="How it works">
          <p className="t-body text-[var(--brand-text-muted)]">
            Review the suggested 301 targets, accept the good matches, then export CSV for Webflow Settings, Hosting, 301 Redirects. Update internal links so they point directly to the final destination when a chain is present.
          </p>
        </InlineBanner>
      </div>

      <RedirectRecommendations workspaceId={workspaceId} data={data} rules={rules} setRules={setRules} />

      <GroupBlock
        title="Scan evidence"
        meta={`All pages, filters, and redirect-chain detail · Last scanned ${dateTimeOrDash(scanTime)}`}
        stats={[{ label: 'Pages', value: summary?.totalPages ?? data.pageStatuses.length, color: 'var(--blue)' }]}
        collapsible
        defaultOpen={false}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2" aria-label="Redirect status filters">
            {filters.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={filter === item.id ? 'secondary' : 'ghost'}
                onClick={() => onFilterChange(item.id)}
                aria-pressed={filter === item.id}
              >
                {item.label} <span className="t-micro text-[var(--brand-text-dim)]">{item.count}</span>
              </Button>
            ))}
          </div>
          <RedirectChains chains={data.chains} />
          <DataTable
            columns={columns}
            rows={tableRows}
            getRowKey={(record) => (record as RedirectPageRecord).source.path}
            empty={(
              <EmptyState
                icon={() => <Icon name="search" size="2xl" />}
                title="No pages match this redirect view"
                description="Clear search or choose a broader status filter."
                action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
              />
            )}
          />
        </div>
      </GroupBlock>
    </div>
  );
}
