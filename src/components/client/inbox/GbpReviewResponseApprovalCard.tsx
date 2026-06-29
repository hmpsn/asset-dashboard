import { useState } from 'react';
import { MessageSquareReply, Star } from 'lucide-react';
import { Badge, Button, FormInput, Icon } from '../../ui';
import type { ClientDeliverable } from '../../../../shared/types/client-deliverable';

interface GbpReviewResponsePayload {
  family?: string;
  locationTitle?: string | null;
  ratingValue?: number | null;
  reviewerDisplayName?: string | null;
  reviewerIsAnonymous?: boolean;
  reviewText?: string | null;
  proposedReply?: string;
}

interface GbpReviewResponseApprovalCardProps {
  deliverable: ClientDeliverable;
  ageLabel?: string | null;
  submitting?: boolean;
  onApprove: () => void;
  onRequestChanges: (note: string) => void;
  onDecline: (note: string) => void;
}

function payloadFor(deliverable: ClientDeliverable): GbpReviewResponsePayload {
  return deliverable.payload as GbpReviewResponsePayload;
}

export function GbpReviewResponseApprovalCard({
  deliverable,
  ageLabel,
  submitting = false,
  onApprove,
  onRequestChanges,
  onDecline,
}: GbpReviewResponseApprovalCardProps) {
  const payload = payloadFor(deliverable);
  const [noteMode, setNoteMode] = useState<'none' | 'changes' | 'decline'>('none');
  const [note, setNote] = useState('');
  const reviewer = payload.reviewerDisplayName ?? (payload.reviewerIsAnonymous ? 'Anonymous reviewer' : 'Reviewer');
  const rating = typeof payload.ratingValue === 'number' ? payload.ratingValue : null;

  const submitNote = () => {
    const trimmed = note.trim();
    if (noteMode === 'changes') onRequestChanges(trimmed);
    if (noteMode === 'decline') onDecline(trimmed);
    setNote('');
    setNoteMode('none');
  };

  return (
    <div className="rounded-[var(--radius-md)] bg-[var(--surface-2)] border border-[var(--brand-border)] overflow-hidden p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <Badge label="Google review" tone="blue" variant="soft" shape="pill" icon={MessageSquareReply} />
            {ageLabel && <span className="t-caption-sm text-[var(--brand-text-muted)]">{ageLabel}</span>}
          </div>
          <h4 className="t-body font-semibold text-[var(--brand-text-bright)]">{deliverable.title}</h4>
          <p className="t-caption-sm text-[var(--brand-text-muted)]">
            {payload.locationTitle ?? 'Google Business Profile'} · {reviewer}
          </p>
        </div>
        {rating !== null && (
          <div className="flex items-center gap-1 t-caption font-semibold text-blue-400 shrink-0">
            <Icon as={Star} size="sm" />
            {rating}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-3)]/35 p-3">
          <p className="t-caption-sm font-semibold text-[var(--brand-text-muted)] mb-1">Review</p>
          <p className="t-caption text-[var(--brand-text)] whitespace-pre-wrap">
            {payload.reviewText ?? deliverable.summary ?? 'No review text provided.'}
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] border border-teal-500/20 bg-teal-500/5 p-3">
          <p className="t-caption-sm font-semibold text-accent-brand mb-1">Proposed public reply</p>
          <p className="t-caption text-[var(--brand-text)] whitespace-pre-wrap">
            {payload.proposedReply ?? 'No draft reply provided.'}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        {noteMode === 'none' ? (
          <>
            <Button size="sm" variant="primary" disabled={submitting} onClick={onApprove}>
              {submitting ? 'Submitting...' : 'Approve and publish'}
            </Button>
            <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setNoteMode('changes')}>
              Request changes
            </Button>
            <Button size="sm" variant="ghost" disabled={submitting} onClick={() => setNoteMode('decline')}>
              Decline
            </Button>
          </>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <FormInput
              type="text"
              value={note}
              onChange={setNote}
              placeholder={noteMode === 'decline' ? 'Why are you declining? (optional)' : 'What should be changed?'}
              className="flex-1 t-caption"
            />
            <Button size="sm" variant="primary" onClick={submitNote}>Send</Button>
            <Button size="sm" variant="ghost" onClick={() => { setNoteMode('none'); setNote(''); }}>Cancel</Button>
          </div>
        )}
      </div>
    </div>
  );
}
