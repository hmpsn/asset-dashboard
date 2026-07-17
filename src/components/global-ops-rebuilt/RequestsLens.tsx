// @ds-rebuilt
import { useEffect, useRef } from 'react';
import { AdminInbox } from '../admin/AdminInbox';
import { ClientActionsTab } from '../admin/ClientActionsTab';
import { ClientDeliverablesPane } from '../admin/ClientDeliverablesPane';
import { RequestManager } from '../RequestManager';
import {
  Button,
  EmptyState,
  Icon,
  InlineBanner,
  PageContainer,
  useRovingTabindex,
} from '../ui';
import { REQUESTS_TABS, useRequestsTabState, type RequestsTab } from './useGlobalOpsSurfaceState';
import { useWorkspaceBadges } from '../../hooks/admin/useWorkspaceBadges';

interface RequestsLensProps {
  workspaceId?: string;
}

const TAB_LABELS: Record<RequestsTab, string> = {
  deliverables: 'Deliverables',
  signals: 'Signals',
  requests: 'All requests',
  actions: 'Client actions',
};

function RequestsModeTray({ value, onChange }: { value: RequestsTab; onChange: (value: RequestsTab) => void }) {
  const trayRef = useRef<HTMLDivElement>(null);
  const selectedIndex = Math.max(0, REQUESTS_TABS.indexOf(value));
  const { activeIndex, setActiveIndex, getItemProps } = useRovingTabindex(REQUESTS_TABS.length, {
    orientation: 'horizontal',
    wrap: true,
    defaultIndex: selectedIndex,
    onActivate: (index) => {
      const tab = REQUESTS_TABS[index];
      if (tab) onChange(tab);
    },
  });

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex, setActiveIndex]);

  useEffect(() => {
    const tray = trayRef.current;
    const selectedTab = tray?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!tray || !selectedTab) return;
    const inset = 4;
    const selectedLeft = selectedTab.offsetLeft;
    const selectedRight = selectedLeft + selectedTab.offsetWidth;
    if (selectedRight > tray.scrollLeft + tray.clientWidth - inset) {
      tray.scrollLeft = selectedRight - tray.clientWidth + inset;
    } else if (selectedLeft < tray.scrollLeft + inset) {
      tray.scrollLeft = selectedLeft - inset;
    }
  }, [value]);

  return (
    <div
      ref={trayRef}
      role="tablist"
      aria-label="Request workspaces"
      className="flex max-w-full gap-[7px] overflow-x-auto pr-1"
      data-testid="requests-mode-tray"
    >
      {REQUESTS_TABS.map((tab, index) => {
        const selected = value === tab;
        const itemProps = getItemProps(index);
        return (
          <Button
            key={tab}
            id={`requests-tab-${tab}`}
            role="tab"
            aria-selected={selected}
            aria-controls={`requests-panel-${tab}`}
            ref={itemProps.ref}
            tabIndex={activeIndex === index ? 0 : -1}
            onKeyDown={itemProps.onKeyDown}
            onFocus={itemProps.onFocus}
            onClick={itemProps.onClick}
            variant="ghost"
            size="sm"
            className={selected
              ? '!shrink-0 !rounded-[var(--radius-pill)] !border !border-[var(--brand-border-hover)] !bg-[var(--surface-3)] !px-[13px] !py-1.5 t-ui font-semibold !text-[var(--brand-text-bright)]'
              : '!shrink-0 !rounded-[var(--radius-pill)] !border !border-[var(--brand-border)] !bg-[var(--surface-2)] !px-[13px] !py-1.5 t-ui font-semibold !text-[var(--brand-text)] hover:!border-[var(--brand-border-hover)] hover:!text-[var(--brand-text-bright)]'}
          >
            {TAB_LABELS[tab]}
          </Button>
        );
      })}
    </div>
  );
}

export function RequestsLens({ workspaceId }: RequestsLensProps) {
  const badgesQuery = useWorkspaceBadges(workspaceId);
  const defaultTab: RequestsTab = (badgesQuery.data?.pendingReplies?.count ?? 0) > 0 ? 'requests' : 'deliverables';
  const state = useRequestsTabState(defaultTab);

  if (!workspaceId) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <EmptyState
          icon={({ className }) => <Icon name="message" className={className} />}
          title="Choose a workspace"
          description="Choose a workspace to load deliverables, client signals, all requests, and client actions."
        />
      </PageContainer>
    );
  }

  const activeContent = state.tab === 'deliverables'
    ? <ClientDeliverablesPane workspaceId={workspaceId} />
    : state.tab === 'signals'
      ? <AdminInbox workspaceId={workspaceId} />
      : state.tab === 'requests'
        ? <RequestManager workspaceId={workspaceId} />
        : <ClientActionsTab workspaceId={workspaceId} />;

  return (
    <div
      data-testid="requests-rebuilt"
      data-active-tab={state.tab}
      className="mx-auto min-h-full w-full max-w-[920px] px-4 pb-[90px] sm:px-[30px]"
    >
      <header data-testid="requests-header" className="mb-[22px]">
        <div className="mb-3 flex items-center gap-[9px] t-mono font-semibold uppercase tracking-[0.09em] text-[var(--blue)]">
          <span className="h-[7px] w-[7px] shrink-0 rounded-[var(--radius-pill)] bg-[var(--blue)]" aria-hidden="true" />
          Client requests · workspace inbox
        </div>
        <h1 className="t-h1 !font-bold tracking-[-0.02em] text-[var(--brand-text-bright)]">What your clients sent back.</h1>
        <p className="mt-2 max-w-[70ch] t-body leading-relaxed text-[var(--brand-text)]">
          The operator side of the portal thread. Follow deliverables and signals, manage requests, and close the loop on client actions.
        </p>
      </header>

      {state.invalidTab && (
        <div className="mb-[14px]">
          <InlineBanner
            tone="warning"
            title="Unknown Requests tab"
            message={`The requested tab is not active, so Requests opened ${TAB_LABELS[defaultTab]}.`}
            data-testid="requests-invalid-tab-fallback"
          />
        </div>
      )}

      <div className="mb-[14px]">
        <RequestsModeTray value={state.tab} onChange={state.setTab} />
      </div>

      <div
        id={`requests-panel-${state.tab}`}
        role="tabpanel"
        aria-labelledby={`requests-tab-${state.tab}`}
        data-requests-panel={state.tab}
      >
        {activeContent}
      </div>
    </div>
  );
}
