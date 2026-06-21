import { z } from 'zod';
import type { StrategyPov, StrategyPovAIOutput } from '../../shared/types/strategy-pov.js';

/**
 * Zod schema for the stored StrategyPov blob (server/db/migrations/140-strategy-pov.sql
 * `pov_json` column). Field names are cross-referenced against shared/types/strategy-pov.ts —
 * a mismatch silently fails safeParse and destroys the stored POV (CLAUDE.md "Zod schema field
 * names" + "Schema vs stored shape"). `leadMoveRecId` and `editedAt` are nullable per the type.
 *
 * NOTE: this reflects what is actually written to the column (rowToPov reads it back). The store
 * always persists every field, so none are optional here.
 */
export const strategyPovSchema: z.ZodType<StrategyPov> = z.object({
  situation: z.string(),
  leadMoveRecId: z.string().nullable(),
  leadSentence: z.string(),
  wins: z.array(z.string()),
  flags: z.array(z.string()),
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
});
