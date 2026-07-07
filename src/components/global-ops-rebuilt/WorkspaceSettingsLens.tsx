// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceSettings } from '../WorkspaceSettings';
import { StrategySettings } from '../strategy/StrategySettings';
import { useStrategySettings } from '../strategy/hooks/useStrategySettings';
import { useKeywordStrategy } from '../../hooks/admin/useKeywordStrategy';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  GroupBlock,
  Icon,
  InlineBanner,
  PageContainer,
  PageHeader,
  Segmented,
  SectionCard,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import { queryKeys } from '../../lib/queryKeys';
import { useArchiveWorkspace, useGlobalOpsWorkspaces } from '../../hooks/admin/useGlobalOpsSettings';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import { formatDate } from './globalOpsFormatters';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import {
  WORKSPACE_SETTINGS_TABS,
  useWorkspaceSettingsTabState,
  type WorkspaceSettingsTab,
} from './useGlobalOpsSurfaceState';

interface WorkspaceSettingsLensProps {
  workspaceId?: string;
}

const TAB_LABELS: Record<WorkspaceSettingsTab, string> = {
  connections: 'Connections',
  features: 'Features',
  flags: 'Feature Flags',
  publishing: 'Publishing',
  dashboard: 'Client Dashboard',
  export: 'Data Export',
  'llms-txt': 'LLMs.txt',
};

function WorkspaceMissingState() {
  return (
    <PageContainer width="wide" className="min-h-full">
      <EmptyState
        icon={({ className }) => <Icon name="settings" className={className} />}
        title="Choose a workspace"
        description="Workspace Settings needs a workspace-scoped route before connection, publishing, and dashboard controls can load."
      />
    </PageContainer>
  );
}

