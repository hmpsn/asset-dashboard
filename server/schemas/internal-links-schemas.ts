import { z } from 'zod';

export const linkSuggestionSchema = z.object({
  fromPage: z.string(),
  fromTitle: z.string(),
  toPage: z.string(),
  toTitle: z.string(),
  anchorText: z.string(),
  reason: z.string(),
  priority: z.enum(['high', 'medium', 'low']),
}).passthrough();

export const linkSuggestionsArraySchema = z.array(linkSuggestionSchema);
