import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../../../api/client';
import {
  Badge,
  Button,
  Disclosure,
  FormField,
  FormTextarea,
  Icon,
  InlineBanner,
  SectionCard,
} from '../../ui';
import { RenderMarkdown } from '../RenderMarkdown';
import { useRespondToBrandReview } from '../../../hooks/client/useUnifiedInbox';
import {
  BRAND_REVIEW_CONTRACT_VERSION,
  type ClientBrandReviewBundlePayload,
  type ClientBrandReviewItemPayload,
} from '../../../../shared/types/brand-generation';
import {
  BRAND_DELIVERABLE_TYPES,
  type BrandDeliverableType,
} from '../../../../shared/types/brand-engine';
import type {
  ClientDeliverable,
  ClientDeliverableItem,
} from '../../../../shared/types/client-deliverable';

type ReviewItemStatus = 'awaiting_client' | 'approved' | 'changes_requested';
type ReviewBundleStatus = ReviewItemStatus | 'partial';
type ReviewTarget = 'voice_foundation' | BrandDeliverableType;

interface BrandGenerationReviewProps {
  workspaceId: string;
  deliverable: ClientDeliverable;
  ageLabel?: string | null;
}

interface SafeReviewItem {
  item: ClientDeliverableItem;
  payload: ClientBrandReviewItemPayload;
}

interface SafeReviewBundle {
  payload: ClientBrandReviewBundlePayload;
  items: SafeReviewItem[];
}

interface SavedDecision {
  decision: 'approve' | 'changes_requested';
  note?: string;
  reviewToken: string;
}

interface MutationErrorState {
  message: string;
  kind: 'conflict' | 'uncertain' | 'concurrent';
  reviewToken: string;
}

interface FocusIntent {
  itemId: string;
  reviewToken: string;
  target: 'changes_trigger' | 'confirmation' | 'error';
}

const TARGET_LABELS: Record<ReviewTarget, string> = {
  voice_foundation: 'Voice Foundation',
  mission: 'Mission Statement',
  vision: 'Vision Statement',
  values: 'Core Values',
  tagline: 'Tagline',
  elevator_pitch: 'Elevator Pitch',
  archetypes: 'Brand Archetypes',
  personality_traits: 'Personality Traits',
  voice_guidelines: 'Voice Guidelines',
  tone_examples: 'Tone Examples',
  messaging_pillars: 'Messaging Pillars',
  differentiators: 'Differentiators',
  positioning_matrix: 'Positioning Matrix',
  brand_story: 'Brand Story',
  personas: 'Customer Personas',
  customer_journey: 'Customer Journey',
  objection_handling: 'Objection Handling',
  emotional_triggers: 'Emotional Triggers',
  naming: 'Naming Directions',
};

const STATUS_META: Record<ReviewBundleStatus, {
  label: string;
  tone: 'teal' | 'emerald' | 'amber';
}> = {
  awaiting_client: { label: 'Awaiting your review', tone: 'teal' },
  approved: { label: 'Approved', tone: 'emerald' },
  changes_requested: { label: 'Changes requested', tone: 'amber' },
  partial: { label: 'Partially reviewed', tone: 'amber' },
};

const REVIEW_ITEM_STATUSES = new Set<ReviewItemStatus>([
  'awaiting_client',
  'approved',
  'changes_requested',
]);
const REVIEW_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBrandTarget(value: unknown): value is BrandDeliverableType {
  return typeof value === 'string'
    && (BRAND_DELIVERABLE_TYPES as readonly string[]).includes(value);
}

function isReviewTarget(value: unknown): value is ReviewTarget {
  return value === 'voice_foundation' || isBrandTarget(value);
}

function reviewTokenFromPayload(value: unknown): string | null {
  if (!isRecord(value) || typeof value.reviewToken !== 'string') return null;
  return REVIEW_TOKEN_PATTERN.test(value.reviewToken) ? value.reviewToken : null;
}

