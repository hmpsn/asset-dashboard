// @ds-rebuilt
import { FolderOpen } from 'lucide-react';
import {
  Button,
  Drawer,
  Icon,
  InlineBanner,
  MetricTile,
  Skeleton,
  Toolbar,
  ToolbarSpacer,
} from '../ui';
import type { BulkResult, OrganizePlan } from './types';

interface OrganizeDrawerProps {
  open: boolean;
  loading: boolean;
  executing: boolean;
  plan: OrganizePlan | null;
  result: BulkResult | null;
  onPreview: () => void;
  onExecute: () => void;
  onClose: () => void;
}

function groupMoves(plan: OrganizePlan): Array<{ folder: string; assets: string[] }> {
  const byFolder = new Map<string, string[]>();
  for (const move of plan.moves) {
    const list = byFolder.get(move.targetFolder) ?? [];
    list.push(move.assetName);
    byFolder.set(move.targetFolder, list);
  }
  return [...byFolder.entries()]
    .map(([folder, assets]) => ({ folder, assets }))
    .sort((a, b) => b.assets.length - a.assets.length);
}

export function OrganizeDrawer({
  open,
  loading,
  executing,
  plan,
  result,
  onPreview,
  onExecute,
  onClose,
}: OrganizeDrawerProps) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Organize assets"
      subtitle="Preview folder creation and asset moves before applying changes to Webflow."
      eyebrow="Folder plan"
      width={620}
      footer={(
        <Toolbar label="Organize actions" className="w-full border-none bg-transparent p-0">
          <Button size="sm" variant="secondary" onClick={onPreview} loading={loading} disabled={loading || executing}>
            <Icon as={FolderOpen} size="sm" />
            Refresh preview
          </Button>
          <ToolbarSpacer />
          <Button size="sm" variant="primary" onClick={onExecute} loading={executing} disabled={!plan || loading || executing}>
            Apply organization
          </Button>
        </Toolbar>
      )}
    >
      <div className="flex flex-col gap-4">
        {result && (
          <InlineBanner tone={result.tone} title={result.title}>
            {result.message}
          </InlineBanner>
        )}

        {loading && (
          <div className="flex flex-col gap-3" aria-label="Loading organization preview">
            <Skeleton className="h-[92px] w-full" />
            <Skeleton className="h-[180px] w-full" />
          </div>
        )}

        {!loading && !plan && (
          <InlineBanner tone="info" title="No preview loaded">
            Run a preview to see proposed folders and moves before changing the asset library.
          </InlineBanner>
        )}

        {!loading && plan && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricTile label="Assets to move" value={plan.summary.assetsToMove} accent="var(--teal)" />
              <MetricTile label="New folders" value={plan.summary.foldersToCreate} accent="var(--blue)" />
              <MetricTile label="Already organized" value={plan.summary.alreadyOrganized} accent="var(--brand-text-bright)" />
            </div>

            {(plan.summary.unused > 0 || plan.summary.ogImages > 0 || plan.summary.shared > 0) && (
              <InlineBanner tone="info" title="Routing rules applied">
                {plan.summary.ogImages > 0 && `${plan.summary.ogImages} OG images route to _Social / OG Images. `}
                {plan.summary.unused > 0 && `${plan.summary.unused} unused assets route to _Unused Assets. `}
                {plan.summary.shared > 0 && `${plan.summary.shared} shared assets route to _Shared Assets.`}
              </InlineBanner>
            )}

            <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-1)]">
              <div className="border-b border-[var(--brand-border)] px-4 py-3 t-label text-[var(--brand-text-muted)]">
                Folder breakdown
              </div>
              <div className="max-h-[420px] overflow-y-auto p-3">
                {groupMoves(plan).map(({ folder, assets }) => (
                  <details key={folder} className="group border-t border-[var(--brand-border)] first:border-t-0">
                    <summary className="flex cursor-pointer items-center gap-2 py-2 t-caption text-[var(--brand-text)]">
                      <Icon as={FolderOpen} size="sm" className="text-[var(--teal)]" />
                      <span className="min-w-0 flex-1 truncate font-semibold text-[var(--brand-text-bright)]">{folder}</span>
                      <span className="t-mono text-[var(--brand-text-muted)]">{assets.length}</span>
                    </summary>
                    <div className="mb-2 ml-6 flex flex-col gap-1">
                      {assets.slice(0, 14).map((assetName) => (
                        <span key={assetName} className="truncate t-caption-sm text-[var(--brand-text-muted)]">
                          {assetName}
                        </span>
                      ))}
                      {assets.length > 14 && (
                        <span className="t-caption-sm text-[var(--brand-text-muted)]">
                          and {assets.length - 14} more
                        </span>
                      )}
                    </div>
                  </details>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}
