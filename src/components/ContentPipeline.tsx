import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Clipboard, FileText, RefreshCw, Download, ChevronDown, Layers, HelpCircle, X, TrendingDown, CalendarDays } from 'lucide-react'; // trend-icon-ok
import { LoadingState, Icon, IconButton, Button, cn, PageHeader } from './ui';
import { useContentPipeline, useWorkspaces } from '../hooks/admin';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import { AiSuggested } from './pipeline/AiSuggested';
import { CannibalizationAlert } from './admin/CannibalizationAlert';
import { WorkflowStepper } from './ui';
import { adminPath } from '../routes';
import { useWorkspaceIntelligence } from '../hooks/admin';
import type { FixContext } from '../App';

const ContentPlanner = lazyWithRetry(() => import('./ContentPlanner').then(m => ({ default: m.ContentPlanner })));
const ContentCalendar = lazyWithRetry(() => import('./ContentCalendar').then(m => ({ default: m.ContentCalendar })));
const ContentPipelineGuide = lazyWithRetry(() => import('./ContentPipelineGuide').then(m => ({ default: m.ContentPipelineGuide })));

interface Props {
  workspaceId: string;
  onRequestCountChange?: (count: number) => void;
  fixContext?: FixContext | null;
  clearFixContext?: () => void;
}

const TABS = [
  { id: 'planner' as const, label: 'Planner', icon: Layers },
  { id: 'calendar' as const, label: 'Calendar', icon: CalendarDays },
  { id: 'briefs' as const, label: 'Briefs', icon: Clipboard },
  { id: 'posts' as const, label: 'Posts', icon: FileText },
  { id: 'subscriptions' as const, label: 'Subscriptions', icon: RefreshCw },
];

type PipelineTab = typeof TABS[number]['id'];

const EXPORTS = [
  { key: 'briefs', label: 'Content Briefs' },
  { key: 'requests', label: 'Content Requests' },
  { key: 'matrices', label: 'Content Matrices' },
  { key: 'templates', label: 'Content Templates' },
  { key: 'strategy', label: 'Keyword Strategy' },
] as const;

