import { useRef, useState } from 'react';
import { Button } from '../ui';

interface CockpitSendPanelProps {
  onSend: (note: string) => void;
  onCancel: () => void;
  disabled?: boolean;
}

/** Strategy v3 cockpit — note-on-send panel (spec §4.3 confirmed micro-choice 1).
 *  ↵ Enter sends immediately (zero-friction no-note path works — the note may be empty);
 *  Shift+Enter inserts a newline; Esc cancels. The note lands above the rec on the client overview. */
export function CockpitSendPanel({ onSend, onCancel, disabled }: CockpitSendPanelProps) {
  const [note, setNote] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="rounded-[var(--radius-lg)] border border-[var(--brand-border)] bg-[var(--surface-3)] p-3 space-y-2">
      {/* // form-control-ok — no Textarea primitive exists in src/components/ui/ */}
      <textarea
        ref={ref}
        autoFocus
        rows={2}
        value={note}
        disabled={disabled}
        placeholder="Add a note for the client (optional) — Enter to send, Esc to cancel"
        className="w-full resize-none rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--surface-2)] px-3 py-2 t-body text-[var(--brand-text)] placeholder:text-[var(--brand-text-muted)] focus:border-[var(--brand-border-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--teal)] focus-visible:ring-offset-0"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend(note.trim());
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={disabled} onClick={() => onSend(note.trim())}>Send to client</Button>
      </div>
    </div>
  );
}
