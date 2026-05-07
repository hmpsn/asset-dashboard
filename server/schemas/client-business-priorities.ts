import { z } from '../middleware/validate.js';

export const CLIENT_BUSINESS_PRIORITIES_MARKER = '\n--- CLIENT PRIORITIES ---\n';

const clientBusinessPriorityCategorySchema = z.enum([
  'growth',
  'brand',
  'product',
  'audience',
  'competitive',
  'other',
]);

// Lenient by design for legacy DB reads; the POST body schema below is the strict write boundary.
export const clientBusinessPrioritySchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    category: z.string().optional(),
  }),
]);

export const clientBusinessPrioritiesBodySchema = z.object({
  priorities: z.array(z.object({
    text: z.string().trim().min(1, 'priority text is required').max(500),
    category: clientBusinessPriorityCategorySchema.optional().default('other'),
  }).strict()).max(10),
}).strict();

export type ClientBusinessPriorityInput = z.infer<typeof clientBusinessPrioritySchema>;
export type ClientBusinessPrioritiesBody = z.infer<typeof clientBusinessPrioritiesBodySchema>;
