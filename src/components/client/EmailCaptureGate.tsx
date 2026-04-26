import { useState, useCallback } from 'react';
import { Mail } from 'lucide-react';
import { post } from '../../api/client';
import { Icon, Button } from '../ui';
import type { WorkspaceInfo } from './types';

export interface EmailCaptureGateProps {
  workspaceId: string;
  ws: WorkspaceInfo | null;
  onComplete: () => void;
  onSkip: () => void;
}

export function EmailCaptureGate({
  workspaceId,
  ws,
  onComplete,
  onSkip,
}: EmailCaptureGateProps) {
  const [captureName, setCaptureName] = useState('');
  const [captureEmail, setCaptureEmail] = useState('');
  const [captureSubmitting, setCaptureSubmitting] = useState(false);

  const submitEmailCapture = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      if (!captureEmail.trim() || captureSubmitting) return;
      setCaptureSubmitting(true);
      try {
        await post(`/api/public/capture-email/${workspaceId}`, {
          email: captureEmail.trim(),
          name: captureName.trim() || undefined,
        });
        localStorage.setItem(`portal_email_${workspaceId}`, captureEmail.trim());
      } catch (err) {
        console.error('EmailCaptureGate operation failed:', err);
      }
      setCaptureSubmitting(false);
      onComplete();
    },
    [captureEmail, captureName, captureSubmitting, workspaceId, onComplete]
  );

  const handleSkip = () => {
    try {
      localStorage.setItem(`portal_email_${workspaceId}`, '__skipped__');
    } catch (err) {
      console.error('EmailCaptureGate operation failed:', err);
    }
    onSkip();
  };

  return (
    <div className="min-h-screen bg-[var(--surface-1)] flex items-center justify-center">
      <div className="w-full max-w-sm">
        {/* pr-check-disable-next-line -- full-screen email gate card uses brand signature radius intentionally */}
        <div className="bg-[var(--surface-2)] border border-[var(--brand-border)] p-8 shadow-2xl shadow-black/40" style={{ borderRadius: 'var(--radius-signature-lg)' }}>
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Icon as={Mail} size="xl" className="text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-[var(--brand-text-bright)]">Welcome to {ws?.name}</h2>
            <p className="t-caption-sm text-[var(--brand-text-muted)] mt-1 text-center">
              Enter your email to receive performance reports and important updates about your site.
            </p>
          </div>
          <form onSubmit={submitEmailCapture} className="space-y-3">
            <input
              type="text"
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-4 py-3 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
            />
            <input
              type="email"
              value={captureEmail}
              onChange={(e) => setCaptureEmail(e.target.value)}
              placeholder="Your email address"
              required
              className="w-full bg-[var(--surface-3)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] px-4 py-3 text-sm text-[var(--brand-text-bright)] placeholder-[var(--brand-text-muted)] focus:outline-none focus:border-teal-500 transition-colors"
              autoFocus
            />
            <Button
              type="submit"
              variant="primary"
              disabled={captureSubmitting || !captureEmail.trim()}
              loading={captureSubmitting}
              className="w-full"
            >
              {captureSubmitting ? '' : 'Continue to Dashboard'}
            </Button>
            <button
              type="button"
              onClick={handleSkip}
              className="w-full text-center t-caption-sm text-[var(--brand-text-muted)] hover:text-[var(--brand-text)] transition-colors"
            >
              Skip for now
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
