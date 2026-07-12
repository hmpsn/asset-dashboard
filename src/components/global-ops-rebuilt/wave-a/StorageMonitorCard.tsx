// @ds-rebuilt
import { Button, Icon, InlineBanner, SectionCard, Skeleton } from '../../ui';
import type { GlobalOpsPruneType, GlobalOpsStorageReport } from '../../../hooks/admin/useGlobalOpsSettings';
import { formatBytes, formatDate, formatDateTime, formatNumber } from '../globalOpsFormatters';

const STORAGE_ACCENTS = [
  'var(--amber)',
  'var(--teal)',
  'var(--blue)',
  'var(--orange)',
  'var(--red)',
  'var(--emerald)',
] as const;

const PRUNE_ROWS: ReadonlyArray<{
  type: GlobalOpsPruneType;
  label: string;
  detail: string;
  iconColor: string;
}> = [
  { type: 'backups', label: 'Prune old backups', detail: 'Keep the configured retention window', iconColor: 'var(--amber)' },
  { type: 'reports', label: 'Prune audit snapshots', detail: 'Keep retained report history per site', iconColor: 'var(--brand-text-muted)' },
  { type: 'chat', label: 'Prune chat history', detail: 'Remove sessions outside retention', iconColor: 'var(--teal)' },
  { type: 'activity', label: 'Prune activity logs', detail: 'Trim activity beyond the retention cap', iconColor: 'var(--red)' },
];

interface StorageMonitorCardProps {
  data: GlobalOpsStorageReport | null;
  loading: boolean;
  fetching: boolean;
  onRefresh: () => void;
  onPrune: (type: GlobalOpsPruneType) => void;
}

export function StorageMonitorCard({ data, loading, fetching, onRefresh, onPrune }: StorageMonitorCardProps) {
  return (
    <SectionCard
      title="Storage Monitor"
      subtitle="Persistent disk usage and cleanup tools"
      titleIcon={<Icon name="layers" size="md" className="text-[var(--amber)]" />}
      iconChip
      action={(
        <Button variant="secondary" size="sm" onClick={onRefresh} loading={fetching}>
          <Icon name="refresh" size="sm" /> Refresh
        </Button>
      )}
    >
      {loading ? (
        <Skeleton className="h-[310px] w-full" />
      ) : data ? (
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className="t-ui font-semibold text-[var(--brand-text-bright)]">{formatBytes(data.totalBytes)}</span>
              <span className="t-caption-sm text-[var(--brand-text-muted)]">
                {formatNumber(data.totalFiles)} files · scanned {formatDateTime(data.timestamp)}
              </span>
            </div>
            <div className="flex h-3 overflow-hidden rounded-[var(--radius-pill)] bg-[var(--surface-1)]">
              {data.breakdown.map((item, index) => {
                const percentage = data.totalBytes > 0 ? (item.bytes / data.totalBytes) * 100 : 0;
                if (percentage < 0.5) return null;
                return (
                  <span
                    key={item.name}
                    title={`${item.label}: ${formatBytes(item.bytes)}`}
                    className="h-full"
                    style={{ width: `${percentage}%`, background: STORAGE_ACCENTS[index % STORAGE_ACCENTS.length] }}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            {data.breakdown.map((item, index) => {
              const percentage = data.totalBytes > 0 ? (item.bytes / data.totalBytes) * 100 : 0;
              return (
                <div key={item.name} className="grid grid-cols-[8px_minmax(0,1fr)_auto_70px_42px] items-center gap-2 py-1">
                  <span className="h-[7px] w-[7px] rounded-[var(--radius-pill)]" style={{ background: STORAGE_ACCENTS[index % STORAGE_ACCENTS.length] }} />
                  <span className="truncate t-caption text-[var(--brand-text-muted)]">{item.label}</span>
                  {/* muted-tier-ok: file count is tertiary metadata beside the primary byte total. */}
                  <span className="t-caption-sm tabular-nums text-[var(--brand-text-dim)]">{formatNumber(item.fileCount)} files</span>
                  <span className="text-right t-caption font-semibold tabular-nums text-[var(--brand-text)]">{formatBytes(item.bytes)}</span>
                  {/* muted-tier-ok: percentage is tertiary context for the primary byte total. */}
                  <span className="text-right t-caption-sm tabular-nums text-[var(--brand-text-dim)]">{percentage.toFixed(0)}%</span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-3 border-y border-[var(--brand-border)] py-3 text-center">
            <div><div className="t-ui font-semibold tabular-nums text-[var(--brand-text-bright)]">{formatNumber(data.chatSessionCount)}</div><div className="t-caption-sm text-[var(--brand-text-muted)]">Chat sessions</div></div>
            <div><div className="t-ui font-semibold tabular-nums text-[var(--brand-text-bright)]">{data.backupRetentionDays}d</div><div className="t-caption-sm text-[var(--brand-text-muted)]">Backup retention</div></div>
            <div><div className="t-ui font-semibold text-[var(--brand-text-bright)]">{data.oldestChatSession ? formatDate(data.oldestChatSession) : '—'}</div><div className="t-caption-sm text-[var(--brand-text-muted)]">Oldest chat</div></div>
          </div>

          <div>
            <div className="mb-2 t-micro uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">Cleanup actions</div>
            <div className="space-y-1.5">
              {PRUNE_ROWS.map((row) => (
                <Button key={row.type} variant="secondary" size="sm" className="h-auto w-full justify-start px-3 py-2 text-left" onClick={() => onPrune(row.type)}>
                  <Icon name="minus" size="sm" style={{ color: row.iconColor }} />
                  <span className="flex-1 t-caption text-[var(--brand-text)]">{row.label}</span>
                  <span className="t-caption-sm text-[var(--brand-text-muted)]">{row.detail}</span>
                </Button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <InlineBanner tone="warning" title="Storage stats unavailable" message="Retry the storage read before running cleanup actions." />
      )}
    </SectionCard>
  );
}
