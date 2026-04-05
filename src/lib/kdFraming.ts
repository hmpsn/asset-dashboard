/**
 * Plain-language keyword difficulty framing utilities.
 *
 * KD ranges (spec-locked — do not alter without spec change):
 *   0–30:   Low competition — strong odds
 *   31–60:  Moderate competition — achievable with a strong post
 *   61–80:  Competitive — requires authority and depth
 *   81–100: Highly competitive — long-term play
 */

const KD_TIERS = [
  { max: 30, label: 'Low competition — strong odds' },
  { max: 60, label: 'Moderate competition — achievable with a strong post' },
  { max: 80, label: 'Competitive — requires authority and depth' },
  { max: 100, label: 'Highly competitive — long-term play' },
] as const;

/**
 * Returns a plain-language framing string for a keyword difficulty score.
 * Returns undefined if kd is undefined (caller omits line entirely).
 */
export function kdFraming(kd: number | undefined): string | undefined {
  if (kd === undefined) return undefined;
  for (const tier of KD_TIERS) {
    if (kd <= tier.max) return tier.label;
  }
  return KD_TIERS[KD_TIERS.length - 1].label;
}

/**
 * Returns a tooltip string showing raw KD and framing label.
 * Returns empty string if kd is undefined (caller omits tooltip prop).
 */
export function kdTooltip(kd: number | undefined): string {
  if (kd === undefined) return '';
  const framing = kdFraming(kd);
  return `KD ${kd}/100 — ${framing}`;
}
