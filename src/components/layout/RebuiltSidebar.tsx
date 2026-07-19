// @ds-rebuilt
import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { DollarSign, LogOut, Moon, PanelLeftClose, PanelLeftOpen, Settings, Sun, Users } from 'lucide-react';
import { auth } from '../../api';
import { featureFlags } from '../../api/misc';
import { GLOBAL_TABS, adminPath, type Page } from '../../routes';
import {
  NAV_DESTINATION_REGISTRY,
  REBUILT_NAV_ZONES,
  BOOK_ROOT_NAV_ID,
  type AnyNavEntry,
  type NavDestinationId,
  type NavDestinationScope,
  type RebuiltNavZoneKey,
  isNavEntryHidden,
  resolveNavDescription,
  resolveNavLabel,
  resolveNavPath,
  resolveNavScope,
} from '../../lib/navRegistry';
import { queryKeys } from '../../lib/queryKeys';
import { UNBOUNDED_TOGGLE_SET_OPTIONS, useToggleSet } from '../../hooks/useToggleSet';
import { useWorkspaceBadges } from '../../hooks/admin/useWorkspaceBadges';
import { FEATURE_FLAGS, type FeatureFlagKey } from '../../../shared/types/feature-flags';
import { WorkspaceSelector, type Workspace } from '../WorkspaceSelector';
import { NotificationBell } from '../NotificationBell';
import { ClickableRow, IconButton, NavGroup, NavItem } from '../ui';
import { useRovingTabindex } from '../ui/useRovingTabindex';

interface RebuiltNavItem {
  id: NavDestinationId;
  label: string;
  icon: AnyNavEntry['icon'];
  desc: string;
  scope: NavDestinationScope;
  needsSite?: boolean;
  hidden: boolean;
}

interface RebuiltNavGroup {
  key: RebuiltNavPresentationKey;
  label: string;
  accent: string;
  items: RebuiltNavItem[];
}

type RebuiltNavPresentationKey = RebuiltNavZoneKey;

interface RebuiltNavGroupPresentation {
  key: RebuiltNavPresentationKey;
  label: string;
  accent: string;
  items: readonly NavDestinationId[];
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
  /** Whole-sidebar icon-rail collapse (distinct from per-group accordion collapse). */
  rail: boolean;
  onToggleRail: () => void;
  onNavigate?: () => void;
}

const SIDEBAR_COLLAPSED_KEY = 'admin-sidebar-collapsed';
const NAV_ENTRY_BY_ID = new Map<NavDestinationId, AnyNavEntry>(NAV_DESTINATION_REGISTRY.map((entry) => [entry.id, entry]));

const EXTRA_REBUILT_NAV_ENTRIES: Partial<Record<NavDestinationId, AnyNavEntry>> = {
  competitors: {
    id: 'competitors',
    label: 'Competitors',
    icon: Users,
    group: 'seo-strategy',
    description: 'Competitive intelligence, keyword gaps, and alerts',
    needsSite: true,
  },
};

const REBUILT_ZONE_ACCENT: Record<RebuiltNavZoneKey, string> = {
  book: 'var(--teal)',
  top: 'var(--teal)',
  'strategy-content': 'var(--blue)',
  'search-site-health': 'var(--cyan)',
  optimization: 'var(--teal)',
  'client-facing': 'var(--brand-yellow)',
  admin: 'var(--brand-text)',
};

// nav-registry-ok — rebuilt route identity, ordering, and zone labels come
// from navRegistry; only visual accents and uppercase styling remain local.
const GROUP_PRESENTATION: RebuiltNavGroupPresentation[] = REBUILT_NAV_ZONES.map((zone) => ({
  key: zone.key,
  label: zone.label.toUpperCase(),
  accent: REBUILT_ZONE_ACCENT[zone.key],
  items: zone.items,
}));

