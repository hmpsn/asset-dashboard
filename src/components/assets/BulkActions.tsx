/**
 * BulkActions — Bulk action toolbar shown when assets are selected.
 * Extracted from AssetBrowser.tsx bulk actions section.
 */
import { Loader2, Sparkles, Trash2, Minimize2, Wand2 } from 'lucide-react';
import { Icon, Button } from '../ui';

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
    <div className="flex items-center gap-3 px-4 py-2.5 bg-[var(--surface-2)] border border-[var(--brand-border-hover)] rounded-[var(--radius-md)] text-sm sticky top-0 z-[var(--z-dropdown)] shadow-lg shadow-black/30">
      <span className="text-[var(--brand-text-bright)] font-medium">{selectedCount} selected</span>
      <Button
        onClick={onBulkGenerateAlt}
        disabled={!!bulkProgress}
        variant="ghost"
        size="sm"
        className="flex items-center gap-1.5 px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkProgress ? (
          <><Icon as={Loader2} size="sm" className="animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
        ) : (
          <><Icon as={Sparkles} size="sm" /> Generate Alt Text</>
        )}
      </Button>
      <Button
        onClick={onBulkRename}
        disabled={!!bulkRenameProgress}
        variant="ghost"
        size="sm"
        className="flex items-center gap-1.5 px-3 py-1 bg-cyan-700 hover:bg-cyan-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkRenameProgress ? (
          <><Icon as={Loader2} size="sm" className="animate-spin" /> {bulkRenameProgress.done}/{bulkRenameProgress.total}</>
        ) : (
          <><Icon as={Wand2} size="sm" /> Smart Rename</>
        )}
      </Button>
      <Button
        onClick={onBulkCompress}
        disabled={!!bulkCompressProgress}
        variant="ghost"
        size="sm"
        className="flex items-center gap-1.5 px-3 py-1 bg-orange-700 hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-xs font-medium transition-colors"
      >
        {bulkCompressProgress ? (
          <><Icon as={Loader2} size="sm" className="animate-spin" /> {bulkCompressProgress.done}/{bulkCompressProgress.total}</>
        ) : (
          <><Icon as={Minimize2} size="sm" /> Compress</>
        )}
      </Button>
      <Button
        onClick={onBulkDelete}
        disabled={deleting}
        variant="ghost"
        size="sm"
        className="flex items-center gap-1.5 px-3 py-1 bg-red-900/50 hover:bg-red-800 text-red-300 rounded text-xs font-medium transition-colors"
      >
        <Icon as={Trash2} size="sm" /> {deleting ? 'Deleting...' : 'Delete'}
      </Button>
      <Button
        onClick={onClearSelection}
        variant="ghost"
        size="sm"
        className="ml-auto text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] text-xs"
      >
        Clear selection
      </Button>
    </div>
  );
}
