import { useState, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CornerDownRight, Share2, AlertTriangle } from 'lucide-react';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { ErrorBoundary } from './ErrorBoundary';
import { RedirectManager } from './RedirectManager';
import { InternalLinks } from './InternalLinks';
import { Icon, cn } from './ui';

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<LinksTab>(() => {
    const param = searchParams.get('tab');
    return TABS.some(t => t.id === param) ? (param as LinksTab) : 'redirects';
  });

  // Clear ?tab= from URL on manual tab change so refresh shows last selection
  const handleTabChange = (id: LinksTab) => {
    setActiveTab(id);
    if (searchParams.has('tab')) {
      const next = new URLSearchParams(searchParams);
      next.delete('tab');
      setSearchParams(next, { replace: true });
    }
  };

  return (
    <div className="space-y-8">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 border-b border-[var(--brand-border)] pb-0">
        {TABS.map(t => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={cn('flex items-center gap-1.5 px-3 py-2 t-caption font-medium border-b-2 transition-colors -mb-px', active ? 'border-teal-400 text-accent-brand' : 'border-transparent text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]')}
            >
              <Icon as={t.icon} size="md" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'redirects' && (
        <RedirectManager key={`redirects-${siteId}`} siteId={siteId} workspaceId={workspaceId} />
      )}
      {activeTab === 'internal' && (
        <InternalLinks key={`internal-${siteId}`} siteId={siteId} workspaceId={workspaceId} />
      )}
      {activeTab === 'dead-links' && (
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center py-16"><div className="w-5 h-5 border-2 rounded-[var(--radius-pill)] animate-spin border-[var(--brand-border)] border-t-teal-400" /></div>}>
            <LinkChecker siteId={siteId} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
