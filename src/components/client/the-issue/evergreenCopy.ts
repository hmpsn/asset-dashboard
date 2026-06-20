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
  contentPlanFloor: 'The content moves we recommend next will appear here as your strategist curates them.',
  alsoOnPlan: 'The rest of the plan — refreshes, technical work, and keywords we’re working on your behalf.',
  whatsWorking: 'Real results from the work we’ve shipped for you.',
  ask: 'Have a question about your strategy? Your strategist is one message away.',
} as const;

/** CTA labels (locked, audit blocker #1 / D1). The greenlight verb is "Request this" on
 *  monetizable content moves and "Discuss this" on non-monetizable moves — the literal
 *  the retired act-on label never appears on the client surface. The detail link is "See the details";
 *  the in-card soft-yes opens the advisor ("Let us talk"). */
export const ISSUE_CTA = {
  /** Primary greenlight CTA on a monetizable content move — a REQUEST (the brief doesn't exist yet). */
  requestThis: 'Request this',
  /** Greenlight verb on a NON-monetizable move — opens a conversation, not a priced request. */
  discussThis: 'Discuss this',
  /** In-card soft-yes — opens the advisor pre-seeded with the move (warm-lead valve). */
  letsTalk: 'Let us talk',
  /** Alternate phrasing for compact rows. */
  request: 'Request',
  /** Link to the recommendation's details — NOT "open the brief". */
  seeDetails: 'See the details',
  relevant: 'Relevant',
  notRelevant: 'Not relevant',
} as const;

/** Consequence line shown in the pre-request ConfirmDialog (audit blocker #1 / D3). No charge at click. */
export const ISSUE_REQUEST_CONFIRM_CONSEQUENCE =
  'Your strategist will confirm scope before any work begins. Nothing is billed at this click.';

/** Success toast after a request is added to the plan (audit blocker #1). */
export const ISSUE_REQUEST_SUCCESS_TOAST =
  'Added to your plan — your strategist will scope and confirm before any work or charge.';

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

// ── Evergreen guard — two zones (D2) ────────────────────────────────────────────
//
// The client experiences The Issue as a continuously-current dashboard, but the D2
// owner ruling carves out a SURGICAL relaxation: the verdict (slot 1) and money frame
// (slot 3) MAY carry exactly one fixed engagement-start baseline ("since we started").
// Two zones, both enforced through this module:
//   • PLAN zone (default) — content plan / also-on-plan. No temporal phrasing at all
//     (rolling windows + issue numbers + week-of). Back-compat for the static pr-check twin.
//   • VERDICT zone — verdict / proof. Allows ALLOWED_BASELINE_PATTERNS anchors and bans
//     rolling windows; the INVERSE law makes a *dateless* verdict a violation.

/** Rolling / shifting / cherry-picked windows — banned in EVERY zone. */
export const ROLLING_WINDOW_PATTERNS: RegExp[] = [
  /\bsince last week\b/i,
  /\bthis week\b/i,
  /\blast week\b/i,
  /\bvs\.?\s+last\s+(refresh|period|week|month)\b/i,
  /\bvs\.?\s+(?:the\s+)?previous\b/i,
  /\b\d+\s+days?\s+ago\b/i,
  /\byesterday\b/i,
];

/** Plan-zone-only bans (issue numbers, week-of, manufactured cadence). */
export const PLAN_RELATIVE_PATTERNS: RegExp[] = [
  /\bissue\s+#\d+\b/i,
  /\bweek of\b/i,
];

/**
 * Plan-zone ban superset = rolling + plan-relative. Preserved under the original name for the
 * pr-check static evergreen rule and the existing contract test.
 */
export const BANNED_TEMPORAL_PATTERNS: RegExp[] = [...ROLLING_WINDOW_PATTERNS, ...PLAN_RELATIVE_PATTERNS];

/** The ONLY temporal phrases allowed in the verdict/proof zone — fixed engagement-start anchors. */
export const ALLOWED_BASELINE_PATTERNS: RegExp[] = [
  /\bsince we started\b/i,
  /\bwhen we started\b/i,
  /\bvs\.?\s+when we started\b/i,
  /\bsince [A-Z][a-z]+\b/, // "since January" — a fixed month anchor
];

export type EvergreenZone = 'plan' | 'verdict';

/**
 * Zone-aware temporal guard — returns TRUE on a VIOLATION.
 *  - 'plan' (default): any BANNED_TEMPORAL_PATTERNS match.
 *  - 'verdict': a rolling-window match OR the ABSENCE of a baseline anchor (inverse law, D2).
 */
export function hasTemporalLanguage(text: string, zone: EvergreenZone = 'plan'): boolean {
  if (ROLLING_WINDOW_PATTERNS.some((re) => re.test(text))) return true;
  if (zone === 'verdict') return !ALLOWED_BASELINE_PATTERNS.some((re) => re.test(text));
  return BANNED_TEMPORAL_PATTERNS.some((re) => re.test(text));
}

/** True when `text` carries at least one allowed engagement-start anchor (inverse-law helper). */
export function hasBaselineAnchor(text: string): boolean {
  return ALLOWED_BASELINE_PATTERNS.some((re) => re.test(text));
}

/**
 * Baseline-anchored verdict copy (D2, verdict zone). Carries an ALLOWED_BASELINE anchor when a
 * baseline exists (inverse law), never a rolling window, reports declines truthfully, and degrades
 * to an honest establishing line when baseline is null.
 */
export function baselineVerdict(args: { outcomeNoun: string; current: number; baseline: number | null }): string {
  const { outcomeNoun, current, baseline } = args;
  const head = `${current.toLocaleString()} ${outcomeNoun}`;
  if (baseline == null) {
    return `${head} — we're establishing your baseline now; your trend appears here as outcomes land.`;
  }
  if (current > baseline) return `${head}, up from ${baseline.toLocaleString()} since we started.`;
  if (current < baseline) return `${head}, down from ${baseline.toLocaleString()} since we started.`;
  return `${head} — holding steady since we started.`;
}
