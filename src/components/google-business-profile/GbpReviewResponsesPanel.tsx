import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, MessageSquareReply, RefreshCw, Send } from 'lucide-react';
import {
  useApproveAndPublishGbpReviewResponse,
  useDraftGbpReviewResponse,
  useGbpReviewResponses,
  useRetryGbpReviewResponsePublish,
  useSendGbpReviewResponseToClient,
  useUpdateGbpReviewResponse,
} from '../../hooks/admin/useGoogleBusinessProfile';
import { Badge, Button, EmptyState, ErrorState, FormTextarea, SectionCard } from '../ui';
import type {
  GbpReviewResponseStatus,
  GbpReviewResponseSummary,
} from '../../../shared/types/google-business-profile';

const STATUS_TONE: Record<GbpReviewResponseStatus, 'zinc' | 'teal' | 'blue' | 'emerald' | 'amber' | 'red'> = {
  draft: 'zinc',
  awaiting_client: 'blue',
  changes_requested: 'amber',
  declined: 'red',
  approved: 'teal',
  publishing: 'blue',
  published: 'emerald',
  publish_failed: 'red',
  cancelled: 'zinc',
};

function statusLabel(status: GbpReviewResponseStatus): string {
  return status.replace(/_/g, ' ');
}

function reviewTitle(response: GbpReviewResponseSummary): string {
  const reviewer = response.review.reviewerDisplayName ?? (response.review.reviewerIsAnonymous ? 'Anonymous reviewer' : 'Reviewer');
  const rating = typeof response.review.ratingValue === 'number' ? `${response.review.ratingValue} star` : 'GBP review';
  return `${rating} from ${reviewer}`;
}

export function GbpReviewResponsesPanel({ workspaceId }: { workspaceId: string }) {
  const query = useGbpReviewResponses(workspaceId);
  const draft = useDraftGbpReviewResponse(workspaceId);
  const update = useUpdateGbpReviewResponse(workspaceId);
  const send = useSendGbpReviewResponseToClient(workspaceId);
  const approve = useApproveAndPublishGbpReviewResponse(workspaceId);
  const retry = useRetryGbpReviewResponsePublish(workspaceId);
  const [draftTextById, setDraftTextById] = useState<Record<string, string>>({});

  const data = query.data;
  const responses = data?.responses ?? [];
  const responseReviewNames = useMemo(
    () => new Set(responses.map(response => response.reviewResourceName)),
    [responses],
  );
  const eligibleWithoutDraft = (data?.eligibleReviews ?? [])
    .filter(review => !responseReviewNames.has(review.reviewResourceName))
    .slice(0, 8);

  useEffect(() => {
    setDraftTextById((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const response of responses) {
        if (next[response.id] === undefined) {
          next[response.id] = response.editedText ?? response.draftText;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [responses]);

  if (query.isLoading && !data) {
    return (
      <SectionCard title="Review response workflow" titleExtra={<Badge label="Phase 2C" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <div className="h-28 rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/30 animate-pulse" />
      </SectionCard>
    );
  }

  if (query.isError && !data) {
    return (
      <SectionCard title="Review response workflow" titleExtra={<Badge label="Phase 2C" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <ErrorState
          type="data"
          title="Couldn't load review response workflow"
          message="Check the GBP response feature flag and try again."
          action={{ label: 'Retry', onClick: () => void query.refetch() }}
        />
      </SectionCard>
    );
  }

  if (!data?.connection.connected) {
    return (
      <SectionCard title="Review response workflow" titleExtra={<Badge label="Phase 2C" tone="zinc" variant="soft" shape="pill" />} variant="subtle">
        <EmptyState
          icon={AlertTriangle}
          title="Connect Google Business Profile first"
          description="Review response approvals start after the workspace has an authenticated GBP connection."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Review response workflow"
      titleExtra={<Badge label="Draft + approval" tone="teal" variant="soft" shape="pill" />}
      variant="subtle"
    >
      <div className="space-y-4">
        {eligibleWithoutDraft.length > 0 && (
          <div className="space-y-2">
            <p className="t-label text-[var(--brand-text-muted)]">Unanswered reviews ready for a draft</p>
            {eligibleWithoutDraft.map(review => (
              <div key={review.reviewResourceName} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="t-caption font-semibold text-[var(--brand-text-bright)]">
                      {review.ratingValue ?? '-'} star · {review.reviewerDisplayName ?? 'Reviewer'}
                    </p>
                    <p className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-2">
                      {review.commentText ?? review.commentExcerpt ?? 'No review text provided.'}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={MessageSquareReply}
                    loading={draft.isPending && draft.variables?.reviewResourceName === review.reviewResourceName}
                    onClick={() => draft.mutate({ reviewResourceName: review.reviewResourceName })}
                  >
                    Draft reply
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {responses.length > 0 ? (
          <div className="space-y-3">
            {responses.map(response => {
              const draftText = draftTextById[response.id] ?? response.editedText ?? response.draftText;
              const canEdit = ['draft', 'changes_requested'].includes(response.status);
              const canSend = ['draft', 'changes_requested', 'awaiting_client'].includes(response.status);
              const canPublish = ['draft', 'approved'].includes(response.status);
              return (
                <div key={response.id} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)]/60 p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-caption font-semibold text-[var(--brand-text-bright)]">{reviewTitle(response)}</p>
                      <p className="t-caption-sm text-[var(--brand-text-muted)] line-clamp-2">
                        {response.review.commentText ?? response.review.commentExcerpt ?? 'No review text provided.'}
                      </p>
                    </div>
                    <Badge label={statusLabel(response.status)} tone={STATUS_TONE[response.status]} variant="soft" shape="pill" />
                  </div>

                  <FormTextarea
                    value={draftText}
                    onChange={(value) => setDraftTextById(prev => ({ ...prev, [response.id]: value }))}
                    rows={4}
                    maxLength={1500}
                    disabled={!canEdit}
                    aria-label="Draft review response"
                  />
                  {response.lastError && (
                    <p className="t-caption-sm text-red-400">{response.lastError}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canEdit || update.isPending}
                      onClick={() => update.mutate({ responseId: response.id, body: { draftText } })}
                    >
                      Save draft
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={Send}
                      disabled={!canSend || send.isPending}
                      onClick={() => send.mutate({ responseId: response.id })}
                    >
                      Send to client
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={CheckCircle2}
                      disabled={!canPublish || approve.isPending}
                      onClick={() => approve.mutate(response.id)}
                    >
                      Approve and publish
                    </Button>
                    {response.status === 'publish_failed' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={RefreshCw}
                        loading={retry.isPending && retry.variables === response.id}
                        onClick={() => retry.mutate(response.id)}
                      >
                        Retry publish
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : eligibleWithoutDraft.length === 0 ? (
          <EmptyState
            icon={MessageSquareReply}
            title="No unanswered synced reviews"
            description="Sync authenticated reviews to find unanswered reviews that can be drafted and approved."
          />
        ) : null}

        <p className="t-caption-sm text-[var(--brand-text-muted)]">{data.policy.guidance}</p>
      </div>
    </SectionCard>
  );
}
