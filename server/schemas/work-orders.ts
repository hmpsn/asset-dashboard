/**
 * Zod schemas for work-order route request bodies.
 * Used by server/routes/work-orders.ts and server/routes/public-content.ts
 * validate() middleware.
 */
import { z } from '../middleware/validate.js';

// Work-order conversation comment. `author` is intentionally absent — both the
// admin and the public handler hardcode the author ('team' / 'client'
// respectively); never trust the body. .strict() rejects any extra keys.
export const workOrderCommentSchema = z.object({
  content: z.string().min(1, 'content is required').max(2000),
}).strict();
