// @ds-rebuilt
import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCompetitorAlerts } from '../../hooks/admin/useCompetitorAlerts';
import { queryKeys } from '../../lib/queryKeys';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Icon,
  InlineBanner,
  Skeleton,
  type BadgeTone,
  type DataColumn,
} from '../ui';
import type {
  CompetitorAlertWithInsight,
  CompetitorAlertsResponseWithSnapshot,
} from './types';
import type {
  CompetitorAlertSeverity,
  CompetitorAlertType,
} from '../../../shared/types/competitor-alerts';

interface CompetitorAlertsProps {
  workspaceId: string;
  competitorCount: number;
}

type AlertRecord = Record<string, unknown> & {
  source: CompetitorAlertWithInsight;
  domain: string;
  type: string;
  keyword: string;
  move: number | null;
  volume: number | null;
  snapshotDate: string;
  createdAt: string;
};

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const ALERT_TYPE_LABEL: Record<CompetitorAlertType, string> = {
  keyword_gained: 'Gained',
  keyword_lost: 'Lost',
  authority_change: 'Authority shift',
  new_keyword: 'New keyword',
};

const SEVERITY_TONE: Record<CompetitorAlertSeverity, BadgeTone> = {
  critical: 'red',
  warning: 'amber',
  opportunity: 'emerald',
};

const SEVERITY_LABEL: Record<CompetitorAlertSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  opportunity: 'Opportunity',
};

function AlertIcon({ className }: { className?: string }) {
  return <Icon name="swords" className={className} />;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : DATE_FORMAT.format(parsed);
}

function isRecent(value: string): boolean {
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) return false;
  const now = Date.now();
  return parsed <= now && now - parsed <= RECENT_WINDOW_MS;
}

function positionMove(alert: CompetitorAlertWithInsight): string {
  if (alert.previousPosition == null || alert.currentPosition == null) return '-';
  return `#${alert.previousPosition} -> #${alert.currentPosition}`;
}

function toRecord(alert: CompetitorAlertWithInsight): AlertRecord {
  return {
    source: alert,
    domain: alert.competitorDomain,
    type: ALERT_TYPE_LABEL[alert.alertType],
    keyword: alert.keyword ?? '-',
    move: alert.positionChange,
    volume: alert.volume,
    snapshotDate: alert.snapshotDate,
    createdAt: alert.createdAt,
  };
}

export function CompetitorAlerts({ workspaceId, competitorCount }: CompetitorAlertsProps) {
  const queryClient = useQueryClient();
  const { alerts, isLoading, isError } = useCompetitorAlerts(workspaceId);
  const response = queryClient.getQueryData<CompetitorAlertsResponseWithSnapshot>(
    queryKeys.admin.competitorAlerts(workspaceId),
  );
  const rows = (alerts as CompetitorAlertWithInsight[]).map(toRecord);
  const thisWeekCount = (alerts as CompetitorAlertWithInsight[]).filter((alert) => isRecent(alert.createdAt)).length;
  const syncLine = response?.lastSnapshotDate
    ? `Weekly check - updated ${formatDate(response.lastSnapshotDate)}`
    : null;

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'domain',
      label: 'Domain',
      width: 'minmax(180px, 1.4fr)',
      render: (_value, record) => {
        const alert = (record as AlertRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{alert.competitorDomain}</span>
            {alert.insightId && <Badge label="Insight linked" tone="blue" variant="soft" size="sm" className="mt-1" />}
          </div>
        );
      },
      sortable: true,
    },
    {
      key: 'type',
      label: 'Type',
      width: '136px',
      render: (_value, record) => <Badge label={(record as AlertRecord).type} tone="zinc" variant="outline" size="sm" />,
      sortable: true,
    },
    {
      key: 'keyword',
      label: 'Keyword',
      width: 'minmax(180px, 1.2fr)',
      render: (_value, record) => <span className="truncate">{(record as AlertRecord).source.keyword ?? '-'}</span>,
      sortable: true,
    },
    {
      key: 'move',
      label: 'Position',
      width: '118px',
      align: 'right',
      render: (_value, record) => (
        <span className="tabular-nums font-semibold text-[var(--blue)]">
          {positionMove((record as AlertRecord).source)}
        </span>
      ),
      sortable: true,
    },
    {
      key: 'volume',
      label: 'Volume',
      width: '96px',
      align: 'right',
      render: (_value, record) => {
        const volume = (record as AlertRecord).source.volume;
        return <span>{typeof volume === 'number' ? NUMBER_FORMAT.format(volume) : '-'}</span>;
      },
      sortable: true,
    },
    {
      key: 'snapshotDate',
      label: 'Snapshot',
      width: '108px',
      render: (_value, record) => formatDate((record as AlertRecord).source.snapshotDate),
      sortable: true,
    },
    {
      key: 'createdAt',
      label: 'Created',
      width: '104px',
      render: (_value, record) => formatDate((record as AlertRecord).source.createdAt),
      sortable: true,
    },
    {
      key: 'severity',
      label: 'Severity',
      width: '112px',
      render: (_value, record) => {
        const severity = (record as AlertRecord).source.severity;
        return <Badge label={SEVERITY_LABEL[severity]} tone={SEVERITY_TONE[severity]} variant="soft" size="sm" />;
      },
    },
  ], []);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="competitor-alerts-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="competitor-alerts-title" className="t-ui font-semibold text-[var(--brand-text-bright)]">
            Competitor alerts
          </h2>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            Weekly gains, losses, and authority shifts across the competitor set.
          </p>
        </div>
        <div className="text-right">
          <div className="t-stat-sm tabular-nums font-bold text-[var(--blue)]">{thisWeekCount}</div> {/* stat-primitive-ok: compact single this-week alert count in the card header, not a labeled StatCard/CompactStatBar metric grid */}
          <div className="t-caption-sm text-[var(--brand-text-muted)]">this week</div>
          {syncLine && <div className="t-caption-sm text-[var(--brand-text-dim)]">{syncLine}</div>} {/* muted-tier-ok: last-sync freshness note is tertiary metadata, intentionally quieter than the count label */}
        </div>
      </div>

      {isError && (
        <InlineBanner tone="error" title="Could not load competitor alerts">
          <div className="flex flex-wrap items-center gap-2">
            <span>Try again after the competitor check finishes.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.admin.competitorAlerts(workspaceId) })}
            >
              Retry
            </Button>
          </div>
        </InlineBanner>
      )}

      {isLoading ? (
        <Skeleton className="h-[216px] w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={AlertIcon}
          title={competitorCount > 0 ? 'No competitor movement detected' : 'No competitor set configured'}
          description={
            competitorCount > 0
              ? 'The weekly competitor check surfaces ranking gains, losses, and authority shifts here.'
              : 'Add competitor domains in Workspace Settings to start monitoring movement.'
          }
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          getRowKey={(row) => (row as AlertRecord).source.id}
        />
      )}
    </section>
  );
}
