// @ds-rebuilt
import type { SnapshotSummary } from '../audit/types';
import { ActionItemsPanel } from '../audit/ActionItemsPanel';
import { dateTimeOrDash } from './siteAuditFormatters';
import {
  Button,
  EmptyState,
  Icon,
  SectionCard,
  Sparkline,
  TrendBadge,
  cn,
  scoreColorClass,
} from '../ui';

interface CompactAuditHistoryProps {
  siteId: string;
  history: SnapshotSummary[];
  onRefresh: () => void;
}

function HistoryIcon({ className }: { className?: string }) {
  return <Icon name="clock" className={className} />;
}

export function CompactAuditHistory({ siteId, history, onRefresh }: CompactAuditHistoryProps) {
  if (history.length === 0) {
    return (
      <div data-testid="site-audit-history-compact">
        <EmptyState
          icon={HistoryIcon}
          title="No audit history yet"
          description="Run and save an audit to begin tracking technical health over time."
          action={(
            <Button size="sm" variant="secondary" onClick={onRefresh}>
              <Icon name="refresh" size="sm" />
              Refresh history
            </Button>
          )}
        />
      </div>
    );
  }

  const scoreSeries = history.slice().reverse().map((snapshot) => snapshot.siteScore);
  const reportUrl = `/report/audit/${siteId}`;

  return (
    <div className="space-y-[14px]" data-testid="site-audit-history-compact">
      <SectionCard
        title="Audit History"
        subtitle={`${history.length} snapshot${history.length === 1 ? '' : 's'} · score trend over time`}
        titleIcon={<Icon name="clock" size="sm" className="text-[var(--blue)]" />}
        iconChip
        action={(
          <Button size="sm" variant="ghost" onClick={onRefresh}>
            <Icon name="refresh" size="sm" />
            Refresh
          </Button>
        )}
        noPadding
        variant="subtle"
      >
        <div className="border-b border-[var(--brand-border)] px-[18px] py-4">
          <Sparkline
            data={scoreSeries}
            width={1000}
            height={60}
            area
            color="var(--emerald)"
            label="Audit score trend"
            className="h-[60px] w-full"
          />
        </div>

        <div>
          {history.map((snapshot, index) => {
            const previous = history[index + 1];
            const delta = previous ? snapshot.siteScore - previous.siteScore : null;
            return (
              <div
                key={snapshot.id}
                className="grid items-center gap-3 border-t border-[var(--brand-border)] px-[18px] py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
              >
                <div className="min-w-0">
                  <div className="t-ui font-semibold text-[var(--brand-text-bright)]">
                    {dateTimeOrDash(snapshot.createdAt)}
                  </div>
                  <div className="t-caption-sm text-[var(--brand-text-muted)]">
                    {snapshot.totalPages} pages · {snapshot.errors} errors · {snapshot.warnings} warnings
                  </div>
                </div>
                {/* stat-primitive-ok: row-level snapshot score inside the compact history ledger, not a standalone KPI */}
                <span className={cn('t-stat-sm tabular-nums', scoreColorClass(snapshot.siteScore))}>
                  {snapshot.siteScore}
                </span>
                <span className="min-w-[68px] text-right">
                  {delta === null
                    ? <span className="t-mono text-[var(--brand-text-dim)]">—</span>
                    : <TrendBadge value={delta} suffix=" pts" showSign hideOnZero={false} />}
                </span>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => navigator.clipboard?.writeText(`${window.location.origin}/report/${snapshot.id}`)}
                  >
                    <Icon name="copy" size="sm" />
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => window.open(`/report/${snapshot.id}`, '_blank')}>
                    View
                    <Icon name="external" size="sm" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard variant="subtle" noPadding>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <Icon name="globe" size="md" className="text-[var(--blue)]" />
          <div className="min-w-0 flex-1">
            <div className="t-ui font-semibold text-[var(--brand-text-bright)]">Persistent audit report</div>
            <div className="t-mono truncate text-[var(--brand-text-muted)]">{reportUrl}</div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(`${window.location.origin}${reportUrl}`)}>
            <Icon name="copy" size="sm" />
            Copy link
          </Button>
          <Button size="sm" variant="secondary" onClick={() => window.open(reportUrl, '_blank')}>
            <Icon name="external" size="sm" />
            Open report
          </Button>
        </div>
      </SectionCard>

      <ActionItemsPanel snapshotId={history[0].id} />
    </div>
  );
}
