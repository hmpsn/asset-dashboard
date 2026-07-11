import { useEffect, useId } from 'react';
import { Button } from './Button';
import { Modal } from './overlay/Modal';
import { isTopmostOverlay } from './overlay/overlayUtils';

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
  const titleId = useId();
  const messageId = useId();
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      const titleElement = document.getElementById(titleId);
      const panel = titleElement?.closest<HTMLElement>('[data-overlay-panel="true"]') ?? null;
      if (!isTopmostOverlay(panel)) return;
      // Skip Enter if a button inside the dialog has focus — its onClick fires natively, avoiding a double-call.
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.stopImmediatePropagation();
        onConfirm();
      }
    };
    document.addEventListener('keydown', handler); // keydown-ok — topmost confirmation owns Enter regardless of focus state
    return () => document.removeEventListener('keydown', handler);
  }, [open, onConfirm, titleId]);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      size="sm"
      labelledById={titleId}
      describedById={messageId}
    >
      <div
        className="p-6"
      >
        <h3 id={titleId} className="text-[var(--brand-text-bright)] font-semibold text-base mb-2">{title}</h3>
        <p id={messageId} className="text-[var(--brand-text)] t-body mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <Button
            onClick={onCancel}
            variant="secondary"
            size="md"
            className="rounded-[var(--radius-lg)]"
          >
            {cancelLabel}
          </Button>
          <Button
            onClick={onConfirm}
            variant={variant === 'destructive' ? 'danger' : 'primary'}
            size="md"
            className="rounded-[var(--radius-lg)]"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
