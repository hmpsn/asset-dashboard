// @ds-rebuilt
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { DollarSign, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { auth } from '../../api';
import { featureFlags } from '../../api/misc';
import { GLOBAL_TABS, adminPath, type Page } from '../../routes';
import {
  NAV_REGISTRY,
  type NavEntry,
  type NavGroupKey,
  isNavEntryHidden,
  resolveNavDescription,
  resolveNavLabel,
} from '../../lib/navRegistry';
import { queryKeys } from '../../lib/queryKeys';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';
import { WorkspaceSelector, type Workspace } from '../WorkspaceSelector';
import { NotificationBell } from '../NotificationBell';
import { ClickableRow, IconButton, NavGroup, NavItem } from '../ui';
import { useRovingTabindex } from '../ui/useRovingTabindex';

interface RebuiltNavItem {
  id: Page;
  label: string;
  icon: NavEntry['icon'];
  desc: string;
  needsSite?: boolean;
  hidden: boolean;
}

interface RebuiltNavGroup {
  key: NavGroupKey;
  label: string;
  accent: string;
  items: RebuiltNavItem[];
}

export interface RebuiltSidebarProps {
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
}

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';

// nav-registry-ok — group chrome is presentation only; item identity comes from NAV_REGISTRY.
const GROUP_PRESENTATION: Array<{ key: NavGroupKey; label: string; accent: string }> = [
  { key: 'home', label: '', accent: 'var(--teal)' },
  { key: 'monitoring', label: 'MONITORING', accent: 'var(--blue)' },
  { key: 'site-health', label: 'SITE HEALTH', accent: 'var(--emerald)' },
  { key: 'seo-strategy', label: 'STRATEGY', accent: 'var(--teal)' },
  { key: 'optimization', label: 'OPTIMIZATION', accent: 'var(--teal)' },
  { key: 'content', label: 'CONTENT', accent: 'var(--brand-yellow)' },
  { key: 'admin', label: 'ADMIN', accent: 'var(--brand-text)' },
];

function buildNavGroups(isFlagEnabled: (flag: FeatureFlagKey) => boolean): RebuiltNavGroup[] {
  const entryToNavItem = (entry: NavEntry): RebuiltNavItem => ({
    id: entry.id,
    label: resolveNavLabel(entry, isFlagEnabled),
    icon: entry.icon,
    desc: resolveNavDescription(entry, isFlagEnabled),
    needsSite: entry.needsSite,
    hidden: isNavEntryHidden(entry, isFlagEnabled),
  });

  return GROUP_PRESENTATION.map((presentation) => ({
    ...presentation,
    items: NAV_REGISTRY.filter((entry) => entry.group === presentation.key).map(entryToNavItem),
  }));
}

function readCollapsedGroups(): Set<string> {
  try {
    const stored = localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    return stored ? new Set<string>(JSON.parse(stored) as string[]) : new Set<string>();
  } catch {
    return new Set<string>();
  }
}

export function RebuiltSidebar({
  workspaces,
  selected,
  tab,
  theme,
  pendingContentRequests,
  onCreate,
  onDelete,
  onLinkSite,
  onUnlinkSite,
  toggleTheme,
  onLogout,
}: RebuiltSidebarProps) {
  const navigate = useNavigate();
  const { data: flagValues } = useQuery({
    queryKey: queryKeys.shared.featureFlags(),
    queryFn: featureFlags.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const isFlagEnabled = (flag: FeatureFlagKey) => flagValues?.[flag] ?? FEATURE_FLAGS[flag];
  const navGroups = useMemo(() => buildNavGroups(isFlagEnabled), [flagValues]);

  const [collapsedGroups, toggleGroup, setCollapsedGroups] = useToggleSet<string>(
    readCollapsedGroups,
    UNBOUNDED_TOGGLE_SET_OPTIONS,
  );

  useEffect(() => { // effect-layout-ok — intentional post-render active-group expansion mirrors legacy Sidebar
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, JSON.stringify([...collapsedGroups]));
    } catch (err) {
      console.error('RebuiltSidebar operation failed:', err);
    }
  }, [collapsedGroups]);

  // effect-layout-ok — intentional post-render active-group expansion mirrors legacy Sidebar
  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.label && group.items.some((item) => item.id === tab));
    if (activeGroup && collapsedGroups.has(activeGroup.label)) {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(activeGroup.label);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- tab changes intentionally reopen only the active group
  }, [tab, navGroups]);

  const visibleGroups = useMemo(() => navGroups.map((group) => {
    const collapsed = !!group.label && collapsedGroups.has(group.label);
    return {
      ...group,
      collapsed,
      visibleItems: collapsed ? [] : group.items.filter((item) => !item.hidden),
    };
  }), [collapsedGroups, navGroups]);

  const visibleItems = useMemo(() => visibleGroups.flatMap((group) =>
    group.visibleItems.map((item) => ({ group, item })),
  ), [visibleGroups]);

  const activateItem = (item: RebuiltNavItem) => {
    const isGlobal = GLOBAL_TABS.has(item.id);
    const disabled = isGlobal ? false : (!selected || (item.needsSite && !selected.webflowSiteId));
    if (disabled) return;
    if (isGlobal) navigate('/' + item.id);
    else if (selected) navigate(adminPath(selected.id, item.id));
  };

  const roving = useRovingTabindex(visibleItems.length, {
    orientation: 'vertical',
    onActivate: (index) => {
      const model = visibleItems[index];
      if (model) activateItem(model.item);
    },
  });

  let navIndex = 0;

  return (
    <aside
      style={{
        width: '100%',
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface-1)',
        color: 'var(--brand-text)',
      }}
    >
      <ClickableRow
        onClick={() => navigate('/')}
        title="Command Center"
        style={{
          display: 'block',
          padding: '16px 16px 12px',
          background: 'transparent',
        }}
      >
        <img
          src={theme === 'light' ? '/hmpsn-studio-logo-wordmark-navy.svg' : '/logo.svg'}
          alt="Studio logo"
          style={{ height: 28 }}
        />
      </ClickableRow>

      <div style={{ padding: '0 12px 10px', borderBottom: '1px solid var(--brand-border)' }}>
        <WorkspaceSelector
          workspaces={workspaces}
          selected={selected}
          onSelect={(workspace) => {
            if (GLOBAL_TABS.has(tab)) navigate(adminPath(workspace.id));
            else navigate(adminPath(workspace.id, tab));
          }}
          onCreate={onCreate}
          onDelete={onDelete}
          onLinkSite={onLinkSite}
          onUnlinkSite={onUnlinkSite}
        />
      </div>

      <nav
        aria-label="Admin"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '12px 8px',
        }}
      >
        {visibleGroups.map((group) => (
          <NavGroup
            key={group.key}
            label={group.label}
            accent={group.accent}
            collapsed={group.collapsed}
            onToggleCollapse={group.label ? () => toggleGroup(group.label) : undefined}
            style={{ marginTop: group.label ? 8 : 0 }}
          >
            {group.visibleItems.map((item) => {
              const index = navIndex;
              navIndex += 1;
              const isGlobal = GLOBAL_TABS.has(item.id);
              const active = tab === item.id;
              const disabled = isGlobal ? false : (!selected || (item.needsSite && !selected.webflowSiteId));
              const rovingProps = roving.getItemProps(index);
              const disabledTitle = !selected ? 'Select a workspace first' : 'Connect a site first';
              return (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  active={active}
                  disabled={disabled}
                  badge={item.id === 'content-pipeline' && pendingContentRequests > 0 ? pendingContentRequests : undefined}
                  accent={group.accent}
                  title={disabled ? disabledTitle : item.desc}
                  onClick={() => activateItem(item)}
                  itemRef={rovingProps.ref}
                  tabIndex={rovingProps.tabIndex}
                  onFocus={rovingProps.onFocus}
                  onKeyDown={rovingProps.onKeyDown}
                />
              );
            })}
          </NavGroup>
        ))}
      </nav>

      <div
        style={{
          borderTop: '1px solid var(--brand-border)',
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
        }}
      >
        <NotificationBell
          onSelectWorkspace={(workspaceId) => navigate(adminPath(workspaceId))}
          workspaceId={selected?.id}
        />
        <IconButton
          onClick={() => navigate('/revenue')}
          icon={DollarSign}
          label="Revenue"
          size="md"
          title="Revenue"
          style={{
            color: tab === 'revenue' ? 'var(--teal)' : 'var(--brand-text-muted)',
            background: tab === 'revenue' ? 'color-mix(in srgb, var(--teal) 10%, transparent)' : 'transparent',
          }}
        />
        <IconButton
          onClick={() => navigate('/settings')}
          icon={Settings}
          label="Settings"
          size="md"
          title="Settings"
          style={{
            color: tab === 'settings' ? 'var(--teal)' : 'var(--brand-text-muted)',
            background: tab === 'settings' ? 'color-mix(in srgb, var(--teal) 10%, transparent)' : 'transparent',
          }}
        />
        <IconButton
          onClick={toggleTheme}
          icon={theme === 'dark' ? Sun : Moon}
          label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          size="md"
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          style={{ color: 'var(--brand-text-muted)', background: 'transparent' }}
        />
        {onLogout && (
          <IconButton
            onClick={() => {
              auth.logout();
              onLogout();
            }}
            icon={LogOut}
            label="Log out"
            size="md"
            title="Log out"
            style={{ color: 'var(--brand-text-muted)', background: 'transparent' }}
          />
        )}
      </div>
    </aside>
  );
}