function omitChangedItems<T>(current: Record<string, T>, changedIds: Set<string>): Record<string, T> {
  if (![...changedIds].some(id => id in current)) return current;
  const next = { ...current };
  for (const id of changedIds) delete next[id];
  return next;
}

function deriveBundleStatus(itemStatuses: ReviewItemStatus[]): ReviewBundleStatus {
  if (itemStatuses.every(status => status === 'approved')) return 'approved';
  if (itemStatuses.every(status => status === 'changes_requested')) return 'changes_requested';
  if (itemStatuses.some(status => status !== 'awaiting_client')) return 'partial';
  return 'awaiting_client';
}

function safeReviewBundle(deliverable: ClientDeliverable): SafeReviewBundle | null {
  if (deliverable.type !== 'brand_generation' || deliverable.kind !== 'review') return null;
  if (!isRecord(deliverable.payload)) return null;
  const reviewKind = deliverable.payload.reviewKind;
  if (
    deliverable.payload.schemaVersion !== BRAND_REVIEW_CONTRACT_VERSION
    || deliverable.payload.family !== 'brand_generation'
    || (reviewKind !== 'voice_foundation' && reviewKind !== 'brand_suite')
  ) {
    return null;
  }
  const payload = {
    schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
    family: 'brand_generation' as const,
    reviewKind,
  } satisfies ClientBrandReviewBundlePayload;

  const sourceItems = deliverable.items ?? [];
  if (sourceItems.length === 0 || (reviewKind === 'voice_foundation' && sourceItems.length !== 1)) {
    return null;
  }

  const seenTargets = new Set<string>();
  const items: SafeReviewItem[] = [];
  for (const item of sourceItems) {
    if (
      !REVIEW_ITEM_STATUSES.has(item.status as ReviewItemStatus)
      || typeof item.proposedValue !== 'string'
      || !item.proposedValue.trim()
      || !isRecord(item.itemPayload)
      || item.itemPayload.schemaVersion !== BRAND_REVIEW_CONTRACT_VERSION
      || item.itemPayload.family !== 'brand_generation'
      || item.itemPayload.reviewKind !== reviewKind
      || !isReviewTarget(item.itemPayload.target)
      || !reviewTokenFromPayload(item.itemPayload)
      || item.field !== item.itemPayload.target
      || seenTargets.has(item.itemPayload.target)
    ) {
      return null;
    }
    if (
      (reviewKind === 'voice_foundation' && item.itemPayload.target !== 'voice_foundation')
      || (reviewKind === 'brand_suite' && item.itemPayload.target === 'voice_foundation')
    ) {
      return null;
    }
    seenTargets.add(item.itemPayload.target);
    const itemPayload = reviewKind === 'voice_foundation'
      ? {
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation' as const,
          reviewKind: 'voice_foundation' as const,
          target: 'voice_foundation' as const,
          reviewToken: item.itemPayload.reviewToken as string,
        }
      : {
          schemaVersion: BRAND_REVIEW_CONTRACT_VERSION,
          family: 'brand_generation' as const,
          reviewKind: 'brand_suite' as const,
          target: item.itemPayload.target as BrandDeliverableType,
          reviewToken: item.itemPayload.reviewToken as string,
        };
    items.push({ item, payload: itemPayload });
  }

  // Parent status is an independently persisted projection. Derive it from the children and fail
  // closed if the two disagree so a stale parent can never make a child look actionable.
  const childStatus = deriveBundleStatus(
    items.map(({ item }) => item.status as ReviewItemStatus),
  );
  if (deliverable.status !== childStatus) return null;

  return { payload, items };
}

