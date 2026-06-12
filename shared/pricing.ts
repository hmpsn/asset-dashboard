/**
 * Shared pricing constants — the SINGLE source of truth for cross-cutting
 * discount/pricing config used by BOTH the server checkout builder and the
 * client cart display, so the strikethrough the client shows always matches the
 * amount the server charges.
 */

/**
 * Premium content discount — Premium-tier workspaces pay this fraction less on
 * content purchases (briefs + full posts) per MONETIZATION.md §"Premium Content
 * Discount".
 *
 * Expressed as a SINGLE config constant on purpose: the owner's tier-model
 * rediscussion (data/roadmap.json → `tier-model-rediscussion`, brainstorm-gated)
 * may re-map who gets the discount or change the rate. Keeping it here means that
 * re-map is a one-line config change, not a checkout-logic rewrite.
 *
 * Applied at checkout-build time to content line items ONLY (fixes are
 * hours-covered for Premium and never enter a Premium cart).
 */
export const PREMIUM_CONTENT_DISCOUNT = 0.10;
