/**
 * BulkActions — Bulk action toolbar shown when assets are selected.
 * Extracted from AssetBrowser.tsx bulk actions section.
 */
import { Loader2, Sparkles, Trash2, Minimize2, Wand2 } from 'lucide-react';

export interface BulkActionsProps {
  selectedCount: number;
  bulkProgress: { done: number; total: number } | null;
  bulkRenameProgress: { done: number; total: number } | null;
  bulkCompressProgress: { done: number; total: number } | null;
  deleting: boolean;
  onBulkGenerateAlt: () => void;
  onBulkRename: () => void;
  onBulkCompress: () => void;
  onBulkDelete: () => void;
  onClearSelection: () => void;
}

export function BulkActions({
  selectedCount, bulkProgress, bulkRenameProgress, bulkCompressProgress, deleting,
  onBulkGenerateAlt, onBulkRename, onBulkCompress, onBulkDelete, onClearSelection,
}: BulkActionsProps) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-900 border border-zinc-700 rounded-lg text-sm sticky top-0 z-20 shadow-lg shadow-black/30">
      <span className="text-zinc-300 font-medium">{selectedCount} selected</span>
      <button
        onClick={onBulkGenerateAlt}
        disabled={!!bulkProgress}
        className="flex items-center gap-1.5 px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkProgress ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
        ) : (
          <><Sparkles className="w-3 h-3" /> Generate Alt Text</>
        )}
      </button>
      <button
        onClick={onBulkRename}
        disabled={!!bulkRenameProgress}
        className="flex items-center gap-1.5 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkRenameProgress ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> {bulkRenameProgress.done}/{bulkRenameProgress.total}</>
        ) : (
          <><Wand2 className="w-3 h-3" /> Smart Rename</>
        )}
      </button>
      <button
        onClick={onBulkCompress}
        disabled={!!bulkCompressProgress}
        className="flex items-center gap-1.5 px-3 py-1 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkCompressProgress ? (
          <><Loader2 className="w-3 h-3 animate-spin" /> {bulkCompressProgress.done}/{bulkCompressProgress.total}</>
        ) : (
          <><Minimize2 className="w-3 h-3" /> Compress</>
        )}
      </button>
      <button
        onClick={onBulkDelete}
        disabled={deleting}
        className="flex items-center gap-1.5 px-3 py-1 bg-red-900/50 hover:bg-red-800 text-red-300 rounded text-xs font-medium transition-colors"
      >
        <Trash2 className="w-3 h-3" /> {deleting ? 'Deleting...' : 'Delete'}
      </button>
      <button
        onClick={onClearSelection}
        className="ml-auto text-zinc-500 hover:text-zinc-300 text-xs"
      >
        Clear selection
      </button>
    </div>
  );
}
