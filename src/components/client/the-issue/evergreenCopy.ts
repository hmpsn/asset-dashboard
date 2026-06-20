// ── evergreenCopy — the no-temporal-language contract for the client surface ─────
//
// The client experiences The Issue as a continuously-current dashboard — NOT a dated
// edition. Owner correction (locked): client copy is EVERGREEN. No "since last week" /
// "this week" / "last refresh" / issue numbers / dates. Proof is framed as current
// state ("what's working right now"), never time-relative deltas.
//
// This module is the single source of section titles + intros for TheIssueClientPage,
// plus a guard helper used by the evergreen-copy contract test. Keeping all client-facing
// strings here makes the temporal-phrase audit trivial and prevents drift when reused
// components (which may carry "vs last refresh" copy) are re-homed under this surface.

/** Section titles — value-first, evergreen, no admin jargon, no time anchors. */
export const ISSUE_SECTION_TITLES = {
  yourTurn: 'Your turn',
  status: 'Where your site stands',
  stats: 'Your numbers',
  roi: 'What your SEO is worth',
  contentPlan: 'Your content plan',
  alsoOnPlan: 'Also on your plan',
  whatsWorking: "What's working right now",
  competitors: 'How you stack up',
  ask: 'Ask your strategist',
} as const;

/** Short evergreen intros / helper copy per section. */
export const ISSUE_SECTION_INTROS = {
  contentPlan: 'The pieces we recommend writing next — each one a chance to capture qualified search demand.',
  contentPlanFloor: "Opportunities we're evaluating — these are content gaps we're sizing up before we recommend them.",
  alsoOnPlan: 'The rest of the plan — refreshes, technical work, and keywords we’re working on your behalf.',
  whatsWorking: 'Real results from the work we’ve shipped for you.',
  ask: 'Have a question about your strategy? Your strategist is one message away.',
} as const;

/** CTA labels (locked): "Act on this" = request; the detail link is "See the details". */
export const ISSUE_CTA = {
  /** Primary greenlight CTA — a request, never "open the brief" (the brief doesn't exist yet). */
  actOnThis: 'Act on this',
  /** Alternate phrasing for compact rows. */
  request: 'Request',
  /** Link to the recommendation's details — NOT "open the brief". */
  seeDetails: 'See the details',
  relevant: 'Relevant',
  notRelevant: 'Not relevant',
} as const;

/**
 * Loop-footer summary line, evergreen. "you've greenlit N moves · M in discussion".
 * Returns null when there is nothing to report so the footer can omit the line.
 */
export function loopStatusLine(approved: number, discussing: number): string | null {
  const parts: string[] = [];
  if (approved > 0) parts.push(`you've greenlit ${approved} move${approved === 1 ? '' : 's'}`);
  if (discussing > 0) parts.push(`${discussing} in discussion`);
  if (parts.length === 0) return null;
  return parts.join(' · ');
}

/**
 * Work-in-flight line, evergreen ("N briefs in progress"). Returns null at zero.
 * "In progress" is a state, not a time anchor — allowed under the evergreen guard.
 */
export function workInFlightLine(count: number): string | null {
  if (count <= 0) return null;
  return `${count} brief${count === 1 ? '' : 's'} in progress`;
}

// ── Evergreen guard (used by the contract test + dev assertions) ────────────────
//
// The banned phrases mirror the evergreen-copy pr-check rule. This is the
// programmatic twin: a test can import BANNED_TEMPORAL_PATTERNS and assert that no
// rendered client-surface string matches, catching a reused component that smuggles
// in "vs last refresh" copy.

export const BANNED_TEMPORAL_PATTERNS: RegExp[] = [
  /\bsince last week\b/i,
  /\bthis week\b/i,
  /\blast week\b/i,
  /\bvs\.?\s+last\s+(refresh|period|week|month)\b/i,
  /\bvs\.?\s+(?:the\s+)?previous\b/i,
  /\b\d+\s+days?\s+ago\b/i,
  /\byesterday\b/i,
  /\bissue\s+#\d+\b/i,
  /\bweek of\b/i,
];

/** True when `text` contains a banned time-relative phrase (evergreen violation). */
export function hasTemporalLanguage(text: string): boolean {
  return BANNED_TEMPORAL_PATTERNS.some((re) => re.test(text));
}
