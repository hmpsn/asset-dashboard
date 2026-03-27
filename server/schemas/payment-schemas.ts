/**
 * Zod schemas for Stripe payment metadata JSON fields.
 */
import { z } from 'zod';

export const cartItemSchema = z.object({
  productType: z.string(),
  pageIds: z.array(z.string()).optional(),
  issueChecks: z.array(z.string()).optional(),
  quantity: z.number().optional(),
}).passthrough();

export const cartItemsArraySchema = z.array(cartItemSchema);

export const stringArraySchema = z.array(z.string());
