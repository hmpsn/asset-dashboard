import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { Clipboard, FileText, RefreshCw, Map, Bot, Download, ChevronDown, Layers, HelpCircle } from 'lucide-react';
import { contentBriefs, contentPosts, contentMatrices } from '../api/content';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import type { FixContext } from '../App';

const SiteArchitecture = lazy(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));
const LlmsTxtGenerator = lazy(() => import('./LlmsTxtGenerator').then(m => ({ default: m.LlmsTxtGenerator })));
const ContentPlanner = lazy(() => import('./ContentPlanner').then(m => ({ default: m.ContentPlanner })));
const ContentPipelineGuide = lazy(() => import('./ContentPipelineGuide').then(m => ({ default: m.ContentPipelineGuide })));

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
  { id: 'guide' as const, label: 'Guide', icon: HelpCircle },
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

export function ContentPipeline({ workspaceId, onRequestCountChange, fixContext }: Props) {
  const [activeTab, setActiveTab] = useState<PipelineTab>('briefs');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [summary, setSummary] = useState<PipelineSummary | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      const [briefs, posts, matrices] = await Promise.all([
        contentBriefs.list(workspaceId).catch(() => []),
        contentPosts.list(workspaceId).catch(() => []),
        contentMatrices.list(workspaceId).catch(() => []),
      ]);
      const briefArr = Array.isArray(briefs) ? briefs : [];
      const postArr = Array.isArray(posts) ? posts : [];
      const matrixArr = Array.isArray(matrices) ? matrices as { cells?: { status?: string }[] }[] : [];
      const allCells = matrixArr.flatMap(m => m.cells || []);
      setSummary({
        briefs: briefArr.length,
        posts: postArr.length,
        matrices: matrixArr.length,
        cells: allCells.length,
        published: allCells.filter(c => c.status === 'published').length,
      });
    } catch { /* silent */ }
  }, [workspaceId]);

  useEffect(() => { void fetchSummary(); }, [fetchSummary]);

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

  return (
    <div className="space-y-4">
      {/* Health summary bar */}
      {summary && (summary.briefs > 0 || summary.matrices > 0) && (
        <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900 rounded-xl border border-zinc-800 text-[11px] text-zinc-400">
          {summary.briefs > 0 && <span className="flex items-center gap-1"><Clipboard className="w-3 h-3 text-teal-400" /><span className="font-medium text-zinc-300">{summary.briefs}</span> brief{summary.briefs !== 1 ? 's' : ''}</span>}
          {summary.posts > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><FileText className="w-3 h-3 text-amber-400" /><span className="font-medium text-zinc-300">{summary.posts}</span> post{summary.posts !== 1 ? 's' : ''}</span></>}
          {summary.matrices > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><Layers className="w-3 h-3 text-violet-400" /><span className="font-medium text-zinc-300">{summary.matrices}</span> matri{summary.matrices !== 1 ? 'ces' : 'x'}</span></>}
          {summary.cells > 0 && <><span className="text-zinc-700">&middot;</span><span className="flex items-center gap-1"><span className="font-medium text-zinc-300">{summary.cells}</span> cell{summary.cells !== 1 ? 's' : ''}</span>{summary.published > 0 && <span className="text-green-400 ml-0.5">({Math.round(summary.published / summary.cells * 100)}% published)</span>}</>}
        </div>
      )}

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
      {activeTab === 'guide' && (
        <Suspense fallback={<div className="flex items-center justify-center py-24"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
          <ContentPipelineGuide />
        </Suspense>
      )}
    </div>
  );
}
