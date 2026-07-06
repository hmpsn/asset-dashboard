import { z } from 'zod';
import type { StrategyPov, StrategyPovAIOutput } from '../../shared/types/strategy-pov.js';

/**
 * Zod schema for the stored StrategyPov blob (server/db/migrations/140-strategy-pov.sql
 * `pov_json` column). Field names are cross-referenced against shared/types/strategy-pov.ts —
 * a mismatch silently fails safeParse and destroys the stored POV (CLAUDE.md "Zod schema field
 * names" + "Schema vs stored shape"). `leadMoveRecId` and `editedAt` are nullable per the type.
 *
 * NOTE: this reflects what is actually written to the column (rowToPov reads it back). Every field
 * the store persists is required here EXCEPT `verdictHeadline` (SB-038, W1.2), which is additive and
 * absent from pre-SB-038 blobs — it must stay `.optional()` so a legacy blob still safeParses.
 */
export const strategyPovSchema: z.ZodType<StrategyPov> = z.object({
  situation: z.string(),
  leadMoveRecId: z.string().nullable(),
  leadSentence: z.string(),
  wins: z.array(z.string()),
  flags: z.array(z.string()),
  verdictHeadline: z.string().optional(),
  version: z.number(),
  generatedAt: z.string(),
  editedAt: z.string().nullable(),
});

/**
 * Zod schema for the raw model output (no version/timestamps — the store stamps those).
 * Used by the generator's parseStructuredAIOutput call. Matches StrategyPovAIOutput exactly.
 */
export const strategyPovAIOutputSchema: z.ZodType<StrategyPovAIOutput> = z.object({
  situation: z.string().trim().min(1),
  leadSentence: z.string().trim().min(1),
  wins: z.array(z.string().trim().min(1)),
  flags: z.array(z.string().trim().min(1)),
  verdictHeadline: z.string().trim().min(1).optional(),
});
