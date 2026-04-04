import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../api';
import { type Page, adminPath } from '../../routes';
import { WorkspaceSelector, type Workspace } from '../WorkspaceSelector';
import { NotificationBell } from '../NotificationBell';
import {
  Settings, Clipboard, BarChart3, Globe, Image, Gauge, Search,
  Pencil, Target, Code2, LogOut, TrendingUp, Link2, MessageSquare,
  Sun, Moon, LayoutDashboard, ChevronRight, Activity, Shield,
  Zap, BookOpen, CalendarDays, DollarSign, Trophy,
} from 'lucide-react';

interface NavItem {
  id: Page;
  label: string;
  icon: typeof Globe;
  desc?: string;
  needsSite?: boolean;
  hidden?: boolean;
}

interface NavGroup {
  label: string;
  groupIcon?: typeof Globe;
  groupColor?: string;
  activeBg?: string;
  activeText?: string;
  activeIcon?: string;
  inactiveIcon?: string;
  hoverBg?: string;
  hoverText?: string;
  items: NavItem[];
}

interface SidebarProps {
  workspaces: Workspace[];
  selected: Workspace | null;
  tab: Page;
  theme: 'dark' | 'light';
  pendingContentRequests: number;
  hasContentItems: boolean;
  onCreate: (name: string, siteId?: string, siteName?: string) => void;
  onDelete: (id: string) => void;
  onLinkSite: (workspaceId: string, siteId: string, siteName: string, token?: string) => void;
  onUnlinkSite: (workspaceId: string) => void;
  toggleTheme: () => void;
  onLogout?: () => void;
}

const ALL_GROUP_LABELS = ['ANALYTICS', 'SITE HEALTH', 'SEO', 'CONTENT'];

