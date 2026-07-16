import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { identity, voice } from '../../api/brand-engine';
import { queryKeys } from '../../lib/queryKeys';
import { extractErrorMessage } from '../../lib/extractErrorMessage';
import { RenderMarkdown } from '../client/RenderMarkdown';
import { useToast } from '../Toast';
import { Badge, Button, InlineBanner, Modal, Skeleton } from '../ui';

interface BrandPendingChangesProps {
  workspaceId: string;
  onReviewVoice: () => void;
}

function deliverableLabel(value: string): string {
  return value
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export function BrandPendingChanges({
  workspaceId,
  onReviewVoice,
}: BrandPendingChangesProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const profileQuery = useQuery({
    queryKey: queryKeys.admin.voiceProfile(workspaceId),
    queryFn: () => voice.getProfile(workspaceId),
  });
  const readinessQuery = useQuery({
    queryKey: queryKeys.admin.voiceReadiness(workspaceId),
    queryFn: () => voice.getReadiness(workspaceId),
    enabled: Boolean(profileQuery.data),
  });
  const deliverablesQuery = useQuery({
    queryKey: queryKeys.admin.brandIdentity(workspaceId),
    queryFn: () => identity.list(workspaceId),
  });

  const proposedSamples = (profileQuery.data?.samples ?? [])
    .filter(sample => sample.source === 'mcp_proposed');
  const draftDeliverables = (deliverablesQuery.data ?? [])
    .filter(deliverable => deliverable.status === 'draft');
  const visibleChangeCount = proposedSamples.length + draftDeliverables.length;
  const voiceNeedsFinalization = Boolean(
    profileQuery.data
      && readinessQuery.data
      && readinessQuery.data.readiness.state !== 'finalized',
  );
  const totalPendingCount = visibleChangeCount + (voiceNeedsFinalization ? 1 : 0);
  const isLoading = profileQuery.isLoading
    || deliverablesQuery.isLoading
    || (Boolean(profileQuery.data) && readinessQuery.isLoading);
  const hasLoadError = profileQuery.isError
    || deliverablesQuery.isError
    || readinessQuery.isError;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceProfile(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.voiceReadiness(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.brandIdentity(workspaceId) }),
    ]);
  };

  const approveAllMutation = useMutation({
    mutationFn: async () => {
      const sampleIds = proposedSamples.map(sample => sample.id);
      const visibleDeliverables = draftDeliverables.map(deliverable => ({
        id: deliverable.id,
        version: deliverable.version,
      }));
      if (sampleIds.length > 0 && profileQuery.data) {
        await voice.attestSamples(workspaceId, sampleIds, profileQuery.data.revision);
      }
      await Promise.all(
        visibleDeliverables.map(deliverable =>
          identity.updateStatus(workspaceId, deliverable.id, 'approved', deliverable.version)),
      );
      return sampleIds.length + visibleDeliverables.length;
    },
    onSuccess: async (count) => {
      await invalidate();
      toast(`${count} brand change${count === 1 ? '' : 's'} approved`);
    },
    onError: async (error) => {
      await invalidate();
      toast(extractErrorMessage(error, 'Some brand changes could not be approved'), 'error');
    },
  });

  const openVoiceReview = () => {
    setOpen(false);
    onReviewVoice();
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant={totalPendingCount > 0 ? 'primary' : 'secondary'}
        onClick={() => setOpen(true)}
        aria-label={hasLoadError
          ? 'Review Brand and AI approval status'
          : totalPendingCount > 0
          ? `Review ${totalPendingCount} pending Brand and AI items`
          : 'Review Brand and AI approvals'}
      >
        {isLoading ? 'Checking approvals…' : hasLoadError
          ? 'Approvals unavailable'
          : totalPendingCount > 0
          ? `${totalPendingCount} pending`
          : 'No pending changes'}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} size="workflow">
        <Modal.Header title="Pending Brand & AI changes" onClose={() => setOpen(false)} />
        <Modal.Body className="max-h-[calc(100vh-11rem)] overflow-y-auto">
          <div className="space-y-5">
            <p className="t-body text-[var(--brand-text-muted)]">
              Review the complete visible set below. Batch approval is bound to these exact
              proposals and deliverables; voice finalization remains its own explicit lock step.
            </p>

            {hasLoadError ? (
              <InlineBanner tone="error" title="Approval status unavailable">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p>Some pending items could not be loaded. Retry before approving changes.</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => void invalidate()}>
                    Retry
                  </Button>
                </div>
              </InlineBanner>
            ) : isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                {visibleChangeCount > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-3 border-y border-[var(--brand-border)] py-3">
                    <div>
                      <p className="t-ui font-semibold text-[var(--brand-text-bright)]">
                        {visibleChangeCount} change{visibleChangeCount === 1 ? '' : 's'} ready for approval
                      </p>
                      <p className="t-caption text-[var(--brand-text-muted)]">
                        Nothing is truncated or hidden behind pagination.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => approveAllMutation.mutate()}
                      loading={approveAllMutation.isPending}
                      disabled={approveAllMutation.isPending}
                    >
                      Approve all {visibleChangeCount} change{visibleChangeCount === 1 ? '' : 's'}
                    </Button>
                  </div>
                )}

                {proposedSamples.length > 0 && (
                  <section aria-labelledby="pending-voice-proposals" className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 id="pending-voice-proposals" className="t-ui font-semibold text-[var(--brand-text-bright)]">
                        Voice proposals
                      </h3>
                      <Badge label={String(proposedSamples.length)} tone="amber" />
                    </div>
                    <div className="divide-y divide-[var(--brand-border)] border-y border-[var(--brand-border)]">
                      {proposedSamples.map(sample => (
                        <div key={sample.id} className="space-y-2 py-3">
                          <div className="flex flex-wrap gap-2">
                            <Badge label="Chat proposal" tone="amber" />
                            {sample.contextTag && <Badge label={sample.contextTag} tone="blue" />}
                          </div>
                          <p className="t-body whitespace-pre-wrap text-[var(--brand-text)]">{sample.content}</p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {draftDeliverables.length > 0 && (
                  <section aria-labelledby="pending-brand-deliverables" className="space-y-3">
                    <div className="flex items-center gap-2">
                      <h3 id="pending-brand-deliverables" className="t-ui font-semibold text-[var(--brand-text-bright)]">
                        Brand deliverables
                      </h3>
                      <Badge label={String(draftDeliverables.length)} tone="amber" />
                    </div>
                    <div className="divide-y divide-[var(--brand-border)] border-y border-[var(--brand-border)]">
                      {draftDeliverables.map(deliverable => (
                        <div key={deliverable.id} className="space-y-2 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="t-ui font-semibold text-[var(--brand-text-bright)]">
                              {deliverableLabel(deliverable.deliverableType)}
                            </p>
                            <Badge label="Draft" tone="amber" />
                          </div>
                          <div className="t-body text-[var(--brand-text)]">
                            <RenderMarkdown text={deliverable.content} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {voiceNeedsFinalization && (
                  <InlineBanner tone="warning" title="Voice still needs final approval">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p>
                        Approving proposals makes them authentic anchors. Locking the complete
                        voice revision is a separate human decision.
                      </p>
                      <Button type="button" variant="secondary" size="sm" onClick={openVoiceReview}>
                        Review and lock voice
                      </Button>
                    </div>
                  </InlineBanner>
                )}

                {totalPendingCount === 0 && (
                  <InlineBanner
                    tone="success"
                    title="Everything is approved"
                    message="There are no pending Brand & AI changes or voice decisions."
                  />
                )}
              </>
            )}
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}
