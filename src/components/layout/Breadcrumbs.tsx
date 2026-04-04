import { useNavigate } from 'react-router-dom';
import { type Page, adminPath } from '../../routes';
import type { Workspace } from '../WorkspaceSelector';
import { ArrowLeft, ChevronRight, Search, MessageSquare } from 'lucide-react';
import { NotificationBell } from '../NotificationBell';

const TAB_LABELS: Record<string, string> = {
  home: 'Home', media: 'Assets', 'seo-audit': 'Site Audit', 'seo-editor': 'SEO Editor',
  links: 'Links', 'seo-strategy': 'Strategy',
  'seo-schema': 'Schema', 'seo-briefs': 'Content Briefs', content: 'Content', calendar: 'Calendar', subscriptions: 'Subscriptions', brand: 'Brand & AI', 'content-pipeline': 'Content Pipeline',
  'seo-ranks': 'Rank Tracker', 'analytics-hub': 'Analytics', performance: 'Performance', 'content-perf': 'Content Performance',
  rewrite: 'Page Rewriter', 'workspace-settings': 'Workspace Settings', prospect: 'Prospect', roadmap: 'Roadmap',
  'ai-usage': 'AI Usage', requests: 'Requests', settings: 'Settings', revenue: 'Revenue',
  outcomes: 'Outcomes', 'outcomes-overview': 'Outcomes Overview',
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
    <div className="flex items-center gap-1.5 px-5 py-2 border-b border-zinc-800 text-[11px] min-h-[36px]">
      {selected && tab !== 'home' && (
        <button
          onClick={() => navigate(adminPath(selected.id))}
          className="p-1 -ml-1 mr-0.5 rounded text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          title="Back to workspace home"
        >
          <ArrowLeft className="w-3 h-3" />
        </button>
      )}
      <button
        onClick={() => navigate('/')}
        className={`font-medium transition-colors ${!selected ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}
      >
        Command Center
      </button>
      {selected && (
        <>
          <span className="text-zinc-700">/</span>
          <div className="relative group">
            <button className="font-medium text-zinc-300 hover:text-teal-400 transition-colors flex items-center gap-1">
              {selected.webflowSiteName || selected.name}
              <ChevronRight className="w-2.5 h-2.5 text-zinc-600 rotate-90" />
            </button>
            <div className="absolute top-full left-0 mt-1 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1">
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => navigate(adminPath(ws.id))}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    ws.id === selected.id ? 'text-teal-400 bg-teal-500/5' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
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
              <span className="text-zinc-500">
                {TAB_LABELS[tab] || tab}
              </span>
            </>
          )}
        </>
      )}
      {!selected && tab !== 'home' && (
        <>
          <span className="text-zinc-700">/</span>
          <span className="text-zinc-500">
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
          className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
        >
          <Search className="w-3.5 h-3.5" />
        </button>
        {/* Requests widget */}
        {selected && (
          <button
            onClick={() => selected && navigate(adminPath(selected.id, 'requests'))}
            title="Client Requests"
            className={`relative p-1.5 rounded-lg transition-all ${tab === 'requests' ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            {pendingContentRequests > 0 && (
              <span className="absolute -top-0.5 -right-0.5 text-[9px] font-bold px-1 py-0 rounded-full bg-amber-500/90 text-[#0f1219] min-w-[14px] text-center leading-[14px]">
                {pendingContentRequests}
              </span>
            )}
          </button>
        )}
        {/* Notification bell */}
        <NotificationBell onSelectWorkspace={(wsId) => navigate(adminPath(wsId))} workspaceId={selected?.id} />
      </div>
    </div>
  );
}

export { TAB_LABELS };
