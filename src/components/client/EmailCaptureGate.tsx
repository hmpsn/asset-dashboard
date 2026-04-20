import { useState, useCallback } from 'react';
import { Loader2, Mail } from 'lucide-react';
import { post } from '../../api/client';
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
    <div className="min-h-screen bg-[#0f1219] flex items-center justify-center">
      <div className="w-full max-w-sm">
        <div className="bg-zinc-900 border border-zinc-800 p-8 shadow-2xl shadow-black/40" style={{ borderRadius: '10px 24px 10px 24px' }}>
          <div className="flex flex-col items-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-teal-500/10 flex items-center justify-center mb-4">
              <Mail className="w-6 h-6 text-teal-400" />
            </div>
            <h2 className="text-lg font-semibold text-zinc-200">Welcome to {ws?.name}</h2>
            <p className="text-xs text-zinc-500 mt-1 text-center">
              Enter your email to receive performance reports and important updates about your site.
            </p>
          </div>
          <form onSubmit={submitEmailCapture} className="space-y-3">
            <input
              type="text"
              value={captureName}
              onChange={(e) => setCaptureName(e.target.value)}
              placeholder="Your name (optional)"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
            />
            <input
              type="email"
              value={captureEmail}
              onChange={(e) => setCaptureEmail(e.target.value)}
              placeholder="Your email address"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-teal-500 transition-colors"
              autoFocus
            />
            <button
              type="submit"
              disabled={captureSubmitting || !captureEmail.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-50 text-white text-sm font-medium transition-all flex items-center justify-center gap-2"
            >
              {captureSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue to Dashboard'}
            </button>
            <button
              type="button"
              onClick={handleSkip}
              className="w-full text-center text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Skip for now
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
