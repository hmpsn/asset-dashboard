// @ds-rebuilt
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Page } from '../../routes';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import type { Workspace } from '../WorkspaceSelector';
import { AppShell, Drawer, PageContainer, Toolbar } from '../ui';
import { RebuiltBreadcrumb } from './RebuiltBreadcrumb';
import { RebuiltSidebar } from './RebuiltSidebar';

/**
 * F4 does not mount this anywhere; the Keywords pilot (P) is the first caller,
 * flag-gated. App.tsx is untouched.
 */
export interface RebuiltAppChromeProps {
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
  focusMode?: boolean;
  onFocusModeChange?: (focusMode: boolean) => void;
  children: ReactNode;
}

export interface RebuiltFocusModeContextValue {
  focusMode: boolean;
  setFocusMode: (focusMode: boolean) => void;
}

const ignoreFocusModeChange = () => undefined;
const RebuiltFocusModeContext = createContext<RebuiltFocusModeContextValue>({
  focusMode: false,
  setFocusMode: ignoreFocusModeChange,
});

export function useRebuiltFocusMode(): RebuiltFocusModeContextValue {
  return useContext(RebuiltFocusModeContext);
}

export function useRebuildShellEnabled(): boolean {
  return useFeatureFlag('ui-rebuild-shell');
}

const SIDEBAR_RAIL_KEY = 'admin-sidebar-rail';
const NARROW_SHELL_QUERY = '(max-width: 720px)';

function readRail(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function readNarrowViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(NARROW_SHELL_QUERY).matches;
}

function useNarrowViewportRail(): boolean {
  const [isNarrow, setIsNarrow] = useState(readNarrowViewport);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const query = window.matchMedia(NARROW_SHELL_QUERY);
    const handleChange = () => setIsNarrow(query.matches);
    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return isNarrow;
}

export function RebuiltAppChrome({
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
  focusMode = false,
  onFocusModeChange,
  children,
}: RebuiltAppChromeProps) {
  const [rail, setRail] = useState(readRail);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const narrowViewportRail = useNarrowViewportRail();
  const effectiveRail = rail || narrowViewportRail;
  const shellRail = effectiveRail || focusMode;
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_RAIL_KEY, rail ? '1' : '0');
    } catch {
      /* localStorage unavailable — rail state stays in-memory only */
    }
  }, [rail]);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);
  const toggleRail = useCallback(() => {
    if (narrowViewportRail) {
      setMobileNavOpen(true);
      return;
    }
    setRail((prev) => !prev);
  }, [narrowViewportRail]);
  const handleShellRailToggle = useCallback(() => {
    if (focusMode) {
      onFocusModeChange?.(false);
      return;
    }
    toggleRail();
  }, [focusMode, onFocusModeChange, toggleRail]);
  const focusModeContextValue = useMemo<RebuiltFocusModeContextValue>(() => ({
    focusMode,
    setFocusMode: onFocusModeChange ?? ignoreFocusModeChange,
  }), [focusMode, onFocusModeChange]);

  return (
    <RebuiltFocusModeContext.Provider value={focusModeContextValue}>
      <AppShell
        rail={shellRail}
        focusMode={focusMode}
        onFocusModeChange={onFocusModeChange}
        sidebar={
          <RebuiltSidebar
            workspaces={workspaces}
            selected={selected}
            tab={tab}
            theme={theme}
            pendingContentRequests={pendingContentRequests}
            onCreate={onCreate}
            onDelete={onDelete}
            onLinkSite={onLinkSite}
            onUnlinkSite={onUnlinkSite}
            toggleTheme={toggleTheme}
            onLogout={onLogout}
            rail={shellRail}
            onToggleRail={handleShellRailToggle}
          />
        }
        topbar={
          <Toolbar label="Breadcrumb" wrap={false} style={{ width: '100%' }}>
            <RebuiltBreadcrumb
              workspaces={workspaces}
              selected={selected}
              tab={tab}
              pendingContentRequests={pendingContentRequests}
            />
          </Toolbar>
        }
      >
        <PageContainer as="main" width="wide">
          {children}
        </PageContainer>
      </AppShell>
      <Drawer
        open={narrowViewportRail && mobileNavOpen}
        onClose={closeMobileNav}
        side="left"
        width="min(320px, 88vw)"
        title="Navigation"
      >
        <RebuiltSidebar
          workspaces={workspaces}
          selected={selected}
          tab={tab}
          theme={theme}
          pendingContentRequests={pendingContentRequests}
          onCreate={onCreate}
          onDelete={onDelete}
          onLinkSite={onLinkSite}
          onUnlinkSite={onUnlinkSite}
          toggleTheme={toggleTheme}
          onLogout={onLogout}
          rail={false}
          onToggleRail={closeMobileNav}
          onNavigate={closeMobileNav}
        />
      </Drawer>
    </RebuiltFocusModeContext.Provider>
  );
}
