// @ds-rebuilt
import { useCallback, useMemo, useState } from 'react';
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query';
import type { DeadLink, LinkCheckResult, LinkCheckSnapshot, SiteDomainInfo } from '../../hooks/admin/useAdminLinks';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import {
  Badge,
  Button,
  DataTable,
  Drawer,
  EmptyState,
  FormSelect,
  Icon,
  InlineBanner,
  MetricTile,
  Segmented,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
  type DataColumn,
} from '../ui';
import type { DeadLinksListMode, LinkTypeFilter, LinksSurfaceTab } from './useLinksSurfaceState';
import { cleanUrlLabel, dateTimeOrDash, downloadCsv, truncateMiddle } from './linksFormatters';
import { mutationErrorMessage } from './linksMutationFeedback';
import { useToast } from '../Toast';

interface DeadLinksLensProps {
  domains: UseQueryResult<SiteDomainInfo, Error>;
  snapshot: UseQueryResult<LinkCheckSnapshot | null, Error>;
  runCheck: UseMutationResult<LinkCheckResult, Error, string | undefined, unknown>;
  selectedDomain: string;
  onSelectedDomainChange: (domain: string) => void;
  listMode: DeadLinksListMode;
  onListModeChange: (mode: DeadLinksListMode) => void;
  typeFilter: LinkTypeFilter;
  onTypeFilterChange: (filter: LinkTypeFilter) => void;
  search: string;
  clearSearch: () => void;
  onTabChange: (tab: LinksSurfaceTab) => void;
}

type DeadLinkRecord = Record<string, unknown> & {
  source: DeadLink;
  url: string;
  status: string | number;
  type: string;
  foundOn: string;
  anchorText: string;
};

function linkKey(link: DeadLink): string {
  return `${link.url}:${link.foundOnSlug}:${link.anchorText}`;
}

function statusTone(status: DeadLink['status']): 'red' | 'amber' | 'zinc' {
  if (status === 'timeout' || status === 'error') return 'red';
  if (status >= 300 && status < 400) return 'amber';
  return 'red';
}

function filterLinks(links: DeadLink[], typeFilter: LinkTypeFilter, search: string): DeadLink[] {
  const q = search.trim().toLowerCase();
  return links.filter((link) => {
    const matchesType = typeFilter === 'all' || link.type === typeFilter;
    const matchesSearch = !q
      || link.url.toLowerCase().includes(q)
      || link.foundOn.toLowerCase().includes(q)
      || link.foundOnSlug.toLowerCase().includes(q)
      || link.anchorText.toLowerCase().includes(q);
    return matchesType && matchesSearch;
  });
}

function toRecord(link: DeadLink): DeadLinkRecord {
  return {
    source: link,
    url: link.url,
    status: link.status,
    type: link.type,
    foundOn: link.foundOn,
    anchorText: link.anchorText,
  };
}

function domainOptions(domains: SiteDomainInfo | undefined) {
  if (!domains) return [];
  return [
    { value: domains.staging, label: `${cleanUrlLabel(domains.staging)} (staging)` },
    ...domains.customDomains.map((domain) => ({ value: domain, label: `${cleanUrlLabel(domain)} (live)` })),
  ];
}

function DeadLinkDrawer({
  link,
  reviewed,
  onClose,
  onToggleReviewed,
  onRecheck,
  onOpenRedirects,
}: {
  link: DeadLink | null;
  reviewed: boolean;
  onClose: () => void;
  onToggleReviewed: (link: DeadLink) => void;
  onRecheck: () => void;
  onOpenRedirects: () => void;
}) {
  const { toast } = useToast();
  const copyUrl = () => {
    if (!link) return;
    void navigator.clipboard.writeText(link.url);
    toast('Link URL copied', 'success');
  };

  return (
    <Drawer
      open={link != null}
      onClose={onClose}
      title={link ? truncateMiddle(link.url, 72) : 'Link detail'}
      subtitle={link ? `Found on ${link.foundOn}` : undefined}
      eyebrow="Dead-link detail"
      width={560}
      footer={link && (
        <Toolbar label="Dead-link detail actions" className="w-full">
          <Button size="sm" variant={reviewed ? 'secondary' : 'primary'} onClick={() => onToggleReviewed(link)}>
            <Icon name="check" size="sm" />
            {reviewed ? 'Reviewed' : 'Mark reviewed'}
          </Button>
          <Button size="sm" variant="secondary" onClick={copyUrl}>
            <Icon name="copy" size="sm" />
            Copy URL
          </Button>
          <Button size="sm" variant="ghost" onClick={onOpenRedirects}>
            <Icon name="arrowRight" size="sm" />
            Review redirects
          </Button>
          <ToolbarSpacer />
          <Button size="sm" variant="ghost" onClick={onRecheck}>
            <Icon name="refresh" size="sm" />
            Re-check site
          </Button>
        </Toolbar>
      )}
    >
      {!link ? (
        <InlineBanner tone="info" title="Link detail unavailable">Pick another row to inspect it.</InlineBanner>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <MetricTile label="Status" value={String(link.status)} accent={`var(--${statusTone(link.status)})`} />
            <MetricTile label="Type" value={link.type} accent={link.type === 'internal' ? 'var(--blue)' : 'var(--brand-text-bright)'} />
            <MetricTile label="Reviewed" value={reviewed ? 'Yes' : 'No'} accent={reviewed ? 'var(--emerald)' : 'var(--brand-text-dim)'} />
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <p className="t-label text-[var(--brand-text-muted)]">URL</p>
            <p className="mt-1 break-all t-caption text-[var(--brand-text-bright)]">{link.url}</p>
            <p className="mt-2 t-caption-sm text-[var(--brand-text-muted)]">{link.statusText}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
            <p className="t-label text-[var(--brand-text-muted)]">Found on</p>
            <p className="mt-1 t-caption font-semibold text-[var(--brand-text-bright)]">{link.foundOn}</p>
            <p className="mt-1 break-all t-caption-sm text-[var(--brand-text-muted)]">/{link.foundOnSlug}</p>
            {link.anchorText && <p className="mt-2 t-caption-sm text-[var(--teal)]">"{link.anchorText}"</p>}
          </div>
          <InlineBanner tone="info" title="Redirect action">
            Direct Webflow redirect creation is deferred. Use Redirects to review suggested rules, or export this link-check CSV for manual repair.
          </InlineBanner>
        </div>
      )}
    </Drawer>
  );
}

