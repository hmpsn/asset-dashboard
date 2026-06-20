import { Swords } from 'lucide-react';
import { SectionCard, Badge, EmptyState, LoadingState, ErrorState } from '../ui';
import { formatDateShort } from '../../utils/formatDates';
import { useCompetitorAlerts } from '../../hooks/admin/useCompetitorAlerts';
import type {
  CompetitorAlertView,
  CompetitorAlertType,
  CompetitorAlertSeverity,
} from '../../../shared/types/competitor-alerts';
import type { BadgeTone } from '../ui';

interface CompetitorAlertsPanelProps {
  workspaceId: string;
}

/** Human label per alert type (the cron stores the discriminator; the page renders the verb). */
const ALERT_TYPE_LABEL: Record<CompetitorAlertType, string> = {
  keyword_gained: 'Gained',
  keyword_lost: 'Lost',
  authority_change: 'Authority shift',
  new_keyword: 'New keyword',
};

/**
 * Severity → Badge tone (Four Laws of Color). critical → red, warning → amber, opportunity → emerald.
 * No purple — this is admin competitor intelligence, not an admin-AI surface.
 */
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

function AlertRow({ alert }: { alert: CompetitorAlertView }) {
  const hasPositionMove =
    alert.previousPosition != null && alert.currentPosition != null;

  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-[var(--brand-border)] last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="t-body font-semibold text-[var(--brand-text-bright)] truncate">
            {alert.competitorDomain}
          </span>
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {ALERT_TYPE_LABEL[alert.alertType]}
          </span>
        </div>
        {alert.keyword && (
          <p className="t-caption-sm text-[var(--brand-text-muted)] truncate mt-0.5">
            {alert.keyword}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1">
          {/* Position movement — blue (Four Laws: data metric, read-only). */}
          {hasPositionMove && (
            <span className="t-caption-sm text-blue-400 font-medium tabular-nums">
              #{alert.previousPosition} → #{alert.currentPosition}
            </span>
          )}
          {alert.volume != null && (
            <span className="t-caption-sm text-blue-400 tabular-nums">
              {alert.volume.toLocaleString()} vol
            </span>
          )}
          <span className="t-caption-sm text-[var(--brand-text-muted)]">
            {formatDateShort(alert.snapshotDate)}
          </span>
        </div>
      </div>
      <Badge label={SEVERITY_LABEL[alert.severity]} tone={SEVERITY_TONE[alert.severity]} />
    </div>
  );
}

/**
 * The Issue — Phase 6: surfaces the never-shown competitor alerts (competitor_alerts table, written
 * weekly by the Monday competitor-monitoring cron). Read-only. Blue for position/volume data metrics;
 * red/amber/emerald severity badges. No purple.
 */
export function CompetitorAlertsPanel({ workspaceId }: CompetitorAlertsPanelProps) {
  const { alerts, isLoading, isError } = useCompetitorAlerts(workspaceId);

  return (
    <SectionCard title="Competitor alerts" titleIcon={<Swords className="w-4 h-4 text-accent-brand" />}>
      <p className="t-caption-sm text-[var(--brand-text-muted)] mb-3">
        Weekly gains, losses, and authority shifts across your competitor set.
      </p>
      {isLoading ? (
        <LoadingState message="Loading competitor movement..." />
      ) : isError ? (
        <ErrorState message="Couldn't load competitor alerts. Try again shortly." />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={Swords}
          title="No competitor movement detected"
          description="The Monday competitor check surfaces gains/losses here."
        />
      ) : (
        <div>
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
