/**
 * The Issue (Client) P0 — AI lead-value enrich (the single AI operation for P0).
 *
 * Produces a low-confidence per-workspace lead/customer-value estimate used ONLY as the
 * `basis: 'ai_enriched'` fallback when neither a client_provided nor an agency_estimate value exists.
 * The estimate is advisory: this function never persists it (the admin confirms via the standard
 * workspace PATCH). `basis` is stamped in code, never by the model. On AI error or schema-validation
 * failure it returns null (FM-2 honest degradation) so nothing fabricated reaches the workspace.
 */
import { z } from 'zod';
import { callAI } from './ai.js';
import { parseAIJson } from './openai-helpers.js';
import { createLogger } from './logger.js';

const log = createLogger('the-issue-lead-value-ai');

/** Shape the model is asked for. `basis`/`currency` are stamped by us, not the model. */
const leadValueEnrichSchema = z.object({
  valuePerOutcome: z.number().positive(),
  unitLabel: z.string().min(1),
});

export interface EnrichLeadValueInput {
  workspaceId: string;
  industry?: string;
  currency?: string;
}

export interface EnrichedLeadValue {
  valuePerOutcome: number;
  unitLabel: string;
  currency: string;
  basis: 'ai_enriched';
}

const SYSTEM = `You estimate the dollar value of a single converted outcome (one new customer/lead/booking) for a business, for use as a clearly-labeled low-confidence estimate. Return ONLY a JSON object: { "valuePerOutcome": number, "unitLabel": string }. valuePerOutcome is the typical dollar value of ONE converted outcome for the industry. unitLabel is the human noun for one outcome (e.g. "new patient", "qualified lead", "booking"). No prose, no markdown fences.`;

export async function enrichLeadValue(input: EnrichLeadValueInput): Promise<EnrichedLeadValue | null> {
  const currency = input.currency ?? 'USD';
  const industry = (input.industry ?? '').trim();
  const prompt = `Industry / business context: ${industry || 'unknown'}\nCurrency: ${currency}\nEstimate the value of one converted outcome.`;

  let raw: string;
  try {
    const result = await callAI({
      operation: 'the-issue-lead-value-enrich',
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 200,
      workspaceId: input.workspaceId,
    });
    raw = result.text || '{}';
  } catch (err) {
    log.warn({ err, workspaceId: input.workspaceId }, 'enrichLeadValue: AI call failed — returning null (honest degradation)');
    return null;
  }

  let parsedJson: unknown;
  try {
    parsedJson = parseAIJson(raw);
  } catch (err) {
    log.warn({ err, workspaceId: input.workspaceId }, 'enrichLeadValue: failed to parse AI JSON — returning null');
    return null;
  }

  const parsed = leadValueEnrichSchema.safeParse(parsedJson);
  if (!parsed.success) {
    log.warn({ workspaceId: input.workspaceId, issues: parsed.error.issues.slice(0, 3) }, 'enrichLeadValue: schema validation failed — returning null');
    return null;
  }

  // basis + currency stamped in code, never by the model.
  return {
    valuePerOutcome: parsed.data.valuePerOutcome,
    unitLabel: parsed.data.unitLabel,
    currency,
    basis: 'ai_enriched',
  };
}
