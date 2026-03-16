import { useState } from 'react';
import { Clipboard, FileText, RefreshCw } from 'lucide-react';
import { ContentBriefs } from './ContentBriefs';
import { ContentManager } from './ContentManager';
import { ContentSubscriptions } from './ContentSubscriptions';
import type { FixContext } from '../App';

interface Props {
  workspaceId: string;
  onRequestCountChange?: (count: number) => void;
  fixContext?: FixContext | null;
}

const TABS = [
  { id: 'briefs' as const, label: 'Briefs', icon: Clipboard },
  { id: 'posts' as const, label: 'Posts', icon: FileText },
  { id: 'subscriptions' as const, label: 'Subscriptions', icon: RefreshCw },
];

type PipelineTab = typeof TABS[number]['id'];

export function ContentPipeline({ workspaceId, onRequestCountChange, fixContext }: Props) {
  const [activeTab, setActiveTab] = useState<PipelineTab>('briefs');

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
    </div>
  );
}
