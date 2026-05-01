import type { ReactNode } from 'react';

interface IssueSummaryLineProps {
  text: string;
}

export function IssueSummaryLine({ text }: IssueSummaryLineProps): ReactNode {
  if (!text) {
    return null;
  }

  return (
    <p className="t-body text-[var(--brand-text-muted)] leading-relaxed mt-3 mb-4">
      {text}
    </p>
  );
}
