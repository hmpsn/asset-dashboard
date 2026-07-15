// @ds-rebuilt
import { Link, useNavigate } from 'react-router-dom';
import type { DiagnosticReport } from '../../../../../shared/types/diagnostics';
import { useDiagnosticReport } from '../../../../hooks/admin/useDiagnostics';
import { adminPath } from '../../../../routes';
import {
  Badge,
  EmptyState,
  ErrorState,
  Icon,
  MetricTile,
  SectionCard,
  Skeleton,
} from '../../../ui';
import { formatDateTime } from '../../globalOpsFormatters';
import { DiagnosticsEvidence } from './DiagnosticsEvidence';
import { DiagnosticsRemediationPlan, DiagnosticsRootCauses } from './DiagnosticsFindings';
import {
  affectedPagePath,
  anomalyTypeLabel,
  diagnosticPageLabel,
  formatDiagnosticPercent,
} from './diagnosticPresentation';

interface DiagnosticsReportViewProps {
  workspaceId: string;
  reportId: string;
}

const DIAGNOSTIC_METRIC_TILE_CLASS = '!min-w-0 !rounded-[var(--radius-lg)] px-4 py-[15px] [&_.t-caption]:!font-mono [&_.t-caption]:!text-[calc(var(--type-label-size)-1px)] [&_.t-caption]:!font-semibold [&_.t-caption]:!uppercase [&_.t-caption]:!tracking-[0.05em] [&_.t-stat]:!text-[calc(var(--type-stat-size)+1px)] [&_.t-caption-sm]:!text-[calc(var(--type-caption-size)-1px)]';

function ReportLoadingState() {
  return (
    <div className="space-y-6" aria-label="Loading diagnostic report">
      <Skeleton className="h-4 w-40" />
      <div className="flex items-start gap-3"><Skeleton className="h-[38px] w-[38px]" /><div className="flex-1 space-y-2"><Skeleton className="h-6 w-80 max-w-full" /><Skeleton className="h-4 w-64 max-w-full" /></div></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[98px] w-full" />)}</div>
      <Skeleton className="h-[220px] w-full" />
    </div>
  );
}

function ReportNavigation({ workspaceId }: { workspaceId: string }) {
  return (
    <nav aria-label="Diagnostic report navigation" className="flex flex-wrap items-center justify-between gap-3">
      <Link to={adminPath(workspaceId, 'analytics-hub')} className="inline-flex items-center gap-1.5 t-caption font-semibold text-[var(--brand-text)] hover:text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>
        <Icon name="arrowLeft" size="sm" aria-hidden="true" />
        Back to Search &amp; Traffic
      </Link>
      <Link to={adminPath(workspaceId, 'diagnostics')} className="t-caption-sm font-medium text-[var(--blue)] hover:text-[var(--teal)]">
        All diagnostic reports
      </Link>
    </nav>
  );
}

function RunningReport({ report, workspaceId }: { report: DiagnosticReport; workspaceId: string }) {
  const evidenceSources = [
    'Search and analytics period comparison',
    'Internal-link and redirect evidence',
    'Backlink and referring-domain evidence',
    'Existing signals and recent activity',
    'Root-cause ranking and remediation',
  ];

  return (
    <>
      <ReportNavigation workspaceId={workspaceId} />
      <SectionCard className="mx-auto mt-5 w-full max-w-[560px] !rounded-[18px]" noPadding>
        <div className="px-6 py-9 text-center sm:px-10">
          <span className="mx-auto inline-flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-[var(--brand-mint-dim)] text-[var(--teal)]">
            <Icon name="gauge" size="xl" aria-hidden="true" />
          </span>
          <h1 className="mt-[18px] t-stat-sm font-bold text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-stat-sm-size) + 1px)' }}>Running deep diagnostic…</h1> {/* stat-primitive-ok — semantic running-state title uses the 19px source role, not a metric display. */}
          <p className="mx-auto mt-1.5 max-w-[420px] t-caption leading-relaxed text-[var(--brand-text-muted)]">
            Gathering data and analyzing root causes for {diagnosticPageLabel(report)}. This usually takes 30–60 seconds.
          </p>
          <div className="mx-auto mt-5 max-w-[370px] space-y-0.5 text-left" aria-label="Diagnostic evidence sources">
            {evidenceSources.map((source) => (
              <div key={source} className="flex items-center gap-[11px] py-2 t-caption text-[var(--brand-text)]">
                <span className="inline-flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[var(--radius-pill)] border border-[var(--brand-border-hover)]">
                  <span className="h-1.5 w-1.5 rounded-[var(--radius-pill)] bg-[var(--blue)]" />
                </span>
                {source}
              </div>
            ))}
          </div>
          <p className="mt-4 t-caption-sm text-[var(--brand-text-muted)]" aria-live="polite">The report refreshes automatically when analysis completes.</p>
        </div>
      </SectionCard>
    </>
  );
}

