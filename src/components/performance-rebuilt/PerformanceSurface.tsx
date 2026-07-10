// @ds-rebuilt
import { useMemo } from 'react';
import { useWorkspaces } from '../../hooks/admin';
import { Badge, ErrorState, LensSwitcher, PageHeader, Skeleton, Toolbar, ToolbarSpacer } from '../ui';
import { PageSpeedLens } from './PageSpeedLens';
import { PageWeightLens } from './PageWeightLens';
import { PERFORMANCE_LENSES, type PerformanceLens, usePerformanceSurfaceState } from './usePerformanceSurfaceState';

interface PerformanceSurfaceProps {
  workspaceId: string;
}

const PERFORMANCE_SUBTITLE = 'Page weight and Core Web Vitals. Heavy pages fix in Asset Manager.';

export function PerformanceSurface({ workspaceId }: PerformanceSurfaceProps) {
  const state = usePerformanceSurfaceState();
  const workspaces = useWorkspaces();
  const workspace = useMemo(
    () => workspaces.data?.find((item) => item.id === workspaceId),
    [workspaceId, workspaces.data],
  );
  const siteId = workspace?.webflowSiteId;

  if (workspaces.isLoading && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5" aria-label="Loading Performance">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (workspaces.isError && !workspace) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Performance"
          subtitle={PERFORMANCE_SUBTITLE}
          variant="rebuilt-admin"
        />
        <ErrorState
          type="data"
          title="Workspace details did not load"
          message="Retry the workspace read before reviewing performance."
          action={{ label: 'Retry', onClick: () => workspaces.refetch() }}
          className="min-h-[420px]"
        />
      </div>
    );
  }

  if (!workspace || !siteId) {
    return (
      <div className="flex min-h-full flex-col gap-5">
        <PageHeader
          title="Performance"
          subtitle={PERFORMANCE_SUBTITLE}
          variant="rebuilt-admin"
        />
        <ErrorState
          type="permission"
          title="Connect a Webflow site first"
          message="Performance scans need a linked Webflow site before page weight or PageSpeed data can be restored."
          className="min-h-[420px]"
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col gap-5">
      <PageHeader
        title="Performance"
        subtitle={PERFORMANCE_SUBTITLE}
        variant="rebuilt-admin"
      />

      <Toolbar label="Performance view controls" className="w-full">
        <LensSwitcher
          id="performance-rebuilt-lens"
          options={PERFORMANCE_LENSES.map((lens) => ({
            value: lens.id,
            label: lens.label,
          }))}
          value={state.lens}
          onChange={(value) => state.setLens(value as PerformanceLens)}
          size="sm"
        />
        <ToolbarSpacer />
        <Badge label={workspace.webflowSiteName ?? siteId} tone="blue" variant="outline" size="sm" />
      </Toolbar>

      {state.lens === 'weight' ? (
        <PageWeightLens workspaceId={workspaceId} siteId={siteId} />
      ) : (
        <PageSpeedLens workspaceId={workspaceId} siteId={siteId} />
      )}
    </div>
  );
}

export default PerformanceSurface;