export function WorkspaceSettingsLens({ workspaceId }: WorkspaceSettingsLensProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const state = useWorkspaceSettingsTabState();
  const workspaces = useGlobalOpsWorkspaces();
  const archiveWorkspace = useArchiveWorkspace();
  const { startJob } = useBackgroundTasks();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const keywordStrategy = useKeywordStrategy(workspaceId ?? '');
  const strategyInputs = useStrategySettings(
    keywordStrategy.data,
    keywordStrategy.data?.strategy ?? null,
    workspaceId ?? '',
    true,
  );

  const workspace = useMemo(
    () => (workspaces.data ?? []).find((item) => item.id === workspaceId) ?? null,
    [workspaceId, workspaces.data],
  );

  if (!workspaceId) return <WorkspaceMissingState />;

  const handleLegacyUpdate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaces() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.workspaceOverview() });
  };

  const handleRunAudit = async () => {
    if (!workspace?.webflowSiteId) {
      toast('Link a Webflow site before running an audit', 'error');
      return;
    }
    const jobId = await startJob(BACKGROUND_JOB_TYPES.SEO_AUDIT, {
      siteId: workspace.webflowSiteId,
      workspaceId,
      skipLinkCheck: false,
    });
    toast(jobId ? 'Audit job started' : 'Audit job did not start', jobId ? 'success' : 'error');
  };

  const handleRunStrategy = async () => {
    const jobId = await startJob(BACKGROUND_JOB_TYPES.KEYWORD_STRATEGY, {
      workspaceId,
      mode: 'full',
    });
    toast(jobId ? 'Strategy generation started' : 'Strategy job did not start', jobId ? 'success' : 'error');
  };

  const handleArchive = () => {
    archiveWorkspace.mutate({ workspaceId, archived: !workspace?.archivedAt }, {
      onSuccess: () => {
        toast(workspace?.archivedAt ? 'Workspace restored' : 'Workspace archived', 'success');
        setArchiveOpen(false);
      },
      onError: (error) => toast(mutationErrorMessage(error, 'Workspace archive update failed'), 'error'),
    });
  };

  return (
    <PageContainer width="wide" className="min-h-full" gap={false}>
      <div data-testid="workspace-settings-rebuilt" data-active-tab={state.tab} className="flex flex-col gap-[var(--section-gap)]">
        <PageHeader
          title="Workspace Settings"
          subtitle={workspace?.name ?? 'Workspace configuration, publishing, portal controls, and setup operations.'}
          actions={
            <Toolbar label="Workspace settings actions">
              <Button variant="secondary" size="sm" onClick={handleRunAudit}>Run Audit</Button>
              <Button variant="secondary" size="sm" onClick={handleRunStrategy}>Run Strategy</Button>
              <Button variant={workspace?.archivedAt ? 'secondary' : 'danger'} size="sm" onClick={() => setArchiveOpen(true)}>
                {workspace?.archivedAt ? 'Restore' : 'Archive'}
              </Button>
            </Toolbar>
          }
        />

        {state.invalidTab && (
          <InlineBanner
            tone="warning"
            title="Unknown Workspace Settings tab"
            message="The requested tab is not active, so Workspace Settings opened Connections."
            data-testid="workspace-settings-invalid-tab-fallback"
          />
        )}

        {workspace?.archivedAt && (
          <InlineBanner
            tone="info"
            title="Workspace is archived"
            message={`Archived ${formatDate(workspace.archivedAt)}. It is hidden from default admin workspace lists until restored.`}
          />
        )}

        <Segmented
          options={WORKSPACE_SETTINGS_TABS.map((tab) => ({ value: tab, label: TAB_LABELS[tab] }))}
          value={state.tab}
          onChange={(value) => state.setTab(value as WorkspaceSettingsTab)}
          className="max-w-full overflow-x-auto"
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col gap-4">
            <SectionCard title="Setup State" titleIcon={<Icon name="gauge" size="md" className="text-[var(--blue)]" />}>
              {workspaces.isLoading ? (
                <Skeleton className="h-[180px] w-full" />
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption text-[var(--brand-text)]">Webflow</span>
                    <Badge label={workspace?.webflowSiteId ? 'Linked' : 'Not linked'} tone={workspace?.webflowSiteId ? 'emerald' : 'amber'} variant="soft" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption text-[var(--brand-text)]">Search Console</span>
                    <Badge label={workspace?.gscPropertyUrl ? 'Connected' : 'Missing'} tone={workspace?.gscPropertyUrl ? 'emerald' : 'amber'} variant="soft" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption text-[var(--brand-text)]">GA4</span>
                    <Badge label={workspace?.ga4PropertyId ? 'Connected' : 'Missing'} tone={workspace?.ga4PropertyId ? 'emerald' : 'amber'} variant="soft" />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption text-[var(--brand-text)]">Client portal</span>
                    <Badge label={workspace?.clientPortalEnabled ? 'Enabled' : 'Disabled'} tone={workspace?.clientPortalEnabled ? 'teal' : 'zinc'} variant="soft" />
                  </div>
                </div>
              )}
            </SectionCard>

            <GroupBlock
              title="Locked workbench preview"
              meta="Cold start"
              defaultOpen
              stats={[
                { label: 'Tier', value: workspace?.tier ?? 'free' },
                { label: 'Auto reports', value: workspace?.autoReports ? workspace.autoReportFrequency ?? 'on' : 'off' },
              ]}
            >
              <p className="t-caption text-[var(--brand-text-muted)]">
                Operators can complete connections, run the first audit, generate the initial strategy, and then open client dashboard controls from this settings workbench.
              </p>
              <Toolbar label="Cold-start actions" className="mt-3">
                <Button variant="secondary" size="sm" onClick={() => state.setTab('connections')}>Connections</Button>
                <Button variant="secondary" size="sm" onClick={() => state.setTab('dashboard')}>Dashboard</Button>
                <ToolbarSpacer />
              </Toolbar>
            </GroupBlock>

            <SectionCard
              title="Strategy Inputs"
              titleIcon={<Icon name="swords" size="md" className="text-[var(--teal)]" />}
              titleExtra={<Badge label="Edit home" tone="teal" variant="soft" />}
              noPadding
            >
              <div className="p-3">
                <StrategySettings
                  workspaceId={workspaceId}
                  isAuxLoading={keywordStrategy.isAuxLoading}
                  settingsOpen={strategyInputs.settingsOpen}
                  setSettingsOpen={strategyInputs.setSettingsOpen}
                  seoDataAvailable={strategyInputs.seoDataAvailable}
                  seoDataMode={strategyInputs.seoDataMode}
                  setSeoDataMode={strategyInputs.setSeoDataMode}
                  maxPages={strategyInputs.maxPages}
                  setMaxPages={strategyInputs.setMaxPages}
                  competitors={strategyInputs.competitors}
                  setCompetitors={strategyInputs.setCompetitors}
                  businessContext={strategyInputs.businessContext}
                  setBusinessContext={strategyInputs.setBusinessContext}
                  contextOpen={strategyInputs.contextOpen}
                  setContextOpen={strategyInputs.setContextOpen}
                  discoveringCompetitors={strategyInputs.discoveringCompetitors}
                  discoverError={strategyInputs.discoverError}
                  onDiscoverCompetitors={strategyInputs.discoverCompetitors}
                />
              </div>
            </SectionCard>
          </div>

          <SectionCard
            title={TAB_LABELS[state.tab]}
            titleExtra={<Badge label="Carry-over parity" tone="blue" variant="soft" />}
            noPadding
          >
            <div className="p-4">
              <WorkspaceSettings
                key={`${workspaceId}:${state.tab}`}
                workspaceId={workspaceId}
                workspaceName={workspace?.name ?? 'Workspace'}
                webflowSiteId={workspace?.webflowSiteId}
                webflowSiteName={workspace?.webflowSiteName}
                onUpdate={handleLegacyUpdate}
              />
            </div>
          </SectionCard>
        </div>
      </div>

      <ConfirmDialog
        open={archiveOpen}
        title={workspace?.archivedAt ? 'Restore workspace?' : 'Archive workspace?'}
        message={workspace?.archivedAt
          ? 'This returns the workspace to default operator lists.'
          : 'This hides the workspace from default operator lists but preserves data, history, and client records.'}
        confirmLabel={workspace?.archivedAt ? 'Restore workspace' : 'Archive workspace'}
        variant={workspace?.archivedAt ? 'default' : 'destructive'}
        onCancel={() => setArchiveOpen(false)}
        onConfirm={handleArchive}
      />
    </PageContainer>
  );
}
