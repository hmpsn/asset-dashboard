import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Shield, Search, BarChart3, TrendingUp, TrendingDown,
  Bell, FileText, AlertTriangle,
  Globe, Clipboard, Flag, Clock, RefreshCw, Layers, DollarSign, Target,
} from 'lucide-react';
import {
  StatCard, SectionCard, PageHeader, MetricRing, TabBar, OnboardingChecklist,
  Icon, Button, cn, LoadingState, ErrorState,
  NeedsAttention, type AttentionItem,
} from './ui';
import { FeatureFlag } from './ui/FeatureFlag';
import { themeColor, CHART_SERIES_COLORS, scoreColor, scoreColorClass } from './ui/constants';
import { BriefingReviewQueue } from './admin/BriefingReviewQueue';
import { WorkOrderPanel } from './admin/WorkOrderPanel';
import { AdminRecommendationQueue } from './admin/AdminRecommendationQueue';
import { ErrorBoundary } from './ErrorBoundary';
import { usePageEditStates } from '../hooks/usePageEditStates';
import { useAuditSummary } from '../hooks/useAuditSummary';
import { AnomalyAlerts } from './AnomalyAlerts';
import { SeoWorkStatus, ActivityFeed, RankingsSnapshot, ActiveRequestsAnnotations, SeoChangeImpact, WeeklyAccomplishments } from './workspace-home';
import { type Page, adminPath, clientPath } from '../routes';
import { useWorkspaceHomeData, useAdminROI, useWorkspaceIntelligence } from '../hooks/admin';
import { queryKeys } from '../lib/queryKeys';
import { timeAgo } from '../lib/timeAgo';

interface WorkspaceHomeProps {
  workspaceId: string;
  workspaceName: string;
  webflowSiteId?: string;
  webflowSiteName?: string;
  gscPropertyUrl?: string;
  ga4PropertyId?: string;
}

interface ActivityEntry {
  id: string;
  type: string;
  title: string;
  description?: string;
  createdAt: string;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// Tabs for the lower operational sections (below the metric grid)
const SECTION_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'pipeline', label: 'Pipeline' },
  { id: 'activity', label: 'Activity' },
];

type SectionTab = 'overview' | 'pipeline' | 'activity';

