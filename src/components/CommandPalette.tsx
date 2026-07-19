import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { anomalies, pageWeight, webflow } from '../api';
import {
  Search, Globe, Shield, Code2, FileText,
  Command, ArrowUp, ArrowDown, CornerDownLeft,
  Zap, LayoutTemplate, Grid3X3, Layers, Send, Pencil,
  MessageSquare, Trophy, Upload, RefreshCw, Gauge,
} from 'lucide-react';
import { type Workspace } from './WorkspaceSelector';
import { adminPath } from '../routes';
import {
  NAV_DESTINATION_REGISTRY, type AnyNavEntry, type NavGroupKey,
  resolveNavLabel, resolveNavPath, resolveRebuiltNavZoneLabel, isNavEntryHidden,
} from '../lib/navRegistry';
import type { FeatureFlagKey } from '../../shared/types/feature-flags';
import { useBackgroundTasks } from '../hooks/useBackgroundTasks';
import { useFeatureFlag } from '../hooks/useFeatureFlag';
import { useToast } from './Toast';
import { ClickableRow, ConfirmDialog, FormInput, Icon } from './ui';
import { BACKGROUND_JOB_TYPES } from '../../shared/types/background-jobs';

interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  icon: typeof Search;
  type: 'nav' | 'workspace' | 'action' | 'recent';
  action: () => void;
  disabled?: boolean;
}

interface CommandPaletteProps {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
}

export function isPaletteNavEntryAvailable(entry: AnyNavEntry, selectedWorkspace: Workspace | null): boolean {
  return resolveNavPath(entry, selectedWorkspace?.id) !== null;
}

/**
 * The workspace API has no demo/fixture discriminator. Keep the staging/test
 * names documented by the admin UX audit out of operator-facing switchers
 * until the model gains a first-class flag.
 */
export function isPaletteWorkspaceVisible(workspace: Pick<Workspace, 'name'>): boolean {
  const name = workspace.name.trim();
  return !/^cascade-debug/i.test(name)
    && !/^dbg/i.test(name)
    && !/^Trigger Check WS$/i.test(name)
    && !/^Check Set WS$/i.test(name);
}

// Legacy palette presentation stays byte-identical while the rebuilt shell is
// OFF. Flag-ON group labels resolve through REBUILT_NAV_ZONES in navRegistry.
// nav-registry-ok — this map is flag-OFF compatibility copy only.
const LEGACY_PALETTE_GROUP_LABELS: Record<NavGroupKey, string> = {
  home: '',
  monitoring: 'Monitoring',
  'site-health': 'Site Health',
  'seo-strategy': 'Strategy',
  optimization: 'Optimization',
  content: 'Content',
  admin: 'Admin',
  utility: '',
};

const RECENT_KEY = 'admin-palette-recent';
const MAX_RECENT = 5;

