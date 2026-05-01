// CLIENT-FACING
// Phase 2.5e — Premium-only AI-generated "letter from the editor".
// Renders ABOVE the DateLine on premium briefings when the
// `client-briefing-v2-ai-polish` flag is on AND the AI call succeeded.
// On any fail-soft path the parent composer skips this component entirely
// (props arrive only when the wire response carries the field).

import type { ReactNode } from 'react';

interface WeeklyOpenerProps {
  /** ≤25-word, period-terminated, single-line opener from the public endpoint. */
  text: string;
}

/**
 * Italic body line, muted, sits above the DateLine to set the week's tone.
 * Renders nothing for empty input — defensive guard so a future caller
 * passing an empty string doesn't render an empty `<p>`.
 */
export function WeeklyOpener({ text }: WeeklyOpenerProps): ReactNode {
  if (!text) return null;
  return (
    <p className="t-body italic text-[var(--brand-text-muted)] leading-relaxed mb-2">
      {text}
    </p>
  );
}
