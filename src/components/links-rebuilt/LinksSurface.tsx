// @ds-rebuilt
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useWorkspaces } from '../../hooks/admin';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import {
  useAnalyzeInternalLinks,
  useInternalLinksSnapshot,
  useLinkCheckDomains,
  useLinkCheckSnapshot,
  useRedirectScan,
  useRedirectSnapshot,
  useRunLinkCheck,
  useSchemaCoverage,
  useSiteArchitecture,
} from '../../hooks/admin/useAdminLinks';
import { ErrorBoundary } from '../ErrorBoundary';
import {
  Button,
  EmptyState,
  ErrorState,
  FormSelect,
  Icon,
  InlineBanner,
  LensSwitcher,
  PageHeader,
  SearchField,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { useToast } from '../Toast';
import { ArchitectureLens } from './ArchitectureLens';
import { InternalLinksLens } from './InternalLinksLens';
import { RedirectsLens } from './RedirectsLens';
import { dateTimeOrDash } from './linksFormatters';
import { mutationErrorMessage } from './linksMutationFeedback';
import {
  LINKS_SURFACE_TABS,
  type LinksSurfaceTab,
  useLinksSurfaceState,
} from './useLinksSurfaceState';

const LazyDeadLinksLens = lazyWithRetry(() => import('./DeadLinksLens').then((module) => ({ default: module.DeadLinksLens })));

interface LinksSurfaceProps {
  workspaceId: string;
}

function SurfaceIcon({ className }: { className?: string }) {
  return <Icon name="link" className={className} />;
}

function lensCount(tab: LinksSurfaceTab, data: {
  redirectCount?: number;
  internalCount?: number;
  deadCount?: number;
  architectureCount?: number;
}): number | undefined {
  if (tab === 'redirects') return data.redirectCount;
  if (tab === 'internal') return data.internalCount;
  if (tab === 'dead-links') return data.deadCount;
  return data.architectureCount;
}

function LinkOutcomeFooter() {
  return (
    <InlineBanner tone="info" title="Link fixes become outcomes after measurement">
      <p className="t-body text-[var(--brand-text-muted)]">
        Use Links for redirects, internal links, and dead-link repair. When analytics or Search Console proves lift,
        graduate the measured win into Insights Engine instead of treating the workshop itself as the outcome.
      </p>
    </InlineBanner>
  );
}

export function LinksSurface({ workspaceId }: LinksSurfaceProps) {
  const { toast } = useToast();
  const state = useLinksSurfaceState();
  const workspaces = useWorkspaces();
  const workspace = workspaces.data?.find((item) => item.id === workspaceId);
  const siteId = workspace?.webflowSiteId;
  const [selectedDomain, setSelectedDomain] = useState('');

  const redirectSnapshot = useRedirectSnapshot(siteId, workspaceId);
  const redirectScan = useRedirectScan(siteId, workspaceId);
  const internalSnapshot = useInternalLinksSnapshot(siteId, workspaceId);
  const internalAnalyze = useAnalyzeInternalLinks(siteId, workspaceId);
  const linkDomains = useLinkCheckDomains(siteId, workspaceId);
  const linkSnapshot = useLinkCheckSnapshot(siteId, workspaceId);
  const runLinkCheck = useRunLinkCheck(siteId, workspaceId);
  const architecture = useSiteArchitecture(workspaceId);
  const schemaCoverage = useSchemaCoverage(workspaceId);

  const redirectData = redirectScan.data ?? redirectSnapshot.data?.result ?? null;
  const internalData = internalAnalyze.data ?? internalSnapshot.data ?? null;
  const deadData = runLinkCheck.data ?? linkSnapshot.data?.result ?? null;
  const architectureData = architecture.data ?? null;

  useEffect(() => {
    setSelectedDomain('');
  }, [siteId]);

  useEffect(() => {
    if (!linkDomains.data || selectedDomain) return;
    setSelectedDomain(linkDomains.data.defaultDomain || linkDomains.data.staging);
  }, [linkDomains.data, selectedDomain]);

  const lensOptions = useMemo(() => LINKS_SURFACE_TABS.map((tab) => ({
    value: tab.id,
    label: tab.label,
    count: lensCount(tab.id, {
      redirectCount: redirectData?.pageStatuses.length,
      internalCount: internalData?.suggestions.length,
      deadCount: deadData?.deadLinks.length,
      architectureCount: architectureData?.totalPages,
    }),
  })), [
    architectureData?.totalPages,
    deadData?.deadLinks.length,
    internalData?.suggestions.length,
    redirectData?.pageStatuses.length,
  ]);

  const runRedirectScan = () => {
    redirectScan.mutate(undefined, {
      onSuccess: () => toast('Redirect scan complete', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Redirect scan failed'), 'error'),
    });
  };

  const runInternalAnalyze = () => {
    internalAnalyze.mutate(undefined, {
      onSuccess: () => toast('Internal-link analysis complete', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Internal-link analysis failed'), 'error'),
    });
  };

  const runDeadLinkCheck = () => {
    runLinkCheck.mutate(selectedDomain || undefined, {
      onSuccess: () => toast('Link check complete', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Link check failed'), 'error'),
    });
  };

  const runArchitectureRefresh = () => {
    void architecture.refetch();
    void schemaCoverage.refetch();
    toast('Architecture refresh started', 'success');
  };

  const activeMeta = (() => {
    if (state.tab === 'redirects') return `Last scanned ${dateTimeOrDash(redirectSnapshot.data?.createdAt ?? redirectData?.scannedAt)}`;
    if (state.tab === 'internal') return `Last analyzed ${dateTimeOrDash(internalData?.analyzedAt)}`;
    if (state.tab === 'dead-links') return `Last checked ${dateTimeOrDash(deadData?.checkedAt)}${deadData?.crawledDomain ? ` · ${deadData.crawledDomain.replace(/^https?:\/\//i, '')}` : ''}`;
    return `Last analyzed ${dateTimeOrDash(architectureData?.analyzedAt)}`;
  })();

  const activeAction = (() => {
    if (state.tab === 'redirects') {
      return (
        <Button size="sm" variant="secondary" disabled={!siteId || redirectScan.isPending} onClick={runRedirectScan}>
          <Icon name="refresh" size="sm" />
          {redirectScan.isPending ? 'Scanning...' : 'Re-scan'}
        </Button>
      );
    }
    if (state.tab === 'internal') {
      return (
        <Button size="sm" variant="secondary" disabled={!siteId || internalAnalyze.isPending} onClick={runInternalAnalyze}>
          <Icon name="refresh" size="sm" />
          {internalAnalyze.isPending ? 'Analyzing...' : 'Re-analyze'}
        </Button>
      );
    }
    if (state.tab === 'dead-links') {
      const options = linkDomains.data
        ? [
            { value: linkDomains.data.staging, label: `${linkDomains.data.staging.replace(/^https?:\/\//i, '')} (staging)` },
            ...linkDomains.data.customDomains.map((domain) => ({ value: domain, label: `${domain.replace(/^https?:\/\//i, '')} (live)` })),
          ]
        : [];
      return (
        <>
          {options.length > 0 && (
            <FormSelect
              value={selectedDomain}
              onChange={setSelectedDomain}
              options={options}
              aria-label="Crawl domain"
              className="w-[220px]"
            />
          )}
          <Button size="sm" variant="secondary" disabled={!siteId || !selectedDomain || runLinkCheck.isPending} onClick={runDeadLinkCheck}>
            <Icon name="refresh" size="sm" />
            {runLinkCheck.isPending ? 'Checking...' : deadData ? 'Re-check' : 'Run link check'}
          </Button>
        </>
      );
    }
    return (
      <Button size="sm" variant="secondary" disabled={architecture.isFetching || schemaCoverage.isFetching} onClick={runArchitectureRefresh}>
        <Icon name="refresh" size="sm" />
        {architecture.isFetching ? 'Analyzing...' : 'Re-analyze'}
      </Button>
    );
  })();

  if (workspaces.isLoading && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Links">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (workspaces.isError && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Links" subtitle="Redirects, internal links, broken links, and architecture." />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before reviewing Links."
          action={{ label: 'Retry workspace', onClick: () => workspaces.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Links" subtitle="Redirects, internal links, broken links, and architecture." />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before reviewing Links." className="min-h-[420px]" />
      </div>
    );
  }

  if (!siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Links" subtitle="Redirects, internal links, broken links, and architecture." />
        <EmptyState
          icon={SurfaceIcon}
          title="Connect a Webflow site first"
          description="Links reads the workspace Webflow site before it can scan redirects, internal links, dead links, or architecture."
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Links"
        subtitle="Redirects, internal-link opportunities, dead-link checks, and architecture."
        className="flex-col items-start gap-3 sm:flex-row sm:items-center [&_p]:whitespace-normal [&_p]:overflow-visible"
      />

      <Toolbar label="Links view controls" className="w-full">
        <LensSwitcher
          id="links-rebuilt-tab-switcher"
          options={lensOptions}
          value={state.tab}
          onChange={(value) => state.setTab(value as LinksSurfaceTab)}
          size="sm"
          className="w-full flex-wrap sm:w-fit sm:flex-nowrap"
        />
        <SearchField
          value={state.search}
          onChange={state.setSearch}
          placeholder="Search links and pages"
          debounceMs={300}
          className="min-w-[220px] flex-1"
        />
        <ToolbarSpacer />
        <span className="t-caption text-[var(--brand-text-muted)]">{activeMeta}</span>
        {activeAction}
      </Toolbar>

      {state.tab === 'redirects' && (
        <RedirectsLens
          workspaceId={workspaceId}
          snapshot={redirectSnapshot}
          scan={redirectScan}
          filter={state.redirectFilter}
          onFilterChange={state.setRedirectFilter}
          search={state.search}
          clearSearch={state.clearSearch}
        />
      )}

      {state.tab === 'internal' && (
        <InternalLinksLens
          workspaceId={workspaceId}
          snapshot={internalSnapshot}
          analyze={internalAnalyze}
          priority={state.internalPriority}
          onPriorityChange={state.setInternalPriority}
          viewMode={state.internalView}
          onViewModeChange={state.setInternalView}
          search={state.search}
          clearSearch={state.clearSearch}
        />
      )}

      {state.tab === 'dead-links' && (
        <ErrorBoundary
          label="Dead Links"
          fallback={(
            <ErrorState
              type="data"
              title="Dead Links failed to load"
              message="Retry the dead-link lens before running a site-wide check."
            />
          )}
        >
          <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
            <LazyDeadLinksLens
              domains={linkDomains}
              snapshot={linkSnapshot}
              runCheck={runLinkCheck}
              selectedDomain={selectedDomain}
              onSelectedDomainChange={setSelectedDomain}
              listMode={state.deadList}
              onListModeChange={state.setDeadList}
              typeFilter={state.linkType}
              onTypeFilterChange={state.setLinkType}
              search={state.search}
              clearSearch={state.clearSearch}
              onTabChange={state.setTab}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {state.tab === 'architecture' && (
        <ArchitectureLens
          architecture={architecture}
          coverage={schemaCoverage}
          filter={state.architectureFilter}
          onFilterChange={state.setArchitectureFilter}
          search={state.search}
          clearSearch={state.clearSearch}
        />
      )}

      <LinkOutcomeFooter />
    </div>
  );
}
