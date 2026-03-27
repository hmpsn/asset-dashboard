/**
 * Zod schemas for approval batch items.
 */
import { z } from 'zod';

export const approvalItemSchema = z.object({
  id: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  pageSlug: z.string(),
  field: z.string(),
  collectionId: z.string().optional(),
  currentValue: z.string(),
  proposedValue: z.string(),
  clientValue: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'applied']),
  clientNote: z.string().optional(),
  reason: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).passthrough();

export const approvalItemsArraySchema = z.array(approvalItemSchema);
