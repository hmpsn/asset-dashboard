import { X, FolderOpen } from 'lucide-react';
import { Button, Icon } from '../ui';

interface OrganizePlan {
  foldersToCreate: string[];
  moves: Array<{ assetId: string; assetName: string; targetFolder: string }>;
  summary: {
    totalAssets: number;
    assetsToMove: number;
    foldersToCreate: number;
    alreadyOrganized: number;
    unused: number;
    shared: number;
    ogImages: number;
  };
}

interface OrganizePreviewProps {
  organizePreview: OrganizePlan;
  organizeExecuting: boolean;
  onExecute: () => void;
  onCancel: () => void;
}

export function OrganizePreview({
  organizePreview, organizeExecuting, onExecute, onCancel,
}: OrganizePreviewProps) {
  return (
    <div className="p-4 bg-teal-950/40 border border-teal-800/50 rounded-[var(--radius-md)] space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-teal-200 flex items-center gap-2">
          <Icon as={FolderOpen} size="md" /> Organization Plan
        </h3>
        <button onClick={onCancel} className="text-[var(--brand-text-muted)] hover:text-[var(--brand-text)]">
          <Icon as={X} size="md" />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-md)] p-2">
          <div className="text-lg font-bold text-teal-300">{organizePreview.summary.assetsToMove}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)]">Assets to move</div>
        </div>
        <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-md)] p-2">
          <div className="text-lg font-bold text-teal-300">{organizePreview.summary.foldersToCreate}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)]">New folders</div>
        </div>
        <div className="bg-[var(--surface-2)]/60 rounded-[var(--radius-md)] p-2">
          <div className="text-lg font-bold text-[var(--brand-text)]">{organizePreview.summary.alreadyOrganized}</div>
          <div className="t-caption-sm text-[var(--brand-text-muted)]">Already organized</div>
        </div>
      </div>

      {/* Folder breakdown */}
      <div className="max-h-48 overflow-y-auto space-y-1 text-xs">
        {(() => {
          const byFolder = new Map<string, string[]>();
          for (const m of organizePreview.moves) {
            const list = byFolder.get(m.targetFolder) || [];
            list.push(m.assetName);
            byFolder.set(m.targetFolder, list);
          }
          return [...byFolder.entries()].sort((a, b) => b[1].length - a[1].length).map(([folder, assetNames]) => (
            <details key={folder} className="group">
              <summary className="cursor-pointer flex items-center gap-2 px-2 py-1.5 bg-[var(--surface-2)]/40 rounded hover:bg-[var(--surface-2)]/60 transition-colors">
                <Icon as={FolderOpen} size="sm" className="text-teal-400 shrink-0" />
                <span className="text-[var(--brand-text-bright)] font-medium truncate">{folder}</span>
                <span className="ml-auto text-[var(--brand-text-muted)] shrink-0">{assetNames.length} assets</span>
              </summary>
              <div className="ml-7 mt-1 space-y-0.5 text-[var(--brand-text-muted)]">
                {assetNames.slice(0, 10).map((name, i) => (
                  <div key={i} className="truncate">{name}</div>
                ))}
                {assetNames.length > 10 && <div className="text-[var(--brand-text-muted)]">...and {assetNames.length - 10} more</div>}
              </div>
            </details>
          ));
        })()}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="primary"
          size="md"
          icon={FolderOpen}
          loading={organizeExecuting}
          disabled={organizeExecuting}
          onClick={onExecute}
        >
          {organizeExecuting ? 'Organizing...' : 'Apply Organization'}
        </Button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[var(--brand-text)] hover:text-[var(--brand-text-bright)] text-xs transition-colors"
        >
          Cancel
        </button>
        {(organizePreview.summary.unused > 0 || organizePreview.summary.ogImages > 0) && (
          <span className="ml-auto t-caption-sm text-[var(--brand-text-muted)]">
            {organizePreview.summary.ogImages > 0 && <>{organizePreview.summary.ogImages} OG images &rarr; _Social / OG Images</>}
            {organizePreview.summary.ogImages > 0 && organizePreview.summary.unused > 0 && ' · '}
            {organizePreview.summary.unused > 0 && <>{organizePreview.summary.unused} unused &rarr; _Unused Assets</>}
            {(organizePreview.summary.unused > 0 || organizePreview.summary.ogImages > 0) && organizePreview.summary.shared > 0 && ' · '}
            {organizePreview.summary.shared > 0 && <>{organizePreview.summary.shared} shared &rarr; _Shared Assets</>}
          </span>
        )}
      </div>
    </div>
  );
}
