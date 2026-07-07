// @ds-rebuilt
import { useEffect, useMemo, useState } from 'react';
import {
  useApproveAndPublishGbpReviewResponse,
  useDraftGbpReviewResponse,
  useGbpAuthenticatedReviews,
  useGbpReviewResponses,
  useRetryGbpReviewResponsePublish,
  useSendGbpReviewResponseToClient,
  useSyncGbpAuthenticatedReviews,
  useUpdateGbpReviewResponse,
  useWorkspaceGbpMappings,
} from '../../hooks/admin/useGoogleBusinessProfile';
import { useFeatureFlag } from '../../hooks/useFeatureFlag';
import { useToast } from '../Toast';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  ErrorState,
  FormTextarea,
  GroupBlock,
  Icon,
  InlineBanner,
  Segmented,
  Skeleton,
  type DataColumn,
} from '../ui';
import type {
  GbpReviewResponseReviewContext,
  GbpReviewResponseSummary,
} from '../../../shared/types/google-business-profile';
import {
  canApproveAndPublishReviewResponse,
  canEditReviewResponse,
  canSendReviewResponse,
  deskIncludesStatus,
  REVIEW_STATUS_META,
  REVIEW_STATUS_ORDER,
} from './localPresenceReviewStatus';
import { mutationErrorMessage } from './localPresenceMutationFeedback';
import {
  useDraftAndSendGbpReviewResponse,
  useManualGbpReviewResponseDraft,
} from './localPresenceReviewActions';
import type { LocalPresenceDesk } from './useLocalPresenceSurfaceState';

interface LocalPresenceReviewsPipelineProps {
  workspaceId: string;
  desk: LocalPresenceDesk;
  setDesk: (desk: LocalPresenceDesk) => void;
  search: string;
}

type ResponseRecord = Record<string, unknown> & {
  source: GbpReviewResponseSummary;
  reviewer: string;
  status: string;
  updated: string;
};

function ReviewsEmptyIcon({ className }: { className?: string }) {
  return <Icon name="message" className={className} />;
}

function WarningEmptyIcon({ className }: { className?: string }) {
  return <Icon name="alert" className={className} />;
}

