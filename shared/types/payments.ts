// ── Payment domain types ────────────────────────────────────────

export type ProductType =
  | 'brief_blog' | 'brief_landing' | 'brief_service' | 'brief_location'
  | 'brief_product' | 'brief_pillar' | 'brief_resource'
  | 'post_draft' | 'post_polished' | 'post_premium'
  | 'schema_page' | 'schema_10'
  | 'strategy' | 'strategy_refresh'
  | 'fix_meta' | 'fix_alt' | 'fix_redirect' | 'fix_meta_10'
  | 'plan_growth' | 'plan_premium'
  | 'content_starter' | 'content_growth' | 'content_scale';

// ── Content cart context ────────────────────────────────────────
// A content cart item (brief or full post) carries the same payload the
// single-purchase content flow sends today (see src/hooks/usePayments.ts), so
// the cart checkout can mirror Buy-now fulfillment exactly. Unlike per-page fix
// items — which MERGE by productType — each content item is a DISTINCT topic and
// never merges; identity is the generated `cartItemId`, not productType.
export type ContentServiceType = 'brief_only' | 'full_post';
/** The page types the cart/checkout supports (the brief-priced subset). A subset
 *  of the broader content.ts ContentPageType — kept narrow so it maps 1:1 onto a
 *  brief product. */
export type ContentCartPageType =
  | 'blog' | 'landing' | 'service' | 'location' | 'product' | 'pillar' | 'resource';

export interface ContentCartContext {
  topic: string;
  targetKeyword: string;
  serviceType: ContentServiceType;
  pageType: ContentCartPageType;
  /** Where this content request originated (mirrors PricingModalData.source). */
  source: 'strategy' | 'client';
  intent?: string;
  priority?: string;
  rationale?: string;
  notes?: string;
  targetPageId?: string;
  targetPageSlug?: string;
}

/**
 * Resolve the Stripe ProductType for a content cart item. Mirrors the
 * single-purchase mapping in usePayments.ts EXACTLY so cart and Buy-now charge
 * the same product (full post → post_polished, otherwise brief_blog). Keeping
 * one resolver prevents the two paths from drifting.
 */
export function contentProductType(serviceType: ContentServiceType): ProductType {
  return serviceType === 'full_post' ? 'post_polished' : 'brief_blog';
}

export interface PaymentRecord {
  id: string;
  workspaceId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  productType: ProductType;
  amount: number;           // cents
  currency: string;
  status: 'pending' | 'paid' | 'failed' | 'refunded';
  contentRequestId?: string;
  metadata?: Record<string, string>;
  createdAt: string;
  paidAt?: string;
}

export interface WorkOrder {
  id: string;
  workspaceId: string;
  paymentId: string;
  productType: ProductType;
  status: 'pending' | 'in_progress' | 'completed' | 'closed' | 'cancelled';
  pageIds: string[];
  issueChecks?: string[];
  quantity: number;
  assignedTo?: string;
  completedAt?: string;
  /** Set when an operator explicitly closes out a completed order (one-way, no reopen). */
  closedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Work-order conversation (client ↔ team comment thread) ──
// Comments live in a dedicated `work_order_comments` table, served out-of-band
// from the work-order deliverable payload.
export type WorkOrderCommentAuthor = 'client' | 'team';

export interface WorkOrderComment {
  id: string;
  workOrderId: string;
  author: WorkOrderCommentAuthor;
  content: string;
  createdAt: string;
  readAt?: string;
}
