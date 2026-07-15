// @ds-rebuilt
import type { AdminWorkspaceView } from '../../../../shared/types/workspace';
import { Icon, SectionCard, Skeleton } from '../../ui';

interface WebflowConnectionsCardProps {
  workspaces: AdminWorkspaceView[];
  loading: boolean;
}

export function WebflowConnectionsCard({ workspaces, loading }: WebflowConnectionsCardProps) {
  return (
    <SectionCard
      title="Webflow Connections"
      subtitle="Link sites from each workspace’s connection settings"
      titleIcon={<Icon name="globe" size="md" className="text-[var(--blue)]" />}
      iconChip
      noPadding
    >
      {loading ? (
        <div className="space-y-2 px-[18px] py-3">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      ) : workspaces.length === 0 ? (
        <p className="px-[18px] py-4 t-caption text-[var(--brand-text-muted)]">
          No workspaces yet. Create one before linking a Webflow site.
        </p>
      ) : (
        <div className="max-h-[248px] divide-y divide-[var(--brand-border)] overflow-y-auto">
          {workspaces.map((workspace) => {
            const linked = Boolean(workspace.webflowSiteId);
            return (
              <div
                key={workspace.id}
                className={`flex min-h-10 items-center gap-3 px-[18px] py-2 ${linked ? '' : 'opacity-60'}`}
              >
                <Icon
                  name={linked ? 'check' : 'link'}
                  size="sm"
                  className={linked ? 'text-[var(--emerald)]' : 'text-[var(--brand-text-muted)]'}
                />
                <span className="min-w-0 flex-1 truncate t-caption font-semibold text-[var(--brand-text-bright)]">
                  {workspace.name}
                </span>
                <span className="max-w-[46%] truncate t-caption-sm text-[var(--brand-text-muted)]">
                  {workspace.webflowSiteName ?? 'Not linked'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
