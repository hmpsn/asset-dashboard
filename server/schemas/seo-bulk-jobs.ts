import { z } from '../middleware/validate.js';

export const seoBulkAcceptFixSchema = z.object({
  pageId: z.string().min(1),
  check: z.string().min(1),
  suggestedFix: z.string().min(1),
  message: z.string().optional(),
  pageSlug: z.string().optional(),
  pageName: z.string().optional(),
});

export type SeoBulkAcceptFix = z.infer<typeof seoBulkAcceptFixSchema>;
