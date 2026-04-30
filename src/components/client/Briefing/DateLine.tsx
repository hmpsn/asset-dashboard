import type { ReactNode } from 'react';

interface DateLineProps {
  /** ISO date string YYYY-MM-DD (Monday, UTC) — the briefing's weekOf field. */
  weekOf: string;
  /** 1-indexed sequential issue number for this workspace. Optional — when absent, the issue badge is omitted. */
  issueNumber?: number;
}

export function DateLine({ weekOf, issueNumber }: DateLineProps): ReactNode {
  let formatted = weekOf.toUpperCase();

  try {
    const d = new Date(`${weekOf}T00:00:00Z`);
    const dateStr = d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
    formatted = `WEEK OF ${dateStr}`.toUpperCase();
  } catch {
    // If parse fails, render raw string uppercase
    formatted = weekOf.toUpperCase();
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
