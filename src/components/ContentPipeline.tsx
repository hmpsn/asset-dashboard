import { useState, useRef, useEffect, Suspense } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Clipboard, FileText, RefreshCw, Map, Bot, Download, ChevronDown, Layers, HelpCircle, X, TrendingDown } from 'lucide-react';
import { useContentPipeline } from '../hooks/admin';
import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../lib/wsEvents';
import { queryKeys } from '../lib/queryKeys';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import { AiSuggested } from './pipeline/AiSuggested';
import type { FixContext } from '../App';

const SiteArchitecture = lazyWithRetry(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));
const LlmsTxtGenerator = lazyWithRetry(() => import('./LlmsTxtGenerator').then(m => ({ default: m.LlmsTxtGenerator })));
const ContentPlanner = lazyWithRetry(() => import('./ContentPlanner').then(m => ({ default: m.ContentPlanner })));
const ContentPipelineGuide = lazyWithRetry(() => import('./ContentPipelineGuide').then(m => ({ default: m.ContentPipelineGuide })));

interface Props {
  workspaceId: string;
  onRequestCountChange?: (count: number) => void;
  fixContext?: FixContext | null;
}

const TABS = [
  { id: 'planner' as const, label: 'Planner', icon: Layers },
  { id: 'briefs' as const, label: 'Briefs', icon: Clipboard },
  { id: 'posts' as const, label: 'Posts', icon: FileText },
  { id: 'subscriptions' as const, label: 'Subscriptions', icon: RefreshCw },
  { id: 'architecture' as const, label: 'Architecture', icon: Map },
  { id: 'llms-txt' as const, label: 'LLMs.txt', icon: Bot },
];

type PipelineTab = typeof TABS[number]['id'];

const EXPORTS = [
  { key: 'briefs', label: 'Content Briefs' },
  { key: 'requests', label: 'Content Requests' },
  { key: 'matrices', label: 'Content Matrices' },
  { key: 'templates', label: 'Content Templates' },
  { key: 'strategy', label: 'Keyword Strategy' },
] as const;

interface PipelineSummary {
  briefs: number;
  posts: number;
  matrices: number;
  cells: number;
  published: number;
}

interface DecaySummary {
  critical: number;
  warning: number;
  totalDecaying: number;
  avgDeclinePct: number;
}

