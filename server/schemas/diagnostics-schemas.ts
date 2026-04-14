import { z } from '../middleware/validate.js';

export const rootCauseSchema = z.object({
  rank: z.number().int().min(1),
  title: z.string(),
  confidence: z.enum(['high', 'medium', 'low']),
  explanation: z.string(),
  evidence: z.array(z.string()),
});

export const remediationActionSchema = z.object({
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  title: z.string(),
  description: z.string(),
  effort: z.enum(['low', 'medium', 'high']),
  impact: z.enum(['high', 'medium', 'low']),
  owner: z.enum(['dev', 'content', 'seo']),
  pageUrls: z.array(z.string()).optional(),
});

export type RootCauseSchema = z.infer<typeof rootCauseSchema>;
export type RemediationActionSchema = z.infer<typeof remediationActionSchema>;