function contentPreview(content: string): string {
  const plain = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(?:#{1,6}|[-*•]|\d+\.)\s+/gm, '')
    .replace(/[*_`>|~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= 240) return plain;
  return `${plain.slice(0, 237).trimEnd()}…`;
}

function mutationErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) {
    return 'This piece changed; your team must resend it.';
  }
  return 'We couldn’t confirm whether it saved.';
}

function changesFormId(deliverableId: string, itemId: string): string {
  return `brand-review-changes-${deliverableId}-${itemId}`;
}

function changesTriggerId(deliverableId: string, itemId: string): string {
  return `brand-review-changes-trigger-${deliverableId}-${itemId}`;
}

function confirmationId(deliverableId: string, itemId: string): string {
  return `brand-review-confirmation-${deliverableId}-${itemId}`;
}

function mutationErrorId(deliverableId: string, itemId: string): string {
  return `brand-review-error-${deliverableId}-${itemId}`;
}

/**
 * Client-safe grouped brand review. It consumes only the explicit public projection, never raw
 * generation/intake/evidence metadata, and every write names exactly one mirrored child item.
 */
export function BrandGenerationReview({
  workspaceId,
  deliverable,
  ageLabel,
}: BrandGenerationReviewProps) {
  const respond = useRespondToBrandReview(workspaceId);
  const [noteItemId, setNoteItemId] = useState<string | null>(null);
  const [noteReviewToken, setNoteReviewToken] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [submittingItemId, setSubmittingItemId] = useState<string | null>(null);
  const [mutationErrors, setMutationErrors] = useState<Record<string, MutationErrorState>>({});
  const [savedDecisions, setSavedDecisions] = useState<Record<string, SavedDecision>>({});
  const [conflictedReviewTokens, setConflictedReviewTokens] = useState<Record<string, string>>({});
  const [uncertainReviewTokens, setUncertainReviewTokens] = useState<Record<string, string>>({});
  const [focusIntent, setFocusIntent] = useState<FocusIntent | null>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const latestReviewTokens = useRef<Map<string, string | null>>(new Map());
  latestReviewTokens.current = new Map((deliverable.items ?? []).map(item => [
    item.id,
    reviewTokenFromPayload(item.itemPayload),
  ]));

  // Reconcile local state per durable child. A sibling response can update the parent timestamp;
  // it must not discard another item's in-progress note. The review token makes a same-ID resend
  // distinguishable even when its prose and status happen to be unchanged.
  const serverItemStates = new Map((deliverable.items ?? []).map(item => [
    item.id,
    [
      item.status,
      item.clientNote ?? '',
      item.proposedValue ?? '',
      reviewTokenFromPayload(item.itemPayload) ?? '',
    ].join('\u001e'),
  ]));
  const serverReviewStateKey = [...serverItemStates.entries()]
    .flatMap(([itemId, state]) => [itemId, state])
    .join('\u001f');
  const previousServerItemStates = useRef(serverItemStates);
  useEffect(() => {
    const previous = previousServerItemStates.current;
    previousServerItemStates.current = serverItemStates;
    const candidateIds = new Set([...previous.keys(), ...serverItemStates.keys()]);
    const changedIds = new Set(
      [...candidateIds].filter(itemId => previous.get(itemId) !== serverItemStates.get(itemId)),
    );
    if (changedIds.size === 0) return;

    setSavedDecisions(current => omitChangedItems(current, changedIds));
    setMutationErrors(current => omitChangedItems(current, changedIds));
    setConflictedReviewTokens(current => omitChangedItems(current, changedIds));
    setUncertainReviewTokens(current => omitChangedItems(current, changedIds));
    if (noteItemId && changedIds.has(noteItemId)) {
      setNoteItemId(null);
      setNoteReviewToken(null);
      setNote('');
      setNoteError(null);
    }
    if (focusIntent && changedIds.has(focusIntent.itemId)) setFocusIntent(null);
  }, [focusIntent, noteItemId, serverItemStates, serverReviewStateKey]);

  useEffect(() => {
    if (noteItemId) noteTextareaRef.current?.focus();
  }, [noteItemId]);

  useEffect(() => {
    if (!focusIntent) return;
    const currentItem = deliverable.items?.find(item => item.id === focusIntent.itemId);
    if (reviewTokenFromPayload(currentItem?.itemPayload) !== focusIntent.reviewToken) {
      setFocusIntent(null);
      return;
    }
    const id = focusIntent.target === 'changes_trigger'
      ? changesTriggerId(deliverable.id, focusIntent.itemId)
      : focusIntent.target === 'confirmation'
        ? confirmationId(deliverable.id, focusIntent.itemId)
        : mutationErrorId(deliverable.id, focusIntent.itemId);
    const target = document.getElementById(id);
    if (target) {
      target.focus();
      setFocusIntent(null);
    }
  }, [deliverable.id, deliverable.items, focusIntent, noteItemId, savedDecisions]);

  const bundle = safeReviewBundle(deliverable);
  if (!bundle) {
    return (
      <SectionCard
        id={`unified-decision-${deliverable.id}`}
        title="Brand review unavailable"
        titleIcon={<Icon name="alert" size="md" className="text-accent-warning" />}
      >
        <InlineBanner
          tone="error"
          title="We couldn’t open this review"
          message="Refresh your inbox. If the problem continues, ask your team to resend the brand review."
        />
      </SectionCard>
    );
  }

  const effectiveItems = bundle.items.map(({ item, payload }) => {
    const savedCandidate = savedDecisions[item.id];
    const saved = savedCandidate?.reviewToken === payload.reviewToken
      ? savedCandidate
      : undefined;
    const status: ReviewItemStatus = saved
      ? saved.decision === 'approve' ? 'approved' : 'changes_requested'
      : item.status as ReviewItemStatus;
    return { item, payload, saved, status };
  });
  const bundleStatus = deriveBundleStatus(effectiveItems.map(({ status }) => status));
  const bundleMeta = STATUS_META[bundleStatus];
  const approvedCount = effectiveItems.filter(({ status }) => status === 'approved').length;
  const changesCount = effectiveItems.filter(({ status }) => status === 'changes_requested').length;
  const awaitingCount = effectiveItems.length - approvedCount - changesCount;
  const isFoundation = bundle.payload.reviewKind === 'voice_foundation';

  const submitDecision = async (
    itemId: string,
    reviewToken: string,
    decision: SavedDecision['decision'],
    requestedNote?: string,
  ) => {
    setSubmittingItemId(itemId);
    setMutationErrors(current => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    try {
      if (decision === 'approve') {
        await respond.mutateAsync({
          deliverableId: deliverable.id,
          deliverableItemId: itemId,
          reviewToken,
          decision: 'approve',
        });
        if (latestReviewTokens.current.get(itemId) !== reviewToken) return;
        setSavedDecisions(current => ({
          ...current,
          [itemId]: { decision: 'approve', reviewToken },
        }));
      } else {
        const trimmedNote = requestedNote?.trim() ?? '';
        await respond.mutateAsync({
          deliverableId: deliverable.id,
          deliverableItemId: itemId,
          reviewToken,
          decision: 'changes_requested',
          note: trimmedNote,
        });
        if (latestReviewTokens.current.get(itemId) !== reviewToken) return;
        setSavedDecisions(current => ({
          ...current,
          [itemId]: { decision: 'changes_requested', note: trimmedNote, reviewToken },
        }));
      }
      setNoteItemId(null);
      setNoteReviewToken(null);
      setNote('');
      setNoteError(null);
      setFocusIntent({ itemId, reviewToken, target: 'confirmation' });
    } catch (error) {
      const conflict = error instanceof ApiError && error.status === 409;
      const refresh = respond.getLastErrorRefresh(deliverable.id, itemId, reviewToken);
      const refreshedToken = reviewTokenFromPayload(refresh?.refreshedItem?.itemPayload);
      const refreshedStatus = refresh?.refreshedItem?.status;
      const sameTokenTerminal = refresh?.refreshSucceeded === true
        && refreshedToken === reviewToken
        && (refreshedStatus === 'approved' || refreshedStatus === 'changes_requested');
      const requestedStatus = decision === 'approve' ? 'approved' : 'changes_requested';
      const matchingChangeNote = decision !== 'changes_requested'
        || (refresh?.refreshedItem?.clientNote ?? '').trim() === (requestedNote ?? '').trim();
      if (sameTokenTerminal && refreshedStatus === requestedStatus && matchingChangeNote) {
        setSavedDecisions(current => ({
          ...current,
          [itemId]: {
            decision,
            note: decision === 'changes_requested' ? requestedNote?.trim() : undefined,
            reviewToken,
          },
        }));
        setMutationErrors(current => {
          const next = { ...current };
          delete next[itemId];
          return next;
        });
        setConflictedReviewTokens(current => omitChangedItems(current, new Set([itemId])));
        setUncertainReviewTokens(current => omitChangedItems(current, new Set([itemId])));
        setNoteItemId(null);
        setNoteReviewToken(null);
        setNote('');
        setNoteError(null);
        setFocusIntent({ itemId, reviewToken, target: 'confirmation' });
        return;
      }
      if (sameTokenTerminal) {
        const authoritativeDecision = refreshedStatus === 'approved'
          ? 'approve'
          : 'changes_requested';
        setSavedDecisions(current => ({
          ...current,
          [itemId]: {
            decision: authoritativeDecision,
            note: refresh.refreshedItem?.clientNote ?? undefined,
            reviewToken,
          },
        }));
        setMutationErrors(current => ({
          ...current,
          [itemId]: {
            message: 'This piece was already reviewed by someone else. Your inbox now shows that decision.',
            kind: 'concurrent',
            reviewToken,
          },
        }));
        setConflictedReviewTokens(current => omitChangedItems(current, new Set([itemId])));
        setUncertainReviewTokens(current => omitChangedItems(current, new Set([itemId])));
        setNoteItemId(null);
        setNoteReviewToken(null);
        setNote('');
        setNoteError(null);
        setFocusIntent({ itemId, reviewToken, target: 'error' });
        return;
      }
      const confirmedSameAwaiting = refresh?.refreshSucceeded === true
        && refresh.refreshedItem?.status === 'awaiting_client'
        && refreshedToken === reviewToken;
      if (conflict) {
        setConflictedReviewTokens(current => ({ ...current, [itemId]: reviewToken }));
      } else if (!confirmedSameAwaiting) {
        setUncertainReviewTokens(current => ({ ...current, [itemId]: reviewToken }));
      } else {
        setUncertainReviewTokens(current => {
          if (current[itemId] !== reviewToken) return current;
          const next = { ...current };
          delete next[itemId];
          return next;
        });
      }
      if (conflict || !confirmedSameAwaiting) {
        setNoteItemId(null);
        setNoteReviewToken(null);
        setNote('');
        setNoteError(null);
      }
      setMutationErrors(current => ({
        ...current,
        [itemId]: {
          message: mutationErrorMessage(error),
          kind: conflict ? 'conflict' : 'uncertain',
          reviewToken,
        },
      }));
      if (conflict || !confirmedSameAwaiting) {
        setFocusIntent({ itemId, reviewToken, target: 'error' });
      }
    } finally {
      setSubmittingItemId(null);
    }
  };

  const openChangesForm = (itemId: string, reviewToken: string) => {
    setNoteItemId(itemId);
    setNoteReviewToken(reviewToken);
    setNote('');
    setNoteError(null);
    setMutationErrors(current => {
      if (!current[itemId] || current[itemId].kind !== 'uncertain') return current;
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    setFocusIntent(null);
  };

  const closeChangesForm = (itemId: string) => {
    const reviewToken = noteReviewToken;
    setNoteItemId(null);
    setNoteReviewToken(null);
    setNote('');
    setNoteError(null);
    if (reviewToken) setFocusIntent({ itemId, reviewToken, target: 'changes_trigger' });
  };

  const reviewSummary = isFoundation
    ? 'Review this proposed direction before your team finalizes any brand voice.'
    : deliverable.summary ?? 'Review each brand piece independently.';

  return (
    <SectionCard
      id={`unified-decision-${deliverable.id}`}
      title={deliverable.title}
      subtitle={reviewSummary}
      titleIcon={<Icon name="sparkle" size="md" className="text-accent-brand" />}
      titleExtra={<Badge label={bundleMeta.label} tone={bundleMeta.tone} variant="soft" shape="pill" />}
      action={(
        <Badge
          label={`${effectiveItems.length} ${effectiveItems.length === 1 ? 'piece' : 'pieces'}`}
          tone="blue"
          variant="soft"
          shape="pill"
        />
      )}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 t-caption-sm text-[var(--brand-text-muted)]" aria-live="polite">
          {approvedCount > 0 && <span>{approvedCount} approved</span>}
          {changesCount > 0 && <span>{changesCount} changes requested</span>}
          {awaitingCount > 0 && <span>{awaitingCount} awaiting review</span>}
          {ageLabel && <span className="sm:ml-auto">{ageLabel}</span>}
        </div>

        {deliverable.note?.trim() && (
          <InlineBanner
            tone="info"
            title="Note from your team"
            message={<RenderMarkdown text={deliverable.note} mode="prose" />}
          />
        )}

        {isFoundation && (
          <InlineBanner
            tone="warning"
            title="Advisory voice foundation"
            message="This is a proposed direction for your feedback. Approving it records your review; it does not finalize your brand voice. Your team owns final voice selection."
          />
        )}

        <ul className="space-y-3" aria-label="Brand pieces to review">
          {effectiveItems.map(({ item, payload, saved, status }) => {
            const label = TARGET_LABELS[payload.target];
            const statusMeta = STATUS_META[status];
            const isSubmitting = respond.isPending && submittingItemId === item.id;
            const isAwaiting = status === 'awaiting_client';
            const itemNote = saved?.note ?? item.clientNote;
            const itemErrorCandidate = mutationErrors[item.id];
            const itemError = itemErrorCandidate?.reviewToken === payload.reviewToken
              ? itemErrorCandidate
              : null;
            const isConflicted = conflictedReviewTokens[item.id] === payload.reviewToken;
            const isUncertain = uncertainReviewTokens[item.id] === payload.reviewToken;
            const isBlocked = isConflicted || isUncertain;
            const changesFormOpen = noteItemId === item.id
              && noteReviewToken === payload.reviewToken;
            const formId = changesFormId(deliverable.id, item.id);
            const approveLabel = payload.target === 'voice_foundation'
              ? 'Approve this direction'
              : 'Approve this piece';

            return (
              <li key={item.id}>
                <SectionCard
                  variant="subtle"
                  title={label}
                  subtitle={contentPreview(item.proposedValue ?? '')}
                  titleExtra={(
                    <Badge
                      label={statusMeta.label}
                      tone={statusMeta.tone}
                      variant="soft"
                      shape="pill"
                    />
                  )}
                >
                  <div className="space-y-3">
                    {payload.target === 'naming' && (
                      <InlineBanner
                        tone="info"
                        size="sm"
                        title="Creative directions, not clearance"
                        message="Approval does not confirm trademark, domain, legal, cultural, or linguistic availability."
                      />
                    )}

                    <Disclosure summary={`Read full ${label.toLowerCase()}`}>
                      <div className="pt-3">
                        <RenderMarkdown text={item.proposedValue ?? ''} mode="prose" />
                      </div>
                    </Disclosure>

                    {status === 'approved' && (
                        <InlineBanner
                          id={confirmationId(deliverable.id, item.id)}
                          tabIndex={-1}
                          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                          tone="success"
                          size="sm"
                          title="Approval recorded"
                          message={payload.target === 'voice_foundation'
                            ? 'Your feedback is recorded for your team. This did not finalize the voice profile.'
                            : 'This piece remains visible while the rest of the brand review is completed.'}
                        />
                    )}

                    {status === 'changes_requested' && (
                        <InlineBanner
                          id={confirmationId(deliverable.id, item.id)}
                          tabIndex={-1}
                          className="focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                          tone="warning"
                          size="sm"
                          title="Changes requested"
                          message={itemNote
                            ? `Your note: ${itemNote}`
                            : 'Your team has this item back for revision.'}
                        />
                    )}

                    {itemError && (
                      <InlineBanner
                        id={mutationErrorId(deliverable.id, item.id)}
                        tabIndex={-1}
                        className="focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60"
                        tone="error"
                        size="sm"
                        title={itemError.kind === 'conflict'
                          ? 'Piece changed'
                          : itemError.kind === 'concurrent'
                            ? 'Already reviewed'
                            : 'Decision not confirmed'}
                        message={itemError.message}
                        onDismiss={itemError.kind === 'uncertain' && !isUncertain ? () => {
                          setMutationErrors(current => {
                            const next = { ...current };
                            delete next[item.id];
                            return next;
                          });
                        } : undefined}
                      />
                    )}

                    {isAwaiting && !isBlocked && (
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        {!changesFormOpen && (
                          <Button
                            size="sm"
                            variant="primary"
                            className="w-full sm:w-auto"
                            loading={isSubmitting}
                            disabled={respond.isPending}
                            aria-label={`Approve ${label}`}
                            onClick={() => void submitDecision(
                              item.id,
                              payload.reviewToken,
                              'approve',
                            )}
                          >
                            {isSubmitting ? 'Saving decision…' : approveLabel}
                          </Button>
                        )}
                        <Button
                          id={changesTriggerId(deliverable.id, item.id)}
                          size="sm"
                          variant="secondary"
                          className="w-full sm:w-auto"
                          disabled={respond.isPending}
                          aria-label={`Request changes to ${label}`}
                          aria-expanded={changesFormOpen}
                          aria-controls={formId}
                          onClick={() => {
                            if (changesFormOpen) closeChangesForm(item.id);
                            else openChangesForm(item.id, payload.reviewToken);
                          }}
                        >
                          Request changes
                        </Button>
                      </div>
                    )}

                    {isAwaiting && !isBlocked && changesFormOpen && (
                      <form
                        id={formId}
                        className="space-y-3"
                        noValidate
                        onSubmit={(event) => {
                          event.preventDefault();
                          const trimmed = note.trim();
                          if (!trimmed) {
                            setNoteError('Add a note so your team knows what to change.');
                            return;
                          }
                          setNoteError(null);
                          void submitDecision(
                            item.id,
                            payload.reviewToken,
                            'changes_requested',
                            trimmed,
                          );
                        }}
                      >
                        <FormField
                          label={`What should change in ${label}?`}
                          error={noteError ?? undefined}
                          hint="Be specific about what feels off and what you want to preserve."
                          required
                        >
                          <FormTextarea
                            ref={noteTextareaRef}
                            value={note}
                            onChange={(value) => {
                              setNote(value);
                              if (noteError && value.trim()) setNoteError(null);
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                            rows={4}
                            maxLength={2000}
                            required
                            placeholder="Tell your team what to revise…"
                          />
                        </FormField>
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                          <Button
                            type="submit"
                            size="sm"
                            variant="primary"
                            className="w-full sm:w-auto"
                            loading={isSubmitting}
                            disabled={respond.isPending}
                          >
                            {isSubmitting ? 'Sending feedback…' : 'Send change request'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="w-full sm:w-auto"
                            disabled={respond.isPending}
                            onClick={() => closeChangesForm(item.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </form>
                    )}
                  </div>
                </SectionCard>
              </li>
            );
          })}
        </ul>
      </div>
    </SectionCard>
  );
}
