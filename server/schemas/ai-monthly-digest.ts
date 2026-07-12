import { z } from 'zod';

import { parseStructuredAIOutput } from '../ai-structured-output.js';

export const MONTHLY_DIGEST_CLAUSE_IDS = {
  REPORTING_SCOPE: 'reporting.scope',
  SEARCH_CLICKS: 'metric.search.clicks',
  SEARCH_IMPRESSIONS: 'metric.search.impressions',
  SEARCH_POSITION: 'metric.search.position',
  ANALYTICS_SESSIONS: 'metric.analytics.sessions',
  ANALYTICS_AVAILABLE: 'provider.analytics.available',
  WORK_ACTIVITY: 'work.activity',
  ATTENTION_SIGNALS: 'attention.signals',
  ROI_MEASURED_RESULTS: 'roi.measured-results',
} as const;

export type MonthlyDigestClauseId = typeof MONTHLY_DIGEST_CLAUSE_IDS[keyof typeof MONTHLY_DIGEST_CLAUSE_IDS];

const monthlyDigestClauseIdSchema = z.enum([
  MONTHLY_DIGEST_CLAUSE_IDS.REPORTING_SCOPE,
  MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_CLICKS,
  MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_IMPRESSIONS,
  MONTHLY_DIGEST_CLAUSE_IDS.SEARCH_POSITION,
  MONTHLY_DIGEST_CLAUSE_IDS.ANALYTICS_SESSIONS,
  MONTHLY_DIGEST_CLAUSE_IDS.ANALYTICS_AVAILABLE,
  MONTHLY_DIGEST_CLAUSE_IDS.WORK_ACTIVITY,
  MONTHLY_DIGEST_CLAUSE_IDS.ATTENTION_SIGNALS,
  MONTHLY_DIGEST_CLAUSE_IDS.ROI_MEASURED_RESULTS,
]);

export function parseMonthlyDigestClauseSelection(
  raw: string,
  availableClauseIds: readonly MonthlyDigestClauseId[],
): MonthlyDigestClauseId[] {
  const available = new Set(availableClauseIds);
  const schema = z.object({
    clauseIds: z.array(monthlyDigestClauseIdSchema).min(2).max(3),
  }).strict().superRefine(({ clauseIds }, ctx) => {
    const seen = new Set<MonthlyDigestClauseId>();
    for (const [index, clauseId] of clauseIds.entries()) {
      if (seen.has(clauseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate clause ID: ${clauseId}`,
          path: ['clauseIds', index],
        });
      }
      seen.add(clauseId);

      if (!available.has(clauseId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Unavailable clause ID: ${clauseId}`,
          path: ['clauseIds', index],
        });
      }
    }
  });

  return parseStructuredAIOutput(
    raw,
    schema,
    'monthly-digest-clause-selection',
  ).clauseIds;
}
