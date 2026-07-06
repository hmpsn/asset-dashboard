// @ds-rebuilt
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Page } from '../../routes';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import type { Workspace } from '../WorkspaceSelector';
import { AppShell, PageContainer, Toolbar } from '../ui';
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
  children: ReactNode;
}

export function useRebuildShellEnabled(): boolean {
  return useFeatureFlag('ui-rebuild-shell');
}

const SIDEBAR_RAIL_KEY = 'admin-sidebar-rail';

function readRail(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_RAIL_KEY) === '1';
  } catch {
    return false;
  }
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
  children,
}: RebuiltAppChromeProps) {
  const [rail, setRail] = useState(readRail);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_RAIL_KEY, rail ? '1' : '0');
    } catch {
      /* localStorage unavailable — rail state stays in-memory only */
    }
  }, [rail]);
  const toggleRail = useCallback(() => setRail((prev) => !prev), []);

  return (
    <AppShell
      rail={rail}
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
          rail={rail}
          onToggleRail={toggleRail}
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
  );
}
