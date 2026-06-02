// src/components/client/inbox/ProjectedReviewModal.tsx
//
// R4 — in-shell projected review (DARK, only reachable behind the `unified-inbox` flag).
//
// The two PROJECTED unified-deliverable types — `copy_section` and `content_request` — have NO
// physical `client_deliverable` row and 404 on the uniform `/respond` verbs. Instead of deep-linking
// the client OUT to `?tab=reviews`, this modal mounts the PROVEN bespoke review surfaces in-shell so
// the client reviews + responds without leaving the unified inbox:
//   - `copy_section`     → <ClientCopyReview> (auto-expanding the projected copy entry)
//   - `content_request`  → <ContentTab>       (auto-expanding the projected request; ContentTab
//                          self-selects brief actions vs <PostReviewCard> from the LOCAL request
//                          status — the modal NEVER inspects deliverable status here).
//
// Respond goes through the bespoke routes those components already call (copy-pipeline /
// content-request / posts), never the unified /respond. The unified list refresh is handled by the
// COPY_SECTION_UPDATED / CONTENT_REQUEST_UPDATE / POST_UPDATED WS handlers wired in UnifiedInbox.
//
// Full-screen modal chrome (backdrop, panel, header/close, Escape-to-close) is copied verbatim from
// DeliverableDetailModal. The Escape handler keeps the `isContentEditable`/input/textarea/select
// guard from that file UNCHANGED — PostReviewCard embeds a RichTextEditor + useAutoSave, so a naive
// Escape-closes-modal would discard the client's in-progress typing.
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../ui';
import type { DeliverableType } from '../../../../shared/types/client-deliverable';
import { ClientCopyReview } from '../ClientCopyReview';
import { ContentTab, type ContentTabProps } from '../ContentTab';

/**
 * The ContentTab pass-through props the modal forwards verbatim. `workspaceId`, `setToast`, the
 * auto-expand seed, AND the solo id are supplied by the modal itself (not part of the pass-through
 * bag), so they are omitted here. `soloRequestId` (ISSUE 2c) is set locally from `externalRef`.
 */
type ContentTabPassThroughProps = Omit<
  ContentTabProps,
  'workspaceId' | 'setToast' | 'initialExpandedRequestId' | 'soloRequestId'
>;

type ProjectedReviewModalProps = ContentTabPassThroughProps & {
  /** Which bespoke surface to mount — branched on TYPE, never on deliverable status. */
  type: Extract<DeliverableType, 'copy_section' | 'content_request'>;
  /** The source id of the projected deliverable (copy entry id / content request id) to auto-expand. */
  externalRef: string;
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onDismiss: () => void;
};

export function ProjectedReviewModal({
  type,
  externalRef,
  workspaceId,
  setToast,
  onDismiss,
  ...contentTabProps
}: ProjectedReviewModalProps) {
  // Escape-to-close — guard verbatim from DeliverableDetailModal: do NOT close while the client is
  // typing in an input/textarea/select or a contenteditable (the embedded RichTextEditor), so a
  // stray Escape never discards in-progress post edits.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )
        return;
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler); // keydown-ok — isContentEditable guard is in the handler body above
    return () => document.removeEventListener('keydown', handler);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="projected-review-modal-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex flex-col" // fixed-inset-ok — full-screen trust-first panel; escape key + backdrop click handled in component body
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onDismiss} />
      {/* ISSUE 2c — SOLO panel (max-w-3xl, matching DeliverableDetailModal): the bespoke surfaces now
          render only the opened item (no PageHeader / stat grid / multi-entry chrome), so the wide
          max-w-5xl is no longer needed. The narrower panel keeps the single-item review focused. */}
      <div
        className="relative z-[var(--z-sticky)] flex flex-col h-full max-w-3xl mx-auto w-full bg-[var(--surface-1)] shadow-2xl overflow-hidden"
        style={{ borderRadius: `0 0 var(--radius-xl) var(--radius-xl)` }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
          <IconButton
            autoFocus
            onClick={onDismiss}
            icon={X}
            label="Close"
            size="sm"
            variant="ghost"
            className="p-1.5 rounded-[var(--radius-md)] hover:bg-[var(--surface-3)] transition-colors"
          />
          <h2 id="projected-review-modal-title" className="t-h2 text-[var(--brand-text-bright)] truncate">
            {type === 'copy_section' ? 'Copy Review' : 'Content Review'}
          </h2>
        </div>

        {/* Body — the proven bespoke surface, auto-expanded to the projected source id. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {type === 'copy_section' ? (
            <ClientCopyReview workspaceId={workspaceId} initialExpandedEntryId={externalRef} soloEntryId={externalRef} />
          ) : (
            <ContentTab
              {...contentTabProps}
              workspaceId={workspaceId}
              setToast={setToast}
              initialExpandedRequestId={externalRef}
              soloRequestId={externalRef}
            />
          )}
        </div>
      </div>
    </div>
  );
}