function formatDate(value?: string): string {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'No date';
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatRating(value?: number): string {
  return typeof value === 'number' ? value.toFixed(1) : '—';
}

function reviewTitle(review: GbpReviewResponseReviewContext): string {
  const reviewer = review.reviewerDisplayName ?? (review.reviewerIsAnonymous ? 'Anonymous reviewer' : 'Reviewer');
  const rating = typeof review.ratingValue === 'number' ? `${review.ratingValue} star` : 'GBP review';
  return `${rating} from ${reviewer}`;
}

function reviewMatchesSearch(review: GbpReviewResponseReviewContext, search: string): boolean {
  if (!search) return true;
  const query = search.toLowerCase();
  return [
    review.reviewerDisplayName ?? '',
    review.commentExcerpt ?? '',
    review.locationTitle ?? '',
    review.reviewResourceName,
  ].join(' ').toLowerCase().includes(query);
}

function responseMatchesSearch(response: GbpReviewResponseSummary, search: string): boolean {
  if (!search) return true;
  const query = search.toLowerCase();
  return [
    response.status,
    response.draftText,
    response.editedText ?? '',
    response.lastError ?? '',
    response.review.reviewerDisplayName ?? '',
    response.review.commentExcerpt ?? '',
    response.review.locationTitle ?? '',
  ].join(' ').toLowerCase().includes(query);
}

function toRecord(response: GbpReviewResponseSummary): ResponseRecord {
  return {
    source: response,
    reviewer: response.review.reviewerDisplayName ?? 'Reviewer',
    status: response.status,
    updated: response.updatedAt,
  };
}

export function LocalPresenceReviewsPipeline({ workspaceId, desk, setDesk, search }: LocalPresenceReviewsPipelineProps) {
  const connectionEnabled = useFeatureFlag('gbp-auth-connection');
  const reviewsEnabled = useFeatureFlag('gbp-auth-reviews');
  const responsesEnabled = useFeatureFlag('gbp-review-responses');

  if (!connectionEnabled) {
    return (
      <InlineBanner tone="info" title="Google Business Profile connection is not enabled">
        Authenticated GBP connection is governed by the backend feature lifecycle. Aggregate GBP benchmark data may still appear in Overview.
      </InlineBanner>
    );
  }

  return (
    <LocalPresenceReviewsConnected
      workspaceId={workspaceId}
      reviewsEnabled={reviewsEnabled}
      responsesEnabled={responsesEnabled}
      desk={desk}
      setDesk={setDesk}
      search={search}
    />
  );
}

function LocalPresenceReviewsConnected({
  workspaceId,
  reviewsEnabled,
  responsesEnabled,
  desk,
  setDesk,
  search,
}: LocalPresenceReviewsPipelineProps & { reviewsEnabled: boolean; responsesEnabled: boolean }) {
  const mappings = useWorkspaceGbpMappings(workspaceId);
  const mappingData = mappings.data;
  const connected = Boolean(mappingData?.connection.connected);
  const mappedCount = mappingData?.mappings.length ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <GroupBlock
        title="GBP connection"
        meta="Connection and location mapping health for authenticated review sync."
        stats={[
          { label: 'Mapped', value: mappedCount, color: connected ? 'var(--teal)' : 'var(--brand-text-muted)' },
          { label: 'Locations', value: mappingData?.locations.length ?? 0, color: 'var(--blue)' },
        ]}
        flag={{
          label: connected ? 'Connected' : 'Disconnected',
          color: connected ? 'var(--teal)' : 'var(--brand-text-muted)',
          bg: connected ? 'var(--brand-mint-dim)' : 'var(--surface-3)',
          border: connected ? 'color-mix(in srgb, var(--teal) 28%, transparent)' : 'var(--brand-border)',
        }}
      >
        {mappings.isLoading && !mappingData ? (
          <div className="p-2"><Skeleton className="h-[92px] w-full" /></div>
        ) : mappings.isError && !mappingData ? (
          <ErrorState
            type="data"
            title="GBP mapping status did not load"
            message="Retry the authenticated Google Business Profile mapping read before syncing reviews."
            action={{ label: 'Retry', onClick: () => void mappings.refetch() }}
          />
        ) : (
          <div className="flex flex-wrap gap-2 p-3">
            <Badge label={mappingData?.connection.status.replace(/_/g, ' ') ?? 'unknown'} tone={connected ? 'teal' : 'zinc'} variant="soft" shape="pill" />
            <Badge label={`${mappedCount} mapped`} tone={mappedCount > 0 ? 'teal' : 'amber'} variant="soft" shape="pill" />
            {mappingData?.connection.needsReconnect && <Badge label="Reconnect needed" tone="amber" variant="soft" shape="pill" />}
          </div>
        )}
      </GroupBlock>

      {!reviewsEnabled ? (
        <InlineBanner tone="info" title="Authenticated review sync is not enabled">
          Review sync remains backend lifecycle-governed and is hidden until the feature flag is active.
        </InlineBanner>
      ) : (
        <AuthenticatedReviewSync workspaceId={workspaceId} connected={connected} mappedCount={mappedCount} />
      )}

      {!responsesEnabled ? (
        <InlineBanner tone="info" title="Review response workflow is not enabled">
          Drafting, client approval, and publishing stay hidden until the backend response flag is active.
        </InlineBanner>
      ) : (
        <ReviewResponseWorkflow workspaceId={workspaceId} desk={desk} setDesk={setDesk} search={search} />
      )}
    </div>
  );
}

