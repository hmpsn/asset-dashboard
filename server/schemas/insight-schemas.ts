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
export const anomalyDigestDataSchema = z.object({
  anomalyId: z.string(),
  anomalyType: z.string(),
  metric: z.string(),
  currentValue: z.number(),
  expectedValue: z.number(),
  direction: z.enum(['spike', 'drop']),
  detectedAt: z.string(),
  description: z.string().optional(),
});
