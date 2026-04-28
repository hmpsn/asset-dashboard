/**
 * Zod schemas for public-content route request bodies.
 * Used by server/routes/public-content.ts validate() middleware.
 */
import { z } from '../middleware/validate.js';

// Shared enum values mirroring what the handlers accept
const priorityEnum = z.enum(['low', 'medium', 'high', 'critical']);
const serviceTypeEnum = z.enum(['brief_only', 'full_post']);
const pageTypeEnum = z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']);

// POST /api/public/content-request/:workspaceId
export const createContentRequestSchema = z.object({
  topic: z.string().min(1, 'topic is required').max(200),
  targetKeyword: z.string().min(1, 'targetKeyword is required').max(200),
  intent: z.string().max(50).optional().or(z.literal('')),
  priority: priorityEnum.optional().default('medium'),
  rationale: z.string().max(1000).optional().or(z.literal('')),
  clientNote: z.string().max(1000).optional().or(z.literal('')),
  serviceType: serviceTypeEnum.optional().default('brief_only'),
  pageType: pageTypeEnum.optional().default('blog'),
  initialStatus: z.literal('pending_payment').optional(),
  targetPageId: z.string().max(100).optional().or(z.literal('')),
  targetPageSlug: z.string().max(200).optional().or(z.literal('')),
});

// POST /api/public/content-request/:workspaceId/submit
export const submitContentRequestSchema = z.object({
  topic: z.string().min(1, 'topic is required').max(200),
  targetKeyword: z.string().min(1, 'targetKeyword is required').max(200),
  notes: z.string().max(1000).optional().or(z.literal('')),
  serviceType: serviceTypeEnum.optional().default('brief_only'),
  pageType: pageTypeEnum.optional().default('blog'),
  initialStatus: z.literal('pending_payment').optional(),
  targetPageId: z.string().max(100).optional().or(z.literal('')),
  targetPageSlug: z.string().max(200).optional().or(z.literal('')),
});

// POST /api/public/content-request/:workspaceId/:id/decline
export const declineContentRequestSchema = z.object({
  reason: z.string().max(1000).optional().or(z.literal('')),
});

// POST /api/public/content-request/:workspaceId/:id/request-changes
export const requestChangesSchema = z.object({
  feedback: z.string().max(2000).optional().or(z.literal('')),
});

// POST /api/public/content-request/:workspaceId/:id/comment
// Note: 'author' is intentionally absent — the handler hardcodes 'client' regardless of input
// (unauthenticated public endpoint). Keeping 'author' in the schema would imply 'team' is accepted.
export const addCommentSchema = z.object({
  content: z.string().min(1, 'content is required').max(2000),
});

// POST /api/public/content-request/:workspaceId/from-audit
export const fromAuditSchema = z.object({
  pageSlug: z.string().min(1, 'pageSlug is required').max(200),
  pageName: z.string().min(1, 'pageName is required').max(200),
  issues: z.array(z.string().max(300)).max(50).optional().default([]),
  wordCount: z.number().optional(),
});

// POST /api/public/content-request/:workspaceId/:id/approve
export const approveContentRequestSchema = z.object({});

// POST /api/public/content-request/:workspaceId/:id/upgrade
export const upgradeContentRequestSchema = z.object({});

// POST /api/public/tracked-keywords/:workspaceId
export const addTrackedKeywordSchema = z.object({
  keyword: z.string().min(2, 'Keyword must be at least 2 characters').max(120),
});

// DELETE /api/public/tracked-keywords/:workspaceId
export const removeTrackedKeywordSchema = z.object({
  keyword: z.string().min(1, 'Keyword required'),
}).strict();

// POST /api/public/content-request/:workspaceId/:id/approve-post
export const approvePostSchema = z.object({}).strict();

// POST /api/public/content-request/:workspaceId/:id/request-post-changes
export const requestPostChangesSchema = z.object({
  feedback: z.string().min(1).max(2000),
}).strict();

// PATCH /api/public/content-posts/:workspaceId/:postId/client-edit
// IMPORTANT: only include client-editable fields. Do NOT include targetWordCount,
// keywords, or status — those are admin/AI fields. The route merges these client
// updates with the existing section data (preserving required DB fields) so that
// parseJsonSafeArray(postSectionSchema) does not silently drop sections on read-back.
export const clientPostEditSchema = z.object({
  title: z.string().max(500).optional(),
  metaDescription: z.string().max(500).optional(),
  introduction: z.string().max(20000).optional(),
  sections: z.array(z.object({
    index: z.number(),
    heading: z.string().max(500),
    content: z.string().max(100000),
    wordCount: z.number(),
    // targetWordCount, keywords, status intentionally omitted — merged from DB by route
  })).optional(),
  conclusion: z.string().max(20000).optional(),
}).strict();
