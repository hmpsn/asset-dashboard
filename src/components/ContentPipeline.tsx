import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { ArrowUpRight, Clipboard, FileText, RefreshCw, Download, Layers, HelpCircle, X, TrendingDown, CalendarDays, AlertTriangle } from 'lucide-react'; // trend-icon-ok
import { LoadingState, Icon, IconButton, Button, ClickableRow, cn, PageHeader, TabBar, Menu, Disclosure, WorkflowStepper, tierAtLeast } from './ui';
import type { MenuItem } from './ui';
import { useContentPipeline, useWorkspaces } from '../hooks/admin';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import { AiSuggested } from './pipeline/AiSuggested';
import { CannibalizationAlert } from './ui/CannibalizationAlert';
import { adminPath } from '../routes';
import { useWorkspaceIntelligence } from '../hooks/admin';
import type { FixContext } from '../types/fix-context';
import { clearTabSearchParam, resolveTabSearchParam } from '../lib/tab-search-param';

/** Synthetic FixContext built from an AI-suggested signal to prefill ContentBriefs. */
function buildSignalPrefill(keyword: string, pageUrl?: string): FixContext {
  return {
    targetRoute: 'content-pipeline',
    primaryKeyword: keyword || undefined,
    // pageUrl from PipelineSignal is a path/slug — pass as pageSlug so
    // handleGenerate() picks it up via fixContextRef.current?.pageSlug,
    // targeting the correct page without polluting the keyword field.
    pageSlug: pageUrl || undefined,
  };
}

const ContentPlanner = lazyWithRetry(() => import('./ContentPlanner').then(m => ({ default: m.ContentPlanner })));
const ContentCalendar = lazyWithRetry(() => import('./ContentCalendar').then(m => ({ default: m.ContentCalendar })));
const ContentPipelineGuide = lazyWithRetry(() => import('./ContentPipelineGuide').then(m => ({ default: m.ContentPipelineGuide })));

interface Props {
  workspaceId: string;
  fixContext?: FixContext | null;
  clearFixContext?: () => void;
}

