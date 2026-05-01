import type { ReactNode } from 'react';

interface DateLineProps {
  /** ISO date string YYYY-MM-DD (Monday, UTC) — the briefing's weekOf field. */
  weekOf: string;
  /** 1-indexed sequential issue number for this workspace. Optional — when absent, the issue badge is omitted. */
  issueNumber?: number;
}

export function DateLine({ weekOf, issueNumber }: DateLineProps): ReactNode {
  // `new Date('bad-stringT00:00:00Z')` returns Invalid Date WITHOUT throwing,
  // and `toLocaleDateString` on it returns the literal "Invalid Date". A
  // try/catch can't catch this — only an explicit isNaN(timestamp) check
  // detects the malformed input. Falls back to the raw uppercased string so
  // the dateline still renders something the reader can recognize.
  let formatted = weekOf.toUpperCase();
  const d = new Date(`${weekOf}T00:00:00Z`);
  if (!Number.isNaN(d.getTime())) {
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
    formatted = `WEEK OF ${dateStr}`.toUpperCase();
  }

  return (
    <div className="border-b border-[var(--brand-border)] pb-2 mb-4">
      <div className="flex items-baseline justify-between">
        <span className="t-label tracking-wider text-[var(--brand-text-muted)] font-medium">
          {formatted}
        </span>
        {issueNumber != null && issueNumber >= 1 && (
          <span className="t-label tracking-wider text-[var(--brand-text-muted)] font-medium">
            ISSUE {issueNumber}
          </span>
        )}
      </div>
    </div>
  );
}
