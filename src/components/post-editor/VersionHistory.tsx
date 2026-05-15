/**
 * VersionHistory — Version history panel with revert button.
 * Extracted from PostEditor.tsx version history section.
 */
import { Loader2, X, History, RotateCcw } from 'lucide-react';
import { Button, Icon, IconButton, SectionCard } from '../ui';

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
    <SectionCard noPadding className="overflow-hidden !border-teal-500/20">
      <div className="px-4 py-3 border-b border-[var(--brand-border)]/50 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon as={History} size="md" className="text-teal-400" />
          <span className="text-xs font-medium text-[var(--brand-text-bright)]">Version History</span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">{versions.length} version{versions.length !== 1 ? 's' : ''}</span>
        </div>
        <IconButton
          type="button"
          icon={X}
          label="Close version history"
          size="sm"
          variant="ghost"
          onClick={onClose}
          className="p-1 rounded-[var(--radius-sm)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text-bright)]"
        />
      </div>
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        {versionsLoading ? (
          <div className="flex items-center gap-2 text-xs text-[var(--brand-text-muted)] py-2"><Icon as={Loader2} size="sm" className="animate-spin" /> Loading versions...</div>
        ) : versions.length === 0 ? (
          <div className="text-xs text-[var(--brand-text-muted)] py-2">No version history yet. Versions are saved automatically when you edit or regenerate content.</div>
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
                <div key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/50 hover:bg-[var(--surface-3)] transition-colors group">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex-shrink-0 w-6 h-6 rounded-[var(--radius-pill)] bg-teal-500/10 border border-teal-500/20 flex items-center justify-center">
                      <span className="t-caption-sm font-semibold text-teal-400">v{v.versionNumber}</span>
                    </div>
                    <div className="min-w-0">
                      <div className="t-caption-sm text-[var(--brand-text-bright)] truncate">{label}{detail}</div>
                      <div className="t-caption-sm text-[var(--brand-text-muted)]">{new Date(v.createdAt).toLocaleString()} · {v.totalWordCount.toLocaleString()}w</div>
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onRevert(v.id)}
                    disabled={reverting === v.id}
                    loading={reverting === v.id}
                    icon={reverting === v.id ? undefined : RotateCcw}
                    className="flex-shrink-0 gap-1 px-2 py-1 rounded-[var(--radius-sm)] t-caption-sm font-medium text-[var(--brand-text-muted)] hover:text-teal-300 hover:bg-teal-500/10 opacity-0 group-hover:opacity-100 disabled:opacity-50"
                  >
                    Revert
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
