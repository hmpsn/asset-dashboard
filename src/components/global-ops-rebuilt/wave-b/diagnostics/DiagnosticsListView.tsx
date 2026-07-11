// @ds-rebuilt
import { Link, useNavigate } from 'react-router-dom';
import { useDiagnosticsList } from '../../../../hooks/admin/useDiagnostics';
import { adminPath } from '../../../../routes';
import { Badge, Button, EmptyState, ErrorState, Icon, SectionCard, Skeleton } from '../../../ui';
import { formatDateTime } from '../../globalOpsFormatters';
import {
  DIAGNOSTIC_STATUS_TONE,
  affectedPagePath,
  anomalyTypeLabel,
  diagnosticPageLabel,
  statusLabel,
} from './diagnosticPresentation';

interface DiagnosticsListViewProps {
  workspaceId: string;
}

export function DiagnosticsListView({ workspaceId }: DiagnosticsListViewProps) {
  const navigate = useNavigate();
  const reportsQuery = useDiagnosticsList(workspaceId);
  const reports = reportsQuery.data?.reports ?? [];

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-[13px]">
          <span className="inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-[var(--brand-mint-dim)] text-[var(--teal)]">
            <Icon name="gauge" size="lg" aria-hidden="true" />
          </span>
          <div>
            <h1 className="t-h2 font-bold tracking-[-0.02em] text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-h2-size) - 1px)' }}>Diagnostics</h1>
            <p className="mt-0.5 t-caption text-[var(--brand-text)]">Deep diagnostic reports and investigation history</p>
          </div>
        </div>
        {reports.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))} className="self-start">
            <Icon name="arrowRight" size="sm" aria-hidden="true" />Open Search &amp; Traffic
          </Button>
        )}
      </header>

      {reportsQuery.isError ? (
        <SectionCard>
          <ErrorState title="Diagnostic reports unavailable" message="We couldn't load this workspace's diagnostic history." action={{ label: 'Try again', onClick: () => void reportsQuery.refetch() }} />
        </SectionCard>
      ) : reportsQuery.isLoading ? (
        <SectionCard title="Reports" noPadding>
          <div className="space-y-2 px-[18px] py-4">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-[64px] w-full" />)}</div>
        </SectionCard>
      ) : reports.length === 0 ? (
        <SectionCard title="Reports" noPadding>
          <EmptyState
            icon={({ className }) => <Icon name="gauge" className={className} />}
            title="No diagnostics yet"
            description="Run a deep diagnostic from an anomaly in Search & Traffic to investigate root causes."
            action={<Button size="sm" onClick={() => navigate(adminPath(workspaceId, 'analytics-hub'))}>Open Search &amp; Traffic</Button>}
            className="min-h-[310px]"
          />
        </SectionCard>
      ) : (
        <SectionCard
          title="Reports"
          titleIcon={<Icon name="file" size="md" className="text-[var(--blue)]" />}
          iconChip
          action={<Badge label={`${reports.length} total`} tone="blue" variant="soft" />}
          noPadding
          className="overflow-hidden !rounded-[var(--radius-lg)]"
        >
          <div className="divide-y divide-[var(--brand-border)]">
            {reports.map((report) => (
              <Link
                key={report.id}
                to={`${adminPath(workspaceId, 'diagnostics')}?report=${report.id}`}
                className="group flex items-center gap-3 px-[18px] py-[13px] hover:bg-[var(--surface-3)]"
                style={{ transitionDuration: 'var(--dur-fast)' }}
              >
                <span className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-3)] text-[var(--blue)]">
                  <Icon name={report.status === 'failed' ? 'alert' : report.status === 'completed' ? 'chart' : 'clock'} size="md" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{diagnosticPageLabel(report)}</h2>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 t-caption-sm text-[var(--brand-text-muted)]">
                    <span>{anomalyTypeLabel(report.anomalyType)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="max-w-[320px] truncate font-mono">{affectedPagePath(report)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatDateTime(report.completedAt ?? report.createdAt)}</span>
                  </p>
                </div>
                <Badge label={statusLabel(report.status)} tone={DIAGNOSTIC_STATUS_TONE[report.status]} shape="pill" />
                <Icon name="arrowRight" size="sm" className="flex-none text-[var(--brand-text-dim)] group-hover:text-[var(--teal)]" aria-hidden="true" />
              </Link>
            ))}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
