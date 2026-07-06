/**
 * Shared guard for document-level keydown handlers (UI/UX rule 9 — one
 * implementation, not per-surface copies).
 *
 * Returns true when the event target is a text-entry context that owns its
 * own keyboard semantics: form fields, or anything inside a contenteditable
 * region (`isContentEditable` is inherited, so nested elements report true;
 * the `closest` check additionally catches non-editable hosts that carry the
 * attribute explicitly).
 *
 * NOTE: three legacy call sites (App.tsx, NotificationBell, OnboardingChecklist)
 * still carry inline copies of this check — they migrate here as their
 * surfaces are rebuilt in Phase A. New global keydown handlers must use this.
 */
export function isEditableKeyTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && (target.isContentEditable || target.closest('[contenteditable="true"]') !== null))
  );
}