function buildNavGroups(isFlagEnabled: (flag: FeatureFlagKey) => boolean): RebuiltNavGroup[] {
  const entryToNavItem = (entry: AnyNavEntry): RebuiltNavItem => ({
    id: entry.id,
    label: resolveNavLabel(entry, isFlagEnabled),
    icon: entry.icon,
    desc: resolveNavDescription(entry, isFlagEnabled),
    scope: resolveNavScope(entry),
    needsSite: entry.needsSite,
    hidden: isNavEntryHidden(entry, isFlagEnabled),
  });

  return GROUP_PRESENTATION.map((presentation) => ({
    key: presentation.key,
    label: presentation.label,
    accent: presentation.accent,
    items: presentation.items.flatMap((id) => {
      const entry = NAV_ENTRY_BY_ID.get(id) ?? EXTRA_REBUILT_NAV_ENTRIES[id];
      return entry ? [entryToNavItem(entry)] : [];
    }),
  }));
}

function isNavItemDisabled(item: RebuiltNavItem, selected: Workspace | null): boolean {
  const entry = NAV_ENTRY_BY_ID.get(item.id);
  if (!entry || resolveNavPath(entry, selected?.id) === null) return true;
  return item.scope === 'workspace' && !!item.needsSite && !selected?.webflowSiteId;
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
  rail,
  onToggleRail,
  onNavigate,
}: RebuiltSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const badgesQuery = useWorkspaceBadges(selected?.id);
  const { data: flagValues } = useQuery({
    queryKey: queryKeys.shared.featureFlags(),
    queryFn: featureFlags.list,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  const isFlagEnabled = (flag: FeatureFlagKey) => flagValues?.[flag] ?? FEATURE_FLAGS[flag];
  const navGroups = useMemo(() => buildNavGroups(isFlagEnabled), [flagValues]);
  const activeDestinationId: NavDestinationId = location.pathname === '/' ? BOOK_ROOT_NAV_ID : tab;
  const pendingReplies = badgesQuery.data?.pendingReplies?.count ?? 0;
  const badgeForItem = (itemId: NavDestinationId): number | undefined => {
    const count = itemId === 'content-pipeline'
      ? pendingContentRequests
      : itemId === 'requests'
        ? pendingReplies
        : 0;
    return count > 0 ? count : undefined;
  };

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
    const activeGroup = navGroups.find((group) => group.label && group.items.some((item) => item.id === activeDestinationId));
    if (activeGroup && collapsedGroups.has(activeGroup.label)) {
      setCollapsedGroups((prev) => {
        const next = new Set(prev);
        next.delete(activeGroup.label);
        return next;
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ONLY an active destination change reopens the active group (legacy Sidebar parity). `navGroups` is intentionally omitted: it gets a fresh identity when the flag query resolves, and including it would re-run this effect and re-expand a group the user just manually collapsed (review PR #1478). navGroups is read as a live closure — correct because a stale read only matters across a destination change, which retriggers the effect anyway.
  }, [activeDestinationId]);

  const visibleGroups = useMemo(() => navGroups.map((group) => {
    // In the icon rail there are no group headers to toggle, so every group is
    // fully expanded regardless of the per-group accordion state.
    const collapsed = !rail && !!group.label && collapsedGroups.has(group.label);
    return {
      ...group,
      collapsed,
      visibleItems: collapsed ? [] : group.items.filter((item) => !item.hidden),
    };
  }), [collapsedGroups, navGroups, rail]);

  const enabledVisibleItems = useMemo(() => visibleGroups.flatMap((group) =>
    group.visibleItems
      .filter((item) => !isNavItemDisabled(item, selected))
      .map((item) => ({ group, item })),
  ), [selected, visibleGroups]);

  const activateItem = (item: RebuiltNavItem) => {
    const disabled = isNavItemDisabled(item, selected);
    if (disabled) return;
    const entry = NAV_ENTRY_BY_ID.get(item.id);
    if (!entry) return;
    const path = resolveNavPath(entry, selected?.id);
    if (!path) return;
    navigate(path);
    onNavigate?.();
  };

  const roving = useRovingTabindex(enabledVisibleItems.length, {
    orientation: 'vertical',
    onActivate: (index) => {
      const model = enabledVisibleItems[index];
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: rail ? 'center' : 'space-between',
          gap: 6,
          padding: '16px 12px 12px',
        }}
      >
        {!rail && (
          <ClickableRow
            onClick={() => navigate('/')}
            title="Command Center"
            style={{ background: 'transparent', padding: 4, borderRadius: 'var(--radius-md)' }}
          >
            <img
              src={theme === 'light' ? '/hmpsn-studio-logo-wordmark-navy.svg' : '/logo.svg'}
              alt="Studio logo"
              style={{ height: 28, display: 'block' }}
            />
          </ClickableRow>
        )}
        <IconButton
          onClick={onToggleRail}
          icon={rail ? PanelLeftOpen : PanelLeftClose}
          label={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          title={rail ? 'Expand sidebar' : 'Collapse sidebar'}
          size="md"
          style={{ color: 'var(--brand-text-muted)', background: 'transparent' }}
        />
      </div>

      <div
        style={{
          padding: rail ? '0 8px 10px' : '0 12px 10px',
          borderBottom: '1px solid var(--brand-border)',
          display: rail ? 'flex' : 'block',
          justifyContent: 'center',
        }}
      >
        {rail ? (
          // No room for the full selector in the rail — a workspace initial that
          // expands the sidebar so the user can switch (parity escape hatch).
          <ClickableRow
            onClick={onToggleRail}
            title={selected ? `${selected.name} — expand to switch workspace` : 'Expand to select a workspace'}
            aria-label={selected ? `Workspace ${selected.name}. Expand to switch.` : 'Expand to select a workspace'}
            style={{
              width: 36,
              height: 36,
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--brand-border)',
              background: 'var(--surface-2)',
              color: 'var(--brand-text-bright)',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {(selected?.name || '?').charAt(0).toUpperCase()}
          </ClickableRow>
        ) : (
          <WorkspaceSelector
            workspaces={workspaces}
            selected={selected}
            onSelect={(workspace) => {
              if (GLOBAL_TABS.has(tab)) navigate(adminPath(workspace.id));
              else navigate(adminPath(workspace.id, tab));
              onNavigate?.();
            }}
            onCreate={onCreate}
            onDelete={onDelete}
            onLinkSite={onLinkSite}
            onUnlinkSite={onUnlinkSite}
          />
        )}
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
            rail={rail}
            collapsed={group.collapsed}
            onToggleCollapse={group.label ? () => toggleGroup(group.label) : undefined}
            // Preserve every hidden item count on its collapsed group header.
            badge={group.collapsed
              ? group.items.reduce((sum, item) => sum + (badgeForItem(item.id) ?? 0), 0) || undefined
              : undefined}
            style={{ marginTop: group.label ? 8 : 0 }}
          >
            {group.visibleItems.map((item) => {
              const index = navIndex;
              const active = activeDestinationId === item.id;
              const disabled = isNavItemDisabled(item, selected);
              const rovingProps = disabled ? null : roving.getItemProps(index);
              if (!disabled) navIndex += 1;
              const disabledTitle = !selected ? 'Select a workspace first' : 'Connect a site first';
              return (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  label={item.label}
                  collapsed={rail}
                  active={active}
                  disabled={disabled}
                  badge={badgeForItem(item.id)}
                  accent={group.accent}
                  title={disabled ? disabledTitle : item.desc}
                  onClick={() => activateItem(item)}
                  itemRef={rovingProps?.ref}
                  tabIndex={rovingProps?.tabIndex}
                  onFocus={rovingProps?.onFocus}
                  onKeyDown={rovingProps?.onKeyDown}
                />
              );
            })}
          </NavGroup>
        ))}
      </nav>

      <div
        style={{
          borderTop: '1px solid var(--brand-border)',
          padding: rail ? '10px 8px' : '10px 12px',
          display: 'flex',
          flexDirection: rail ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: rail ? 6 : 4,
        }}
      >
        <NotificationBell
          onSelectWorkspace={(workspaceId) => navigate(adminPath(workspaceId))}
          workspaceId={selected?.id}
        />
        <IconButton
          onClick={() => {
            navigate('/revenue');
            onNavigate?.();
          }}
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
          onClick={() => {
            navigate('/settings');
            onNavigate?.();
          }}
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