function FailedReport({ report, workspaceId }: { report: DiagnosticReport; workspaceId: string }) {
  return (
    <>
      <ReportNavigation workspaceId={workspaceId} />
      <SectionCard className="mx-auto mt-5 w-full max-w-[560px] !rounded-[18px]">
        <EmptyState
          icon={({ className }) => <Icon name="alert" className={className} />}
          title="Diagnostic failed"
          description={report.errorMessage ?? 'The diagnostic could not complete. Return to the source insight and try again.'}
        />
      </SectionCard>
    </>
  );
}

function CompletedReport({ report, workspaceId }: { report: DiagnosticReport; workspaceId: string }) {
  const context = report.diagnosticContext;
  const trafficChange = context.periodComparison.changePercent.clicks;

  return (
    <div className="space-y-[26px]">
      <ReportNavigation workspaceId={workspaceId} />

      <header>
        <div className="flex min-w-0 items-start gap-[13px]">
          <span className="inline-flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-[var(--brand-mint-dim)] text-[var(--teal)]">
            <Icon name="gauge" size="lg" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="t-h2 font-bold tracking-[-0.02em] text-[var(--brand-text-bright)]" style={{ fontSize: 'calc(var(--type-h2-size) - 1px)' }}>Deep Diagnostic: {diagnosticPageLabel(report)}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 t-caption-sm text-[var(--brand-text-muted)]" style={{ fontSize: 'calc(var(--type-caption-size) - 1px)' }}>
              <Badge label="Completed" tone="emerald" shape="pill" className="!uppercase !tracking-[0.04em]" />
              <span>{anomalyTypeLabel(report.anomalyType)}</span>
              <span aria-hidden="true">·</span>
              <span className="max-w-full truncate font-mono">{affectedPagePath(report)}</span>
              <span aria-hidden="true">·</span>
              <span>{formatDateTime(report.completedAt ?? report.createdAt)}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricTile label="Traffic change" value={formatDiagnosticPercent(trafficChange)} sub="Current vs prior period" accent={trafficChange < 0 ? 'var(--red)' : 'var(--emerald)'} className={DIAGNOSTIC_METRIC_TILE_CLASS} />
        <MetricTile label="Internal links" value={context.internalLinks.count} sub={`Site median: ${context.internalLinks.siteMedian}`} className={DIAGNOSTIC_METRIC_TILE_CLASS} />
        <MetricTile label="Backlinks" value={context.backlinks.totalBacklinks} sub={`${context.backlinks.referringDomains} domains`} className={DIAGNOSTIC_METRIC_TILE_CLASS} />
        <MetricTile label="Root causes" value={report.rootCauses.length} sub={`${report.remediationActions.length} actions`} className={DIAGNOSTIC_METRIC_TILE_CLASS} />
      </div>

      <DiagnosticsRootCauses causes={report.rootCauses} />
      <DiagnosticsRemediationPlan actions={report.remediationActions} />

      <section aria-labelledby="diagnostics-evidence-heading">
        <h2 id="diagnostics-evidence-heading" className="mb-3 t-micro font-semibold uppercase tracking-[0.06em] text-[var(--brand-text-dim)]">Evidence</h2>
        <DiagnosticsEvidence context={context} />
      </section>
    </div>
  );
}

export function DiagnosticsReportView({ workspaceId, reportId }: DiagnosticsReportViewProps) {
  const navigate = useNavigate();
  const reportQuery = useDiagnosticReport(workspaceId, reportId);
  const report = reportQuery.data?.report;

  if (reportQuery.isLoading) return <ReportLoadingState />;
  if (reportQuery.isError || !report) {
    return (
      <SectionCard>
        <ErrorState
          title="Report not found"
          message="This diagnostic report could not be loaded. Check the report link or return to the report list."
          actions={[{ label: 'Try again', onClick: () => void reportQuery.refetch() }, { label: 'All reports', onClick: () => navigate(adminPath(workspaceId, 'diagnostics')), variant: 'secondary' }]}
        />
      </SectionCard>
    );
  }

  if (report.status === 'running' || report.status === 'pending') return <RunningReport report={report} workspaceId={workspaceId} />;
  if (report.status === 'failed') return <FailedReport report={report} workspaceId={workspaceId} />;

  return <CompletedReport report={report} workspaceId={workspaceId} />;
}
