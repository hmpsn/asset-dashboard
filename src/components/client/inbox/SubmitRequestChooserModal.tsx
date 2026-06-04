// src/components/client/inbox/SubmitRequestChooserModal.tsx
//
// Item 1 — the "Submit a request" chooser, mounted from UnifiedInbox. This modal opens from the
// persistent "Submit a request" primary button and offers BOTH paths the owner chose:
//
//   - "Ask for content"  → REUSES the existing topic-submission + pricing flow. A small topic form
//                           (topic / target keyword / notes / brief-vs-full-post) calls the SAME
//                           `setPricingModal({...})` ContentTab uses → the global
//                           PricingConfirmationModal confirms + POSTs /api/public/content-request/:ws/submit.
//   - "Send a request"   → REUSES the extracted <SubmitRequestForm> (the proven RequestsTab
//                           task-request form → POST /api/public/requests/:ws).
//
// Centered modal shell matches item 3 (DeliverableDetailModal / ProjectedReviewModal): centered,
// brand-overlay backdrop, ~75vw / ≤1200px / ~90vh, Escape-to-close with the isContentEditable guard.
import { useEffect, useState } from 'react';
import { X, MessageSquare, Sparkles, FileText } from 'lucide-react';
import { Button, IconButton, Icon, FormInput, FormTextarea } from '../../ui';
import { SubmitRequestForm } from '../SubmitRequestForm';
import type { PricingModalState } from '../StrategyTab';

interface SubmitRequestChooserModalProps {
  workspaceId: string;
  clientUser?: { id: string; name: string; email: string; role: string } | null;
  setToast: (toast: { message: string; type: 'success' | 'error' } | null) => void;
  onDismiss: () => void;
  /** Reuse the existing content-topic pricing flow (same handler ContentTab calls). */
  setPricingModal: (modal: PricingModalState | null) => void;
  pricingConfirming: boolean;
}

type ChooserStep = 'choose' | 'content' | 'request';

