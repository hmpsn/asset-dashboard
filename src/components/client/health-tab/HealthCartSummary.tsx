/**
 * HealthCartSummary — sticky in-tab cart summary bar.
 *
 * Shown at the bottom of the Health tab when the cart has items, giving users
 * a quick view of what they've added without opening the full SeoCartDrawer.
 *
 * Rules:
 * - Only renders when cart.totalItems > 0
 * - Uses `--z-sticky` from the token scale
 * - Totals MIRROR cart state (sum of priceUsd × quantity) — never compute
 *   authoritative pricing here; server owns real checkout math
 * - Links to the existing cart (calls cart.openCart())
 * - Shows pack suggestion when a bundleFamily crosses its pack threshold
 * - No prices when `hidePrices` is true (external billing workspaces)
 */
import { ShoppingCart, Sparkles } from 'lucide-react';
import { Button, Icon } from '../../ui';
import { useCart } from '../useCart';
import { FIX_CATALOG, FIX_PRODUCT_WIRING, type FixType, type BundleFamily } from '../../../../shared/types/fix-catalog.js';
import { fmtMoneyFull } from '../../../utils/formatNumbers';
import type { ImpactBand } from '../../../../shared/types/fix-catalog.js';

interface HealthCartSummaryProps {
  /** Suppresses all price rendering for external-billing workspaces */
  hidePrices?: boolean;
  /**
   * Combined impact bands for items currently in the cart.
   * When provided, the bar shows "est. +$X–$Y/mo combined".
   * Absent or empty → no combined estimate shown.
   *
   * Prefer passing `impactBandsByCheck` (the same map HealthTab already holds) —
   * the summary then derives per-cart-item bands from each item's issueChecks.
   * This direct prop remains for callers that pre-compute the band list.
   */
  cartImpactBands?: ImpactBand[];
  /**
   * Impact bands keyed by audit check type (the projection map from HealthTab).
   * When provided, the summary maps the cart's `issueChecks` → bands and sums
   * them into the combined "est. +$X–$Y/mo" estimate. Each check is counted once.
   */
  impactBandsByCheck?: Record<string, ImpactBand>;
}

/** Derive the deduped band list for the cart from each item's issueChecks. */
function bandsFromCartChecks(
  cartItems: ReturnType<typeof useCart>['items'],
  impactBandsByCheck: Record<string, ImpactBand>,
): ImpactBand[] {
  const seen = new Set<string>();
  const bands: ImpactBand[] = [];
  for (const item of cartItems) {
    for (const check of item.issueChecks ?? []) {
      if (seen.has(check)) continue;
      seen.add(check);
      const band = impactBandsByCheck[check];
      if (band) bands.push(band);
    }
  }
  return bands;
}

/** Aggregate monthly range across multiple impact bands — sums lower and upper bounds */
function sumImpactBands(bands: ImpactBand[]): [number, number] | null {
  const valid = bands.filter((b) => b.monthlyRangeUsd);
  if (valid.length === 0) return null;
  const lo = valid.reduce((s, b) => s + (b.monthlyRangeUsd![0]), 0);
  const hi = valid.reduce((s, b) => s + (b.monthlyRangeUsd![1]), 0);
  return [lo, hi];
}

/** Returns a pack suggestion if any bundle family in the cart is at or above its threshold */
function buildPackSuggestion(
  cartItems: ReturnType<typeof useCart>['items'],
): { fixType: FixType; family: BundleFamily; packPrice: number; packSize: number; savings: number } | null {
  // Count per bundle family by looking up each cart item's fix type via productType
  const familyCount: Partial<Record<BundleFamily, number>> = {};

  for (const item of cartItems) {
    // Reverse-map productType → fixType via FIX_PRODUCT_WIRING
    for (const [fixType, wiring] of Object.entries(FIX_PRODUCT_WIRING) as [FixType, typeof FIX_PRODUCT_WIRING[FixType]][]) {
      if (wiring.perPageProduct === item.productType && !item.isFlat) {
        const family = FIX_CATALOG[fixType].bundleFamily;
        familyCount[family] = (familyCount[family] ?? 0) + item.quantity;
      }
    }
  }

  for (const [fixType, wiring] of Object.entries(FIX_PRODUCT_WIRING) as [FixType, typeof FIX_PRODUCT_WIRING[FixType]][]) {
    if (!wiring.packProduct) continue;
    const entry = FIX_CATALOG[fixType];
    if (!entry.pack) continue;
    const count = familyCount[entry.bundleFamily] ?? 0;
    if (count >= entry.pack.size) {
      const unitTotal = count * entry.priceUsd;
      const savings = unitTotal - entry.pack.priceUsd;
      if (savings > 0) {
        return {
          fixType,
          family: entry.bundleFamily,
          packPrice: entry.pack.priceUsd,
          packSize: entry.pack.size,
          savings,
        };
      }
    }
  }
  return null;
}

export function HealthCartSummary({ hidePrices, cartImpactBands, impactBandsByCheck }: HealthCartSummaryProps) {
  const cart = useCart();
  const { items, totalItems, totalPrice, openCart } = cart;

  if (totalItems === 0) return null;

  // Prefer an explicit band list; otherwise derive from the cart's issueChecks
  // against the projection map (item 6 — the data exists, wire it).
  const effectiveBands = cartImpactBands
    ?? (impactBandsByCheck ? bandsFromCartChecks(items, impactBandsByCheck) : null);
  const combinedRange = effectiveBands ? sumImpactBands(effectiveBands) : null;
  const packSuggestion = buildPackSuggestion(items);

  const familyLabel: Record<BundleFamily, string> = {
    metadata: 'Metadata pack',
    schema: 'Schema pack',
    'alt-text': 'Alt-text pack',
    redirects: 'Redirect pack',
  };

  return (
    // z-index-ok — sticky in-tab health cart summary; uses --z-sticky token (z-10), well below modal/toast layers
    <div
      data-testid="health-cart-summary"
      className="sticky bottom-0 z-[var(--z-sticky)] mt-4 rounded-[var(--radius-xl)] border border-teal-500/30 bg-[var(--surface-2)] shadow-[0_-4px_24px_rgba(0,0,0,0.3)] px-4 py-3"
    >
      {/* Pack suggestion banner */}
      {packSuggestion && !hidePrices && (
        <div
          data-testid="health-pack-suggestion"
          className="mb-2 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] bg-teal-500/5 border border-teal-500/20"
        >
          <Icon as={Sparkles} size="sm" className="text-accent-brand flex-shrink-0" aria-hidden />
          <p className="t-caption-sm text-accent-brand">
            {familyLabel[packSuggestion.family]} — {packSuggestion.packSize} pages,{' '}
            {fmtMoneyFull(packSuggestion.packPrice)}, save {fmtMoneyFull(packSuggestion.savings)}
          </p>
        </div>
      )}

      {/* Summary row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Icon as={ShoppingCart} size="md" className="text-accent-brand flex-shrink-0" aria-hidden />
          <span className="t-caption font-medium text-[var(--brand-text-bright)]">
            {totalItems} {totalItems === 1 ? 'fix' : 'fixes'}
            {!hidePrices && (
              <> — {fmtMoneyFull(totalPrice)}</>
            )}
          </span>
          {combinedRange && !hidePrices && (
            <span className="t-caption-sm text-accent-info truncate">
              · est. +${combinedRange[0]}–${combinedRange[1]}/mo
            </span>
          )}
        </div>
        <Button
          size="sm"
          onClick={openCart}
          aria-label="Open SEO fix cart"
        >
          Review cart
        </Button>
      </div>
    </div>
  );
}