function buildNavGroups(hasContentItems: boolean): NavGroup[] {
  return [
    { label: '', items: [
      { id: 'home', label: 'Home', icon: LayoutDashboard, desc: 'Workspace overview and quick actions' },
    ]},
    { label: 'ANALYTICS', groupIcon: Activity, groupColor: 'text-blue-400',
      activeBg: 'bg-blue-500/10', activeText: 'text-blue-300', activeIcon: 'text-blue-400', inactiveIcon: 'text-zinc-500', hoverBg: 'hover:bg-blue-500/5', hoverText: 'hover:text-blue-300',
      items: [
      { id: 'analytics-hub', label: 'Analytics', icon: BarChart3, needsSite: true, desc: 'Unified analytics: search performance, traffic, insights, and annotations' },
      { id: 'seo-ranks', label: 'Rank Tracker', icon: TrendingUp, needsSite: true, desc: 'Track keyword rankings over time' },
      { id: 'outcomes', label: 'Outcomes', icon: Trophy, desc: 'Track what\'s working across all your SEO actions' },
    ]},
    { label: 'SITE HEALTH', groupIcon: Shield, groupColor: 'text-emerald-400',
      activeBg: 'bg-emerald-500/10', activeText: 'text-emerald-300', activeIcon: 'text-emerald-400', inactiveIcon: 'text-zinc-500', hoverBg: 'hover:bg-emerald-500/5', hoverText: 'hover:text-emerald-300',
      items: [
      { id: 'seo-audit', label: 'Site Audit', icon: Globe, needsSite: true, desc: 'Comprehensive SEO audit with AI recommendations' },
      { id: 'performance', label: 'Performance', icon: Gauge, needsSite: true, desc: 'PageSpeed scores, Core Web Vitals, and load times' },
      { id: 'links', label: 'Links', icon: Link2, needsSite: true, desc: 'Internal links, broken links, and redirect management' },
      { id: 'media', label: 'Assets', icon: Image, desc: 'Images, alt text, and media optimization' },
    ]},
    { label: 'SEO', groupIcon: Zap, groupColor: 'text-teal-400',
      activeBg: 'bg-teal-500/10', activeText: 'text-teal-300', activeIcon: 'text-teal-400', inactiveIcon: 'text-zinc-500', hoverBg: 'hover:bg-teal-500/5', hoverText: 'hover:text-teal-300',
      items: [
            { id: 'seo-strategy', label: 'Strategy', icon: Target, needsSite: true, desc: 'Keyword strategy with page-keyword mapping' },
      { id: 'page-intelligence', label: 'Page Intelligence', icon: Search, needsSite: true, desc: 'Per-page keyword analysis, metrics, and optimization' },
      { id: 'seo-editor', label: 'SEO Editor', icon: Pencil, needsSite: true, desc: 'Edit titles, descriptions, and meta tags' },
      { id: 'seo-schema', label: 'Schema', icon: Code2, needsSite: true, desc: 'Structured data and schema markup' },
      { id: 'brand', label: 'Brand & AI', icon: Zap, needsSite: true, desc: 'Brand voice, knowledge base, and audience personas' },
      { id: 'rewrite', label: 'Page Rewriter', icon: Pencil, needsSite: true, desc: 'AI-assisted page rewriting with playbook instructions' },
    ]},
    { label: 'CONTENT', groupIcon: BookOpen, groupColor: 'text-amber-400',
      activeBg: 'bg-amber-500/10', activeText: 'text-amber-300', activeIcon: 'text-amber-400', inactiveIcon: 'text-zinc-500', hoverBg: 'hover:bg-amber-500/5', hoverText: 'hover:text-amber-300',
      items: [
      { id: 'content-pipeline', label: 'Content Pipeline', icon: Clipboard, needsSite: true, desc: 'Briefs, posts, and subscriptions in one view' },
      { id: 'calendar', label: 'Calendar', icon: CalendarDays, needsSite: true, hidden: !hasContentItems, desc: 'Content calendar with briefs, posts, and requests' },
      { id: 'requests', label: 'Requests', icon: MessageSquare, needsSite: true, desc: 'Client content requests and feedback' },
      { id: 'content-perf', label: 'Content Perf', icon: BarChart3, needsSite: true, desc: 'Post-publish content performance metrics' },
    ]},
  ];
}

const GLOBAL_TABS = new Set(['settings', 'roadmap', 'prospect', 'ai-usage', 'revenue', 'outcomes-overview']);