// T4.1: "Subscriptions" → "Publish" in the tab bar; Calendar is a view toggle.
// Stepper phases align 1:1 with pipeline tabs (excluding Calendar).
const TABS = [
  { id: 'planner' as const, label: 'Planner', icon: Layers },
  { id: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
  { id: 'briefs' as const, label: 'Briefs', icon: Clipboard },
  { id: 'posts' as const, label: 'Posts', icon: FileText },
  { id: 'publish' as const, label: 'Publish', icon: RefreshCw },
] as const;

type PipelineTab = typeof TABS[number]['id'];

// Legacy alias: old ?tab=subscriptions still resolves to 'publish'
const TAB_LEGACY_ALIASES: Partial<Record<string, PipelineTab>> = {
  subscriptions: 'publish',
};

const EXPORTS = [
  { key: 'briefs', label: 'Content Briefs' },
  { key: 'requests', label: 'Content Requests' },
  { key: 'matrices', label: 'Content Matrices' },
  { key: 'templates', label: 'Content Templates' },
  { key: 'strategy', label: 'Keyword Strategy' },
] as const;

export function ContentPipeline({ workspaceId, fixContext, clearFixContext }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PipelineTab>(() => {
    return resolveTabSearchParam<PipelineTab>(searchParams.get('tab'), {
      validValues: TABS.map(t => t.id),
      fallback: 'briefs',
      legacyAliases: TAB_LEGACY_ALIASES,
    });
  });

  // Clear ?tab= from URL on manual tab change so refresh shows last selection
  const handleTabChange = (id: string) => {
    setActiveTab(id as PipelineTab);
    const next = clearTabSearchParam(searchParams);
    if (next) {
      setSearchParams(next, { replace: true });
    }
  };

  // Sync activeTab when the URL ?tab= param changes externally (e.g. ContentCalendar's
  // openItem navigates to ?tab=posts&post=<id> while the pipeline is already mounted).
  // Only update when the incoming param is a valid tab that differs from current state;
  // guard avoids feedback-loops from the handleTabChange call above that clears the param.
  useEffect(() => {
    const param = searchParams.get('tab');
    if (!param) return;
    const resolved = resolveTabSearchParam<PipelineTab>(param, {
      validValues: TABS.map(t => t.id),
      fallback: activeTab,
      legacyAliases: TAB_LEGACY_ALIASES,
    });
    if (resolved !== activeTab) {
      setActiveTab(resolved);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps -- activeTab intentionally excluded: including it would loop with handleTabChange

  const [guideOpen, setGuideOpen] = useState(false);
  const [decayDismissed, setDecayDismissed] = useState(false);
  // Synthetic fixContext built from an AI-suggested signal click; overrides the
  // parent's fixContext while the user is landing on the briefs tab from AiSuggested.
  const [pipelinePrefill, setPipelinePrefill] = useState<FixContext | null>(null);
  // Nonce incremented on every handleCreateBrief call so the ContentBriefs key changes,
  // forcing a remount even if the user is already on the Briefs tab. Without this, the
  // fixConsumed ref in ContentBriefs is never reset and a second "Create brief" click
  // while already on the tab silently drops the new keyword.
  const [prefillNonce, setPrefillNonce] = useState(0);

  // React Query hook replaces manual data fetching
  const { data: pipelineData } = useContentPipeline(workspaceId);

  // Workspace tier — from cached workspaces list (no extra fetch)
  const { data: workspaces = [] } = useWorkspaces();
  const workspaceTier = (workspaces.find(w => w.id === workspaceId)?.tier ?? 'free') as 'free' | 'growth' | 'premium';

  // Intelligence layer — cannibalization warnings
  const { data: intel } = useWorkspaceIntelligence(workspaceId, ['contentPipeline']);

  const summary = pipelineData?.summary;
  const decay = pipelineData?.decay;

  // Auto-switch to briefs tab when arriving via "Draft Brief" navigation.
  // Guard on targetRoute so stale fixContext from seo-editor/seo-schema navigations
  // doesn't wrongly trigger a tab switch when the user arrives at content-pipeline.
  // NOTE: Do NOT call clearFixContext here — ContentBriefs needs fixContext intact
  // when it mounts to pre-fill keyword/pageType. ContentBriefs owns the cleanup
  // via its own clearFixContext?.() call after consuming the context.
  useEffect(() => {
    if (fixContext?.targetRoute === 'content-pipeline') {
      setActiveTab('briefs');
    }
  }, [fixContext]);

  // T4.2: Export via <Menu> primitive — no hand-rolled dropdown state.
  // Each export type has two items (CSV + JSON).
  const exportMenuItems: MenuItem[] = EXPORTS.flatMap(exp => [
    { label: `${exp.label} — CSV`, onSelect: () => window.open(`/api/export/${workspaceId}/${exp.key}?format=csv`, '_blank') },
    { label: `${exp.label} — JSON`, onSelect: () => window.open(`/api/export/${workspaceId}/${exp.key}?format=json`, '_blank') },
  ]);

  // Navigate to briefs tab when an AI-suggested signal is actioned.
  // Builds a synthetic fixContext from the signal's keyword + pageUrl so
  // ContentBriefs pre-fills the generator instead of landing empty.
  // Increments prefillNonce so the ContentBriefs key changes on every call,
  // forcing a remount even if the Briefs tab is already active (the fixConsumed
  // ref in ContentBriefs is per-mount, so a remount re-consumes the new context).
  // suggestedBriefId is accepted for interface compatibility (AiSuggested marks it
  // accepted in the store before calling this); no additional action needed here.
  const handleCreateBrief = (keyword: string, pageUrl?: string, _suggestedBriefId?: string) => {
    setPipelinePrefill(buildSignalPrefill(keyword, pageUrl));
    setPrefillNonce(n => n + 1);
    setActiveTab('briefs');
  };

  // T4.1: Stepper phases align 1:1 with pipeline tabs (excluding Calendar which is a view toggle).
  // "Strategy" phase now points to the in-page Planner tab instead of navigating off-page.
  const contentWorkflowSteps = [
    { number: 1, label: 'Strategy', completed: activeTab === 'briefs' || activeTab === 'posts' || activeTab === 'publish', current: activeTab === 'planner', onClick: () => handleTabChange('planner') },
    { number: 2, label: 'Briefs', completed: activeTab === 'posts' || activeTab === 'publish', current: activeTab === 'briefs', onClick: () => handleTabChange('briefs') },
    { number: 3, label: 'Posts', completed: activeTab === 'publish', current: activeTab === 'posts', onClick: () => handleTabChange('posts') },
    { number: 4, label: 'Publish', completed: false, current: activeTab === 'publish', onClick: () => handleTabChange('publish') },
  ];

  // T4.3: Count alert items for the Disclosure summary badge.
  const cannibalizationEntries = (intel?.contentPipeline?.cannibalizationWarnings ?? []).map(w => ({
    keyword: w.keyword,
    severity: w.severity,
    pages: w.pages.map(p => ({ path: p })),
  }));
  const decayAlertCount = decay && !decayDismissed && (decay.critical > 0 || decay.warning > 0) ? 1 : 0;
  // Only count cannibalization when the tier can actually open it (CannibalizationAlert is
  // growth-gated) — otherwise the "(N)" badge would promise items a free-tier user can't reach.
  const cannibalizationCount = tierAtLeast(workspaceTier, 'growth') ? cannibalizationEntries.length : 0;
  // AiSuggested renders OUTSIDE this Disclosure (a neutral workflow-entry card, not an alarmed
  // band), so it is intentionally not part of the alert count.
  const alertCount = decayAlertCount + cannibalizationCount;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Pipeline"
        subtitle="Plan, brief, write, and publish content at scale"
        icon={<Icon as={Layers} size="lg" className="text-accent-brand" />}
      />

      {/* T4.1: Calendar tab has no workflow phase — stepper only shown for pipeline tabs.
          "Strategy" step clicks into the Planner tab (not off-page nav). */}
      {activeTab !== 'calendar' && <WorkflowStepper steps={contentWorkflowSteps} compact />}

      {/* Health summary bar — the ONE persistent bar, always visible */}
      {summary && (summary.briefs > 0 || summary.matrices > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)]" style={{ borderRadius: 'var(--radius-signature)' }}>
          {summary.briefs > 0 && <span className="flex items-center gap-1"><Icon as={Clipboard} size="sm" className="text-accent-info" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.briefs}</span> brief{summary.briefs !== 1 ? 's' : ''}</span>}
          {summary.posts > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={FileText} size="sm" className="text-[var(--brand-text-bright)]" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.posts}</span> post{summary.posts !== 1 ? 's' : ''}</span></>}
          {summary.matrices > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={Layers} size="sm" className="text-accent-info" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.matrices}</span> matri{summary.matrices !== 1 ? 'ces' : 'x'}</span></>}
          {summary.cells > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><span className="font-medium text-[var(--brand-text-bright)]">{summary.cells}</span> cell{summary.cells !== 1 ? 's' : ''}</span>{summary.published > 0 && <span className="text-accent-success ml-0.5">({Math.round(summary.published / summary.cells * 100)}% published)</span>}</>}
        </div>
      )}

      {/* T4.3: Alerts & suggestions Disclosure — collapses decay + cannibalization + AI suggestions.
          Operator can reach tab content without scrolling past three alarmed bands. */}
      {alertCount > 0 && (
        <Disclosure
          summary={
            <span className="flex items-center gap-2">
              <Icon as={AlertTriangle} size="md" className="text-accent-warning" aria-hidden />
              Alerts &amp; suggestions
            </span>
          }
          badges={[{ label: `${alertCount}`, tone: 'amber' }]}
        >
          <div className="space-y-4 pt-2">
            {/* Content decay alert — clickable through to Content Decay in SEO Audit */}
            {decay && !decayDismissed && (decay.critical > 0 || decay.warning > 0) && (
              <ClickableRow
                onClick={() => navigate(`${adminPath(workspaceId, 'content-pipeline')}?tab=content-health`)}
                className={cn('flex items-center gap-3 px-4 py-2.5 border text-xs', decay.critical > 0 ? 'bg-red-500/5 border-red-500/20 hover:bg-red-500/10' : 'bg-amber-500/5 border-amber-500/20 hover:bg-amber-500/10')}
                style={{ borderRadius: 'var(--radius-signature)' }}
              >
                <Icon as={TrendingDown} size="md" className={cn('flex-shrink-0', decay.critical > 0 ? 'text-accent-danger' : 'text-accent-warning')} />
                <div className="flex-1">
                  <span className="font-medium text-[var(--brand-text-bright)]">
                    {decay.totalDecaying} page{decay.totalDecaying !== 1 ? 's' : ''} losing traffic
                  </span>
                  <span className="text-[var(--brand-text-muted)] ml-1.5">
                    {decay.critical > 0 && <span className="text-accent-danger">{decay.critical} critical</span>}
                    {decay.critical > 0 && decay.warning > 0 && <span> · </span>}
                    {decay.warning > 0 && <span className="text-accent-warning">{decay.warning} warning</span>}
                    <span className="ml-1.5">· avg {Math.abs(decay.avgDeclinePct).toFixed(0)}% decline</span>
                  </span>
                </div>
                <Icon as={ArrowUpRight} size="sm" className="flex-shrink-0 text-[var(--brand-text-muted)]" />
                <IconButton
                  onClick={(e) => { e.stopPropagation(); setDecayDismissed(true); }}
                  icon={X}
                  label="Dismiss decay alert"
                  size="sm"
                  variant="ghost"
                  className="flex-shrink-0"
                />
              </ClickableRow>
            )}

            {/* Cannibalization warnings — growth-gated, so only surfaced (and counted) for
                tiers that can act on them; keeps the "(N)" badge honest for free tier. */}
            {tierAtLeast(workspaceTier, 'growth') && cannibalizationEntries.length > 0 && (
              <CannibalizationAlert
                entries={cannibalizationEntries}
                tier={workspaceTier}
              />
            )}
          </div>
        </Disclosure>
      )}

      {/* AI-suggested briefs from insight engine — always shown (manages own empty state) */}
      <AiSuggested workspaceId={workspaceId} onCreateBrief={handleCreateBrief} />

      {/* T4.2: Sub-tab bar using <TabBar> primitive + Export via <Menu> (not a fake tab).
          ?tab= deep-link: handled via useSearchParams init + sync effect above. */}
      <div className="flex items-center gap-2">
        <TabBar
          tabs={TABS as unknown as Array<{ id: string; label: string; icon: import('lucide-react').LucideIcon }>}
          active={activeTab}
          onChange={handleTabChange}
          ariaLabel="Content pipeline sections"
          className="flex-1"
        />

        {/* Export action — moved OUT of tab row; rendered via <Menu> primitive */}
        <div className="pb-0 border-b border-[var(--brand-border)] flex items-end">
          <Menu
            trigger={
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 px-2.5 py-1.5 t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] mb-px"
              >
                <Icon as={Download} size="sm" />
                Export
              </Button>
            }
            items={exportMenuItems}
            align="end"
          />
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'planner' && (
        <Suspense fallback={<LoadingState size="lg" message="Loading content planner..." />}>
          <ContentPlanner key={`planner-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'calendar' && (
        <Suspense fallback={<LoadingState size="lg" message="Loading content calendar..." />}>
          <ContentCalendar key={`calendar-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'briefs' && (
        <ContentBriefs
          // When pipelinePrefill is active we include the nonce so every handleCreateBrief
          // call forces a fresh mount even if the tab was already visible, resetting the
          // fixConsumed ref so the new keyword is reliably pre-filled.
          key={pipelinePrefill ? `briefs-${workspaceId}-${prefillNonce}` : `briefs-${workspaceId}`}
          workspaceId={workspaceId}
          // pipelinePrefill wins over parent fixContext while a signal action is pending.
          // ContentBriefs calls clearFixContext after consuming — that clears pipelinePrefill.
          fixContext={pipelinePrefill ?? fixContext}
          clearFixContext={pipelinePrefill ? () => { setPipelinePrefill(null); clearFixContext?.(); } : clearFixContext}
        />
      )}
      {activeTab === 'posts' && (
        <ContentManager key={`content-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {activeTab === 'publish' && (
        <ContentSubscriptions key={`subs-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {/* Floating help button */}
      <IconButton
        onClick={() => setGuideOpen(true)}
        icon={HelpCircle}
        label="Content Pipeline Guide"
        size="lg"
        variant="ghost"
        className={"fixed bottom-24 right-6 z-[var(--z-tooltip)] rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border)] hover:border-teal-500/50 hover:bg-[var(--brand-border-hover)] shadow-lg group" // rounded-literal-ok
        }
        title="Content Pipeline Guide"
      />

      {/* Guide slide-over */}
      {guideOpen && (
        <div className={"fixed inset-0 z-[var(--z-modal-backdrop)] flex justify-end" // fixed-inset-ok — slide panel
        }>
          <div className="absolute inset-0 bg-black/40" onClick={() => setGuideOpen(false)} />
          <div className="relative w-full max-w-md bg-[var(--surface-1)] border-l border-[var(--brand-border)] shadow-2xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between px-5 py-3.5 bg-[var(--surface-1)]/95 backdrop-blur border-b border-[var(--brand-border)]">
              <span className="text-sm font-semibold text-[var(--brand-text-bright)]">Content Pipeline Guide</span>
              <IconButton
                onClick={() => setGuideOpen(false)}
                icon={X}
                label="Close content pipeline guide"
                size="sm"
                variant="ghost"
                className="rounded-[var(--radius-md)]"
              />
            </div>
            <div className="p-5">
              <Suspense fallback={<LoadingState size="sm" message="Loading content pipeline guide..." />}>
                <ContentPipelineGuide />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
