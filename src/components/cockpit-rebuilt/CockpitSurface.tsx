// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Clock, RefreshCw, Settings } from 'lucide-react';
import type { WorkQueueItem } from '../../../shared/types/work-queue';
import { adminPath } from '../../routes';
import { useCockpitRebuilt, countWorkQueueSourceTypes, workQueueWithVisibleItems } from '../../hooks/admin/useCockpitRebuilt';
import { queryKeys } from '../../lib/queryKeys';
import { useToast } from '../Toast';
import {
  Avatar,
  Button,
  ErrorState,
  InlineBanner,
  OnboardingChecklist,
  PageContainer,
  PageHeader,
  Skeleton,
  WorkStreamSelector,
} from '../ui';
import { WeeklyAccomplishments } from '../workspace-home';
import { CockpitActivityDrawer } from './CockpitActivityDrawer';
import { CockpitEvidenceRail } from './CockpitEvidenceRail';
import { CockpitWorkOrderDrawer } from './CockpitWorkOrderDrawer';
import { CockpitWorkQueue, STREAM_META, toSelectableWorkStream } from './CockpitWorkQueue';
import { formatDate } from './cockpitFormatters';
import { mutationErrorMessage } from './cockpitMutationFeedback';
import { useCockpitSurfaceState } from './useCockpitSurfaceState';

interface CockpitSurfaceProps {
  workspaceId: string;
}

function initialsFor(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return (parts.map((part) => part[0]).join('') || 'WS').toUpperCase();
}