function AuthenticatedReviewSync({ workspaceId, connected, mappedCount }: { workspaceId: string; connected: boolean; mappedCount: number }) {
  const reviews = useGbpAuthenticatedReviews(workspaceId);
  const sync = useSyncGbpAuthenticatedReviews(workspaceId);
  const { toast } = useToast();
  const data = reviews.data;

  const runSync = () => {
    sync.mutate(undefined, {
      onSuccess: (result) => toast(`${result.reviewCount} GBP reviews synced`, 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'GBP review sync failed'), 'error'),
    });
  };

  if (reviews.isLoading && !data) {
    return <Skeleton className="h-[220px] w-full" />;
  }

  if (reviews.isError && !data) {
    return (
      <ErrorState
        type="data"
        title="Authenticated reviews did not load"
        message="Check the GBP review flag, connection, and mapping before retrying."
        action={{ label: 'Retry', onClick: () => void reviews.refetch() }}
      />
    );
  }

  return (
    <GroupBlock
      title="Authenticated review sync"
      meta="Manual sync, aggregate review posture, and per-location sync health."
      stats={[
        { label: 'Stored', value: data?.aggregate.storedReviewCount ?? 0, color: 'var(--blue)' },
        { label: 'Unanswered', value: data?.aggregate.unansweredCount ?? 0, color: 'var(--amber)' },
        { label: 'Average', value: formatRating(data?.aggregate.averageRating), color: 'var(--blue)' },
      ]}
    >
      <div className="flex flex-col gap-3 p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={sync.isPending || !connected || mappedCount === 0} onClick={runSync}>
            <Icon name="refresh" size="sm" />
            {sync.isPending ? 'Syncing reviews' : 'Sync reviews'}
          </Button>
          {data?.aggregate.lastSyncedAt && <span className="t-caption text-[var(--brand-text-muted)]">Last synced {formatDate(data.aggregate.lastSyncedAt)}</span>}
        </div>
        {sync.error && (
          <InlineBanner tone="error" size="sm" title="Review sync failed">
            {mutationErrorMessage(sync.error, 'Authenticated GBP review sync could not complete')}
          </InlineBanner>
        )}
        {(!connected || mappedCount === 0) ? (
          <EmptyState
            icon={WarningEmptyIcon}
            title={!connected ? 'Connect Google Business Profile first' : 'Map a GBP location first'}
            description={!connected ? 'Review sync starts after the workspace has an authenticated GBP connection.' : 'Review sync only runs for mapped GBP locations.'}
          />
        ) : (
          <div className="grid gap-2 md:grid-cols-2">
            {(data?.locations ?? []).map((location) => (
              <div key={location.googleLocationId} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">
                      {location.location.title ?? location.location.resourceName}
                    </p>
                    <p className="t-caption-sm text-[var(--brand-text-muted)]">
                      {location.storedReviewCount} stored · {location.unansweredCount} unanswered
                    </p>
                  </div>
                  <Badge
                    label={location.syncStatus.replace(/_/g, ' ')}
                    tone={location.syncStatus === 'synced' ? 'emerald' : location.syncStatus === 'failed' ? 'amber' : 'zinc'}
                    variant="soft"
                    shape="pill"
                  />
                </div>
                {location.lastError && <p className="mt-2 t-caption-sm text-[var(--amber)]">{location.lastError}</p>}
              </div>
            ))}
          </div>
        )}
        {data?.copyPolicy.guidance && <p className="t-caption-sm text-[var(--brand-text-muted)]">{data.copyPolicy.guidance}</p>}
      </div>
    </GroupBlock>
  );
}

