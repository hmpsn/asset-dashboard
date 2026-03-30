import { useState } from 'react';
import { CornerDownRight, Share2 } from 'lucide-react';
import { RedirectManager } from './RedirectManager';
import { InternalLinks } from './InternalLinks';

interface Props {
  siteId: string;
  workspaceId: string;
}

const TABS = [
  { id: 'redirects' as const, label: 'Redirects', icon: CornerDownRight },
  { id: 'internal' as const, label: 'Internal Links', icon: Share2 },
];

type LinksTab = typeof TABS[number]['id'];

export function LinksPanel({ siteId, workspaceId }: Props) {
  const [activeTab, setActiveTab] = useState<LinksTab>('redirects');

  return (
    <div className="space-y-8">
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
      {activeTab === 'redirects' && (
        <RedirectManager key={`redirects-${siteId}`} siteId={siteId} />
      )}
      {activeTab === 'internal' && (
        <InternalLinks key={`internal-${siteId}`} siteId={siteId} workspaceId={workspaceId} />
      )}
    </div>
  );
}
