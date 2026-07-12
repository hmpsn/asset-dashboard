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
      if (e.key !== 'Enter') return;
      if (variant === 'destructive') {
        // Destructive dialogs let the Modal auto-focus Cancel, which owns Enter (safe default).
        // Only confirm on Enter when focus is NOT on a dialog button, so a focused button's native
        // onClick isn't double-invoked.
        if (!(e.target instanceof HTMLButtonElement)) {
          e.stopImmediatePropagation();
          onConfirm();
        }
        return;
      }
      // Non-destructive: Enter confirms regardless of which control holds focus. The Modal
      // auto-focuses Cancel (first focusable), so preventDefault stops its native activation and
      // keeps Enter from falling through to onCancel.
      e.preventDefault();
      e.stopImmediatePropagation();
      onConfirm();
    };
    document.addEventListener('keydown', handler); // keydown-ok — topmost confirmation owns Enter regardless of focus state
    return () => document.removeEventListener('keydown', handler);
  }, [open, onConfirm, titleId, variant]);

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
