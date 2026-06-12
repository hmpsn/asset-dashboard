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
import { HealthCartSummary } from './health-tab/HealthCartSummary';
import { useHealthTabShell } from './health-tab/useHealthTabShell';
import { formatDate } from '../../utils/formatDates';
import type { Tier } from '../ui/TierGate';
import type { ImpactBand } from '../../../shared/types/fix-catalog.js';

const ScoreRing = MetricRing;

export interface HealthTabProps {
  audit: AuditSummary | null;
  auditDetail: AuditDetail | null;
  liveDomain?: string;
  initialSeverity?: 'all' | 'error' | 'warning' | 'info';
  workspaceId?: string;
  onContentRequested?: () => void;
  actionPlanSlot?: ReactNode;
  /** Client tier — controls "Fix this $X" vs "Covered by hours" framing */
  tier?: Tier;
  /** Impact bands keyed by audit check type, from the intelligence projection */
  impactBandsByCheck?: Record<string, ImpactBand>;
  /** Suppresses all price rendering for external-billing workspaces */
  hidePrices?: boolean;
  /** Called when Premium user clicks "request fix" for a specific check */
  onRequestFix?: (check: string, label: string) => void;
}

export function HealthTab({
  audit,
  auditDetail,
  liveDomain,
  initialSeverity,
  workspaceId,
  onContentRequested,
  actionPlanSlot,
  tier = 'growth',
  impactBandsByCheck,
  hidePrices,
  onRequestFix,
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
        <HealthHeaderSection shell={shell} />
        <HealthScoreSummarySection auditDetail={auditDetail} shell={shell} />
        <HealthAuditDiffSection auditDetail={auditDetail} />
        <HealthPageSpeedSection auditDetail={auditDetail} />
        <HealthTopFixesSection
          auditDetail={auditDetail}
          liveDomain={liveDomain}
          workspaceId={workspaceId}
          shell={shell}
          tier={tier}
          hidePrices={hidePrices}
          impactBandsByCheck={impactBandsByCheck}
          onRequestFix={onRequestFix}
        />
        {actionPlanSlot}
        <HealthSiteWideIssuesSection auditDetail={auditDetail} shell={shell} />
        <HealthAllPagesSection
          auditDetail={auditDetail}
          liveDomain={liveDomain}
          workspaceId={workspaceId}
          shell={shell}
          tier={tier}
          hidePrices={hidePrices}
          impactBandsByCheck={impactBandsByCheck}
          onRequestFix={onRequestFix}
        />
        <HealthHistorySection auditDetail={auditDetail} shell={shell} />
        {!hidePrices && <HealthCartSummary hidePrices={hidePrices} impactBandsByCheck={impactBandsByCheck} />}
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
                {audit.totalPages} pages • {formatDate(audit.createdAt)}
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