export function ContentPipeline({ workspaceId, onRequestCountChange, fixContext }: Props) {
  const [activeTab, setActiveTab] = useState<PipelineTab>('briefs');
  const [exportOpen, setExportOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [decayDismissed, setDecayDismissed] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const queryClient = useQueryClient();

  // React Query hook replaces manual data fetching
  const { data: pipelineData, isLoading } = useContentPipeline(workspaceId);

  // Invalidate AI suggested briefs when intelligence signals update
  useWorkspaceEvents(workspaceId, {
    [WS_EVENTS.INTELLIGENCE_SIGNALS_UPDATED]: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.aiSuggestedBriefs(workspaceId) });
    },
  });
  
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

  const handleExport = (dataset: string, format: 'csv' | 'json') => {
    window.open(`/api/export/${workspaceId}/${dataset}?format=${format}`, '_blank');
    setExportOpen(false);
  };

  // Navigate to briefs tab when an AI-suggested brief is actioned
  const handleCreateBrief = () => {
    setActiveTab('briefs');
  };

  return (
    <div className="space-y-8">
      {/* Health summary bar */}
      {summary && (summary.briefs > 0 || summary.matrices > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-400" style={{ borderRadius: '10px 24px 10px 24px' }}>
          {summary.briefs > 0 && <span className="flex items-center gap-1"><Clipboard className="w-3 h-3 text-teal-400" /><span className="font-medium text-zinc-300">{summary.briefs}</span> brief{summary.briefs !== 1 ? 's' : ''}</span>}
          {summary.posts > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><FileText className="w-3 h-3 text-amber-400" /><span className="font-medium text-zinc-300">{summary.posts}</span> post{summary.posts !== 1 ? 's' : ''}</span></>}
          {summary.matrices > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><Layers className="w-3 h-3 text-violet-400" /><span className="font-medium text-zinc-300">{summary.matrices}</span> matri{summary.matrices !== 1 ? 'ces' : 'x'}</span></>}
          {summary.cells > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><span className="font-medium text-zinc-300">{summary.cells}</span> cell{summary.cells !== 1 ? 's' : ''}</span>{summary.published > 0 && <span className="text-green-400 ml-0.5">({Math.round(summary.published / summary.cells * 100)}% published)</span>}</>}
        </div>
      )}

      {/* Content decay alert */}
      {decay && !decayDismissed && (decay.critical > 0 || decay.warning > 0) && (
        <div className={`flex items-center gap-3 px-4 py-2.5 border text-xs ${
          decay.critical > 0
            ? 'bg-red-500/5 border-red-500/20'
            : 'bg-amber-500/5 border-amber-500/20'
        }`} style={{ borderRadius: '10px 24px 10px 24px' }}>
          <TrendingDown className={`w-4 h-4 flex-shrink-0 ${decay.critical > 0 ? 'text-red-400' : 'text-amber-400'}`} />
          <div className="flex-1">
            <span className="font-medium text-zinc-200">
              {decay.totalDecaying} page{decay.totalDecaying !== 1 ? 's' : ''} losing traffic
            </span>
            <span className="text-zinc-500 ml-1.5">
              {decay.critical > 0 && <span className="text-red-400">{decay.critical} critical</span>}
              {decay.critical > 0 && decay.warning > 0 && <span> · </span>}
              {decay.warning > 0 && <span className="text-amber-400">{decay.warning} warning</span>}
              <span className="ml-1.5">· avg {Math.abs(decay.avgDeclinePct).toFixed(0)}% decline</span>
            </span>
          </div>
          <button
            onClick={() => setDecayDismissed(true)}
            className="p-0.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors flex-shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* AI-suggested briefs from insight engine */}
      <AiSuggested workspaceId={workspaceId} onCreateBrief={handleCreateBrief} />

      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 border-b border-zinc-800 pb-0">
        {TABS.map(t => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? 'border-teal-400 text-teal-300'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}

        {/* Export dropdown */}
        <div className="ml-auto relative" ref={exportRef}>
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-zinc-500 hover:text-zinc-300 transition-colors rounded-md hover:bg-zinc-800/50"
          >
            <Download className="w-3 h-3" />
            Export
            <ChevronDown className={`w-3 h-3 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
          </button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 w-56 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl z-20 py-1 overflow-hidden">
              {EXPORTS.map(exp => (
                <div key={exp.key} className="flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 group">
                  <span className="text-xs text-zinc-300">{exp.label}</span>
                  <div className="flex items-center gap-1">
                    <button onClick={() => handleExport(exp.key, 'csv')} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-teal-300 hover:bg-teal-500/10 transition-colors">CSV</button>
                    <button onClick={() => handleExport(exp.key, 'json')} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 hover:text-teal-300 hover:bg-teal-500/10 transition-colors">JSON</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === 'planner' && (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
          <ContentPlanner key={`planner-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'briefs' && (
        <ContentBriefs key={`briefs-${workspaceId}`} workspaceId={workspaceId} onRequestCountChange={onRequestCountChange} fixContext={fixContext} />
      )}
      {activeTab === 'posts' && (
        <ContentManager key={`content-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {activeTab === 'subscriptions' && (
        <ContentSubscriptions key={`subs-${workspaceId}`} workspaceId={workspaceId} />
      )}
      {activeTab === 'architecture' && (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
          <SiteArchitecture key={`arch-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {activeTab === 'llms-txt' && (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
          <LlmsTxtGenerator key={`llms-${workspaceId}`} workspaceId={workspaceId} />
        </Suspense>
      )}
      {/* Floating help button */}
      <button
        onClick={() => setGuideOpen(true)}
        className="fixed bottom-6 right-6 z-30 w-10 h-10 rounded-full bg-zinc-800 border border-zinc-700 hover:border-teal-500/50 hover:bg-zinc-700 shadow-lg flex items-center justify-center transition-all group"
        title="Content Pipeline Guide"
      >
        <HelpCircle className="w-4.5 h-4.5 text-zinc-400 group-hover:text-teal-400 transition-colors" />
      </button>

      {/* Guide slide-over */}
      {guideOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/40" onClick={() => setGuideOpen(false)} />
          <div className="relative w-full max-w-md bg-zinc-950 border-l border-zinc-800 shadow-2xl overflow-y-auto animate-in slide-in-from-right">
            <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3.5 bg-zinc-950/95 backdrop-blur border-b border-zinc-800">
              <span className="text-sm font-semibold text-zinc-200">Content Pipeline Guide</span>
              <button onClick={() => setGuideOpen(false)} className="p-1 rounded-md hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <Suspense fallback={<div className="flex items-center justify-center py-12"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
                <ContentPipelineGuide />
              </Suspense>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