export function WorkspaceHome({ workspaceId, workspaceName, webflowSiteId, webflowSiteName, gscPropertyUrl, ga4PropertyId }: WorkspaceHomeProps) {
  const navigate = useNavigate();
  // The standalone Rank Tracker folded into the Keyword Hub; rank-related
  // drill-ins route to seo-keywords.
  const ranksTab: Page = 'seo-keywords';
  const queryClient = useQueryClient();
  const { summary: seoStatus } = usePageEditStates(workspaceId);
  const { audit } = useAuditSummary(workspaceId);
  const {
    data: homeData,
    isLoading: loading,
    isFetching: refreshing,
    isError: homeDataError,
    error: homeDataErrorDetail,
    refetch: refetchHomeData,
    dataUpdatedAt,
  } = useWorkspaceHomeData(workspaceId);
  const { data: roiData } = useAdminROI(workspaceId);
  const { data: intel } = useWorkspaceIntelligence(workspaceId, ['siteHealth', 'contentPipeline', 'clientSignals']);
  const [now, setNow] = useState(() => new Date());
  const [workOrderPanelOpen, setWorkOrderPanelOpen] = useState(false);
  const [activeSectionTab, setActiveSectionTab] = useState<SectionTab>('overview');

  const storageKey = `onboarding_checklist_dismissed_${workspaceId}`;
  // Must be before any conditional early return (Rules of Hooks).
  // Initialized from localStorage only — no async deps. OnboardingChecklist's
  // own allComplete branch handles the "all steps done" celebration + auto-dismiss.
  const [checklistVisible, setChecklistVisible] = useState(
    () => !localStorage.getItem(storageKey)
  );
  // Sync visibility when workspaceId changes without remount (React Router reuses
  // the same component instance across workspace switches). The !loading render
  // guard prevents any flash — the component is in a loading state at switch time.
  useEffect(() => {
    setChecklistVisible(!localStorage.getItem(storageKey));
  }, [storageKey]);

  // Tick every 30s so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Derive data from query result
  const d = homeData;
  const searchData = d?.searchData ?? null;
  const ga4Data = d?.ga4Data ?? null;
  const comparison = d?.comparison ?? null;
  const ranks = (Array.isArray(d?.ranks) ? d.ranks.slice(0, 10) : []) as Array<{ query: string; position: number; previousPosition?: number; change?: number }>;
  const requests = (Array.isArray(d?.requests) ? d.requests : []) as Array<{ id: string; title: string; status: string; category: string; createdAt: string }>;
  const contentRequests = (Array.isArray(d?.contentRequests) ? d.contentRequests : []) as Array<{ id: string; title?: string; status: string; category?: string }>;
  const activity = (Array.isArray(d?.activity) ? d.activity : []) as ActivityEntry[];
  const annotations = (Array.isArray(d?.annotations) ? d.annotations.slice(0, 5) : []) as Array<{ id: string; date: string; label: string; color?: string }>;
  const churnSignals = (Array.isArray(d?.churnSignals) ? (d.churnSignals as Array<{ id: string; type: string; severity: string; title: string; description: string; detectedAt: string }>).filter(s => s.severity === 'critical' || s.severity === 'warning') : []);
  const workOrders = (Array.isArray(d?.workOrders) ? d.workOrders : []) as Array<{ id: string; status: string; productType: string }>;
  const contentPipeline = d?.contentPipeline ?? null;
  const contentVelocity = d?.contentVelocity ?? null;
  const contentDecayData = d?.contentDecay ?? null;
  const weeklySummary = d?.weeklySummary ?? null;
  const lastFetched = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  if (loading) {
    return <LoadingState message="Loading workspace summary, alerts, and activity..." size="lg" className="py-24" />;
  }

  if (homeDataError) {
    const detail = homeDataErrorDetail instanceof Error ? homeDataErrorDetail.message : 'Unknown error';
    return (
      <ErrorState
        title="Couldn't load workspace home"
        message={`We couldn't load dashboard data for this workspace. ${detail}`}
        actions={[
          { label: 'Retry', onClick: refetchHomeData },
          { label: 'Refresh page', onClick: () => window.location.reload(), variant: 'secondary' },
        ]}
        type="data"
      />
    );
  }

  // Derived data
  const scoreDelta = audit && audit.previousScore != null ? audit.siteScore - audit.previousScore : null;
  const newRequests = requests.filter(r => r.status === 'new' || r.status === 'open');
  const activeRequests = requests.filter(r => r.status !== 'closed' && r.status !== 'resolved');
  const pendingContent = contentRequests.filter(r => r.status === 'requested');
  const rankUp = ranks.filter(r => r.change && r.change > 0).length;
  const rankDown = ranks.filter(r => r.change && r.change < 0).length;

  const usersDelta = comparison?.users
    ? Math.round(((comparison.users.current - comparison.users.previous) / (comparison.users.previous || 1)) * 100)
    : null;

  // T2.1 — "checklist active" = shown and not all steps complete.
  // When the checklist is visible, setup tasks (priority 3) are OWNED by the
  // OnboardingChecklist and must NOT appear in NeedsAttention or HealthBar.
  // Once dismissed (or if the user has never triggered it because all are done),
  // operational follow-ups can surface everywhere.
  const checklistIsActive = checklistVisible;

  // Operational action items — priority: 1=critical, 2=important.
  // Setup tasks (connect Webflow / GSC / GA4) are EXCLUDED here when the
  // checklist is still active — they live in OnboardingChecklist instead.
  const attentionItems: AttentionItem[] = [];

  if (newRequests.length > 0) attentionItems.push({
    id: 'new-requests',
    label: `${newRequests.length} new client request${newRequests.length > 1 ? 's' : ''}`,
    sub: 'Review and respond',
    severity: 'critical',
    icon: Bell,
    // ?tab=requests deep-links the admin Requests sub-tab (two-halves contract —
    // App.tsx requestsSubTab receiver fires on the tab query). Must be preserved.
    href: `${adminPath(workspaceId, 'requests')}?tab=requests`, // inbox-legacy-filter-literal-ok -- admin Requests page deep-link, not the client inbox filter
  });

  // Open orders = any non-terminal order (NOT closed/cancelled).
  const openOrders = workOrders.filter(o => o.status === 'pending' || o.status === 'in_progress' || o.status === 'completed');
  if (openOrders.length > 0) {
    const readyToClose = openOrders.filter(o => o.status === 'completed').length;
    const awaiting = openOrders.length - readyToClose;
    const label = awaiting > 0
      ? `${awaiting} purchased fix${awaiting > 1 ? 'es' : ''} awaiting fulfillment`
      : `${readyToClose} completed order${readyToClose > 1 ? 's' : ''} ready to close out`;
    const sub = awaiting > 0 && readyToClose > 0
      ? `${readyToClose} completed and ready to close out — open the conversation/close panel`
      : 'Open the conversation/close panel to fulfill, reply, and close out';
    attentionItems.push({
      id: 'open-orders',
      label,
      sub,
      severity: 'info',
      icon: Clipboard,
      onClick: () => setWorkOrderPanelOpen(true),
    });
  }

  for (const signal of churnSignals) {
    attentionItems.push({
      id: `churn-${signal.id}`,
      label: signal.title,
      sub: signal.description,
      severity: signal.severity === 'critical' ? 'critical' : 'warning',
      icon: Flag,
    });
  }

  if (contentDecayData && (contentDecayData.critical > 0 || contentDecayData.warning > 0)) {
    const total = contentDecayData.critical + contentDecayData.warning;
    attentionItems.push({
      id: 'content-decay',
      label: `${total} page${total > 1 ? 's' : ''} losing search traffic`,
      sub: contentDecayData.critical > 0
        ? `${contentDecayData.critical} critical · ${contentDecayData.warning} at risk — refresh content`
        : `${contentDecayData.warning} pages declining in clicks`,
      severity: contentDecayData.critical > 0 ? 'critical' : 'warning',
      icon: TrendingDown,
      href: `${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`,
    });
  }

  if (pendingContent.length > 0) attentionItems.push({
    id: 'pending-content',
    label: `${pendingContent.length} content brief${pendingContent.length > 1 ? 's' : ''} awaiting review`,
    sub: 'Approve or edit briefs',
    severity: 'warning',
    icon: FileText,
    href: adminPath(workspaceId, 'content-pipeline'),
  });

  if (audit && audit.errors > 0) attentionItems.push({
    id: 'seo-errors',
    label: `${audit.errors} SEO error${audit.errors > 1 ? 's' : ''} found in audit`,
    sub: `${audit.warnings} warnings · Score ${audit.siteScore}`,
    severity: audit.errors > 5 ? 'critical' : 'warning',
    icon: AlertTriangle,
    href: adminPath(workspaceId, 'seo-audit'),
  });

  if (rankDown > 3) attentionItems.push({
    id: 'rank-drops',
    label: `${rankDown} keywords dropped in position`,
    sub: `${rankUp} improved`,
    severity: 'warning',
    icon: TrendingDown,
    href: adminPath(workspaceId, ranksTab),
  });

  if (contentPipeline && contentPipeline.reviewCells > 0) attentionItems.push({
    id: 'pipeline-review',
    label: `${contentPipeline.reviewCells} content plan page${contentPipeline.reviewCells > 1 ? 's' : ''} need${contentPipeline.reviewCells === 1 ? 's' : ''} review`,
    sub: 'Client flagged or awaiting approval',
    severity: 'info',
    icon: Layers,
    href: adminPath(workspaceId, 'content-pipeline'),
  });

  // T2.1 — setup items appear ONLY when checklist is not active
  if (!checklistIsActive) {
    if (!webflowSiteId) attentionItems.push({
      id: 'setup-webflow',
      label: 'No Webflow site linked',
      sub: 'Link a site to enable SEO tools',
      severity: 'warning',
      icon: Globe,
      href: adminPath(workspaceId, 'workspace-settings'),
    });
    if (!gscPropertyUrl) attentionItems.push({
      id: 'setup-gsc',
      label: 'Google Search Console not connected',
      sub: 'Connect GSC for search data',
      severity: 'warning',
      icon: Search,
      href: adminPath(workspaceId, 'workspace-settings'),
    });
    if (!ga4PropertyId) attentionItems.push({
      id: 'setup-ga4',
      label: 'Google Analytics not connected',
      sub: 'Connect GA4 for traffic data',
      severity: 'warning',
      icon: BarChart3,
      href: adminPath(workspaceId, 'workspace-settings'),
    });
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  attentionItems.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Data freshness
  const ageMs = lastFetched ? now.getTime() - lastFetched.getTime() : 0;
  const isStale = ageMs > 60 * 60 * 1000; // >1 hour
  const freshnessLabel = lastFetched ? timeAgo(lastFetched.toISOString(), { capitalizeJustNow: true }) : '';

  const handleRefresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceHome(workspaceId) });

  const onboardingSteps = [
    {
      id: 'webflow',
      label: 'Link Webflow site',
      description: 'Connect your Webflow site to enable SEO tools and page analysis.',
      completed: !!webflowSiteId,
      estimatedTime: '2 min',
      onClick: () => navigate(adminPath(workspaceId, 'workspace-settings')),
    },
    {
      id: 'gsc',
      label: 'Connect Google Search Console',
      description: 'Get search performance data — clicks, impressions, and rankings.',
      completed: !!gscPropertyUrl,
      estimatedTime: '3 min',
      onClick: () => navigate(adminPath(workspaceId, 'workspace-settings')),
    },
    {
      id: 'ga4',
      label: 'Connect Google Analytics',
      description: 'Track users, sessions, and conversions from organic traffic.',
      completed: !!ga4PropertyId,
      estimatedTime: '3 min',
      onClick: () => navigate(adminPath(workspaceId, 'workspace-settings')),
    },
    {
      id: 'audit',
      label: 'Run your first SEO audit',
      description: 'Get a full health score for your site — issues, warnings, and fixes.',
      completed: !!(audit && audit.siteScore > 0),
      estimatedTime: '1 min',
      onClick: () => navigate(adminPath(workspaceId, 'seo-audit')),
    },
  ];

  return (
    <div className="space-y-8">
      {/* T2.1 / T2.4 — OnboardingChecklist is the first section and OWNS setup tasks */}
      {checklistVisible && !loading && (
        <OnboardingChecklist
          steps={onboardingSteps}
          onDismiss={() => {
            localStorage.setItem(storageKey, '1');
            setChecklistVisible(false);
          }}
          onComplete={() => {
            // Write localStorage now so checklist won't reappear after the
            // 2-second celebration — but don't set state here to keep the
            // celebration visible until OnboardingChecklist auto-calls onDismiss.
            localStorage.setItem(storageKey, '1');
          }}
        />
      )}

      <PageHeader
        title={workspaceName}
        subtitle={webflowSiteName || 'Workspace Dashboard'}
        icon={<Icon as={Globe} size="lg" className="text-accent-brand" />}
        actions={
          <div className="flex items-center gap-3">
            {lastFetched && (
              <span className={`flex items-center gap-1 t-caption-sm ${isStale ? 'text-accent-warning' : 'text-[var(--brand-text-muted)]'}`} title={`Data loaded at ${lastFetched.toLocaleTimeString()}`}>
                <Icon as={Clock} size="sm" />
                {isStale ? 'Stale — ' : ''}{freshnessLabel}
              </span>
            )}
            <Button
              onClick={handleRefresh}
              disabled={refreshing}
              variant="ghost"
              size="sm"
              className="!px-0 text-[var(--brand-text-muted)] hover:text-accent-brand disabled:opacity-50"
              title="Refresh all data"
            >
              <Icon as={RefreshCw} size="sm" className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </Button>
            <Button
              onClick={() => navigate(adminPath(workspaceId, 'workspace-settings'))}
              variant="ghost"
              size="sm"
              className="!px-0 text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]"
            >
              Settings →
            </Button>
          </div>
        }
      />

      {/* T2.2 — WorkspaceHealthBadge REMOVED. Site Health StatCard + MetricRing
          is the single canonical health representation on this screen. */}

      <>
      {/* ── Weekly Accomplishments ── */}
      {weeklySummary && <WeeklyAccomplishments summary={weeklySummary} />}

      {/* T2.4 — Needs Attention: immediately after onboarding, before metrics */}
      {attentionItems.length > 0 && (
        <NeedsAttention
          items={attentionItems}
          showCount
          cap={5}
        />
      )}

      {/* ── Metric Cards (T2.3) ──
          Hero tier (≤3): Site Health · Search Clicks · Traffic Value
          Default tier: everything else, in a compact secondary rail */}
      <div>
        {/* Primary hero row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
          {audit ? (
            <StatCard
              label="Site Health"
              value={audit.siteScore}
              icon={Shield}
              iconColor={themeColor('#71717a', '#94a3b8')}
              delta={scoreDelta ?? undefined}
              deltaLabel=" pts"
              showZeroDelta
              sub={`${audit.errors} err · ${audit.warnings} warn`}
              trailing={<MetricRing score={audit.siteScore} size={44} />}
              onClick={() => navigate(adminPath(workspaceId, 'seo-audit'))}
              size="hero"
              staggerIndex={0}
            />
          ) : (
            <StatCard
              label="Site Health"
              value="—"
              icon={Shield}
              iconColor={themeColor('#71717a', '#94a3b8')}
              valueColor="text-[var(--brand-text-muted)]"
              sub="No audit yet"
              trailing={<MetricRing score={0} size={44} noAnimation />}
              size="hero"
              staggerIndex={0}
            />
          )}

          {searchData ? (
            <StatCard
              label="Search Clicks"
              value={fmt(searchData.totalClicks)}
              icon={Search}
              iconColor={CHART_SERIES_COLORS.cyan}
              sub={`${fmt(searchData.totalImpressions)} impr · ${(searchData.avgCtr * 100).toFixed(1)}% CTR`}
              onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))}
              size="hero"
              staggerIndex={1}
            />
          ) : (
            <StatCard label="Search Clicks" value="—" icon={Search} iconColor={themeColor('#71717a', '#94a3b8')} sub={gscPropertyUrl ? 'Loading...' : 'Connect GSC'} size="hero" staggerIndex={1} />
          )}

          {roiData ? (
            <StatCard
              label="Traffic Value"
              value={`$${fmt(roiData.organicTrafficValue)}`}
              icon={DollarSign}
              iconColor={CHART_SERIES_COLORS.emerald}
              sub={`≈ $${fmt(roiData.adSpendEquivalent)} ad spend`}
              onClick={() => navigate(clientPath(workspaceId, 'roi'))}
              size="hero"
              staggerIndex={2}
            />
          ) : (
            <StatCard label="Traffic Value" value="—" icon={DollarSign} iconColor={themeColor('#71717a', '#94a3b8')} sub="No ROI data yet" size="hero" staggerIndex={2} />
          )}
        </div>

        {/* Secondary supporting rail — size="default" */}
        <div className={cn(
          'grid gap-2',
          // Dynamic columns based on how many secondary cards exist
          'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6',
        )}>
          {ga4Data ? (
            <StatCard
              label="Users"
              value={fmt(ga4Data.totalUsers)}
              icon={BarChart3}
              iconColor={CHART_SERIES_COLORS.blue}
              delta={usersDelta ?? undefined}
              deltaLabel="%"
              sub={`${fmt(ga4Data.totalSessions)} sessions · ${ga4Data.newUserPercentage}% new`}
              onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))}
              size="default"
              staggerIndex={3}
            />
          ) : (
            <StatCard label="Users" value="—" icon={BarChart3} iconColor={themeColor('#71717a', '#94a3b8')} sub={ga4PropertyId ? 'Loading...' : 'Connect GA4'} size="default" staggerIndex={3} />
          )}

          <StatCard
            label="Rank Changes"
            value={ranks.length > 0 ? `${ranks.length} tracked` : '—'}
            icon={TrendingUp}
            iconColor={rankUp > rankDown ? CHART_SERIES_COLORS.emerald : rankDown > rankUp ? CHART_SERIES_COLORS.red : themeColor('#71717a', '#94a3b8')}
            sub={ranks.length > 0 ? `${rankUp} ↑ · ${rankDown} ↓ · ${ranks.length - rankUp - rankDown} =` : 'No keywords tracked'}
            onClick={ranks.length > 0 ? () => navigate(adminPath(workspaceId, ranksTab)) : undefined}
            size="default"
            staggerIndex={4}
          />

          {contentDecayData && contentDecayData.totalDecaying > 0 && (
            <StatCard
              label="Content Decay"
              value={contentDecayData.totalDecaying}
              icon={TrendingDown}
              iconColor={contentDecayData.critical > 0 ? CHART_SERIES_COLORS.red : CHART_SERIES_COLORS.amber}
              sub={contentDecayData.critical > 0 ? `${contentDecayData.critical} crit · ${contentDecayData.warning} risk` : `${contentDecayData.warning} declining`}
              onClick={() => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`)}
              size="default"
              staggerIndex={5}
            />
          )}

          {contentPipeline && contentPipeline.totalCells > 0 && (() => {
            const pct = Math.round((contentPipeline.publishedCells / contentPipeline.totalCells) * 100);
            return (
              <StatCard
                label="Content Pipeline"
                value={`${pct}%`}
                icon={Layers}
                iconColor={themeColor('#71717a', '#94a3b8')}
                sub={`${contentPipeline.publishedCells}/${contentPipeline.totalCells} pub`}
                onClick={() => navigate(adminPath(workspaceId, 'content-pipeline'))}
                size="default"
                staggerIndex={6}
              />
            );
          })()}

          {contentVelocity && (
            <StatCard
              label="Content Velocity"
              value={`${contentVelocity.trailingThreeMonthAvg}/mo`}
              icon={FileText}
              iconColor={CHART_SERIES_COLORS.cyan}
              delta={contentVelocity.trendPct ?? undefined}
              deltaLabel="%"
              sub={`${contentVelocity.currentMonthPublished} this month`}
              onClick={() => navigate(adminPath(workspaceId, 'content'))}
              size="default"
              staggerIndex={7}
            />
          )}

          {intel?.contentPipeline?.coverageGaps && intel.contentPipeline.coverageGaps.length > 0 && (
            <StatCard
              label="Coverage Gaps"
              value={intel.contentPipeline.coverageGaps.length}
              icon={Target}
              iconColor={CHART_SERIES_COLORS.amber}
              sub="Without briefs"
              onClick={() => navigate(adminPath(workspaceId, 'seo-strategy'))}
              size="default"
              staggerIndex={8}
            />
          )}

          {/* T2.2 — Overall Health: composite client-signals score (distinct from audit.siteScore) */}
          {intel?.clientSignals?.compositeHealthScore != null && (
            <StatCard
              label="Overall Health"
              value={Math.round(intel.clientSignals.compositeHealthScore)}
              icon={Shield}
              iconColor={scoreColor(Math.round(intel.clientSignals.compositeHealthScore))}
              valueColor={scoreColorClass(Math.round(intel.clientSignals.compositeHealthScore))}
              sub="Client signals score"
              size="default"
              staggerIndex={9}
            />
          )}
        </div>
      </div>

      {/* ── Anomaly Alerts ── */}
      <AnomalyAlerts workspaceId={workspaceId} isAdmin={true} />

      {/* T2.4 — Operational sections grouped in a TabBar to avoid a 10-section scroll */}
      {/* tab-deeplink-ok — local section switcher; WorkspaceHome no longer receives ?tab= subtabs */}
      <TabBar
        tabs={SECTION_TABS}
        active={activeSectionTab}
        onChange={(id) => setActiveSectionTab(id as SectionTab)}
        ariaLabel="Workspace sections"
      />

      {activeSectionTab === 'overview' && (
        <>
          {/* ── Weekly Briefings ── */}
          <FeatureFlag flag="client-briefing-v2">
            <ErrorBoundary label="Briefing Review Queue">
              <BriefingReviewQueue workspaceId={workspaceId} />
            </ErrorBoundary>
          </FeatureFlag>

          {/* ── Recommendations queue ── */}
          {workspaceId && (
            <ErrorBoundary label="Recommendations">
              <AdminRecommendationQueue workspaceId={workspaceId} />
            </ErrorBoundary>
          )}
        </>
      )}

      {activeSectionTab === 'pipeline' && (
        <>
          {/* ── SEO Pipeline (Work Status + Change Tracker) ── */}
          {seoStatus.total > 0 ? (
            <SectionCard title="SEO Pipeline" titleIcon={<Icon as={Layers} size="md" className="text-accent-brand" />} noPadding>
              <SeoWorkStatus seoStatus={seoStatus} workspaceId={workspaceId} embedded />
              <SeoChangeImpact workspaceId={workspaceId} hasGsc={!!gscPropertyUrl} embedded />
            </SectionCard>
          ) : (
            <SeoChangeImpact workspaceId={workspaceId} hasGsc={!!gscPropertyUrl} />
          )}
        </>
      )}

      {activeSectionTab === 'activity' && (
        <>
          {/* ── Two-column: Activity + Rankings ── */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <ActivityFeed activity={activity} className="lg:col-span-3" />
            <RankingsSnapshot ranks={ranks} gscPropertyUrl={gscPropertyUrl} workspaceId={workspaceId} className="lg:col-span-2" />
          </div>
          {/* ── Active Requests + Annotations ── */}
          <ActiveRequestsAnnotations requests={activeRequests} annotations={annotations} workspaceId={workspaceId} />
        </>
      )}
      </>

      {/* ── Work-order conversation/close panel (focused modal) ── */}
      {workOrderPanelOpen && (
        <ErrorBoundary label="Work Orders">
          <WorkOrderPanel workspaceId={workspaceId} onDismiss={() => setWorkOrderPanelOpen(false)} />
        </ErrorBoundary>
      )}
    </div>
  );
}
