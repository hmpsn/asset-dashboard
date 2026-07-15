// @ds-rebuilt
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { WorkspaceSettings } from '../WorkspaceSettings';
import { useBackgroundTasks } from '../../hooks/useBackgroundTasks';
import { useToast } from '../Toast';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  InlineBanner,
  Toolbar,
} from '../ui';
import { queryKeys } from '../../lib/queryKeys';
import { useArchiveWorkspace, useGlobalOpsWorkspaces } from '../../hooks/admin/useGlobalOpsSettings';
import { BACKGROUND_JOB_TYPES } from '../../../shared/types/background-jobs';
import { formatDate } from './globalOpsFormatters';
import { mutationErrorMessage } from './globalOpsMutationFeedback';
import { useWorkspaceSettingsTabState } from './useGlobalOpsSurfaceState';

interface WorkspaceSettingsLensProps {
  workspaceId?: string;
}

function workspaceDomainLabel(workspace: {
  liveDomain?: string;
  gscPropertyUrl?: string;
  webflowSiteName?: string;
} | null): string {
  const source = workspace?.liveDomain
    || workspace?.gscPropertyUrl?.replace(/^sc-domain:/i, '')
    || workspace?.webflowSiteName
    || 'No live domain';
  return source.replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

function WorkspaceMissingState() {
  return (
    <div className="mx-auto min-h-full w-full max-w-[860px] px-4 pb-[90px] pt-2 sm:px-[30px]">
      <EmptyState
        icon={({ className }) => <Icon name="settings" className={className} />}
        title="Choose a workspace"
        description="Choose a workspace to load connection, publishing, and dashboard controls."
      />
    </div>
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
    <div
      data-testid="workspace-settings-rebuilt"
      data-active-tab={state.tab}
      className="mx-auto min-h-full w-full max-w-[860px] px-4 pb-[90px] pt-2 sm:px-[30px]"
    >
      {state.invalidTab && (
        <InlineBanner
          tone="warning"
          title="Unknown Workspace Settings tab"
          message="The requested tab is not active, so Workspace Settings opened Connections."
          data-testid="workspace-settings-invalid-tab-fallback"
          className="mb-4"
        />
      )}

      {workspace?.archivedAt && (
        <InlineBanner
          tone="info"
          title="Workspace is archived"
          message={`Archived ${formatDate(workspace.archivedAt)}. It is hidden from default operator lists until restored.`}
          className="mb-4"
        />
      )}

      <div className="relative">
        <Toolbar
          label="Workspace operations"
          className="mb-5 justify-end md:absolute md:right-0 md:top-0 md:z-[var(--z-sticky)] md:mb-0"
        >
          <Button variant="secondary" size="sm" onClick={handleRunAudit}>Run Audit</Button>
          <Button variant="secondary" size="sm" onClick={handleRunStrategy}>Run Strategy</Button>
          <Button
            variant={workspace?.archivedAt ? 'secondary' : 'danger'}
            size="sm"
            onClick={() => setArchiveOpen(true)}
          >
            {workspace?.archivedAt ? 'Restore' : 'Archive'}
          </Button>
        </Toolbar>

        <WorkspaceSettings
          key={workspaceId}
          workspaceId={workspaceId}
          workspaceName={workspace?.name ?? 'Workspace'}
          workspaceDomain={workspaceDomainLabel(workspace)}
          webflowSiteId={workspace?.webflowSiteId}
          webflowSiteName={workspace?.webflowSiteName}
          prototypeHeader
          onUpdate={handleLegacyUpdate}
        />
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
    </div>
  );
}
