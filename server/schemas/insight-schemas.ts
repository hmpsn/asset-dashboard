// server/schemas/insight-schemas.ts
// Zod schemas for analytics insight data JSON columns

import { z } from '../middleware/validate.js';

// --- AuditFindingData (InsightDataMap['audit_finding']) ---
export const auditFindingDataSchema = z.object({
  scope: z.enum(['page', 'site']),
  issueCount: z.number(),
  issueMessages: z.string(),
  siteScore: z.number().optional(),
  source: z.string(),
});

// --- AnomalyDigestData (InsightDataMap['anomaly_digest']) ---
// Cross-referenced against shared/types/analytics.ts:331-340
export const anomalyDigestDataSchema = z.object({
  anomalyType: z.string(),
  metric: z.string(),
  currentValue: z.number(),
  expectedValue: z.number(),
  deviationPercent: z.number(),
  durationDays: z.number(),
  firstDetected: z.string(),
  severity: z.string(),
});
