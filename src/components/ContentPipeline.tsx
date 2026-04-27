import { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Clipboard, FileText, RefreshCw, Download, ChevronDown, Layers, HelpCircle, X, TrendingDown, CalendarDays } from 'lucide-react';
import { LoadingState, Icon, cn } from './ui';
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
      {/* Calendar tab has no workflow phase — stepper only shown for pipeline tabs */}
      {activeTab !== 'calendar' && <WorkflowStepper steps={contentWorkflowSteps} compact />}

      {/* Health summary bar */}
      {summary && (summary.briefs > 0 || summary.matrices > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-[var(--surface-2)] border border-[var(--brand-border)] t-caption-sm text-[var(--brand-text)]" style={{ borderRadius: '10px 24px 10px 24px' }}>
          {summary.briefs > 0 && <span className="flex items-center gap-1"><Icon as={Clipboard} size="sm" className="text-teal-400" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.briefs}</span> brief{summary.briefs !== 1 ? 's' : ''}</span>}
          {summary.posts > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={FileText} size="sm" className="text-amber-400" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.posts}</span> post{summary.posts !== 1 ? 's' : ''}</span></>}
          {summary.matrices > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><Icon as={Layers} size="sm" className="text-teal-400" /><span className="font-medium text-[var(--brand-text-bright)]">{summary.matrices}</span> matri{summary.matrices !== 1 ? 'ces' : 'x'}</span></>}
          {summary.cells > 0 && <><span className="text-[var(--brand-border)]">&middot;</span><span className="flex items-center gap-1"><span className="font-medium text-[var(--brand-text-bright)]">{summary.cells}</span> cell{summary.cells !== 1 ? 's' : ''}</span>{summary.published > 0 && <span className="text-emerald-400 ml-0.5">({Math.round(summary.published / summary.cells * 100)}% published)</span>}</>}
        </div>
      )}

      {/* Content decay alert */}
      {decay && !decayDismissed && (decay.critical > 0 || decay.warning > 0) && (
        <div className={cn('flex items-center gap-3 px-4 py-2.5 border text-xs', decay.critical > 0 ? 'bg-red-500/5 border-red-500/20' : 'bg-amber-500/5 border-amber-500/20')} style={{ borderRadius: '10px 24px 10px 24px' }}>
          <Icon as={TrendingDown} size="md" className={cn('flex-shrink-0', decay.critical > 0 ? 'text-red-400' : 'text-amber-400')} />
          <div className="flex-1">
            <span className="font-medium text-[var(--brand-text-bright)]">
              {decay.totalDecaying} page{decay.totalDecaying !== 1 ? 's' : ''} losing traffic
            </span>
            <span className="text-[var(--brand-text-muted)] ml-1.5">
              {decay.critical > 0 && <span className="text-red-400">{decay.critical} critical</span>}
              {decay.critical > 0 && decay.warning > 0 && <span> · </span>}
              {decay.warning > 0 && <span className="text-amber-400">{decay.warning} warning</span>}
              <span className="ml-1.5">· avg {Math.abs(decay.avgDeclinePct).toFixed(0)}% decline</span>
            </span>
          </div>
          <button
            onClick={() => setDecayDismissed(true)}
            className="p-0.5 rounded hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors flex-shrink-0"
          >
            <Icon as={X} size="md" />
          </button>
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
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px', active ? 'border-teal-400 text-teal-300' : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]')}
            >
              <Icon as={TabIcon} size="md" />
              {t.label}
            </button>
          );
        })}

        {/* Export dropdown */}
        <div className="ml-auto relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors rounded-md hover:bg-[var(--surface-3)]"
          >
            <Icon as={Download} size="sm" />
            Export
            <Icon as={ChevronDown} size="sm" className={cn('transition-transform', exportOpen && 'rotate-180')} />
          </button>
          {exportOpen && (
            // pr-check-disable-next-line -- export menu dropdown
            <div className="absolute right-0 top-full mt-1 w-56 bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl z-20 py-1 overflow-hidden">
              {EXPORTS.map(exp => (
                <div key={exp.key} className="flex items-center justify-between px-3 py-2 hover:bg-[var(--surface-3)] group">
                  <span className="text-xs text-[var(--brand-text-bright)]">{exp.label}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleExport(exp.key, 'csv')} className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-teal-300 hover:bg-teal-500/10 transition-colors">CSV</button>
                    <button onClick={() => handleExport(exp.key, 'json')} className="t-caption-sm px-1.5 py-0.5 rounded bg-[var(--surface-3)] text-[var(--brand-text)] hover:text-teal-300 hover:bg-teal-500/10 transition-colors">JSON</button>
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
      <button
        onClick={() => setGuideOpen(true)}
        className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-[var(--surface-3)] border border-[var(--brand-border)] hover:border-teal-500/50 hover:bg-[var(--brand-border-hover)] shadow-lg flex items-center justify-center transition-all group"
        title="Content Pipeline Guide"
      >
        <Icon as={HelpCircle} size="md" className="text-[var(--brand-text)] group-hover:text-teal-400 transition-colors" />
      </button>

      {/* Guide slide-over */}
      {guideOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setGuideOpen(false)} />
          <div className="relative w-full max-w-md bg-[var(--surface-1)] border-l border-[var(--brand-border)] shadow-2xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-[var(--surface-1)]/95 backdrop-blur border-b border-[var(--brand-border)]">
              <span className="text-sm font-semibold text-[var(--brand-text-bright)]">Content Pipeline Guide</span>
              <button onClick={() => setGuideOpen(false)} className="p-1 rounded-md hover:bg-[var(--surface-3)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)] transition-colors">
                <Icon as={X} size="md" />
              </button>
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
