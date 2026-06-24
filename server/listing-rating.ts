// ── Shared listing rating parser (SEO Decision Engine P7 — GBP + reviews) ──
// Single source of truth for both review-data halves: the FREE local_pack items
// (extracted in dataforseo-provider's local-pack normalizer) and the PAID
// business_listings_search items (parseBusinessListings).
//
// GROUND TRUTH: tests/fixtures/dataforseo-business-listings.ts. The critical gotcha —
// a zero-review business has `rating: { rating_type: 'Max5' }` ALONE (value/votes_count
// ABSENT) or omits `rating` entirely. Missing means "no reviews yet" → undefined.
// NEVER coerce a missing value/votes_count to 0; that would silently invent a 0★/0-review
// signal and break every review-gap comparison downstream.

/**
 * Parse a DataForSEO `rating` block into a normalized star rating + review count.
 *
 * Reads `value` → `rating` and `votes_count` → `reviewCount`, but ONLY when each is a
 * finite number. Anything else (missing, null, string, non-object input) yields `undefined`
 * for that field — never 0.
 */
export function parseListingRating(rating: unknown): { rating?: number; reviewCount?: number } {
  if (typeof rating !== 'object' || rating === null) {
    return { rating: undefined, reviewCount: undefined };
  }
  const block = rating as Record<string, unknown>;
  const value = block.value;
  const votesCount = block.votes_count;
  return {
    rating: typeof value === 'number' && Number.isFinite(value) ? value : undefined,
    reviewCount: typeof votesCount === 'number' && Number.isFinite(votesCount) ? votesCount : undefined,
  };
}
