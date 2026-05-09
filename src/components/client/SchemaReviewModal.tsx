// src/components/client/SchemaReviewModal.tsx
/**
 * SchemaReviewModal — full-screen modal wrapper for SchemaReviewTab.
 * Replaces the standalone 'schema-review' ClientTab (removed in Phase 2A).
 * Triggered from the schema plan card in InboxTab's SEO Changes section.
 */
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { SchemaReviewTab } from './SchemaReviewTab';

interface SchemaReviewModalProps {
  workspaceId: string;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onClose: () => void;
}

export function SchemaReviewModal({ workspaceId, setToast, onClose }: SchemaReviewModalProps) {
  // Close on Escape — required for dialog role (WAI-ARIA Authoring Practices)
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    document.addEventListener('keydown', handleKey); // keydown-ok — full-screen modal intentionally handles Escape globally while open
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className={
        'fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--surface-1)]' // fixed-inset-ok -- Full-screen schema review takeover; not a centered reusable dialog, so <Modal> compound doesn't apply.
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="schema-review-modal-title"
    >
      {/* Modal header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--brand-border)] flex-shrink-0">
        <h2 id="schema-review-modal-title" className="t-h2 text-[var(--brand-text-bright)]">Schema Strategy Review</h2>
        {/* autoFocus moves keyboard focus into the modal on open (WAI-ARIA focus management) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close schema review"
          autoFocus
          className="flex items-center justify-center w-9 h-9 rounded-[var(--radius-md)] text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] hover:bg-[var(--surface-3)] transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-6 max-w-4xl mx-auto w-full">
        <SchemaReviewTab workspaceId={workspaceId} setToast={setToast} />
      </div>
    </div>
  );
}