function getRecent(): string[] {
  try {
    const stored = localStorage.getItem(RECENT_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function addRecent(id: string) {
  try {
    const recent = getRecent().filter(r => r !== id);
    recent.unshift(id);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
  } catch (err) { console.error('CommandPalette operation failed:', err); }
}

function fuzzyMatch(text: string, query: string): boolean {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let qi = 0;
  for (let i = 0; i < lower.length && qi < q.length; i++) {
    if (lower[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function CommandPalette({ workspaces, selectedWorkspace, onSelectWorkspace }: CommandPaletteProps) {
  const navigate = useNavigate();
  const rebuildShellEnabled = useFeatureFlag('ui-rebuild-shell');
  const { toast } = useToast();
  const { startJob } = useBackgroundTasks();
  const [open, setOpen] = useState(false);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K to toggle
  // keydown-ok: this handler intentionally fires from input fields. The
  // standard isContentEditable guard would break two desired behaviours:
  //   1. Cmd/Ctrl+K is a global "open command palette" combo and must
  //      fire from any focused field (Slack/Linear/Notion convention).
  //   2. Escape closes the palette from within its own input — the
  //      palette IS an editable target by design, and gating on
  //      isContentEditable would prevent the dismiss interaction.
  // The Escape branch self-gates on `open === true`, so it never fires
  // when the palette is closed; the only stray-input scenario it could
  // hit is "user has focus in some other input *while* the modal is
  // also open", which is impossible because the palette modal grabs
  // focus on open.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(prev => {
          if (!prev) { setQuery(''); setSelectedIndex(0); }
          return !prev;
        });
      }
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown); // keydown-ok
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Build items list
  const items: PaletteItem[] = useMemo(() => {
    const result: PaletteItem[] = [];

    // Navigation items — driven by the nav registry. Resolve the shell flag from
    // the same global source as App so the palette cannot advertise folded legacy
    // homes or stale labels while the rebuilt shell is active.
    const flagResolver = (flag: FeatureFlagKey) => (
      flag === 'ui-rebuild-shell' ? rebuildShellEnabled : false
    );
    for (const entry of NAV_DESTINATION_REGISTRY) {
      if (isNavEntryHidden(entry, flagResolver)) continue;
      if (!isPaletteNavEntryAvailable(entry, selectedWorkspace)) continue;
      const path = resolveNavPath(entry, selectedWorkspace?.id);
      if (!path) continue;
      const label = resolveNavLabel(entry, flagResolver);
      const groupLabel = rebuildShellEnabled
        ? resolveRebuiltNavZoneLabel(entry.id)
        : LEGACY_PALETTE_GROUP_LABELS[entry.group];
      result.push({
        id: `nav:${entry.id}`,
        label,
        sub: groupLabel || undefined,
        icon: entry.icon,
        type: 'nav',
        action: () => { navigate(path); addRecent(`nav:${entry.id}`); },
      });
    }

    // Workspaces. There is no first-class fixture flag in the workspace model,
    // so the documented audit predicate is the narrowest honest filter.
    for (const ws of workspaces.filter(isPaletteWorkspaceVisible)) {
      result.push({
        id: `ws:${ws.id}`,
        label: ws.name,
        sub: ws.webflowSiteName || 'Workspace',
        icon: Globe,
        type: 'workspace',
        action: () => { onSelectWorkspace(ws); navigate(adminPath(ws.id)); addRecent(`ws:${ws.id}`); },
      });
    }

    // Global action: the server endpoint intentionally scans every workspace.
    result.push({
      id: 'action:scan-anomalies',
      label: 'Scan All Workspaces for Anomalies',
      sub: 'Run anomaly detection across all workspaces',
      icon: Zap,
      type: 'action',
      action: () => {
        addRecent('action:scan-anomalies');
        void anomalies.scan()
          .then(() => { toast('Anomaly scan started', 'success'); })
          .catch(() => { toast('Anomaly scan failed. Try again later.', 'error'); });
      },
    });

    const pushWorkspaceAction = (config: {
      id: string;
      label: string;
      sub: string;
      icon: PaletteItem['icon'];
      requiresSite?: boolean;
      missingSiteSub?: string;
      handler: (workspace: Workspace) => void;
    }) => {
      const disabled = !selectedWorkspace || (config.requiresSite && !selectedWorkspace.webflowSiteId);
      const sub = !selectedWorkspace
        ? 'No workspace selected'
        : config.requiresSite && !selectedWorkspace.webflowSiteId
          ? config.missingSiteSub ?? 'Link a Webflow site to use this action'
          : config.sub;
      result.push({
        id: config.id,
        label: config.label,
        sub,
        icon: config.icon,
        type: 'action',
        disabled,
        action: () => {
          if (disabled || !selectedWorkspace) return;
          addRecent(config.id);
          config.handler(selectedWorkspace);
        },
      });
    };

    pushWorkspaceAction({
      id: 'action:run-audit',
      label: 'Run Site Audit',
      sub: 'Start SEO site audit',
      icon: Shield,
      requiresSite: true,
      missingSiteSub: 'Link a site to run audits',
      handler: (workspace) => {
        void startJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, {
          siteId: workspace.webflowSiteId,
          workspaceId: workspace.id,
        }).then((jobId) => {
          toast(
            jobId ? 'Audit started — check the notification bell for progress' : 'Could not start audit. Try again from the Site Audit tab.',
            jobId ? 'success' : 'error',
          );
        }).catch(() => { toast('Could not start audit. Try again from the Site Audit tab.', 'error'); });
      },
    });

    // Legacy navigation-only rows keep their capability but say what they do.
    pushWorkspaceAction({ id: 'action:generate-schema', label: 'Open Schema Generator', sub: 'Open schema tools', icon: Code2, requiresSite: true, handler: (workspace) => navigate(adminPath(workspace.id, 'seo-schema')) });
    pushWorkspaceAction({ id: 'action:create-brief', label: 'Open Content Briefs', sub: 'Open saved content briefs', icon: FileText, requiresSite: true, handler: (workspace) => navigate(`${adminPath(workspace.id, 'content-pipeline')}?tab=briefs`) });
    pushWorkspaceAction({ id: 'action:create-template', label: 'Open Content Template Planner', sub: 'Open the content planner', icon: LayoutTemplate, requiresSite: true, handler: (workspace) => navigate(`${adminPath(workspace.id, 'content-pipeline')}?tab=planner`) });
    pushWorkspaceAction({ id: 'action:build-matrix', label: 'Open Content Matrix Builder', sub: 'Open matrix planning', icon: Grid3X3, requiresSite: true, handler: (workspace) => navigate(`${adminPath(workspace.id, 'content-pipeline')}?tab=planner`) });
    pushWorkspaceAction({ id: 'action:view-content-plan', label: 'Open Content Plan', sub: 'Open the planner overview', icon: Layers, requiresSite: true, handler: (workspace) => navigate(`${adminPath(workspace.id, 'content-pipeline')}?tab=planner`) });

    pushWorkspaceAction({
      id: 'action:review-staged-moves',
      label: 'Review & send staged moves',
      sub: 'Open staged moves for review before sending',
      icon: Send,
      requiresSite: true,
      handler: (workspace) => navigate(`${adminPath(workspace.id, 'seo-strategy')}?lens=moves`),
    });
    pushWorkspaceAction({
      id: 'action:fix-missing-metadata',
      label: 'Fix missing titles/metas',
      sub: 'Open missing titles first; Missing meta is adjacent',
      icon: Pencil,
      requiresSite: true,
      handler: (workspace) => navigate(`${adminPath(workspace.id, 'seo-editor')}?filter=needs-title`),
    });
    pushWorkspaceAction({
      id: 'action:reply-client-requests',
      label: 'Reply to client requests',
      sub: 'Open unanswered client requests',
      icon: MessageSquare,
      handler: (workspace) => navigate(`${adminPath(workspace.id, 'requests')}?tab=requests`), // inbox-legacy-filter-literal-ok -- admin Requests page deep-link, not client inbox
    });
    pushWorkspaceAction({
      id: 'action:record-published-work',
      label: 'Record published work',
      sub: 'Open workspace action results',
      icon: Trophy,
      handler: (workspace) => navigate(adminPath(workspace.id, 'outcomes')),
    });
    pushWorkspaceAction({
      id: 'action:publish-site',
      label: 'Publish site to Webflow',
      sub: 'Confirm before publishing the linked site',
      icon: Upload,
      requiresSite: true,
      handler: () => setPublishConfirmOpen(true),
    });
    pushWorkspaceAction({
      id: 'action:refresh-strategy',
      label: 'Refresh strategy',
      sub: 'Start a full strategy generation job',
      icon: RefreshCw,
      requiresSite: true,
      handler: (workspace) => {
        void startJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
          workspaceId: workspace.id,
          mode: 'full',
        }).then((jobId) => {
          toast(jobId ? 'Strategy generation started' : 'Strategy job did not start', jobId ? 'success' : 'error');
        }).catch(() => { toast('Strategy job did not start', 'error'); });
      },
    });
    pushWorkspaceAction({
      id: 'action:rerun-pagespeed',
      label: 'Re-run PageSpeed',
      sub: 'Test the top 3 pages on mobile',
      icon: Gauge,
      requiresSite: true,
      handler: (workspace) => {
        toast('Mobile PageSpeed bulk test started', 'info');
        void pageWeight.pagespeedBulk(workspace.webflowSiteId ?? '', 'mobile', 3, workspace.id)
          .then(() => { toast('Mobile PageSpeed test complete', 'success'); })
          .catch(() => { toast('PageSpeed bulk test failed', 'error'); });
      },
    });
    pushWorkspaceAction({
      id: 'action:new-content-brief',
      label: 'New content brief',
      sub: 'Open the brief creation workspace',
      icon: FileText,
      requiresSite: true,
      handler: (workspace) => navigate(`${adminPath(workspace.id, 'content-pipeline')}?tab=briefs`),
    });

    return result;
  }, [workspaces, selectedWorkspace, onSelectWorkspace, navigate, rebuildShellEnabled, startJob, toast]);

  const handlePublishSite = useCallback(() => {
    if (!selectedWorkspace?.webflowSiteId) return;
    setPublishConfirmOpen(false);
    void webflow.publish(selectedWorkspace.webflowSiteId, selectedWorkspace.id)
      .then(() => { toast('Site publish started', 'success'); })
      .catch(() => { toast('Site publish failed', 'error'); });
  }, [selectedWorkspace, toast]);

  // Filter items by query
  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Show recent items first, then all nav items
      const recent = getRecent();
      const recentItems = recent.map(id => items.find(i => i.id === id)).filter(Boolean) as PaletteItem[];
      const recentIds = new Set(recent);
      const rest = items.filter(i => !recentIds.has(i.id));
      return [
        ...recentItems.map(i => ({ ...i, type: 'recent' as const })),
        ...rest,
      ];
    }
    return items.filter(i =>
      fuzzyMatch(i.label, query) ||
      (i.sub && fuzzyMatch(i.sub, query))
    );
  }, [query, items]);

  // Reset selection when filtered items change
  useEffect(() => { setSelectedIndex(0); }, [filtered.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter' && filtered[selectedIndex] && !filtered[selectedIndex].disabled) {
      e.preventDefault();
      filtered[selectedIndex].action();
      setOpen(false);
    }
  }, [filtered, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Group items by type for display
  const recentGroup = filtered.filter(i => i.type === 'recent');
  const navGroup = filtered.filter(i => i.type === 'nav');
  const wsGroup = filtered.filter(i => i.type === 'workspace');
  const actionGroup = filtered.filter(i => i.type === 'action');

  let globalIdx = -1;
  const renderItem = (item: PaletteItem) => {
    globalIdx++;
    const idx = globalIdx;
    const ItemIcon = item.icon;
    const isSelected = idx === selectedIndex;
    return (
      <ClickableRow
        key={item.id + (item.type === 'recent' ? '-recent' : '')}
        onClick={() => { item.action(); setOpen(false); }}
        onMouseEnter={() => setSelectedIndex(idx)}
        disabled={item.disabled}
        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
          isSelected ? 'bg-teal-500/10 text-teal-300' : 'text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
        }`}
      >
        <Icon as={ItemIcon} size="md" className={`flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-[var(--brand-text-muted)]'}`} />
        <div className="flex-1 min-w-0">
          <div className="t-caption font-medium truncate">{item.label}</div>
          {item.sub && <div className="t-caption-sm text-[var(--brand-text-muted)] truncate">{item.sub}</div>}
        </div>
        {item.type === 'workspace' && <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">workspace</span>}
        {item.type === 'action' && <span className="t-caption-sm text-[var(--brand-text-muted)] flex-shrink-0">action</span>}
      </ClickableRow>
    );
  };

  const renderGroup = (label: string, groupItems: PaletteItem[]) => {
    if (groupItems.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1.5 t-caption-sm font-semibold uppercase tracking-wider text-[var(--brand-text-muted)]">{label}</div>
        {groupItems.map(renderItem)}
      </div>
    );
  };

  return (
    <>
      {open && (
      <div className="fixed inset-0 z-[var(--z-command-palette)] flex items-start justify-center pt-[15vh]" // fixed-inset-ok — command palette overlay
      onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      {/* pr-check-disable-next-line -- modal container */}
      <div
        className="relative w-full max-w-lg bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-xl)] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--brand-border)]">
          <Icon as={Search} size="md" className="text-[var(--brand-text-muted)] flex-shrink-0" />
          <FormInput
            ref={inputRef}
            value={query}
            onChange={setQuery}
            onKeyDown={handleKeyDown}
            placeholder="Search tools, workspaces, actions..."
            className="flex-1 t-body outline-none"
          />
          <kbd className="flex-shrink-0 t-caption-sm font-medium text-[var(--brand-text-muted)] bg-[var(--surface-3)] px-1.5 py-0.5 rounded border border-[var(--brand-border-hover)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center t-caption text-[var(--brand-text-muted)]">
              No results for "{query}"
            </div>
          ) : query.trim() ? (
            // Flat list when searching
            filtered.map(renderItem)
          ) : (
            // Grouped list when browsing
            <>
              {renderGroup('Recent', recentGroup)}
              {renderGroup('Navigation', navGroup)}
              {renderGroup('Workspaces', wsGroup)}
              {renderGroup('Actions', actionGroup)}
            </>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--brand-border)] bg-[var(--surface-2)]">
          <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon as={ArrowUp} size="sm" /><Icon as={ArrowDown} size="sm" /> navigate
          </div>
          <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon as={CornerDownLeft} size="sm" /> select
          </div>
          <div className="flex items-center gap-1 t-caption-sm text-[var(--brand-text-muted)]">
            <Icon as={Command} size="sm" />K toggle
          </div>
        </div>
      </div>
      </div>
      )}
      <ConfirmDialog
        open={publishConfirmOpen}
        title="Publish site to Webflow?"
        message={`Publish ${selectedWorkspace?.webflowSiteName || selectedWorkspace?.name || 'the linked site'} to Webflow now?`}
        confirmLabel="Publish site"
        onCancel={() => setPublishConfirmOpen(false)}
        onConfirm={handlePublishSite}
      />
    </>
  );
}
