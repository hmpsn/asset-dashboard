// @ds-rebuilt
import { AdminInbox } from '../admin/AdminInbox';
import { ClientActionsTab } from '../admin/ClientActionsTab';
import { ClientDeliverablesPane } from '../admin/ClientDeliverablesPane';
import { RequestManager } from '../RequestManager';
import {
  Badge,
  EmptyState,
  Icon,
  InlineBanner,
  PageContainer,
  PageHeader,
  Segmented,
  SectionCard,
} from '../ui';
import { REQUESTS_TABS, useRequestsTabState, type RequestsTab } from './useGlobalOpsSurfaceState';

interface RequestsLensProps {
  workspaceId?: string;
}

const TAB_LABELS: Record<RequestsTab, string> = {
  deliverables: 'Deliverables',
  signals: 'Signals',
  requests: 'All Requests',
  actions: 'Client Actions',
};

export function RequestsLens({ workspaceId }: RequestsLensProps) {
  const state = useRequestsTabState();

  if (!workspaceId) {
    return (
      <PageContainer width="wide" className="min-h-full">
        <EmptyState
          icon={({ className }) => <Icon name="message" className={className} />}
          title="Choose a workspace"
          description="The Requests feed needs a workspace-scoped route before deliverables, signals, and client actions can load."
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
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="requests-rebuilt" data-active-tab={state.tab} className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Requests"
          subtitle="Unified operator feed for deliverables, client signals, all requests, and client actions."
          actions={<Badge label="Promote to signal deferred" tone="amber" variant="soft" />}
        />

        {state.invalidTab && (
          <InlineBanner
            tone="warning"
            title="Unknown Requests tab"
            message="The requested tab is not active, so Requests opened Deliverables."
            data-testid="requests-invalid-tab-fallback"
          />
        )}

        <Segmented
          options={REQUESTS_TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
          value={state.tab}
          onChange={(value) => state.setTab(value as RequestsTab)}
          className="max-w-full overflow-x-auto"
        />

        <SectionCard
          title={TAB_LABELS[state.tab]}
          titleIcon={<Icon name={state.tab === 'deliverables' ? 'send' : state.tab === 'signals' ? 'bell' : state.tab === 'requests' ? 'message' : 'check'} size="md" className="text-[var(--teal)]" />}
          noPadding
        >
          <div className="p-4">{activeContent}</div>
        </SectionCard>
      </div>
    </PageContainer>
  );
}
