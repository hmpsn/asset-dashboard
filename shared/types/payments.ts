// ── Payment domain types ────────────────────────────────────────

export type ProductType =
  | 'brief_blog' | 'brief_landing' | 'brief_service' | 'brief_location'
  | 'brief_product' | 'brief_pillar' | 'brief_resource'
  | 'post_draft' | 'post_polished' | 'post_premium'
  | 'schema_page' | 'schema_10'
  | 'strategy' | 'strategy_refresh'
  | 'fix_meta' | 'fix_alt' | 'fix_redirect' | 'fix_meta_10'
  | 'plan_growth' | 'plan_premium';

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
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  pageIds: string[];
  issueChecks?: string[];
  quantity: number;
  assignedTo?: string;
  completedAt?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}
