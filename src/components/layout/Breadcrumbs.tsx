import { useNavigate } from 'react-router-dom';
import { type Page, adminPath } from '../../routes';
import type { Workspace } from '../WorkspaceSelector';
import { Icon } from '../ui';
import { ArrowLeft, ChevronRight, Search, MessageSquare } from 'lucide-react';

const TAB_LABELS: Record<string, string> = {
  home: 'Home', brief: 'Meeting Brief', media: 'Assets', 'seo-audit': 'Site Audit', 'seo-editor': 'SEO Editor',
  links: 'Links', 'seo-strategy': 'Strategy', 'page-intelligence': 'Page Intelligence',
  'seo-schema': 'Schema', 'seo-briefs': 'Content Briefs', content: 'Content', calendar: 'Calendar', subscriptions: 'Subscriptions', brand: 'Brand & AI', 'content-pipeline': 'Content Pipeline',
  'seo-ranks': 'Rank Tracker', 'analytics-hub': 'Search & Traffic', performance: 'Performance', 'content-perf': 'Content Performance',
  rewrite: 'Page Rewriter', 'workspace-settings': 'Workspace Settings', prospect: 'Prospect', roadmap: 'Roadmap',
  'ai-usage': 'AI Usage', requests: 'Requests', settings: 'Settings', revenue: 'Revenue',
  outcomes: 'Action Results', 'outcomes-overview': 'Team Outcomes', features: 'Features',
};

interface BreadcrumbsProps {
  workspaces: Workspace[];
  selected: Workspace | null;
  tab: Page;
  pendingContentRequests: number;
}

export function Breadcrumbs({
  workspaces, selected, tab, pendingContentRequests,
}: BreadcrumbsProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--brand-border)] t-caption-sm min-h-[36px]">
      {selected && tab !== 'home' && (
        <button
          onClick={() => navigate(adminPath(selected.id))}
          className="p-1 -ml-1 mr-0.5 rounded text-zinc-600 hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
          title="Back to workspace home"
        >
          <Icon as={ArrowLeft} size="sm" />
        </button>
      )}
      <button
        onClick={() => navigate('/')}
        className={`font-medium transition-colors ${!selected ? 'text-teal-400' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
      >
        Command Center
      </button>
      {selected && (
        <>
          <span className="text-zinc-700">/</span>
          <div className="relative group">
            <button className="font-medium text-[var(--brand-text)] hover:text-teal-400 transition-colors flex items-center gap-1">
              {selected.webflowSiteName || selected.name}
              <Icon as={ChevronRight} size="sm" className="text-zinc-600 rotate-90" />
            </button>
            <div className="absolute top-full left-0 mt-1 w-48 max-h-[300px] overflow-y-auto bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[var(--z-modal)] py-1">
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => navigate(adminPath(ws.id))}
                  className={`w-full text-left px-3 py-1.5 t-caption-sm transition-colors ${
                    ws.id === selected.id ? 'text-teal-400 bg-teal-500/5' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <span className="truncate block">{ws.webflowSiteName || ws.name}</span>
                </button>
              ))}
            </div>
          </div>
          {tab !== 'home' && (
            <>
              <span className="text-zinc-700">/</span>
              <span className="text-[var(--brand-text-muted)]">
                {TAB_LABELS[tab] || tab}
              </span>
            </>
          )}
        </>
      )}
      {!selected && tab !== 'home' && (
        <>
          <span className="text-zinc-700">/</span>
          <span className="text-[var(--brand-text-muted)]">
            {TAB_LABELS[tab] || tab}
          </span>
        </>
      )}

      {/* ── Header widgets (right side) ── */}
      <div className="ml-auto flex items-center gap-1">
        {/* Command Palette trigger */}
        <button
          onClick={() => {
            const event = new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: true,
              bubbles: true,
            });
            window.dispatchEvent(event);
          }}
          title="Command Palette (⌘K)"
          className="p-1.5 rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-all"
        >
          <Icon as={Search} size="sm" />
        </button>
        {/* Requests widget */}
        {selected && (
          <button
            onClick={() => selected && navigate(adminPath(selected.id, 'requests'))}
            title="Client Requests"
            className={`relative p-1.5 rounded-[var(--radius-lg)] transition-all ${tab === 'requests' ? 'text-teal-400 bg-teal-500/10' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
          >
            <Icon as={MessageSquare} size="sm" />
            {pendingContentRequests > 0 && (
              <span className="absolute -top-0.5 -right-0.5 t-micro font-bold px-1 py-0 rounded-full bg-amber-500/90 text-[#0f1219] min-w-[14px] text-center leading-[14px]">
                {pendingContentRequests}
              </span>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export { TAB_LABELS };
