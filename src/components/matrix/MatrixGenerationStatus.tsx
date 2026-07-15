import { Check, Eye, RefreshCw, Sparkles } from 'lucide-react';
import type {
  GetMatrixGenerationResult,
  MatrixGenerationItemRead,
} from '../../../shared/types/matrix-generation';
import { isBlockingMatrixGenerationSetAuditFinding } from '../../../shared/types/matrix-generation';
import {
  Badge,
  Button,
  CompactStatBar,
  Icon,
  InlineBanner,
  ProgressIndicator,
  SectionCard,
} from '../ui';

interface MatrixGenerationStatusProps {
  result: GetMatrixGenerationResult;
  retrying: boolean;
  onRetry: (items: MatrixGenerationItemRead[]) => void;
  approvingItemId: string | null;
  onReview: (item: MatrixGenerationItemRead) => void;
  onApprove: (item: MatrixGenerationItemRead) => void;
}

const ITEM_LABELS: Record<MatrixGenerationItemRead['status'], string> = {
  queued: 'Queued',
  preflighting: 'Checking inputs',
  preflighted: 'Ready to generate',
  generating_brief: 'Generating brief',
  generating_post: 'Generating page',
  auditing_deterministic: 'Running checks',
  auditing_model: 'Reviewing quality',
  revising: 'Applying revision',
  ready_for_human_review: 'Ready for review',
  needs_attention: 'Needs attention',
  blocked_missing_evidence: 'Missing evidence',
  conflict: 'Source changed',
  cancelled: 'Cancelled',
  failed: 'Failed',
};

function itemTone(status: MatrixGenerationItemRead['status']) {
  if (status === 'ready_for_human_review') return 'emerald' as const;
  if (status === 'failed' || status === 'conflict') return 'red' as const;
  if (status === 'needs_attention' || status === 'blocked_missing_evidence') return 'amber' as const;
  if (status === 'cancelled') return 'zinc' as const;
  return 'blue' as const;
}

function runLabel(status: GetMatrixGenerationResult['run']['status']): string {
  if (status === 'completed') return 'Ready for review';
  if (status === 'completed_with_errors') return 'Completed with issues';
  if (status === 'blocked') return 'Blocked';
  if (status === 'conflict') return 'Source changed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'failed') return 'Failed';
  return status === 'queued' ? 'Queued' : 'Generating';
}

function runTone(status: GetMatrixGenerationResult['run']['status']) {
  if (status === 'completed') return 'emerald' as const;
  if (status === 'failed' || status === 'conflict') return 'red' as const;
  if (status === 'completed_with_errors' || status === 'blocked') return 'amber' as const;
  if (status === 'cancelled') return 'zinc' as const;
  return 'blue' as const;
}

export function MatrixGenerationStatus({
  result,
  retrying,
  onRetry,
  approvingItemId,
  onReview,
  onApprove,
}: MatrixGenerationStatusProps) {
  const { run } = result;
  const items = result.items.items;
  const active = run.status === 'queued' || run.status === 'running';
  const processed = run.counts.selected - run.counts.queued - run.counts.running;
  const retryable = items.filter(item => (
    (item.status === 'failed' || item.status === 'needs_attention')
    && item.error?.retryable !== false
  ));
  const firstSetFinding = run.setAuditReport?.findings[0];

  return (
    <SectionCard
      title="Matrix generation"
      subtitle={`${processed} of ${run.counts.selected} pages processed`}
      titleIcon={<Icon as={Sparkles} size="sm" className="text-accent-brand" />}
      titleExtra={<Badge label={runLabel(run.status)} tone={runTone(run.status)} />}
      action={retryable.length > 0 && !active ? (
        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          loading={retrying}
          onClick={() => onRetry(retryable)}
        >
          Retry {retryable.length} {retryable.length === 1 ? 'page' : 'pages'}
        </Button>
      ) : undefined}
    >
      <div className="space-y-3">
        {active && (
          <ProgressIndicator
            status="running"
            step="Generating and auditing selected pages"
            detail="Each page remains a draft until a human approves it."
            percent={run.counts.selected > 0 ? (processed / run.counts.selected) * 100 : 0}
          />
        )}

        {firstSetFinding && (
          <InlineBanner
            tone={run.setAuditReport?.verdict === 'source_correction_required' ? 'error' : 'warning'}
            title="Cross-page review needs attention"
            message={`${firstSetFinding.message}${run.setAuditReport!.findings.length > 1
              ? ` (${run.setAuditReport!.findings.length - 1} more)`
              : ''}`}
          />
        )}

        <CompactStatBar
          className="bg-[var(--surface-1)]"
          items={[
            { label: 'Ready', value: run.counts.readyForHumanReview, valueColor: 'text-emerald-400' },
            { label: 'Attention', value: run.counts.needsAttention + run.counts.blocked, valueColor: 'text-amber-400' },
            { label: 'Failed', value: run.counts.failed + run.counts.conflicts, valueColor: 'text-red-400' },
          ]}
        />

        <div className="divide-y divide-[var(--brand-border)]">
          {items.map(item => {
            const canApprove = !active
              && Boolean(run.setAuditReport)
              && item.status === 'ready_for_human_review'
              && item.auditReport?.verdict === 'ready_for_human_review'
              && item.auditReport.unresolvedRequirementIds.length === 0
              && !item.approvalEvidence
              && Boolean(item.postId)
              && item.currentArtifactRevisions.post.artifactId === item.postId
              && !item.setAuditFindings.some(isBlockingMatrixGenerationSetAuditFinding);
            return (
              <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <p className="t-caption font-medium text-[var(--brand-text-bright)] truncate">
                    {item.target?.targetKeyword ?? item.cellId}
                  </p>
                  {(item.error?.message || item.setAuditFindings[0]?.message) && (
                    <p className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-2">
                      {item.error?.message ?? item.setAuditFindings[0]?.message}
                    </p>
                  )}
                </div>
                <div className="flex flex-none flex-wrap items-center justify-end gap-1.5">
                  {canApprove && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Eye}
                        onClick={() => onReview(item)}
                      >
                        Review page
                      </Button>
                      <Button
                        size="sm"
                        icon={Check}
                        loading={approvingItemId === item.id}
                        onClick={() => onApprove(item)}
                      >
                        Approve for export
                      </Button>
                    </>
                  )}
                  {item.approvalEvidence && <Badge label="Approved for export" tone="teal" />}
                  <Badge label={ITEM_LABELS[item.status]} tone={itemTone(item.status)} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );
}
