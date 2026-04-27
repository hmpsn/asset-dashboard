import { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant?: 'default' | 'destructive';
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  variant = 'default',
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      // Skip Enter if a button inside the dialog has focus — its onClick fires natively, avoiding a double-call.
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) onConfirm();
    };
    document.addEventListener('keydown', handler); // keydown-ok — modal overlay, Escape/Enter are intentional regardless of focus state
    return () => document.removeEventListener('keydown', handler);
  }, [open, onConfirm, onCancel]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'var(--brand-overlay, rgba(15,23,42,0.35))' }}
      onClick={onCancel}
    >
      <div
        className="bg-[var(--surface-2)] border border-[var(--brand-border)] rounded-[var(--radius-xl)] p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-[var(--brand-text-bright)] font-semibold text-base mb-2">{title}</h3>
        <p className="text-[var(--brand-text)] t-body mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-[var(--radius-lg)] t-body font-medium text-[var(--brand-text)] border border-[var(--brand-border)] hover:bg-[var(--surface-3)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={
              variant === 'destructive'
                ? 'px-4 py-2 rounded-[var(--radius-lg)] t-body font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors'
                : 'px-4 py-2 rounded-[var(--radius-lg)] t-body font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
