// @ds-rebuilt
import { useQueryClient } from '@tanstack/react-query';
import { useCompetitorAlerts } from '../../hooks/admin/useCompetitorAlerts';
import { queryKeys } from '../../lib/queryKeys';
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  InlineBanner,
  SectionCard,
  Skeleton,
  type BadgeTone,
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
  return `#${alert.previousPosition} → #${alert.currentPosition}`;
}

function AlertSectionIcon() {
  return <Icon name="swords" size="sm" className="text-[var(--orange)]" />;
}

function AlertFeedRow({ alert }: { alert: CompetitorAlertWithInsight }) {
  const volume = typeof alert.volume === 'number' ? `${NUMBER_FORMAT.format(alert.volume)} volume` : null;

  return (
    <div
      role="listitem"
      className="flex flex-col gap-3 border-t border-[var(--brand-border)] px-[18px] py-[13px] first:border-t-0 sm:flex-row sm:items-start"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="t-ui truncate font-bold text-[var(--brand-text-bright)]">{alert.competitorDomain}</span>
          <span className="t-label font-normal normal-case tracking-normal text-[var(--brand-text)]">{ALERT_TYPE_LABEL[alert.alertType]}</span>
          {alert.insightId && <Badge label="Insight linked" tone="blue" variant="soft" size="sm" />}
        </div>
        {alert.keyword && (
          <p className="t-label mt-[3px] font-normal normal-case tracking-normal text-[var(--brand-text)]">{alert.keyword}</p>
        )}
        <div className="t-label mt-[5px] flex flex-wrap items-center gap-x-[14px] gap-y-1 font-normal normal-case tracking-normal">
          <span className="tabular-nums font-semibold text-[var(--blue)]">{positionMove(alert)}</span>
          {volume && <span className="tabular-nums text-[var(--blue)]">{volume}</span>}
          <span className="eyebrow normal-case tracking-normal text-[var(--brand-text-dim)]">Snapshot {formatDate(alert.snapshotDate)}</span>
          <span className="eyebrow normal-case tracking-normal text-[var(--brand-text-dim)]">Created {formatDate(alert.createdAt)}</span>
        </div>
      </div>
      <Badge
        label={SEVERITY_LABEL[alert.severity]}
        tone={SEVERITY_TONE[alert.severity]}
        variant="soft"
        size="sm"
        className="self-start"
      />
    </div>
  );
}

export function CompetitorAlerts({ workspaceId, competitorCount }: CompetitorAlertsProps) {
  const queryClient = useQueryClient();
  const { alerts, isLoading, isError } = useCompetitorAlerts(workspaceId);
  const response = queryClient.getQueryData<CompetitorAlertsResponseWithSnapshot>(
    queryKeys.admin.competitorAlerts(workspaceId),
  );
  const rows = alerts as CompetitorAlertWithInsight[];
  const thisWeekCount = (alerts as CompetitorAlertWithInsight[]).filter((alert) => isRecent(alert.createdAt)).length;
  const syncLine = response?.lastSnapshotDate
    ? `Weekly check - updated ${formatDate(response.lastSnapshotDate)}`
    : null;

  return (
    <section aria-labelledby="competitor-alerts-title">
      <h2 id="competitor-alerts-title" className="sr-only" aria-label="Competitor alerts" />

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
        <SectionCard
          title="Competitor alerts"
          subtitle="Weekly gains, losses, and authority shifts across the competitor set."
          titleIcon={<AlertSectionIcon />}
          iconChip
          noPadding
          variant="subtle"
          action={(
            <span className="eyebrow normal-case tracking-normal text-[var(--brand-text-muted)]">
              {thisWeekCount} this week{syncLine ? ` · ${syncLine.replace('Weekly check - updated ', '')}` : ''}
            </span>
          )}
        >
          <div role="list" aria-label="Competitor alert feed">
            {rows.map((alert) => <AlertFeedRow key={alert.id} alert={alert} />)}
          </div>
        </SectionCard>
      )}
    </section>
  );
}
