/**
 * Zod schemas for Stripe payment metadata JSON fields.
 */
import { z } from 'zod';

// Content cart context persisted alongside content cart items. Validated so the
// webhook fulfillment path can rely on the shape; passthrough on the parent keeps
// any future fields non-destructive.
const contentCartContextSchema = z.object({
  topic: z.string(),
  targetKeyword: z.string(),
  serviceType: z.enum(['brief_only', 'full_post']),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']),
  source: z.enum(['strategy', 'client']),
  intent: z.string().optional(),
  priority: z.string().optional(),
  rationale: z.string().optional(),
  notes: z.string().optional(),
  targetPageId: z.string().optional(),
  targetPageSlug: z.string().optional(),
}).passthrough();

export const cartItemSchema = z.object({
  productType: z.string(),
  pageIds: z.array(z.string()).optional(),
  issueChecks: z.array(z.string()).optional(),
  quantity: z.number().optional(),
  /** Per-item content context (briefs/posts). */
  content: contentCartContextSchema.optional(),
  /** The content request a content item fulfills (set at checkout-build time). */
  contentRequestId: z.string().optional(),
}).passthrough();

export const cartItemsArraySchema = z.array(cartItemSchema);

export const stringArraySchema = z.array(z.string());