function ReviewResponseWorkflow({ workspaceId, desk, setDesk, search }: LocalPresenceReviewsPipelineProps) {
  const workflow = useGbpReviewResponses(workspaceId);
  const draftAi = useDraftGbpReviewResponse(workspaceId);
  const manualDraft = useManualGbpReviewResponseDraft(workspaceId);
  const draftAndSend = useDraftAndSendGbpReviewResponse(workspaceId);
  const update = useUpdateGbpReviewResponse(workspaceId);
  const send = useSendGbpReviewResponseToClient(workspaceId);
  const approve = useApproveAndPublishGbpReviewResponse(workspaceId);
  const retry = useRetryGbpReviewResponsePublish(workspaceId);
  const { toast } = useToast();
  const [draftTextById, setDraftTextById] = useState<Record<string, string>>({});
  const [manualTextByReview, setManualTextByReview] = useState<Record<string, string>>({});
  const [noteByReview, setNoteByReview] = useState<Record<string, string>>({});
  const data = workflow.data;
  const responses = data?.responses ?? [];
  const responseReviewNames = useMemo(() => new Set(responses.map((response) => response.reviewResourceName)), [responses]);

  useEffect(() => {
    setDraftTextById((current) => {
      let changed = false;
      const next = { ...current };
      for (const response of responses) {
        if (next[response.id] === undefined) {
          next[response.id] = response.editedText ?? response.draftText;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [responses]);

  const eligibleReviews = (data?.eligibleReviews ?? [])
    .filter((review) => !responseReviewNames.has(review.reviewResourceName))
    .filter((review) => reviewMatchesSearch(review, search));

  const filteredResponses = responses
    .filter((response) => deskIncludesStatus(desk, response.status))
    .filter((response) => responseMatchesSearch(response, search));

  const statusCounts = useMemo(() => {
    const counts = new Map(REVIEW_STATUS_ORDER.map((status) => [status, 0]));
    for (const response of responses) counts.set(response.status, (counts.get(response.status) ?? 0) + 1);
    return counts;
  }, [responses]);

  const saveManualDraft = (review: GbpReviewResponseReviewContext) => {
    const draftText = (manualTextByReview[review.reviewResourceName] ?? '').trim();
    manualDraft.mutate({ reviewResourceName: review.reviewResourceName, draftText }, {
      onSuccess: () => toast('Manual review response draft saved', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Manual draft failed'), 'error'),
    });
  };

  const createDraftAndSend = (review: GbpReviewResponseReviewContext) => {
    const draftText = (manualTextByReview[review.reviewResourceName] ?? '').trim();
    const note = (noteByReview[review.reviewResourceName] ?? '').trim();
    draftAndSend.mutate({
      reviewResourceName: review.reviewResourceName,
      draftText,
      note: note || undefined,
    }, {
      onSuccess: () => toast('Manual draft sent to client', 'success'),
      onError: (error) => toast(mutationErrorMessage(error, 'Draft and send failed'), 'error'),
    });
  };

  const columns = useMemo<DataColumn[]>(() => [
    {
      key: 'reviewer',
      label: 'Review',
      width: 'minmax(230px, 1.2fr)',
      render: (_value, record) => {
        const response = (record as ResponseRecord).source;
        return (
          <div className="min-w-0">
            <span className="block truncate font-semibold text-[var(--brand-text-bright)]">{reviewTitle(response.review)}</span>
            <span className="block truncate t-caption-sm text-[var(--brand-text-muted)]">{response.review.commentExcerpt ?? 'No review text provided.'}</span>
          </div>
        );
      },
    },
    {
      key: 'status',
      label: 'Status',
      width: '150px',
      render: (_value, record) => {
        const response = (record as ResponseRecord).source;
        const meta = REVIEW_STATUS_META[response.status];
        return (
          <div className="flex flex-col gap-1">
            <Badge label={meta.label} tone={meta.tone} variant="soft" shape="pill" />
            <span className="t-caption-sm text-[var(--brand-text-muted)]">{meta.description}</span>
          </div>
        );
      },
    },
    {
      key: 'draft',
      label: 'Response',
      width: 'minmax(280px, 1.8fr)',
      render: (_value, record) => {
        const response = (record as ResponseRecord).source;
        const draftText = draftTextById[response.id] ?? response.editedText ?? response.draftText;
        if (!canEditReviewResponse(response.status)) {
          return <p className="line-clamp-3 t-caption-sm text-[var(--brand-text-muted)]">{response.editedText ?? response.draftText}</p>;
        }
        return (
          <FormTextarea
            value={draftText}
            onChange={(value) => setDraftTextById((current) => ({ ...current, [response.id]: value }))}
            rows={3}
            maxLength={1500}
            aria-label={`Draft response for ${reviewTitle(response.review)}`}
          />
        );
      },
    },
    {
      key: 'actions',
      label: 'Actions',
      width: 'minmax(220px, 1fr)',
      render: (_value, record) => {
        const response = (record as ResponseRecord).source;
        const draftText = (draftTextById[response.id] ?? response.editedText ?? response.draftText).trim();
        const closed = response.status === 'declined' || response.status === 'cancelled' || response.status === 'published';
        return (
          <div className="flex flex-wrap gap-1.5">
            {canEditReviewResponse(response.status) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={update.isPending || draftText.length < 20}
                onClick={() => update.mutate(
                  { responseId: response.id, body: { draftText } },
                  {
                    onSuccess: () => toast('Review response draft saved', 'success'),
                    onError: (error) => toast(mutationErrorMessage(error, 'Draft save failed'), 'error'),
                  },
                )}
              >
                Save
              </Button>
            )}
            {canSendReviewResponse(response.status) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={send.isPending}
                onClick={() => send.mutate(
                  { responseId: response.id },
                  {
                    onSuccess: () => toast('Review response sent to client', 'success'),
                    onError: (error) => toast(mutationErrorMessage(error, 'Send to client failed'), 'error'),
                  },
                )}
              >
                <Icon name="send" size="sm" />
                Send
              </Button>
            )}
            {canApproveAndPublishReviewResponse(response.status) && (
              <Button
                size="sm"
                variant="primary"
                disabled={approve.isPending}
                onClick={() => approve.mutate(response.id, {
                  onSuccess: () => toast('Review response approved for publishing', 'success'),
                  onError: (error) => toast(mutationErrorMessage(error, 'Approve and publish failed'), 'error'),
                })}
              >
                <Icon name="check" size="sm" />
                Publish
              </Button>
            )}
            {response.status === 'publish_failed' && (
              <Button
                size="sm"
                variant="secondary"
                disabled={retry.isPending}
                onClick={() => retry.mutate(response.id, {
                  onSuccess: () => toast('Review response publish retried', 'success'),
                  onError: (error) => toast(mutationErrorMessage(error, 'Publish retry failed'), 'error'),
                })}
              >
                <Icon name="refresh" size="sm" />
                Retry
              </Button>
            )}
            {closed && <Badge label="Closed" tone="zinc" variant="outline" shape="pill" />}
            {response.lastError && <span role="alert" className="basis-full t-caption-sm text-[var(--red)]">{response.lastError}</span>}
          </div>
        );
      },
    },
  ], [approve, draftTextById, retry, send, toast, update]);

  if (workflow.isLoading && !data) return <Skeleton className="h-[320px] w-full" />;

  if (workflow.isError && !data) {
    return (
      <ErrorState
        type="data"
        title="Review response workflow did not load"
        message="Check the GBP response flag and retry the workflow read."
        action={{ label: 'Retry', onClick: () => void workflow.refetch() }}
      />
    );
  }

  if (!data?.connection.connected) {
    return (
      <EmptyState
        icon={WarningEmptyIcon}
        title="Connect Google Business Profile first"
        description="Review response approvals start after the workspace has an authenticated GBP connection."
      />
    );
  }

  return (
    <GroupBlock
      title="Review response pipeline"
      meta="Draft, client approval, publish, retry, and closed response states."
      stats={[
        { label: 'Open', value: statusCounts.get('draft')! + statusCounts.get('changes_requested')! + statusCounts.get('publish_failed')!, color: 'var(--amber)' },
        { label: 'With client', value: statusCounts.get('awaiting_client')!, color: 'var(--blue)' },
        { label: 'Published', value: statusCounts.get('published')!, color: 'var(--emerald)' },
      ]}
    >
      <div className="flex flex-col gap-4 p-2">
        <Segmented
          options={[
            { value: 'on_your_desk', label: 'On your desk' },
            { value: 'with_client', label: 'With client' },
            { value: 'published', label: 'Published' },
            { value: 'all', label: 'All' },
          ]}
          value={desk}
          onChange={(value) => setDesk(value as LocalPresenceDesk)}
        />

        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {REVIEW_STATUS_ORDER.map((status) => {
            const meta = REVIEW_STATUS_META[status];
            return (
              <div key={status} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <Badge label={meta.label} tone={meta.tone} variant="soft" shape="pill" />
                  {/* stat-primitive-ok — bespoke review-status pipeline chip (badge + count + description), not a StatCard/CompactStatBar layout */}
                  <span className="t-stat-sm tabular-nums text-[var(--brand-text-bright)]">{statusCounts.get(status) ?? 0}</span>
                </div>
                <p className="mt-1 t-caption-sm text-[var(--brand-text-muted)]">{meta.description}</p>
              </div>
            );
          })}
        </div>

        {eligibleReviews.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-2">
            {eligibleReviews.slice(0, 6).map((review) => {
              const manualText = manualTextByReview[review.reviewResourceName] ?? '';
              const canSubmitManual = manualText.trim().length >= 20;
              return (
                <div key={review.reviewResourceName} className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-1)] p-3">
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate t-caption font-semibold text-[var(--brand-text-bright)]">{reviewTitle(review)}</p>
                      <p className="line-clamp-2 t-caption-sm text-[var(--brand-text-muted)]">{review.commentExcerpt ?? 'No review text provided.'}</p>
                    </div>
                    <Badge label="Unanswered" tone="amber" variant="soft" shape="pill" />
                  </div>
                  <FormTextarea
                    value={manualText}
                    onChange={(value) => setManualTextByReview((current) => ({ ...current, [review.reviewResourceName]: value }))}
                    rows={3}
                    maxLength={1500}
                    placeholder="Write a public reply draft"
                    aria-label={`Manual draft for ${reviewTitle(review)}`}
                  />
                  <FormTextarea
                    value={noteByReview[review.reviewResourceName] ?? ''}
                    onChange={(value) => setNoteByReview((current) => ({ ...current, [review.reviewResourceName]: value }))}
                    rows={2}
                    maxLength={1000}
                    placeholder="Optional client note"
                    aria-label={`Client note for ${reviewTitle(review)}`}
                    className="mt-2"
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={draftAi.isPending}
                      onClick={() => draftAi.mutate(
                        { reviewResourceName: review.reviewResourceName },
                        {
                          onSuccess: () => toast('AI review response draft created', 'success'),
                          onError: (error) => toast(mutationErrorMessage(error, 'AI draft failed'), 'error'),
                        },
                      )}
                    >
                      <Icon name="sparkle" size="sm" />
                      Draft with AI
                    </Button>
                    <Button size="sm" variant="secondary" disabled={!canSubmitManual || manualDraft.isPending} onClick={() => saveManualDraft(review)}>
                      <Icon name="message" size="sm" />
                      Save manual
                    </Button>
                    <Button size="sm" variant="primary" disabled={!canSubmitManual || draftAndSend.isPending} onClick={() => createDraftAndSend(review)}>
                      <Icon name="send" size="sm" />
                      Draft and send
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DataTable
          columns={columns}
          rows={filteredResponses.map(toRecord)}
          getRowKey={(record) => (record as ResponseRecord).source.id}
          empty={(
            <EmptyState
              icon={ReviewsEmptyIcon}
              title="No review responses match this desk"
              description="Sync authenticated reviews, draft a reply, or clear filters to see closed response states."
            />
          )}
        />

        {data.policy.guidance && <p className="t-caption-sm text-[var(--brand-text-muted)]">{data.policy.guidance}</p>}
      </div>
    </GroupBlock>
  );
}
