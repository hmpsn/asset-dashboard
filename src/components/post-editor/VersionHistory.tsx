/**
 * VersionHistory — Version history panel with revert button.
 * Extracted from PostEditor.tsx version history section.
 */
import { Loader2, X, History, RotateCcw } from 'lucide-react';

interface Version {
  id: string;
  versionNumber: number;
  trigger: string;
  triggerDetail?: string;
  totalWordCount: number;
  createdAt: string;
}

export interface VersionHistoryProps {
  versions: Version[];
  versionsLoading: boolean;
  reverting: string | null;
  onRevert: (versionId: string) => void;
  onClose: () => void;
}

export function VersionHistory({
  versions, versionsLoading, reverting, onRevert, onClose,
}: VersionHistoryProps) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-violet-500/20 overflow-hidden">
      <div className="px-4 py-3 border-b border-zinc-800/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <History className="w-3.5 h-3.5 text-violet-400" />
          <span className="text-xs font-medium text-zinc-300">Version History</span>
          <span className="text-[11px] text-zinc-500">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
        </div>
        <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors"><X className="w-3 h-3" /></button>
      </div>
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        {versionsLoading ? (
          <div className="flex items-center gap-2 text-xs text-zinc-500 py-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading versions...</div>
        ) : versions.length === 0 ? (
          <div className="text-xs text-zinc-500 py-2">No version history yet. Versions are saved automatically when you edit or regenerate content.</div>
        ) : (
          <div className="space-y-1.5">
            {versions.map((v) => {
              const triggerLabels: Record<string, string> = {
                regenerate_section: 'Regenerated section',
                manual_edit: 'Manual edit',
                unification: 'Unification pass',
                bulk_regenerate: 'Bulk regeneration',
              };
              const label = triggerLabels[v.trigger] || v.trigger;
              const detail = v.triggerDetail
                ? v.triggerDetail.startsWith('section:') ? ` — Section ${parseInt(v.triggerDetail.split(':')[1]) + 1}`
                : v.triggerDetail.startsWith('field:') ? ` — ${v.triggerDetail.replace('field:', '').split(',').join(', ')}`
                : v.triggerDetail.startsWith('revert_to_v') ? ` — ${v.triggerDetail.replace('revert_to_v', 'Revert to v')}`
                : ` — ${v.triggerDetail}`
                : '';
              return (
                <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 transition-colors group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-violet-400">v{v.versionNumber}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-zinc-300 truncate">{label}{detail}</div>
                      <div className="text-[10px] text-zinc-500">{new Date(v.createdAt).toLocaleString()} · {v.totalWordCount.toLocaleString()}w</div>
                    </div>
                  </div>
                  <button
                    onClick={() => onRevert(v.id)}
                    disabled={reverting === v.id}
                    className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-zinc-500 hover:text-violet-300 hover:bg-violet-500/10 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    {reverting === v.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                    Revert
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
