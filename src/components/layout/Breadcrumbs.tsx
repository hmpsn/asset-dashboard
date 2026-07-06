import { useNavigate } from 'react-router-dom';
import { type Page, adminPath } from '../../routes';
import type { Workspace } from '../WorkspaceSelector';
import { NAV_REGISTRY_BY_ID } from '../../lib/navRegistry';
import { Button, ClickableRow, Icon, IconButton } from '../ui';
import { ArrowLeft, ChevronRight, Search, MessageSquare } from 'lucide-react';

// nav-registry-ok — fallback labels for redirect-only / legacy-folded Page
// values (seo-briefs, content, calendar, subscriptions,
// workspace-settings) that intentionally have no registry entry. A breadcrumb
// can still land on one of these via a stale bookmark, so we keep a label here
// to avoid rendering a raw slug. Identity/label/needsSite/description for all
// real nav surfaces comes from the registry (NAV_REGISTRY_BY_ID).
const LEGACY_TAB_LABELS: Record<string, string> = {
  'seo-briefs': 'Content Briefs',
  content: 'Content',
  calendar: 'Calendar',
  subscriptions: 'Subscriptions',
  'content-pipeline': 'Content Pipeline',
  'workspace-settings': 'Workspace Settings',
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
  const tabLabel = (t: Page): string => {
    const entry = NAV_REGISTRY_BY_ID[t];
    if (entry) return entry.label;
    return LEGACY_TAB_LABELS[t] || t;
  };

  return (
    <div className="flex items-center gap-1.5 px-5 py-2 border-b border-[var(--brand-border)] t-caption-sm min-h-[36px]">
      {selected && tab !== 'home' && (
        <IconButton
          onClick={() => navigate(adminPath(selected.id))}
          icon={ArrowLeft}
          label="Back to workspace home"
          variant="ghost"
          size="sm"
          className="-ml-1 mr-0.5 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]"
          title="Back to workspace home"
        />
      )}
      <Button
        onClick={() => navigate('/')}
        variant="ghost"
        size="sm"
        className={`font-medium transition-colors ${!selected ? 'text-teal-400' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]'}`}
      >
        Command Center
      </Button>
      {selected && (
        <>
          <span className="text-[var(--brand-text-dim)]">/</span>
          <div className="relative group">
            <Button variant="ghost" size="sm" className="font-medium text-[var(--brand-text)] hover:text-teal-400">
              {selected.webflowSiteName || selected.name}
              <Icon as={ChevronRight} size="sm" className="text-[var(--brand-text-muted)] rotate-90" />
            </Button>
            <div className="absolute top-full left-0 mt-1 w-48 max-h-[300px] overflow-y-auto bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-lg)] shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[var(--z-modal)] py-1">
              {workspaces.map(ws => (
                <ClickableRow
                  key={ws.id}
                  onClick={() => navigate(adminPath(ws.id))}
                  className={`w-full text-left px-3 py-1.5 t-caption-sm transition-colors ${
                    ws.id === selected.id ? 'text-teal-400 bg-teal-500/5' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
                  }`}
                >
                  <span className="truncate block">{ws.webflowSiteName || ws.name}</span>
                </ClickableRow>
              ))}
            </div>
          </div>
          {tab !== 'home' && (
            <>
              <span className="text-[var(--brand-text-dim)]">/</span>
              <span className="text-[var(--brand-text-muted)]">
                {tabLabel(tab)}
              </span>
            </>
          )}
        </>
      )}
      {!selected && tab !== 'home' && (
        <>
          <span className="text-[var(--brand-text-dim)]">/</span>
          <span className="text-[var(--brand-text-muted)]">
            {tabLabel(tab)}
          </span>
        </>
      )}

      {/* ── Header widgets (right side) ── */}
      <div className="ml-auto flex items-center gap-1">
        {/* Command Palette trigger */}
        <IconButton
          onClick={() => {
            const event = new KeyboardEvent('keydown', {
              key: 'k',
              metaKey: true,
              bubbles: true,
            });
            window.dispatchEvent(event);
          }}
          icon={Search}
          label="Command Palette"
          variant="ghost"
          size="sm"
          title="Command Palette (⌘K)"
          className="rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]"
        />
        {/* Requests widget */}
        {selected && (
          <Button
            onClick={() => selected && navigate(adminPath(selected.id, 'requests'))}
            icon={MessageSquare}
            variant="ghost"
            size="sm"
            title="Client Requests"
            className={`relative rounded-[var(--radius-lg)] ${tab === 'requests' ? 'text-teal-400 bg-teal-500/10' : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'}`}
          >
            {pendingContentRequests > 0 && (
              <span className="absolute -top-0.5 -right-0.5 t-micro font-bold px-1 py-0 rounded-[var(--radius-pill)] badge-span-ok bg-amber-500/90 text-[#0f1219] min-w-[14px] text-center leading-[14px]">
                {pendingContentRequests}
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  );
}

// Backward-compat export: a flat slug → label map derived from the registry
// plus the legacy fallback labels. Kept for existing consumers/tests; the
// registry is the source of truth.
const TAB_LABELS: Record<string, string> = {
  ...LEGACY_TAB_LABELS,
  ...Object.fromEntries(Object.values(NAV_REGISTRY_BY_ID).map((e) => [e.id, e.label])),
};

export { TAB_LABELS };
