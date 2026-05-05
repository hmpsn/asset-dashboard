import { z } from '../middleware/validate.js';

export const seoBulkAcceptFixSchema = z.object({
  pageId: z.string().min(1),
  check: z.string().min(1),
  suggestedFix: z.string().min(1),
  message: z.string().optional(),
  pageSlug: z.string().optional(),
  pageName: z.string().optional(),
});

export const seoBulkRewritePageSchema = z.object({
  pageId: z.string().min(1),
  title: z.string(),
  slug: z.string().optional(),
  publishedPath: z.string().nullable().optional(),
  currentSeoTitle: z.string().optional(),
  currentDescription: z.string().optional(),
});

export const seoBulkAnalyzePageSchema = z.object({
  pageId: z.string().min(1),
  title: z.string(),
  slug: z.string().optional(),
  publishedPath: z.string().nullable().optional(),
  seoTitle: z.string().optional(),
  seoDescription: z.string().optional(),
});

export type SeoBulkAcceptFix = z.infer<typeof seoBulkAcceptFixSchema>;
export type SeoBulkAnalyzePage = z.infer<typeof seoBulkAnalyzePageSchema>;
export type SeoBulkRewritePage = z.infer<typeof seoBulkRewritePageSchema>;
export type SeoBulkRewriteField = 'title' | 'description' | 'both';