export function CockpitSurface({ workspaceId }: CockpitSurfaceProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useCockpitSurfaceState();
  const cockpit = useCockpitRebuilt(workspaceId);
  const [now, setNow] = useState(() => new Date());
  const [activityOpen, setActivityOpen] = useState(false);
  const [workOrdersOpen, setWorkOrdersOpen] = useState(false);
  const storageKey = `onboarding_checklist_dismissed_${workspaceId}`;
  const [checklistVisible, setChecklistVisible] = useState(() => !localStorage.getItem(storageKey));

  useEffect(() => {
    setChecklistVisible(!localStorage.getItem(storageKey));
  }, [storageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const workspaceName = cockpit.workspace?.webflowSiteName || cockpit.workspace?.name || 'Workspace';
  const workspaceInitials = initialsFor(workspaceName);
  const routes = useMemo(() => ({
    analytics: adminPath(workspaceId, 'analytics-hub'),
    contentHealth: `${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`,
    contentBriefs: `${adminPath(workspaceId, 'content-pipeline')}?tab=briefs`,
    contentPublished: `${adminPath(workspaceId, 'content-pipeline')}?tab=published`,
    keywords: adminPath(workspaceId, 'seo-keywords'),
    outcomes: adminPath(workspaceId, 'outcomes'),
    requests: `${adminPath(workspaceId, 'requests')}?tab=requests`, // inbox-legacy-filter-literal-ok -- admin Requests page deep-link, not the client inbox filter
    settings: adminPath(workspaceId, 'workspace-settings'),
    siteAudit: adminPath(workspaceId, 'seo-audit'),
    strategy: adminPath(workspaceId, 'seo-strategy'),
  }), [workspaceId]);

  const onboardingSteps = useMemo(() => {
    const workspace = cockpit.workspace;
    return [
      {
        id: 'webflow',
        label: 'Link Webflow site',
        description: 'Connect the site so the Cockpit can route technical work.',
        completed: !!workspace?.webflowSiteId,
        estimatedTime: '2 min',
        onClick: () => navigate(routes.settings),
      },
      {
        id: 'gsc',
        label: 'Connect Google Search Console',
        description: 'Bring in clicks, impressions, rankings, and content decay evidence.',
        completed: !!workspace?.gscPropertyUrl,
        estimatedTime: '3 min',
        onClick: () => navigate(routes.settings),
      },
      {
        id: 'ga4',
        label: 'Connect Google Analytics',
        description: 'Bring in users, sessions, and conversion evidence.',
        completed: !!workspace?.ga4PropertyId,
        estimatedTime: '3 min',
        onClick: () => navigate(routes.settings),
      },
      {
        id: 'audit',
        label: 'Run your first SEO audit',
        description: 'Create the technical health baseline for the Cockpit.',
        completed: !!(cockpit.auditQuery.audit && cockpit.auditQuery.audit.siteScore > 0),
        estimatedTime: '1 min',
        onClick: () => navigate(routes.siteAudit),
      },
    ];
  }, [cockpit.auditQuery.audit, cockpit.workspace, navigate, routes.settings, routes.siteAudit]);

  const checklistIsActive = checklistVisible && onboardingSteps.some((step) => !step.completed);
  const workQueue = workQueueWithVisibleItems(cockpit.workQueue, checklistIsActive);
  const sourceTypeCounts = countWorkQueueSourceTypes(workQueue.items);
  const lastFetched = cockpit.lastFetched;
  const isStale = lastFetched ? now.getTime() - lastFetched.getTime() > 60 * 60 * 1000 : false;

  const openRoute = (route: string) => navigate(route);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });
    toast('Cockpit refresh started', 'success');
    void cockpit.homeQuery.refetch().then((result) => {
      if (result.error) {
        toast(mutationErrorMessage(result.error, 'Cockpit refresh failed'), 'error');
      }
    });
  };

  const handleOpenQueueItem = (item: WorkQueueItem) => {
    switch (item.sourceType) {
      case 'request':
      case 'churn_signal':
        navigate(routes.requests);
        return;
      case 'work_order':
        setWorkOrdersOpen(true);
        return;
      case 'content_decay':
        navigate(routes.contentHealth);
        return;
      case 'content_request':
        navigate(routes.contentBriefs);
        return;
      case 'content_pipeline':
        navigate(routes.contentBriefs);
        return;
      case 'rank_drop':
        navigate(routes.keywords);
        return;
      case 'audit_error':
        navigate(routes.siteAudit);
        return;
      case 'setup_gap':
        navigate(routes.settings);
        return;
    }
  };

  if ((cockpit.homeQuery.isLoading || cockpit.workspaceQuery.isLoading) && !cockpit.homeData) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <div data-testid="cockpit-rebuilt-loading" className="flex flex-col gap-5">
          <Skeleton className="h-[68px] w-full" />
          <Skeleton className="h-[128px] w-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            <Skeleton className="h-[126px] w-full" />
            <Skeleton className="h-[126px] w-full" />
            <Skeleton className="h-[126px] w-full" />
          </div>
          <Skeleton className="h-[360px] w-full" />
        </div>
      </PageContainer>
    );
  }

  if ((cockpit.homeQuery.isError || cockpit.workspaceQuery.isError) && !cockpit.homeData) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <PageHeader title="Cockpit" subtitle="Single-client operator command center." />
        <ErrorState
          type="data"
          title="Cockpit data did not load"
          message="Retry the workspace home read before reviewing operator work."
          action={{ label: 'Retry', onClick: handleRefresh }}
          className="min-h-[420px]"
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="cockpit-rebuilt-surface" className="flex flex-col gap-[var(--section-gap)]">
      {checklistVisible && (
        <OnboardingChecklist
          title="Complete Cockpit setup"
          steps={onboardingSteps}
          onDismiss={() => {
            localStorage.setItem(storageKey, '1');
            setChecklistVisible(false);
          }}
          onComplete={() => {
            localStorage.setItem(storageKey, '1');
          }}
        />
      )}

      {/* co-eye — client context / freshness line */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-2 t-caption-sm sm:items-center">
          <Avatar initials={workspaceInitials} label={workspaceName} size="sm" tone="teal" />
          <div className="min-w-0">
            <div className="truncate font-[family-name:var(--font-mono)] font-semibold tracking-[0.08em] text-[var(--teal)] sm:tracking-[0.14em]">
              Client cockpit · {workspaceName}
            </div>
            <div className="text-[var(--brand-text-dim)]">Today, scoped to one</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {/* muted-tier-ok: freshness/date is tertiary metadata (matches prototype's dim eyebrow date) */}
          <span
            className={`t-caption-sm ${isStale ? 'text-[var(--amber)]' : 'text-[var(--brand-text-dim)]'}`}
            title={lastFetched ? `Data loaded at ${formatDate(lastFetched)}` : undefined}
          >
            {lastFetched ? `${isStale ? 'Stale · ' : ''}Data as of ${formatDate(lastFetched)}` : 'Data freshness unavailable'}
          </span>
          <Button variant="ghost" size="sm" icon={Clock} onClick={() => setActivityOpen(true)} aria-label="Open activity log" />
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={handleRefresh} loading={cockpit.homeQuery.isFetching} aria-label="Refresh Cockpit data" />
          <Button variant="secondary" size="sm" icon={Settings} onClick={() => navigate(routes.settings)}>
            Settings
          </Button>
        </div>
      </div>

      {/* co-head — verdict hero card */}
      <div
        // pr-check-disable-next-line -- brand signature radius on the verdict hero container (owner-ratified global asymmetric-on-containers, ui-parity)
        className="rounded-[var(--radius-signature-lg)] border border-[var(--brand-border)] px-6 py-[22px]"
        style={{ background: 'linear-gradient(135deg, var(--surface-2), color-mix(in srgb, var(--teal) 5%, var(--surface-2)))' }}
      >
        <h1 className="t-h2 max-w-[44ch] font-bold text-[var(--brand-text-bright)]">
          {cockpit.verdict?.headline ?? 'Cockpit verdict unavailable'}
        </h1>
        <p className="t-body mt-2 max-w-[72ch] text-[var(--brand-text)]">
          {cockpit.verdict?.narrative ?? 'The server has not returned a Cockpit verdict for this workspace yet.'}
        </p>
      </div>

      {/* co-streams — full-width work-stream selector, sibling of the grid below */}
      <WorkStreamSelector
        ariaLabel="Cockpit work streams"
        value={toSelectableWorkStream(state.stream)}
        onChange={state.setStream}
        options={[
          { id: 'opt', label: STREAM_META.opt.label, unit: STREAM_META.opt.unit, description: STREAM_META.opt.description, count: workQueue.streams.opt, iconName: 'gauge' },
          { id: 'send', label: STREAM_META.send.label, unit: STREAM_META.send.unit, description: STREAM_META.send.description, count: workQueue.streams.send, iconName: 'zap' },
          { id: 'money', label: STREAM_META.money.label, unit: STREAM_META.money.unit, description: STREAM_META.money.description, count: workQueue.streams.money, iconName: 'trophy' },
        ]}
      />

      {state.retiredTab === 'meeting-brief' && (
        <InlineBanner
          tone="info"
          title="Meeting Brief is retired"
          message="This deep link now falls back to Cockpit; no standalone brief route is resurrected."
          data-testid="cockpit-retired-tab-fallback"
        />
      )}

      {state.invalidTab && (
        <InlineBanner
          tone="warning"
          title="Unknown Cockpit tab"
          message="The requested tab is not active, so Cockpit opened the default view."
          data-testid="cockpit-invalid-tab-fallback"
        />
      )}

      {cockpit.homeQuery.isError && cockpit.homeData && (
        <InlineBanner
          tone="warning"
          title="Summary may be stale"
          message="The latest refresh failed, so the last loaded Cockpit numbers are still shown."
        >
          <Button variant="link" size="sm" onClick={handleRefresh}>Retry</Button>
        </InlineBanner>
      )}

      {isStale && (
        <InlineBanner
          tone="warning"
          title="Data is stale"
          message="Refresh the aggregate workspace read before making send or close-out decisions."
        />
      )}

      {cockpit.homeData?.weeklySummary && <WeeklyAccomplishments summary={cockpit.homeData.weeklySummary} />}

      {/* co-grid — main work queue + right rail */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,1fr)]">
        <div className="min-w-0">
          <CockpitWorkQueue
            workQueue={workQueue}
            stream={state.stream}
            onStreamChange={state.setStream}
            activeSourceTypes={state.activeSourceTypes}
            sourceTypeCounts={sourceTypeCounts}
            onToggleSourceType={state.toggleSourceType}
            onClearSourceTypes={state.clearSourceTypes}
            clientName={workspaceName}
            clientInitials={workspaceInitials}
            onOpenItem={handleOpenQueueItem}
          />
        </div>

        <div className="flex flex-col gap-4">
          <CockpitEvidenceRail
            workspaceName={workspaceName}
            workspaceInitials={workspaceInitials}
            workQueue={workQueue}
            requests={cockpit.requests}
            ranks={cockpit.ranks}
            kpis={cockpit.kpis}
            onOpenRoute={openRoute}
            route={routes}
          />
        </div>
      </div>

      <CockpitActivityDrawer
        open={activityOpen}
        onClose={() => setActivityOpen(false)}
        activity={cockpit.activity}
      />
      <CockpitWorkOrderDrawer
        open={workOrdersOpen}
        workspaceId={workspaceId}
        onClose={() => setWorkOrdersOpen(false)}
      />
      </div>
    </PageContainer>
  );
}

export default CockpitSurface;