export function SubmitRequestChooserModal({
  workspaceId,
  clientUser,
  setToast,
  onDismiss,
  setPricingModal,
  pricingConfirming,
}: SubmitRequestChooserModalProps) {
  const [step, setStep] = useState<ChooserStep>('choose');

  // "Ask for content" topic form state (mirrors ContentTab's topic form).
  const [topicName, setTopicName] = useState('');
  const [topicKeyword, setTopicKeyword] = useState('');
  const [topicNotes, setTopicNotes] = useState('');
  const [serviceType, setServiceType] = useState<'brief_only' | 'full_post'>('brief_only');

  // Escape-to-close — guard verbatim from the review modals: do NOT close while typing in an
  // input/textarea/select or contenteditable (so a stray Escape never discards an in-progress form).
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

  const submitTopic = () => {
    if (!topicName.trim() || !topicKeyword.trim()) return;
    // REUSE the existing topic-submission + pricing flow: open the global PricingConfirmationModal
    // (rendered by ClientDashboard) with source:'client'. The confirm there POSTs the content request.
    setPricingModal({
      serviceType,
      topic: topicName.trim(),
      targetKeyword: topicKeyword.trim(),
      notes: topicNotes.trim() || undefined,
      source: 'client',
      pageType: 'blog',
    });
    // The pricing modal now owns the flow → close the chooser so the two modals don't stack.
    onDismiss();
  };

  const title =
    step === 'content' ? 'Ask for content' : step === 'request' ? 'Send a request' : 'Submit a request';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="submit-request-chooser-title"
      className="fixed inset-0 z-[var(--z-modal-fullscreen)] flex items-center justify-center p-4" // fixed-inset-ok — centered chooser dialog; escape + backdrop click handled in component body
    >
      <div className="absolute inset-0 bg-[var(--brand-overlay)] backdrop-blur-sm" onClick={onDismiss} />
      <div className="relative z-[var(--z-sticky)] flex flex-col w-[90vw] sm:w-[75vw] max-w-[1200px] max-h-[90vh] bg-[var(--surface-1)] shadow-2xl overflow-hidden rounded-[var(--radius-xl)]">
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
          <h2 id="submit-request-chooser-title" className="t-h2 text-[var(--brand-text-bright)] truncate">
            {title}
          </h2>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'choose' && (
            <div className="space-y-3">
              <p className="t-body text-[var(--brand-text-muted)]">
                What would you like to do?
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setStep('content')}
                  className="flex flex-col items-start gap-2 p-4 h-auto text-left rounded-[var(--radius-lg)]"
                >
                  <span className="flex items-center gap-2 t-body font-semibold text-[var(--brand-text-bright)]">
                    <Icon as={Sparkles} size="md" className="text-accent-brand" /> Ask for content
                  </span>
                  <span className="t-caption text-[var(--brand-text-muted)]">
                    Request a content brief or a full blog post on a topic.
                  </span>
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setStep('request')}
                  className="flex flex-col items-start gap-2 p-4 h-auto text-left rounded-[var(--radius-lg)]"
                >
                  <span className="flex items-center gap-2 t-body font-semibold text-[var(--brand-text-bright)]">
                    <Icon as={MessageSquare} size="md" className="text-accent-brand" /> Send a request
                  </span>
                  <span className="t-caption text-[var(--brand-text-muted)]">
                    A content update, design change, bug report, SEO, or other request.
                  </span>
                </Button>
              </div>
            </div>
          )}

          {step === 'request' && (
            <SubmitRequestForm
              workspaceId={workspaceId}
              clientUser={clientUser ?? null}
              setToast={setToast}
              onSubmitted={() => {
                setToast({ message: 'Request sent — your team has been notified', type: 'success' });
                onDismiss();
              }}
              onCancel={onDismiss}
            />
          )}

          {step === 'content' && (
            <div className="space-y-3">
              <p className="t-caption text-[var(--brand-text-muted)]">
                Tell us the topic and target keyword — we'll confirm the price next.
              </p>
              <FormInput
                type="text"
                value={topicName}
                onChange={setTopicName}
                placeholder="Topic name (e.g. 'Benefits of sedation dentistry')"
                className="w-full t-caption"
              />
              <FormInput
                type="text"
                value={topicKeyword}
                onChange={setTopicKeyword}
                placeholder="Target keyword (e.g. 'sedation dentistry benefits')"
                className="w-full t-caption"
              />
              <FormTextarea
                value={topicNotes}
                onChange={setTopicNotes}
                placeholder="Any notes or context for this topic... (optional)"
                rows={2}
                className="w-full t-caption"
              />
              <div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] mb-1.5">What would you like?</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setServiceType('brief_only')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[var(--radius-lg)] border t-caption font-medium transition-all ${serviceType === 'brief_only' ? 'bg-teal-600/20 border-teal-500/40 text-accent-brand' : 'bg-[var(--surface-1)] border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-strong)]'}`}
                  >
                    <Icon as={FileText} size="md" /> Content Brief
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setServiceType('full_post')}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-[var(--radius-lg)] border t-caption font-medium transition-all ${serviceType === 'full_post' ? 'bg-teal-600/20 border-teal-500/40 text-accent-brand' : 'bg-[var(--surface-1)] border-[var(--brand-border)] text-[var(--brand-text-muted)] hover:border-[var(--brand-border-strong)]'}`}
                  >
                    <Icon as={Sparkles} size="md" /> Full Blog Post
                  </Button>
                </div>
                <div className="t-caption-sm text-[var(--brand-text-muted)] mt-1">{serviceType === 'brief_only' ? 'A detailed content strategy document for this topic' : 'Brief + professionally written article delivered ready to publish'}</div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button
                  onClick={submitTopic}
                  disabled={!topicName.trim() || !topicKeyword.trim() || pricingConfirming}
                  icon={Sparkles}
                  className="rounded-[var(--radius-lg)]"
                >
                  Continue
                </Button>
                <Button variant="ghost" onClick={() => setStep('choose')}>Back</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
