// @ds-rebuilt
import { Badge, StatusBadge } from '../ui';
import type { BadgeShape, BadgeVariant } from '../ui/Badge';

export const KEYWORDS_SAY_IT_ALOUD = {
  rawEvidence: 'Seen in search',
  unclustered: 'Not in a topic yet',
  opportunity: 'Opportunity',
  currentMonthly: '$/mo',
} as const;

export function keywordLifecycleDisplayLabel(status: string, fallback: string): string {
  return status === 'raw_evidence' ? KEYWORDS_SAY_IT_ALOUD.rawEvidence : fallback;
}

interface KeywordLifecycleBadgeProps {
  status: string;
  variant?: BadgeVariant;
  shape?: BadgeShape;
}

/** Rebuilt Keywords owns a plain-language display label for raw evidence. */
export function KeywordLifecycleBadge({
  status,
  variant = 'soft',
  shape = 'sm',
}: KeywordLifecycleBadgeProps) {
  if (status === 'raw_evidence') {
    return (
      <Badge
        label={KEYWORDS_SAY_IT_ALOUD.rawEvidence}
        tone="zinc"
        variant={variant}
        size="sm"
        shape={shape}
      />
    );
  }

  return (
    <StatusBadge
      status={status}
      domain="keyword-command-center"
      variant={variant}
      shape={shape}
    />
  );
}
