// @ds-rebuilt
import type { ReactNode } from 'react';
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
  return (
    <AppShell
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