export function Sidebar({
  workspaces, selected, tab, theme, pendingContentRequests, hasContentItems,
  onCreate, onDelete, onLinkSite, onUnlinkSite,
  toggleTheme, onLogout,
}: SidebarProps) {
  const navigate = useNavigate();

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('admin-sidebar-collapsed');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem('admin-sidebar-collapsed', JSON.stringify([...next])); } catch (err) { console.error('App operation failed:', err); }
      return next;
    });
  }, []);

  const navGroups = buildNavGroups(hasContentItems);

  // Auto-expand sidebar group containing active tab (#160)
  useEffect(() => {
    const activeGroup = navGroups.find(g => g.label && g.items.some(i => i.id === tab));
    if (activeGroup && collapsedGroups.has(activeGroup.label)) {
      setCollapsedGroups(prev => {
        const next = new Set(prev);
        next.delete(activeGroup.label);
        try { localStorage.setItem('admin-sidebar-collapsed', JSON.stringify([...next])); } catch (err) { console.error('App operation failed:', err); }
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-zinc-800">
      {/* Logo → Command Center */}
      <button
        onClick={() => navigate('/')}
        className="px-4 pt-4 pb-3 block hover:opacity-80 transition-opacity"
        title="Command Center"
      >
        <img src="/logo.svg" alt="Studio logo" className="h-7" style={theme === 'light' ? { filter: 'invert(1) brightness(0.3)' } : undefined} />
      </button>

      {/* Workspace selector */}
      <div className="px-3 pb-2 border-b border-zinc-800">
        <WorkspaceSelector
          workspaces={workspaces}
          selected={selected}
          onSelect={(ws) => { if (GLOBAL_TABS.has(tab)) navigate(adminPath(ws.id)); else navigate(adminPath(ws.id, tab)); }}
          onCreate={onCreate}
          onDelete={onDelete}
          onLinkSite={onLinkSite}
          onUnlinkSite={onUnlinkSite}
        />
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {navGroups.map((group, gi) => {
          const isCollapsed = !!group.label && collapsedGroups.has(group.label);
          const groupBadgeCount = group.items.reduce((sum, item) =>
            item.id === 'content-pipeline' ? sum + pendingContentRequests : sum, 0);

          return (
            <div key={group.label || `group-${gi}`} className={group.label ? 'mt-3' : ''}>
              {group.label ? (
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded-md hover:bg-zinc-800/30 transition-colors group/hdr"
                >
                  {group.groupIcon && (() => {
                    const GIcon = group.groupIcon;
                    return <GIcon className={`w-3.5 h-3.5 ${group.groupColor || 'text-zinc-500'} opacity-70 group-hover/hdr:opacity-100 transition-opacity`} />;
                  })()}
                  <span className="text-[11px] text-zinc-500 font-semibold tracking-widest flex-1 text-left">{group.label}</span>
                  <ChevronRight className={`w-3 h-3 text-zinc-600 transition-transform duration-150 ${!isCollapsed ? 'rotate-90' : ''}`} />
                  {isCollapsed && groupBadgeCount > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums min-w-[18px] text-center leading-tight">
                      {groupBadgeCount}
                    </span>
                  )}
                </button>
              ) : null}
              {!isCollapsed && group.items.filter(item => !item.hidden).map(item => {
                const Icon = item.icon;
                const active = tab === item.id;
                const disabled = !selected || (item.needsSite && !selected.webflowSiteId);
                return (
                  <button
                    key={item.id}
                    onClick={() => !disabled && selected && navigate(adminPath(selected.id, item.id))}
                    title={item.desc}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-[5px] rounded-lg text-[12px] font-medium transition-all ${
                      active
                        ? `${group.activeBg || 'bg-teal-500/10'} ${group.activeText || 'text-teal-300'}`
                        : disabled
                          ? 'text-zinc-700 cursor-not-allowed'
                          : `text-zinc-300 ${group.hoverText || 'hover:text-zinc-100'} ${group.hoverBg || 'hover:bg-zinc-800/50'}`
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${active ? (group.activeIcon || 'text-teal-400') : (group.inactiveIcon || '')}`} />
                    <span className="truncate">{item.label}</span>
                    {item.id === 'content-pipeline' && pendingContentRequests > 0 && (
                      <span className="ml-auto text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums flex-shrink-0 min-w-[20px] text-center leading-tight">
                        {pendingContentRequests}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom: icon-only utility bar */}
      <div className="px-3 py-2.5 border-t border-zinc-800 flex items-center justify-center gap-1">
        <NotificationBell onSelectWorkspace={(workspaceId) => navigate(adminPath(workspaceId))} />
        <button
          onClick={() => navigate('/revenue')}
          title="Revenue"
          className={`p-2 rounded-lg transition-all ${tab === 'revenue' ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
        >
          <DollarSign className="w-4 h-4" />
        </button>
        <button
          onClick={() => navigate('/settings')}
          title="Settings"
          className={`p-2 rounded-lg transition-all ${tab === 'settings' ? 'text-teal-400 bg-teal-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50'}`}
        >
          <Settings className="w-4 h-4" />
        </button>
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="p-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-all"
        >
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {onLogout && (
          <button
            onClick={() => { auth.logout(); onLogout(); }}
            title="Log out"
            className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/5 transition-all"
          >
            <LogOut className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
}

export { ALL_GROUP_LABELS, GLOBAL_TABS };
export type { NavGroup, NavItem };
