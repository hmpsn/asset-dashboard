import type { ReactNode } from 'react';
import { Shield } from 'lucide-react';
import { Button, EmptyState, MetricRing, SectionCard } from '../ui';
import { STUDIO_NAME } from '../../constants';
import type { AuditDetail, AuditSummary } from './types';
import {
  HealthAllPagesSection,
  HealthAuditDiffSection,
  HealthHeaderSection,
  HealthHistorySection,
  HealthPageSpeedSection,
  HealthScoreSummarySection,
  HealthSiteWideIssuesSection,
  HealthTopFixesSection,
} from './health-tab/HealthTabSections';
import { useHealthTabShell } from './health-tab/useHealthTabShell';

const ScoreRing = MetricRing;

export interface HealthTabProps {
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: 'all' | 'error' | 'warning' | 'info';
  workspaceId?: string;
  onContentRequested?: () => void;
  actionPlanSlot?: ReactNode;
}

export function HealthTab({
  audit,
  auditDetail,
  liveDomain,
  initialSeverity,
  workspaceId,
  onContentRequested,
  actionPlanSlot,
}: HealthTabProps) {
  const shell = useHealthTabShell({
    auditDetail,
    liveDomain,
    initialSeverity,
    workspaceId,
    onContentRequested,
  });

  if (auditDetail) {
    return (
      <div className="space-y-8">
        <HealthHeaderSection auditDetail={auditDetail} shell={shell} />
        <HealthScoreSummarySection auditDetail={auditDetail} shell={shell} />
        <HealthAuditDiffSection auditDetail={auditDetail} />
        <HealthPageSpeedSection auditDetail={auditDetail} />
        <HealthTopFixesSection
          auditDetail={auditDetail}
          liveDomain={liveDomain}
          workspaceId={workspaceId}
          shell={shell}
        />
        {actionPlanSlot}
        <HealthSiteWideIssuesSection auditDetail={auditDetail} shell={shell} />
        <HealthAllPagesSection
          auditDetail={auditDetail}
          liveDomain={liveDomain}
          workspaceId={workspaceId}
          shell={shell}
        />
        <HealthHistorySection auditDetail={auditDetail} shell={shell} />
      </div>
    );
  }

  if (audit) {
    return (
      <SectionCard noPadding>
        <div className="p-6">
          <div className="flex items-center gap-4">
            <ScoreRing score={audit.siteScore} size={100} />
            <div>
              <div className="t-ui font-medium text-[var(--brand-text-bright)]">Site Health Score</div>
              <div className="t-caption text-[var(--brand-text-muted)]">
                {audit.totalPages} pages • {new Date(audit.createdAt).toLocaleDateString()}
              </div>
              <div className="flex gap-3 mt-2">
                <span className="t-caption text-accent-danger">{audit.errors} errors</span>
                <span className="t-caption text-accent-warning">{audit.warnings} warnings</span>
              </div>
            </div>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <EmptyState
      icon={Shield}
      title="Site health check coming soon"
      description={`Once ${STUDIO_NAME} runs a site audit, you'll see a detailed health score, page-by-page issues, and recommendations to improve your site.`}
      action={onContentRequested ? (
        <Button variant="secondary" size="sm" onClick={onContentRequested}>
          Request a health check
        </Button>
      ) : undefined}
    />
  );
}
