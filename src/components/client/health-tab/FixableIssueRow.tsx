/**
 * FixableIssueRow — renders a "Fix this — $X" teal CTA for fixable audit issues
 * or, for Premium tier, the hours-covered work-order framing.
 *
 * Extracted from HealthTabSections to own the purchase-surface logic in one place.
 *
 * Rules:
 * - Growth/Free: teal "Fix this — $X" button → useCart.addItem()
 * - Premium: "Covered by your hours — request fix" → no prices anywhere
 * - Only renders for check types present in AUDIT_CHECK_TO_FIX_TYPE
 * - "In cart" state renders a teal confirmation badge (not a button)
 */
import { ShoppingCart, Wrench } from 'lucide-react';
import { Button, Icon } from '../../ui';
import {
  fixTypeForAuditCheck,
  FIX_CATALOG,
  FIX_PRODUCT_WIRING,
} from '../../../../shared/types/fix-catalog.js';
import { useCart } from '../useCart';
import type { Tier } from '../../ui/TierGate';
import type { ProductType } from '../../../../shared/types/payments.js';

interface FixableIssueRowProps {
  /** Audit check type (e.g. "title", "structured-data", "img-alt") */
  check: string;
  /** Human-readable label for the fix item in the cart */
  displayName: string;
  /** Page IDs affected — used for per-page items in the cart */
  pageIds?: string[];
  /** Current client tier — Premium shows hours framing, others show price */
  tier: Tier;
  /** External-billing workspaces: never render prices or cart affordances —
   *  show neutral "Included in your service — request fix" framing instead. */
  hidePrices?: boolean;
  /** Called when Premium / external-billing user clicks "request fix" (routes to work-order flow) */
  onRequestFix?: () => void;
  className?: string;
}

export function FixableIssueRow({
  check,
  displayName,
  pageIds,
  tier,
  hidePrices,
  onRequestFix,
  className = '',
}: FixableIssueRowProps) {
  const fixType = fixTypeForAuditCheck(check);
  if (!fixType) return null;

  const catalogEntry = FIX_CATALOG[fixType];
  const wiring = FIX_PRODUCT_WIRING[fixType];
  const productType = wiring.perPageProduct as ProductType;
  // alt-text is always a flat full-site charge; everything else is per-page
  const isFlat = catalogEntry.bundleFamily === 'alt-text';
  const isPremium = tier === 'premium';

  // External billing has no Stripe path — the cart/checkout summary is hidden,
  // so showing a price + "add to cart" here would strand the client with a cart
  // they can never check out. Render a neutral request-fix CTA instead. This is
  // checked BEFORE tier so a Growth/external client never sees a price.
  if (hidePrices) {
    return (
      <div
        data-testid={`fix-row-external-${check}`}
        className={`flex items-center gap-2 ${className}`}
      >
        <Button
          size="sm"
          variant="secondary"
          icon={Wrench}
          onClick={onRequestFix}
          aria-label={`Request fix for ${displayName}`}
        >
          Included in your service — request fix
        </Button>
      </div>
    );
  }

  if (isPremium) {
    return (
      <div
        data-testid={`fix-row-premium-${check}`}
        className={`flex items-center gap-2 ${className}`}
      >
        <Button
          size="sm"
          variant="secondary"
          icon={Wrench}
          onClick={onRequestFix}
          aria-label={`Request fix for ${displayName}`}
        >
          Covered by your hours — request fix
        </Button>
      </div>
    );
  }

  // Growth / Free path — use useCart inside a wrapper that needs CartProvider
  return (
    <FixCTAButton
      check={check}
      displayName={displayName}
      productType={productType}
      priceUsd={catalogEntry.priceUsd}
      isFlat={isFlat}
      pageIds={pageIds}
      className={className}
    />
  );
}

interface FixCTAButtonProps {
  check: string;
  displayName: string;
  productType: ProductType;
  priceUsd: number;
  isFlat?: boolean;
  pageIds?: string[];
  className: string;
}

function FixCTAButton({
  check,
  displayName,
  productType,
  priceUsd,
  isFlat,
  pageIds,
  className,
}: FixCTAButtonProps) {
  const { items, addItem } = useCart();

  const existing = items.find((i) => i.productType === productType);
  // For per-page rows, "in cart" means THIS row's specific pages are already
  // staged — productType match alone would wrongly mark every page of a family
  // as in-cart after the first add (and block adding the rest). Flat items have
  // no per-page identity, so productType presence is the correct signal.
  const isInCart = isFlat
    ? !!existing
    : !!existing &&
      (pageIds?.length ?? 0) > 0 &&
      pageIds!.every((id) => existing.pageIds?.includes(id));

  if (isInCart) {
    return (
      // badge-span-ok: in-cart state chip pairs an icon with the label at CTA
      // size — Badge's fixed sizing doesn't match the adjacent Button footprint.
      <span // badge-span-ok
        data-testid={`fix-row-incart-${check}`}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-md)] t-caption font-medium bg-teal-500/10 text-accent-brand border border-teal-500/20 ${className}`}
      >
        <Icon as={ShoppingCart} size="sm" aria-hidden />
        In cart
      </span>
    );
  }

  return (
    <Button
      data-testid={`fix-row-cta-${check}`}
      size="sm"
      icon={ShoppingCart}
      onClick={() =>
        addItem({
          productType,
          displayName,
          priceUsd,
          isFlat,
          pageIds,
          // Carry the audit check so the eventual work order knows what to fix.
          issueChecks: [check],
          quantity: 1,
        })
      }
      aria-label={`Add ${displayName} fix to cart — $${priceUsd}${isFlat ? ' flat rate' : ' per page'}`}
      className={className}
    >
      Fix this — ${priceUsd}
      {isFlat ? ' flat' : '/pg'}
    </Button>
  );
}
