import { useSearchParams, Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { SectionCard } from '../../ui/SectionCard.js';
import { StatCard } from '../../ui/StatCard.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { PageHeader } from '../../ui/PageHeader.js';
import { RootCauseCard } from './RootCauseCard.js';
import { RemediationPlan } from './RemediationPlan.js';
import { EvidenceAccordion } from './EvidenceAccordion.js';
import { useDiagnosticReport, useDiagnosticsList, useDiagnosticEvents } from '../../../hooks/admin/useDiagnostics.js';
import type { DiagnosticReport } from '../../../../shared/types/diagnostics.js';

interface Props {
  workspaceId: string;
}

function ReportSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20" />)}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

function ReportDetail({ report }: { report: DiagnosticReport }) {
  const ctx = report.diagnosticContext;
  const posChange = ctx.periodComparison.changePercent;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Deep Diagnostic: ${report.affectedPages[0] ?? report.anomalyType}`}
        subtitle={`Completed ${new Date(report.completedAt ?? report.createdAt).toLocaleDateString()}`}
        icon={<Activity className="w-5 h-5 text-teal-400" />}
      />

      {/* At-a-Glance Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Traffic Change" value={`${posChange.clicks > 0 ? '+' : ''}${posChange.clicks.toFixed(0)}%`} />
        <StatCard label="Internal Links" value={String(ctx.internalLinks.count)} sub={`Site median: ${ctx.internalLinks.siteMedian}`} />
        <StatCard label="Backlinks" value={String(ctx.backlinks.totalBacklinks)} sub={`${ctx.backlinks.referringDomains} domains`} />
        <StatCard label="Root Causes" value={String(report.rootCauses.length)} sub={`${report.remediationActions.length} actions`} />
      </div>

      {/* Root Causes */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Root Causes</h2>
        <div className="space-y-2">
          {report.rootCauses.map((cause) => (
            <RootCauseCard key={cause.rank} cause={cause} />
          ))}
        </div>
      </div>

      {/* Remediation Plan */}
      {report.remediationActions.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-zinc-300 mb-3">Remediation Plan</h2>
          <RemediationPlan actions={report.remediationActions} />
        </div>
      )}

      {/* Raw Evidence */}
      <div>
        <h2 className="text-sm font-semibold text-zinc-300 mb-3">Evidence</h2>
        <EvidenceAccordion context={ctx} />
      </div>
    </div>
  );
}

function DiagnosticReportDetail({ workspaceId, reportId }: { workspaceId: string; reportId: string }) {
  const { data, isLoading, isError } = useDiagnosticReport(workspaceId, reportId);

  if (isLoading) return <SectionCard><ReportSkeleton /></SectionCard>;
  if (isError || !data?.report) return <SectionCard><EmptyState title="Report not found" description="This diagnostic report could not be loaded." icon={Activity} /></SectionCard>;

  const report = data.report;

  // Guard: only render the full detail view for completed reports.
  // For running/pending reports, diagnosticContext is {} (the DB default), so
  // ctx.periodComparison / ctx.internalLinks / ctx.backlinks are all undefined.
  // Accessing .changePercent on undefined would throw a TypeError.
  if (report.status === 'running' || report.status === 'pending') {
    return (
      <SectionCard>
        <EmptyState
          title="Diagnostic in progress"
          description="Gathering data and analyzing root causes. This usually takes 30–60 seconds. The page will update automatically when complete."
          icon={Activity}
        />
      </SectionCard>
    );
  }

  if (report.status === 'failed') {
    return (
      <SectionCard>
        <EmptyState
          title="Diagnostic failed"
          description={report.errorMessage ?? 'The diagnostic could not complete. Try running a new one from the insight feed.'}
          icon={Activity}
        />
      </SectionCard>
    );
  }

  return <ReportDetail report={report} />;
}

function DiagnosticReportList({ workspaceId }: { workspaceId: string }) {
  const { data, isLoading } = useDiagnosticsList(workspaceId);

  if (isLoading) return <SectionCard><ReportSkeleton /></SectionCard>;

  const reports = data?.reports ?? [];
  if (reports.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          title="No diagnostics yet"
          description="Run a deep diagnostic from an anomaly insight to investigate root causes."
          icon={Activity}
        />
      </SectionCard>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Diagnostic Reports" icon={<Activity className="w-5 h-5 text-teal-400" />} />
      {reports.map((r) => (
        <Link key={r.id} to={`?report=${r.id}`} className="block">
          <SectionCard>
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{r.affectedPages[0] ?? r.anomalyType}</h3>
                <p className="text-xs text-zinc-500">{r.anomalyType} - {new Date(r.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded ${r.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400' : r.status === 'failed' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {r.status}
              </span>
            </div>
          </SectionCard>
        </Link>
      ))}
    </div>
  );
}

export function DiagnosticReportPage({ workspaceId }: Props) {
  const [searchParams] = useSearchParams();
  const reportId = searchParams.get('report');

  // Single shared handler — invalidates diagnostics, forInsight, and insights caches
  // with workspace-scoped query keys. No need for a separate useWorkspaceEvents here.
  useDiagnosticEvents(workspaceId);

  if (reportId) {
    return <DiagnosticReportDetail workspaceId={workspaceId} reportId={reportId} />;
  }

  return <DiagnosticReportList workspaceId={workspaceId} />;
}
