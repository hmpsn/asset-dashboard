import { Activity, ArrowRight, SearchCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ClientDiagnosticSummary } from '../../../shared/types/diagnostics';
import { clientPath } from '../../routes';
import { formatDate } from '../../utils/formatDates';
import { Badge, Button, Icon, SectionCard } from '../ui';
import { useBetaMode } from './BetaContext';

interface DiagnosticRootCauseCardsProps {
  workspaceId: string;
  reports: ClientDiagnosticSummary[];
}

function labelFromAnomalyType(type: string): string {
  return type
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function confidenceTone(confidence: ClientDiagnosticSummary['rootCauses'][number]['confidence']) {
  if (confidence === 'high') return 'red';
  if (confidence === 'medium') return 'amber';
  return 'blue';
}

export function DiagnosticRootCauseCards({ workspaceId, reports }: DiagnosticRootCauseCardsProps) {
  const navigate = useNavigate();
  const betaMode = useBetaMode();

  if (reports.length === 0) {
    return null;
  }

  return (
    <SectionCard
      title="What changed"
      titleIcon={<Icon as={SearchCheck} size="md" className="text-accent-info" />}
      titleExtra={<Badge label={`${reports.length} finding${reports.length === 1 ? '' : 's'}`} tone="blue" variant="outline" shape="pill" />}
      action={(
        <Button
          size="sm"
          variant="ghost"
          onClick={() => navigate(clientPath(workspaceId, 'health', betaMode))}
        >
          View health
        </Button>
      )}
    >
      <div className="space-y-4">
        {reports.map((report, index) => (
          <div
            key={report.id}
            className={index > 0 ? 'border-t border-[var(--brand-border)] pt-4' : ''}
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge label={labelFromAnomalyType(report.anomalyType)} tone="blue" variant="soft" />
                  {report.completedAt && (
                    <span className="t-caption-sm text-[var(--brand-text-muted)]">
                      Reviewed {formatDate(report.completedAt)}
                    </span>
                  )}
                </div>
                <p className="t-body mt-2 text-[var(--brand-text)]">
                  {report.clientSummary}
                </p>
              </div>
              {report.affectedPages.length > 0 && (
                <div className="shrink-0 rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)]/40 px-3 py-2 sm:max-w-[220px]">
                  <div className="t-caption-sm font-medium text-[var(--brand-text-muted)]">Affected page</div>
                  <div className="t-caption text-[var(--brand-text)] truncate">
                    {report.affectedPages[0]}
                  </div>
                </div>
              )}
            </div>

            {report.rootCauses.length > 0 && (
              <div className="mt-3 space-y-2">
                <div className="t-caption-sm font-medium text-[var(--brand-text-muted)]">Likely causes</div>
                <div className="flex flex-wrap gap-2">
                  {report.rootCauses.map(cause => (
                    <Badge
                      key={`${report.id}-${cause.rank}-${cause.title}`}
                      label={cause.title}
                      tone={confidenceTone(cause.confidence)}
                      variant="outline"
                      shape="pill"
                    />
                  ))}
                </div>
              </div>
            )}

            {report.remediationActions.length > 0 && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {report.remediationActions.slice(0, 2).map(action => (
                  <div
                    key={`${report.id}-${action.priority}-${action.title}`}
                    className="flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--surface-3)]/40 px-3 py-2"
                  >
                    <Icon as={Activity} size="sm" className="text-accent-brand" />
                    <span className="t-caption text-[var(--brand-text)] truncate">{action.title}</span>
                    <Badge label={action.priority} tone="teal" variant="soft" />
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="link"
              size="sm"
              icon={ArrowRight}
              iconPosition="right"
              className="mt-3"
              onClick={() => navigate(clientPath(workspaceId, 'health', betaMode))}
            >
              See related site health
            </Button>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