export function DeadLinksLens({
  domains,
  snapshot,
  runCheck,
  selectedDomain,
  onSelectedDomainChange,
  listMode,
  onListModeChange,
  typeFilter,
  onTypeFilterChange,
  search,
  clearSearch,
  onTabChange,
}: DeadLinksLensProps) {
  const { toast } = useToast();
  const data = runCheck.data ?? snapshot.data?.result ?? null;
  const [reviewedKeys, toggleReviewed] = useToggleSet<string>([], UNBOUNDED_TOGGLE_SET_OPTIONS);
  const [selectedLink, setSelectedLink] = useState<DeadLink | null>(null);
  const currentList = listMode === 'dead' ? data?.deadLinks ?? [] : data?.redirects ?? [];
  const filtered = useMemo(() => filterLinks(currentList, typeFilter, search), [currentList, typeFilter, search]);
  const rows = useMemo(() => filtered.map(toRecord), [filtered]);
  const availableDomains = domainOptions(domains.data);

  const markReviewed = useCallback((link: DeadLink) => {
    toggleReviewed(linkKey(link));
  }, [toggleReviewed]);

  const exportCsv = () => {
    if (!data) return;
    downloadCsv(`link-check-${new Date().toISOString().slice(0, 10)}.csv`, [
      ['Type', 'URL', 'Status', 'Status Text', 'Found On', 'Found On Slug', 'Anchor Text', 'Link Type'],
      ...data.deadLinks.map((link) => ['Dead', link.url, String(link.status), link.statusText, link.foundOn, link.foundOnSlug, link.anchorText, link.type]),
      ...data.redirects.map((link) => ['Redirect', link.url, String(link.status), link.statusText, link.foundOn, link.foundOnSlug, link.anchorText, link.type]),
    ]);
    toast('Link-check CSV exported', 'success');
  };

  const recheck = () => {
    runCheck.mutate(selectedDomain || undefined, {
      onSuccess: () => toast('Link check complete', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Link check failed'), 'error'),
    });
  };

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'status',
      label: 'Status',
      width: '86px',
      sortable: true,
      render: (_value, record) => {
        const link = (record as DeadLinkRecord).source;
        return <Badge label={String(link.status)} tone={statusTone(link.status)} variant="soft" className="font-mono" />;
      },
    },
    {
      key: 'url',
      label: 'URL',
      width: 'minmax(260px, 1.6fr)',
      sortable: true,
      render: (_value, record) => {
        const link = (record as DeadLinkRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{link.url}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{link.statusText}</span>
          </div>
        );
      },
    },
    {
      key: 'foundOn',
      label: 'Found on',
      width: 'minmax(220px, 1.2fr)',
      sortable: true,
      render: (_value, record) => {
        const link = (record as DeadLinkRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate text-[var(--brand-text-bright)]">{link.foundOn}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">/{link.foundOnSlug}</span>
          </div>
        );
      },
    },
    {
      key: 'anchorText',
      label: 'Anchor',
      width: 'minmax(150px, 0.9fr)',
      sortable: true,
      render: (_value, record) => {
        const anchor = (record as DeadLinkRecord).source.anchorText;
        return anchor ? <span className="truncate text-[var(--teal)]">"{anchor}"</span> : <span className="text-[var(--brand-text-muted)]">—</span>;
      },
    },
    {
      key: 'type',
      label: 'Type',
      width: '96px',
      sortable: true,
      render: (_value, record) => {
        const link = (record as DeadLinkRecord).source;
        return <Badge label={link.type} tone={link.type === 'internal' ? 'blue' : 'zinc'} variant="outline" />;
      },
    },
    {
      key: 'reviewed',
      label: 'Reviewed',
      width: '108px',
      render: (_value, record) => {
        const link = (record as DeadLinkRecord).source;
        const reviewed = reviewedKeys.has(linkKey(link));
        return (
          <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <Button
              size="sm"
              variant={reviewed ? 'secondary' : 'ghost'}
              aria-pressed={reviewed}
              onClick={() => markReviewed(link)}
            >
              {reviewed ? 'Reviewed' : 'Review'}
            </Button>
          </div>
        );
      },
    },
  ], [markReviewed, reviewedKeys]);

  if (!data && (snapshot.isLoading || runCheck.isPending)) {
    return (
      <div className="flex flex-col gap-3" aria-label="Checking links">
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
        title="Link-check snapshot did not load"
        description="Retry the saved snapshot or run a fresh domain-aware link check."
        action={<Button size="sm" variant="primary" onClick={recheck}>Run link check</Button>}
      />
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={() => <Icon name="link" size="2xl" />}
          title="No dead-link check yet"
          description="Choose the crawl domain, then scan all extracted links for dead URLs and redirects."
          action={<Button size="sm" variant="primary" disabled={!selectedDomain} onClick={recheck}>Run link check</Button>}
        />
        {availableDomains.length > 0 && (
          <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <span className="t-caption text-[var(--brand-text-muted)]">Crawl domain</span>
            <FormSelect
              value={selectedDomain}
              onChange={onSelectedDomainChange}
              options={availableDomains}
              aria-label="Crawl domain"
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {runCheck.isError && (
        <InlineBanner tone="error" title="Link check failed">
          <div className="flex flex-wrap items-center gap-2">
            <span>{mutationErrorMessage(runCheck.error, 'Link check failed')}</span>
            <Button size="sm" variant="secondary" onClick={recheck}>Retry check</Button>
          </div>
        </InlineBanner>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Total links" value={data.totalLinks} accent="var(--blue)" />
        <MetricTile label="Healthy" value={data.healthy} accent="var(--emerald)" />
        <MetricTile label="Dead links" value={data.deadLinks.length} accent="var(--red)" />
        <MetricTile label="Redirects" value={data.redirects.length} accent="var(--amber)" sub={`Checked ${dateTimeOrDash(data.checkedAt)}`} />
      </div>

      {data.deadLinks.length === 0 && data.redirects.length === 0 && (
        <InlineBanner tone="success" title="All checked links are healthy">
          No dead links or redirecting links were found for {cleanUrlLabel(data.crawledDomain ?? selectedDomain)}.
        </InlineBanner>
      )}

      <Toolbar label="Dead-link table controls" className="w-full">
        <Segmented
          value={listMode}
          onChange={(value) => onListModeChange(value as DeadLinksListMode)}
          options={[
            { value: 'dead', label: `Dead (${data.deadLinks.length})` },
            { value: 'redirects', label: `Redirects (${data.redirects.length})` },
          ]}
        />
        <div className="flex flex-wrap gap-2" aria-label="Link type filters">
          {(['all', 'internal', 'external'] as const).map((item) => (
            <Button
              key={item}
              size="sm"
              variant={typeFilter === item ? 'secondary' : 'ghost'}
              onClick={() => onTypeFilterChange(item)}
              aria-pressed={typeFilter === item}
            >
              {item}
            </Button>
          ))}
        </div>
        <ToolbarSpacer />
        <Button size="sm" variant="secondary" onClick={exportCsv}>
          <Icon name="download" size="sm" />
          Export CSV
        </Button>
      </Toolbar>

      <p className="t-caption text-[var(--brand-text-muted)]">
        Crawled domain: {cleanUrlLabel(data.crawledDomain ?? selectedDomain)} · Last checked {dateTimeOrDash(data.checkedAt)}
      </p>

      <DataTable
        columns={columns}
        rows={rows}
        getRowKey={(record) => linkKey((record as DeadLinkRecord).source)}
        onRowClick={(record) => setSelectedLink((record as DeadLinkRecord).source)}
        empty={(
          <EmptyState
            icon={() => <Icon name="search" size="2xl" />}
            title={listMode === 'dead' ? 'No dead links match this view' : 'No redirects match this view'}
            description="Clear search or choose a broader link type filter."
            action={<Button size="sm" variant="secondary" onClick={clearSearch}>Clear search</Button>}
          />
        )}
      />

      <DeadLinkDrawer
        link={selectedLink}
        reviewed={selectedLink ? reviewedKeys.has(linkKey(selectedLink)) : false}
        onClose={() => setSelectedLink(null)}
        onToggleReviewed={markReviewed}
        onRecheck={recheck}
        onOpenRedirects={() => {
          setSelectedLink(null);
          onTabChange('redirects');
        }}
      />
    </div>
  );
}
