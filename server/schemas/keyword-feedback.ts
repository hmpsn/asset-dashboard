import { z } from '../middleware/validate.js';

export const keywordFeedbackSourceSchema = z.enum([
  'content_gap',
  'page_map',
  'opportunity',
  'topic_cluster',
  'keyword_gap',
]);

export const keywordFeedbackSchema = z.object({
  keyword: z.string().trim().min(1, 'keyword required').max(200),
  status: z.enum(['approved', 'declined', 'requested']),
  reason: z.string().max(1000).optional().or(z.literal('')),
  source: keywordFeedbackSourceSchema.optional().default('content_gap'),
}).strict();

export const adminKeywordFeedbackSchema = keywordFeedbackSchema.extend({
  declinedBy: z.string().max(320).optional().or(z.literal('')),
}).strict();

export const bulkKeywordFeedbackSchema = z.object({
  keywords: z.array(keywordFeedbackSchema).min(1, 'keywords array required').max(100),
}).strict();

export const adminBulkKeywordFeedbackSchema = bulkKeywordFeedbackSchema.extend({
  declinedBy: z.string().max(320).optional().or(z.literal('')),
}).strict();

export const contentGapVoteSchema = z.object({
  keyword: z.string().trim().min(1, 'keyword required').max(200),
  vote: z.enum(['up', 'down', 'none']),
}).strict();

export type KeywordFeedbackBody = z.infer<typeof keywordFeedbackSchema>;
export type AdminKeywordFeedbackBody = z.infer<typeof adminKeywordFeedbackSchema>;
export type BulkKeywordFeedbackBody = z.infer<typeof bulkKeywordFeedbackSchema>;
export type AdminBulkKeywordFeedbackBody = z.infer<typeof adminBulkKeywordFeedbackSchema>;
export type ContentGapVoteBody = z.infer<typeof contentGapVoteSchema>;
