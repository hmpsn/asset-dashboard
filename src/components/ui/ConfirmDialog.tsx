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
      if (e.key === 'Enter') onConfirm();
    };
    document.addEventListener('keydown', handler);
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
        className="bg-zinc-900 border border-zinc-800 rounded-xl p-6 w-full max-w-sm mx-4 shadow-xl"
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-zinc-100 font-semibold text-base mb-2">{title}</h3>
        <p className="text-zinc-400 text-sm leading-relaxed mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium text-zinc-400 border border-zinc-700 hover:bg-zinc-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={
              variant === 'destructive'
                ? 'px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors'
                : 'px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white transition-all'
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
