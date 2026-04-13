import { useState, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CornerDownRight, Share2, AlertTriangle } from 'lucide-react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { ErrorBoundary } from './ErrorBoundary';
import { RedirectManager } from './RedirectManager';
import { InternalLinks } from './InternalLinks';

const LinkChecker = lazyWithRetry(() => import('./LinkChecker').then(m => ({ default: m.LinkChecker })));

interface Props {
  siteId: string;
  workspaceId: string;
}

const TABS = [
  { id: 'redirects' as const, label: 'Redirects', icon: CornerDownRight },
  { id: 'internal' as const, label: 'Internal Links', icon: Share2 },
  { id: 'dead-links' as const, label: 'Dead Links', icon: AlertTriangle },
];

type LinksTab = typeof TABS[number]['id'];

export function LinksPanel({ siteId, workspaceId }: Props) {
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<LinksTab>(() => {
    const param = searchParams.get('tab');
    return TABS.some(t => t.id === param) ? (param as LinksTab) : 'redirects';
  });

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
      {activeTab === 'dead-links' && (
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-full animate-spin border-zinc-800 border-t-teal-400" /></div>}>
            <LinkChecker siteId={siteId} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
