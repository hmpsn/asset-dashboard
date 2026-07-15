// @ds-rebuilt
import { useMemo } from 'react';
import { useWorkspaces } from '../../hooks/admin';
import { ErrorState, LensSwitcher, PageHeader, Skeleton } from '../ui';
import { PageSpeedLens } from './PageSpeedLens';
import { PageWeightLens } from './PageWeightLens';
import { PERFORMANCE_LENSES, type PerformanceLens, usePerformanceSurfaceState } from './usePerformanceSurfaceState';

interface PerformanceSurfaceProps {
  workspaceId: string;
}

const PERFORMANCE_SUBTITLE = 'Page weight and Core Web Vitals — the detect side of speed. Heavy pages fix in the Asset Manager.';
const SURFACE_WRAP_CLASS = 'mx-auto flex min-h-full w-full max-w-[1080px] flex-col gap-4 px-4 pb-20 sm:px-[30px]';

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
      <div className={SURFACE_WRAP_CLASS} aria-label="Loading Performance">
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-[54px] w-full" />
        <Skeleton className="h-[360px] w-full" />
      </div>
    );
  }

  if (workspaces.isError && !workspace) {
    return (
      <div className={SURFACE_WRAP_CLASS}>
        <PageHeader
          title="Performance"
          subtitle={PERFORMANCE_SUBTITLE}
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
      <div className={SURFACE_WRAP_CLASS}>
        <PageHeader
          title="Performance"
          subtitle={PERFORMANCE_SUBTITLE}
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
    <div className={SURFACE_WRAP_CLASS}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 flex-none rounded-[var(--radius-pill)] bg-[var(--blue)]" aria-hidden="true" />
          <span className="truncate t-micro font-semibold uppercase tracking-[0.14em] text-[var(--brand-text-muted)]">
            Performance · {workspace.name}
          </span>
        </div>
        <span className="truncate t-caption-sm text-[var(--brand-text-muted)]">
          {workspace.webflowSiteName ?? siteId}
        </span>
      </div>

      <PageHeader
        title="Performance"
        subtitle={PERFORMANCE_SUBTITLE}
        className="max-w-[760px]"
      />

      <div className="max-w-full overflow-x-auto pb-px" role="group" aria-label="Performance view controls">
        <LensSwitcher
          id="performance-rebuilt-lens"
          options={PERFORMANCE_LENSES.map((lens) => ({
            value: lens.id,
            label: lens.label,
          }))}
          value={state.lens}
          onChange={(value) => state.setLens(value as PerformanceLens)}
          size="sm"
          mono
        />
      </div>

      {state.lens === 'weight' ? (
        <PageWeightLens key={`${workspaceId}:${siteId}:weight`} workspaceId={workspaceId} siteId={siteId} />
      ) : (
        <PageSpeedLens key={`${workspaceId}:${siteId}:speed`} workspaceId={workspaceId} siteId={siteId} />
      )}
    </div>
  );
}

export default PerformanceSurface;
