import { Loader2, X, FolderOpen } from 'lucide-react';

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
    <div className="p-4 bg-teal-950/40 border border-teal-800/50 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-teal-200 flex items-center gap-2">
          <FolderOpen className="w-4 h-4" /> Organization Plan
        </h3>
        <button onClick={onCancel} className="text-zinc-500 hover:text-zinc-300">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-zinc-900/60 rounded-lg p-2">
          <div className="text-lg font-bold text-teal-300">{organizePreview.summary.assetsToMove}</div>
          <div className="text-[11px] text-zinc-500">Assets to move</div>
        </div>
        <div className="bg-zinc-900/60 rounded-lg p-2">
          <div className="text-lg font-bold text-cyan-300">{organizePreview.summary.foldersToCreate}</div>
          <div className="text-[11px] text-zinc-500">New folders</div>
        </div>
        <div className="bg-zinc-900/60 rounded-lg p-2">
          <div className="text-lg font-bold text-zinc-400">{organizePreview.summary.alreadyOrganized}</div>
          <div className="text-[11px] text-zinc-500">Already organized</div>
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
              <summary className="cursor-pointer flex items-center gap-2 px-2 py-1.5 bg-zinc-900/40 rounded hover:bg-zinc-900/60 transition-colors">
                <FolderOpen className="w-3 h-3 text-teal-400 shrink-0" />
                <span className="text-zinc-200 font-medium truncate">{folder}</span>
                <span className="ml-auto text-zinc-500 shrink-0">{assetNames.length} assets</span>
              </summary>
              <div className="ml-7 mt-1 space-y-0.5 text-zinc-500">
                {assetNames.slice(0, 10).map((name, i) => (
                  <div key={i} className="truncate">{name}</div>
                ))}
                {assetNames.length > 10 && <div className="text-zinc-500">...and {assetNames.length - 10} more</div>}
              </div>
            </details>
          ));
        })()}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onExecute}
          disabled={organizeExecuting}
          className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 rounded-lg text-xs font-semibold transition-colors"
        >
          {organizeExecuting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Organizing...</> : <><FolderOpen className="w-3.5 h-3.5" /> Apply Organization</>}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-xs transition-colors"
        >
          Cancel
        </button>
        {(organizePreview.summary.unused > 0 || organizePreview.summary.ogImages > 0) && (
          <span className="ml-auto text-[11px] text-zinc-500">
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
