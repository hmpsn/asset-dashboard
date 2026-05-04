import { z } from '../middleware/validate.js';

export const clientBusinessPrioritySchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    category: z.string().optional(),
  }),
]);

export type ClientBusinessPriorityInput = z.infer<typeof clientBusinessPrioritySchema>;