export function ContentPipeline({ workspaceId, onRequestCountChange, fixContext, clearFixContext }: Props) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<PipelineTab>(() => {
    const param = searchParams.get('tab');
    return TABS.some(t => t.id === param) ? (param as PipelineTab) : 'briefs';
  });

  // Clear ?tab= from URL on manual tab change so refresh shows last selection
  const handleTabChange = (id: string) => {
    setActiveTab(id as PipelineTab);
    if (searchParams.has('tab')) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  };
  const [exportOpen, setExportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [decayDismissed, setDecayDismissed] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // React Query hook replaces manual data fetching
  const { data: pipelineData } = useContentPipeline(workspaceId);

  // Workspace tier — from cached workspaces list (no extra fetch)
  const { data: workspaces = [] } = useWorkspaces();
  const workspaceTier = (workspaces.find(w => w.id === workspaceId)?.tier ?? 'free') as 'free' | 'growth' | 'premium';

  // Intelligence layer — cannibalization warnings
  const { data: intel } = useWorkspaceIntelligence(workspaceId, ['contentPipeline']);

  const summary = pipelineData?.summary;
  const decay = pipelineData?.decay;

  useEffect(() => {
    if (!exportOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

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

  const handleExport = (dataset: string, format: 'csv' | 'json') => {
    window.open(`/api/export/${workspaceId}/${dataset}?format=${format}`, '_blank');
    setExportOpen(false);
  };

  // Navigate to briefs tab when an AI-suggested brief is actioned
  const handleCreateBrief = () => {
    setActiveTab('briefs');
  };

  const contentWorkflowSteps = [
    { number: 1, label: 'Strategy', completed: activeTab === 'briefs' || activeTab === 'posts' || activeTab === 'subscriptions', current: activeTab === 'planner', onClick: () => navigate(adminPath(workspaceId, 'seo-strategy')) },
    { number: 2, label: 'Briefs', completed: activeTab === 'posts' || activeTab === 'subscriptions', current: activeTab === 'briefs', onClick: () => handleTabChange('briefs') },
    { number: 3, label: 'Posts', completed: activeTab === 'subscriptions', current: activeTab === 'posts', onClick: () => handleTabChange('posts') },
    { number: 4, label: 'Publish', completed: false, current: activeTab === 'subscriptions', onClick: () => handleTabChange('subscriptions') },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Content Pipeline"
        subtitle="Plan, brief, write, and publish content at scale"
        icon={<Icon as={Layers} size="lg" className="text-accent-brand" />}
      />

      {/* Calendar tab has no workflow phase — stepper only shown for pipeline tabs */}
      {activeTab !== 'calendar' && <WorkflowStepper steps={contentWorkflowSteps} compact />}

      {/* Health summary bar */}
      {summary && (summary.briefs > 0 || summary.matrices > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)]" style={{ borderRadius: 'var(--radius-signature)' }}>
          {summary.briefs > 0 && <span className="flex items-center gap-1"><Icon as={Clipboard} size="sm" className="text-accent-brand" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.briefs}</span> brief{summary.briefs !== 1 ? 's' : ''}</span>}
          {summary.posts > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={FileText} size="sm" className="text-accent-warning" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.posts}</span> post{summary.posts !== 1 ? 's' : ''}</span></>}
          {summary.matrices > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={Layers} size="sm" className="text-accent-brand" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.matrices}</span> matri{summary.matrices !== 1 ? 'ces' : 'x'}</span></>}
          {summary.cells > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><span className="font-medium text-[var(--brand-text-bright)]">{summary.cells}</span> cell{summary.cells !== 1 ? 's' : ''}</span>{summary.published > 0 && <span className="text-accent-success ml-0.5">({Math.round(summary.published / summary.cells * 100)}% published)</span>}</>}
        </div>
      )}

      {/* Content decay alert */}
      {decay && !decayDismissed && (decay.critical > 0 || decay.warning > 0) && (
        <div className={cn('flex items-center gap-3 px-4 py-2.5 border text-xs', decay.critical > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20')} style={{ borderRadius: 'var(--radius-signature)' }}>
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
          <IconButton
            onClick={() => setDecayDismissed(true)}
            icon={X}
            label="Dismiss decay alert"
            size="sm"
            variant="ghost"
            className="flex-shrink-0"
          />
        </div>
      )}

      {/* Cannibalization warnings from intelligence */}
      <CannibalizationAlert
        warnings={intel?.contentPipeline?.cannibalizationWarnings}
        tier={workspaceTier}
      />

      {/* AI-suggested briefs from insight engine */}
      <AiSuggested workspaceId={workspaceId} onCreateBrief={handleCreateBrief} />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--brand-border)] pb-0">
        {TABS.map(t => {
          const TabIcon = t.icon;
          const active = activeTab === t.id;
          return (
            <Button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              variant="ghost"
              size="sm"
              className={cn(
                'gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px rounded-none',
                active ? 'border-teal-400 text-accent-brand' : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]',
              )}
            >
              <Icon as={TabIcon} size="md" />
              {t.label}
            </Button>
          );
        })}

        {/* Export dropdown */}
        <div className="ml-auto relative" ref={exportRef}>
          <Button
            onClick={() => setExportOpen(!exportOpen)}
            variant="ghost"
            size="sm"
            className="gap-1 px-2.5 py-1.5 t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] rounded-[var(--radius-md)] hover:bg-[var(--surface-3)]"
          >
            <Icon as={Download} size="sm" />
            Export
            <Icon as={ChevronDown} size="sm" className={cn('transition-transform', exportOpen && 'rotate-180')} />
          </Button>
          {exportOpen && (
            // pr-check-disable-next-line -- export menu dropdown
            <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-[var(--z-dropdown)] py-1 overflow-hidden">
              {EXPORTS.map(exp => (
                <div key={exp.key} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--surface-3)] group">
                  <span className="text-xs text-[var(--brand-text-bright)]">{exp.label}</span>
                  <div className="flex items-center gap-1">
                    <Button
                      onClick={() => handleExport(exp.key, 'csv')}
                      variant="ghost"
                      size="sm"
                      className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-accent-brand hover:bg-teal-500/10"
                    >
                      CSV
                    </Button>
                    <Button
                      onClick={() => handleExport(exp.key, 'json')}
                      variant="ghost"
                      size="sm"
                      className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-accent-brand hover:bg-teal-500/10"
                    >
                      JSON
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'planner' && (
        <Suspense fallback={<LoadingState size="lg" message="Loading..." />}>
          <ContentPlanner key={`planner-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'calendar' && (
        <Suspense fallback={<LoadingState size="lg" message="Loading..." />}>
          <ContentCalendar key={`calendar-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'briefs' && (
        <ContentBriefs key={`briefs-${workspaceId}`} workspaceId={workspaceId} onRequestCountChange={onRequestCountChange} fixContext={fixContext} clearFixContext={clearFixContext} />
      )}
      {activeTab === 'posts' && (
        <ContentManager key={`content-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {activeTab === 'subscriptions' && (
        <ContentSubscriptions key={`subs-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {/* Floating help button */}
      <IconButton
        onClick={() => setGuideOpen(true)}
        icon={HelpCircle}
        label="Content Pipeline Guide"
        size="lg"
        variant="ghost"
        className={"fixed bottom-6 right-6 z-[var(--z-tooltip)] rounded-[var(--radius-pill)] bg-[var(--surface-3)] border border-[var(--brand-border)] hover:border-teal-500/50 hover:bg-[var(--brand-border-hover)] shadow-lg group" // rounded-literal-ok
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
              <Suspense fallback={<LoadingState size="sm" message="Loading..." />}>
                <ContentPipelineGuide />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
