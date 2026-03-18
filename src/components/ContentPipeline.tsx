import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { Clipboard, FileText, RefreshCw, Map, Bot, Download, ChevronDown } from 'lucide-react';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import type { FixContext } from '../App';

const SiteArchitecture = lazy(() => import('./SiteArchitecture').then(m => ({ default: m.SiteArchitecture })));
const LlmsTxtGenerator = lazy(() => import('./LlmsTxtGenerator').then(m => ({ default: m.LlmsTxtGenerator })));

interface Props {
  workspaceId: string;
  onRequestCountChange?: (count: number) => void;
  fixContext?: FixContext | null;
}

const TABS = [
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

export function ContentPipeline({ workspaceId, onRequestCountChange, fixContext }: Props) {
  const [activeTab, setActiveTab] = useState<PipelineTab>('briefs');
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

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
    </div>
  );
}
