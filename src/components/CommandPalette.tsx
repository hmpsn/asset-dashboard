import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { auditSchedules, anomalies } from '../api';
import {
  Search, Globe, BarChart3, Shield, Gauge, Pencil, Link2,
  Target, Code2, Clipboard, Image, Flag, TrendingUp, Sparkles, FileText,
  LayoutDashboard, Settings, Command, ArrowUp, ArrowDown, CornerDownLeft,
  Zap, FileSearch, MessageSquare, LayoutTemplate, Grid3X3, ListChecks, Layers, Trophy,
} from 'lucide-react';
import { type Workspace } from './WorkspaceSelector';
import { type Page, adminPath } from '../routes';

interface PaletteItem {
  id: string;
  label: string;
  sub?: string;
  icon: typeof Search;
  type: 'nav' | 'workspace' | 'action' | 'recent';
  action: () => void;
}

interface CommandPaletteProps {
  workspaces: Workspace[];
  selectedWorkspace: Workspace | null;
  onSelectWorkspace: (ws: Workspace) => void;
}

const NAV_ITEMS: Array<{ id: Page; label: string; icon: typeof Search; group: string; needsSite?: boolean }> = [
  { id: 'home', label: 'Home', icon: LayoutDashboard, group: '' },
  { id: 'analytics-hub', label: 'Analytics', icon: BarChart3, group: 'Analytics', needsSite: true },
  { id: 'seo-ranks', label: 'Rank Tracker', icon: TrendingUp, group: 'Analytics', needsSite: true },
  { id: 'seo-audit', label: 'Site Audit', icon: Globe, group: 'Site Health', needsSite: true },
  { id: 'performance', label: 'Performance', icon: Gauge, group: 'Site Health', needsSite: true },
  { id: 'links', label: 'Links', icon: Link2, group: 'Site Health', needsSite: true },
  { id: 'media', label: 'Assets', icon: Image, group: 'Site Health' },
  { id: 'brand', label: 'Brand & AI', icon: Sparkles, group: 'SEO' },
  { id: 'seo-strategy', label: 'Strategy', icon: Target, group: 'SEO', needsSite: true },
  { id: 'page-intelligence', label: 'Page Intelligence', icon: Search, group: 'SEO', needsSite: true },
  { id: 'seo-editor', label: 'SEO Editor', icon: Pencil, group: 'SEO', needsSite: true },
  { id: 'seo-schema', label: 'Schema', icon: Code2, group: 'SEO', needsSite: true },
  { id: 'seo-briefs', label: 'Content Briefs', icon: Clipboard, group: 'Content', needsSite: true },
  { id: 'content', label: 'Content', icon: FileText, group: 'Content', needsSite: true },
  { id: 'content-pipeline', label: 'Content Pipeline', icon: ListChecks, group: 'Content', needsSite: true },
  { id: 'content-perf', label: 'Content Performance', icon: BarChart3, group: 'Content', needsSite: true },
  { id: 'requests', label: 'Requests', icon: MessageSquare, group: '' },
  { id: 'settings', label: 'Settings', icon: Settings, group: '' },
  { id: 'prospect', label: 'Prospect', icon: FileSearch, group: '' },
  { id: 'roadmap', label: 'Roadmap', icon: Shield, group: '' },
  { id: 'features', label: 'Feature Library', icon: Layers, group: '' },
  { id: 'outcomes', label: 'Outcomes', icon: Trophy, group: 'Analytics' },
  { id: 'outcomes-overview', label: 'Outcomes Overview', icon: BarChart3, group: 'Analytics' },
];

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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘K / Ctrl+K to toggle
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
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Focus input when opened
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  // Build items list
  const items: PaletteItem[] = useMemo(() => {
    const result: PaletteItem[] = [];

    // Navigation items
    for (const nav of NAV_ITEMS) {
      result.push({
        id: `nav:${nav.id}`,
        label: nav.label,
        sub: nav.group || undefined,
        icon: nav.icon,
        type: 'nav',
        action: () => { const GLOBAL = new Set(['settings', 'roadmap', 'prospect', 'ai-usage', 'features', 'outcomes-overview']); if (GLOBAL.has(nav.id) || selectedWorkspace) { navigate(adminPath(selectedWorkspace?.id || '', nav.id)); } addRecent(`nav:${nav.id}`); },
      });
    }

    // Workspaces
    for (const ws of workspaces) {
      result.push({
        id: `ws:${ws.id}`,
        label: ws.name,
        sub: ws.webflowSiteName || 'Workspace',
        icon: Globe,
        type: 'workspace',
        action: () => { onSelectWorkspace(ws); navigate(adminPath(ws.id)); addRecent(`ws:${ws.id}`); },
      });
    }

    // Quick actions (only if a workspace is selected)
    if (selectedWorkspace) {
      result.push({
        id: 'action:run-audit',
        label: 'Run Audit',
        sub: 'Start SEO site audit',
        icon: Shield,
        type: 'action',
        action: () => { auditSchedules.enable(selectedWorkspace!.id); addRecent('action:run-audit'); },
      });
      result.push({
        id: 'action:generate-schema',
        label: 'Generate Schema',
        sub: 'Create schema for current page',
        icon: Code2,
        type: 'action',
        action: () => { navigate(adminPath(selectedWorkspace!.id, 'seo-schema')); addRecent('action:generate-schema'); },
      });
      result.push({
        id: 'action:create-brief',
        label: 'Create Brief',
        sub: 'Generate content brief for keyword',
        icon: FileText,
        type: 'action',
        action: () => { navigate(adminPath(selectedWorkspace!.id, 'seo-briefs')); addRecent('action:create-brief'); },
      });
      result.push({
        id: 'action:scan-anomalies',
        label: 'Scan for Anomalies',
        sub: 'Run anomaly detection now',
        icon: Zap,
        type: 'action',
        action: () => { anomalies.scan(); addRecent('action:scan-anomalies'); },
      });
      result.push({
        id: 'action:create-template',
        label: 'Create Content Template',
        sub: 'Open the content planner',
        icon: LayoutTemplate,
        type: 'action',
        action: () => { navigate(adminPath(selectedWorkspace!.id, 'content-pipeline')); addRecent('action:create-template'); },
      });
      result.push({
        id: 'action:build-matrix',
        label: 'Build Content Matrix',
        sub: 'Plan content at scale',
        icon: Grid3X3,
        type: 'action',
        action: () => { navigate(adminPath(selectedWorkspace!.id, 'content-pipeline')); addRecent('action:build-matrix'); },
      });
    }

    return result;
  }, [workspaces, selectedWorkspace, onSelectWorkspace, navigate]);

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
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
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

  if (!open) return null;

  // Group items by type for display
  const recentGroup = filtered.filter(i => i.type === 'recent');
  const navGroup = filtered.filter(i => i.type === 'nav');
  const wsGroup = filtered.filter(i => i.type === 'workspace');
  const actionGroup = filtered.filter(i => i.type === 'action');

  let globalIdx = -1;
  const renderItem = (item: PaletteItem) => {
    globalIdx++;
    const idx = globalIdx;
    const Icon = item.icon;
    const isSelected = idx === selectedIndex;
    return (
      <button
        key={item.id + (item.type === 'recent' ? '-recent' : '')}
        onClick={() => { item.action(); setOpen(false); }}
        onMouseEnter={() => setSelectedIndex(idx)}
        className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
          isSelected ? 'bg-teal-500/10 text-teal-300' : 'text-zinc-300 hover:bg-zinc-800/50'
        }`}
      >
        <Icon className={`w-4 h-4 flex-shrink-0 ${isSelected ? 'text-teal-400' : 'text-zinc-500'}`} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">{item.label}</div>
          {item.sub && <div className="text-[10px] text-zinc-500 truncate">{item.sub}</div>}
        </div>
        {item.type === 'workspace' && <span className="text-[10px] text-zinc-600 flex-shrink-0">workspace</span>}
        {item.type === 'action' && <span className="text-[10px] text-zinc-600 flex-shrink-0">action</span>}
      </button>
    );
  };

  const renderGroup = (label: string, groupItems: PaletteItem[]) => {
    if (groupItems.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-600">{label}</div>
        {groupItems.map(renderItem)}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-800">
          <Search className="w-4 h-4 text-zinc-500 flex-shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tools, workspaces, actions..."
            className="flex-1 bg-transparent text-sm text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <kbd className="flex-shrink-0 text-[10px] font-medium text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded border border-zinc-700">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-zinc-500">
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
        <div className="flex items-center gap-4 px-4 py-2 border-t border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <ArrowUp className="w-3 h-3" /><ArrowDown className="w-3 h-3" /> navigate
          </div>
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <CornerDownLeft className="w-3 h-3" /> select
          </div>
          <div className="flex items-center gap-1 text-[10px] text-zinc-600">
            <Command className="w-3 h-3" />K toggle
          </div>
        </div>
      </div>
    </div>
  );
}
