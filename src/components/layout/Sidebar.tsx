import { useCallback, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../api';
import { type Page, adminPath, GLOBAL_TABS } from '../../routes';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import {
  NAV_REGISTRY, type NavEntry, type NavGroupKey,
  resolveNavLabel, resolveNavDescription, isNavEntryHidden,
} from '../../lib/navRegistry';
import type { FeatureFlagKey } from '../../../shared/types/feature-flags';
import { WorkspaceSelector, type Workspace } from '../WorkspaceSelector';
import { NotificationBell } from '../NotificationBell';
import { Icon, cn, IconButton, ClickableRow } from '../ui';
import {
  Settings, Globe, LogOut,
  Sun, Moon, ChevronRight, Activity, Shield,
  BookOpen, DollarSign, Sparkles, Target,
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
  onCreate: (name: string, siteId?: string, siteName?: string) => void;
  onDelete: (id: string) => void;
  onLinkSite: (workspaceId: string, siteId: string, siteName: string, token?: string) => void;
  onUnlinkSite: (workspaceId: string) => void;
  toggleTheme: () => void;
  onLogout?: () => void;
  /** When true, sidebar collapses to a slim 14px exit strip. Used by focus mode. */
  hidden?: boolean;
  /** Called when the exit strip is clicked to restore the sidebar. */
  onExitHidden?: () => void;
}

const ALL_GROUP_LABELS = ['MONITORING', 'SITE HEALTH', 'SEO STRATEGY', 'OPTIMIZATION', 'CONTENT', 'ADMIN'];

/**
 * Sidebar-local PRESENTATION for each registry group: the uppercase label,
 * group icon, colors, and render ORDER. Item identity (label / needsSite /
 * description / hidden) comes from the nav registry — never hard-coded here.
 * nav-registry-ok — group chrome is presentation, not item nav metadata.
 */
const GROUP_PRESENTATION: Array<{
  key: NavGroupKey;
  label: string;
  groupIcon?: typeof Globe;
  groupColor?: string;
  activeBg?: string; activeText?: string; activeIcon?: string; inactiveIcon?: string;
  hoverBg?: string; hoverText?: string;
}> = [
  { key: 'home', label: '' },
  { key: 'monitoring', label: 'MONITORING', groupIcon: Activity, groupColor: 'text-blue-400',
    activeBg: 'bg-blue-500/10', activeText: 'text-blue-300', activeIcon: 'text-blue-400', inactiveIcon: 'text-[var(--brand-text-muted)]', hoverBg: 'hover:bg-blue-500/5', hoverText: 'hover:text-blue-300' },
  { key: 'site-health', label: 'SITE HEALTH', groupIcon: Shield, groupColor: 'text-emerald-400',
    activeBg: 'bg-emerald-500/10', activeText: 'text-emerald-300', activeIcon: 'text-emerald-400', inactiveIcon: 'text-[var(--brand-text-muted)]', hoverBg: 'hover:bg-emerald-500/5', hoverText: 'hover:text-emerald-300' },
  { key: 'seo-strategy', label: 'SEO STRATEGY', groupIcon: Target, groupColor: 'text-teal-400',
    activeBg: 'bg-teal-500/10', activeText: 'text-teal-300', activeIcon: 'text-teal-400', inactiveIcon: 'text-[var(--brand-text-muted)]', hoverBg: 'hover:bg-teal-500/5', hoverText: 'hover:text-teal-300' },
  { key: 'optimization', label: 'OPTIMIZATION', groupIcon: Sparkles, groupColor: 'text-teal-400',
    activeBg: 'bg-teal-500/10', activeText: 'text-teal-300', activeIcon: 'text-teal-400', inactiveIcon: 'text-[var(--brand-text-muted)]', hoverBg: 'hover:bg-teal-500/5', hoverText: 'hover:text-teal-300' },
  { key: 'content', label: 'CONTENT', groupIcon: BookOpen, groupColor: 'text-amber-400',
    activeBg: 'bg-amber-500/10', activeText: 'text-amber-300', activeIcon: 'text-amber-400', inactiveIcon: 'text-[var(--brand-text-muted)]', hoverBg: 'hover:bg-amber-500/5', hoverText: 'hover:text-amber-300' },
  { key: 'admin', label: 'ADMIN', groupIcon: Settings, groupColor: 'text-[var(--brand-text)]',
    activeBg: 'bg-zinc-500/10', activeText: 'text-[var(--brand-text-bright)]', activeIcon: 'text-[var(--brand-text)]', inactiveIcon: 'text-[var(--brand-text-dim)]', hoverBg: 'hover:bg-zinc-500/5', hoverText: 'hover:text-[var(--brand-text-bright)]' }, // raw-zinc-ok — admin group neutral tint
];

/**
 * Build the sidebar nav groups from the registry. Group chrome/order is local
 * (GROUP_PRESENTATION); each item's label/needsSite/description/hidden is
 * resolved from the registry, applying keyword-hub flag behavior in ONE place.
 */
function buildNavGroups(isFlagEnabled: (flag: FeatureFlagKey) => boolean): NavGroup[] {
  const entryToNavItem = (entry: NavEntry): NavItem => ({
    id: entry.id,
    label: resolveNavLabel(entry, isFlagEnabled),
    icon: entry.icon,
    desc: resolveNavDescription(entry, isFlagEnabled),
    needsSite: entry.needsSite,
    hidden: isNavEntryHidden(entry, isFlagEnabled),
  });

  return GROUP_PRESENTATION.map((pres) => ({
    label: pres.label,
    groupIcon: pres.groupIcon,
    groupColor: pres.groupColor,
    activeBg: pres.activeBg,
    activeText: pres.activeText,
    activeIcon: pres.activeIcon,
    inactiveIcon: pres.inactiveIcon,
    hoverBg: pres.hoverBg,
    hoverText: pres.hoverText,
    items: NAV_REGISTRY.filter((e) => e.group === pres.key).map(entryToNavItem),
  }));
}

export function Sidebar({
  workspaces, selected, tab, theme, pendingContentRequests,
  onCreate, onDelete, onLinkSite, onUnlinkSite,
  toggleTheme, onLogout, hidden, onExitHidden,
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

  const keywordHubEnabled = useFeatureFlag('keyword-hub');
  // Only keyword-hub drives nav flagBehavior today; resolve other flags as false.
  const navGroups = buildNavGroups((flag) => flag === 'keyword-hub' && keywordHubEnabled);

  // Auto-expand sidebar group containing active tab (#160)
  useEffect(() => { // effect-layout-ok — intentional post-render tab-group expansion
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

  // Focus mode: render a slim clickable strip so the user can exit
  if (hidden) {
    return (
      <aside
        role="button"
        tabIndex={0}
        aria-label="Exit focus mode"
        className="w-[14px] flex-shrink-0 border-r border-[var(--brand-border)] bg-[var(--surface-1)] flex flex-col items-center justify-center cursor-pointer hover:bg-[var(--surface-3)] transition-colors"
        onClick={onExitHidden}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onExitHidden?.(); }}
        title="Exit focus mode"
      >
        <span className="[writing-mode:vertical-rl] rotate-180 text-[var(--brand-text-dim)] t-micro select-none">◀</span>
      </aside>
    );
  }

  return (
    <aside className="w-[200px] flex-shrink-0 flex flex-col border-r border-[var(--brand-border)]">
      {/* Logo → Command Center */}
      <ClickableRow
        onClick={() => navigate('/')}
        className="px-4 pt-4 pb-3 block hover:opacity-80 hover:bg-transparent"
        title="Command Center"
      >
        <img
          src={theme === 'light' ? '/hmpsn-studio-logo-wordmark-navy.svg' : '/logo.svg'}
          alt="Studio logo"
          className="h-7"
        />
      </ClickableRow>

      {/* Workspace selector */}
      <div className="px-3 pb-2 border-b border-[var(--brand-border)]">
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
                <ClickableRow
                  onClick={() => toggleGroup(group.label)}
                  className="flex items-center gap-1.5 px-2 py-1.5 mb-0.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] group/hdr"
                >
                  {group.groupIcon && (() => {
                    const GIcon = group.groupIcon;
                    return <GIcon className={cn('w-3.5 h-3.5', group.groupColor || 'text-[var(--brand-text-muted)]', 'opacity-70 group-hover/hdr:opacity-100 transition-opacity')} />;
                  })()}
                  <span className="t-caption-sm text-[var(--brand-text-muted)] font-semibold tracking-widest uppercase flex-1 text-left">{group.label}</span>
                  <ChevronRight className={`w-3 h-3 text-[var(--brand-text-dim)] transition-transform duration-150 ${!isCollapsed ? 'rotate-90' : ''}`} />
                  {isCollapsed && groupBadgeCount > 0 && (
                    <span className="t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums min-w-[18px] text-center leading-tight">
                      {groupBadgeCount}
                    </span>
                  )}
                </ClickableRow>
              ) : null}
              {!isCollapsed && group.items.filter(item => !item.hidden).map(item => {
                const NavIcon = item.icon;
                const active = tab === item.id;
                const isGlobal = GLOBAL_TABS.has(item.id);
                const disabled = isGlobal ? false : (!selected || (item.needsSite && !selected.webflowSiteId));
                return (
                  <ClickableRow
                    key={item.id}
                    onClick={() => !disabled && (isGlobal ? navigate(adminPath(selected?.id ?? '', item.id)) : selected && navigate(adminPath(selected.id, item.id)))}
                    data-nav-active={active ? 'true' : 'false'}
                    title={item.desc}
                    className={cn(
                      'flex items-center gap-2.5 px-2.5 py-[5px] rounded-[var(--radius-lg)] t-caption font-medium transition-all',
                      active
                        ? `${group.activeBg || 'bg-teal-500/10'} ${group.activeText || 'text-teal-300'}`
                        : disabled
                          ? 'text-[var(--brand-text-dim)] cursor-not-allowed'
                          : `text-[var(--brand-text)] ${group.hoverText || 'hover:text-[var(--brand-text-bright)]'} ${group.hoverBg || 'hover:bg-[var(--surface-3)]'}`
                    )}
                  >
                    <Icon
                      as={NavIcon}
                      size="sm"
                      className={cn('flex-shrink-0', active ? (group.activeIcon || 'text-teal-400') : (group.inactiveIcon || 'text-[var(--brand-text-muted)]'))}
                    />
                      <span className="truncate">{item.label}</span>
                      {item.id === 'content-pipeline' && pendingContentRequests > 0 && (
                        <span className="ml-auto t-caption-sm font-bold px-1.5 py-0.5 rounded-[var(--radius-pill)] badge-span-ok bg-amber-500/20 text-amber-400 border border-amber-500/30 tabular-nums flex-shrink-0 min-w-[20px] text-center leading-tight">
                          {pendingContentRequests}
                        </span>
                      )}
                  </ClickableRow>
                );
              })}
            </div>
          );
        })}
      </nav>

      {/* Bottom: icon-only utility bar */}
      <div className="px-3 py-2.5 border-t border-[var(--brand-border)] flex items-center justify-center gap-1">
        <NotificationBell
          onSelectWorkspace={(workspaceId) => navigate(adminPath(workspaceId))}
          workspaceId={selected?.id}
        />
        <IconButton
          onClick={() => navigate(adminPath(selected?.id ?? '', 'revenue'))}
          icon={DollarSign}
          label="Revenue"
          size="md"
          title="Revenue"
          className={cn(
            'rounded-[var(--radius-lg)] transition-all',
            tab === 'revenue'
              ? 'text-teal-400 bg-teal-500/10'
              : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
          )}
        />
        <IconButton
          onClick={() => navigate(adminPath(selected?.id ?? '', 'settings'))}
          icon={Settings}
          label="Settings"
          size="md"
          title="Settings"
          className={cn(
            'rounded-[var(--radius-lg)] transition-all',
            tab === 'settings'
              ? 'text-teal-400 bg-teal-500/10'
              : 'text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)]'
          )}
        />
        <IconButton
          onClick={toggleTheme}
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          size="md"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          className="rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-all"
        />
        {onLogout && (
          <IconButton
            onClick={() => { auth.logout(); onLogout(); }}
            icon={LogOut}
            label="Log out"
            size="md"
            title="Log out"
            className="rounded-[var(--radius-lg)] text-[var(--brand-text-muted)] hover:text-red-400 hover:bg-red-500/5 transition-all"
          />
        )}
      </div>
    </aside>
  );
}

export { ALL_GROUP_LABELS };
export type { NavGroup, NavItem };
