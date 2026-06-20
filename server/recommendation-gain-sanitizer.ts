// ── recommendation gain sanitizer (shared server util) ──────────────────────────
//
// The always-on safety net that neutralizes any dollar exposure in a rec's
// `estimatedGain` before it reaches a CLIENT-facing surface. The chosen gain form is
// non-dollarized (an outcome-oriented relative-magnitude phrase — see buildOvGainString
// in server/recommendations.ts), so this normally passes strings through unchanged; it
// exists so even a future dollarized variant or a renderer that forgets to gate cannot
// leak a raw money figure ($nnn / $/wk) to a client.
//
// Two consumers MUST run their client-facing gain through this single function so neither
// path can drift from the other (B1):
//   - server/routes/recommendations.ts (`stripEmvFromPublicRecs`) — the public rec read.
//   - server/domains/inbox/deliverable-adapters/recommendation.ts (`buildRecPayload`) —
//     the rec→deliverable mint, which bypasses the public route entirely.
//
// Leaf util: imports NOTHING (pure string transform), so the leaf adapter can consume it
// without violating its import-discipline rule and without a route↔adapter circular import.

/** Matches a "$1,234" / "$1,234/wk" run anywhere in the string. */
const DOLLAR_EXPOSURE_RE = /\$\s?[\d,.]+(?:\s*\/\s*\w+)?/g;

/**
 * Replace any dollar-exposure run with a neutral, non-dollarized token. Non-dollarized
 * strings pass through unchanged; an empty result degrades to a safe evergreen fallback.
 */
export function sanitizePublicGain(gain: string): string {
  const cleaned = gain.replace(DOLLAR_EXPOSURE_RE, 'high-value').trim();
  return cleaned.length > 0 ? cleaned : 'Estimated to drive meaningful organic growth';
}
