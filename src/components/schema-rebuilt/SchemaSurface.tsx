// @ds-rebuilt
import { useCallback } from 'react';
import { BookOpen, FileJson, RefreshCw } from 'lucide-react';
import { useWorkspaceEvents } from '../../hooks/useWorkspaceEvents';
import { WS_EVENTS } from '../../lib/wsEvents';
import { useAdminSchemaWorkspace, useInvalidateAdminSchemaQueries } from '../../hooks/admin/useAdminSchema';
import { Button, ErrorState, Icon, LensSwitcher, PageHeader, Skeleton, Toolbar, ToolbarSpacer } from '../ui';
import { GeneratorLens } from './GeneratorLens';
import { WorkflowGuideLens } from './WorkflowGuideLens';
import { useSchemaSurfaceState, type SchemaSurfaceTab } from './useSchemaSurfaceState';

interface SchemaSurfaceProps {
  workspaceId: string;
}

const LENS_ICONS: Record<SchemaSurfaceTab, typeof FileJson> = {
  generator: FileJson,
  guide: BookOpen,
};

export function SchemaSurface({ workspaceId }: SchemaSurfaceProps) {
  const state = useSchemaSurfaceState();
  const workspaceState = useAdminSchemaWorkspace(workspaceId);
  const invalidateSchema = useInvalidateAdminSchemaQueries(workspaceId, workspaceState.siteId);

  const refreshSchema = useCallback(() => {
    invalidateSchema();
  }, [invalidateSchema]);

  useWorkspaceEvents(workspaceId, {
    // ws-invalidation-ok — rebuilt Schema owns schema plan refresh while mounted outside legacy SchemaSuggester.
    [WS_EVENTS.SCHEMA_PLAN_UPDATED]: refreshSchema,
    // ws-invalidation-ok — client-send state can affect pending approvals and schema plan status.
    [WS_EVENTS.SCHEMA_PLAN_SENT]: refreshSchema,
    // ws-invalidation-ok — CMS mapping changes affect publish availability on generated rows.
    [WS_EVENTS.SCHEMA_CMS_MAPPING_UPDATED]: refreshSchema,
    // ws-invalidation-ok — generated schema snapshots are the main read model for this rebuilt surface.
    [WS_EVENTS.SCHEMA_SNAPSHOT_UPDATED]: refreshSchema,
    // ws-invalidation-ok — schema approval batches and pending panels update after approval changes.
    [WS_EVENTS.APPROVAL_UPDATE]: refreshSchema,
  });

  const lensOptions = state.tabOptions.map((option) => ({
    ...option,
    icon: LENS_ICONS[option.value as SchemaSurfaceTab],
  }));

  if (workspaceState.isLoading && !workspaceState.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Schema">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  if (workspaceState.isError && !workspaceState.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Schema" subtitle="Generate, validate, approve, and publish structured data." />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before generating schema."
          action={{ label: 'Retry', onClick: workspaceState.refetch }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!workspaceState.workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Schema" subtitle="Generate, validate, approve, and publish structured data." />
        <ErrorState type="data" title="Workspace not found" message="Choose a workspace before generating schema." className="min-h-[420px]" />
      </div>
    );
  }

  if (!workspaceState.siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader title="Schema" subtitle="Generate, validate, approve, and publish structured data." />
        <ErrorState
          type="permission"
          title="Connect a Webflow site first"
          message="Schema generation requires a linked Webflow site."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Schema"
        subtitle={state.tab === 'guide'
          ? 'Workflow reference for plan, generation, validation, publishing, delivery, and measurement.'
          : 'Generate JSON-LD, review page-level evidence, validate graph safety, and publish through existing schema services.'}
        actions={(
          <Button
            size="sm"
            variant="secondary"
            onClick={refreshSchema}
          >
            <Icon as={RefreshCw} size="sm" />
            Refresh
          </Button>
        )}
      />

      <Toolbar label="Schema controls">
        <LensSwitcher
          options={lensOptions}
          value={state.tab}
          onChange={(value) => state.setTab(value as SchemaSurfaceTab)}
          size="sm"
        />
        <ToolbarSpacer />
        <span className="t-caption text-[var(--brand-text-muted)]">
          {workspaceState.workspace.webflowSiteName || workspaceState.workspace.name}
        </span>
      </Toolbar>

      {state.tab === 'guide' ? (
        <WorkflowGuideLens />
      ) : (
        <GeneratorLens
          siteId={workspaceState.siteId}
          workspaceId={workspaceId}
          fixContext={state.fixContext}
          businessProfile={workspaceState.workspace.businessProfile}
          intelligenceProfile={workspaceState.workspace.intelligenceProfile}
        />
      )}
    </div>
  );
}

export default SchemaSurface;
