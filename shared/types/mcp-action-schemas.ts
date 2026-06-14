import { z } from 'zod';
import {
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
} from './local-seo.js';

// --- Shared building blocks -------------------------------------------------

const workspaceIdSchema = z.string().min(1, 'workspace_id is required');
const revisionSchema = z.string().trim().min(1, 'expected_revision is required');
const pageTypeSchema = z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']);
const contentRequestStatusSchema = z.enum([
  'pending_payment',
  'requested',
  'brief_generated',
  'client_review',
  'approved',
  'changes_requested',
  'in_progress',
  'post_review',
  'delivered',
  'published',
  'declined',
]);
const postStatusSchema = z.enum(['generating', 'draft', 'review', 'approved', 'error']);
const insightTypeSchema = z.enum([
  'page_health',
  'ranking_opportunity',
  'content_decay',
  'cannibalization',
  'keyword_cluster',
  'competitor_gap',
  'conversion_attribution',
  'ranking_mover',
  'ctr_opportunity',
  'serp_opportunity',
  'strategy_alignment',
  'anomaly_digest',
  'audit_finding',
  'site_health',
  'emerging_keyword',
  'competitor_alert',
  'freshness_alert',
  'milestone_attribution',
]);

const handleIdSchema = z.string().regex(
  /^(keyword-research|keyword-research-bulk|brief-request|brief|post-request|post)_[0-9a-f-]{36}$/,
  'must be a valid handle id of the form `<kind>_<uuid>`',
);

// --- Layout schemas ---------------------------------------------------------

const mediaSlotSchema = z.object({
  type: z.enum(['image', 'video', 'embed']),
  placeholder: z.string().min(1),
});

const outlineSectionSchema = z.object({
  heading: z.object({
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    text: z.string().min(1),
  }),
  description: z.string().optional(),
  bullets: z.array(z.string()).optional(),
  callout: z.enum(['info', 'cta', 'quote']).optional(),
  media: mediaSlotSchema.optional(),
});

export const typedOutlineSchema = z.object({
  sections: z.array(outlineSectionSchema).min(1),
});

export const layoutSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('cms'), collection_id: z.string().min(1) }),
  z.object({ type: z.literal('outline'), structure: typedOutlineSchema }),
]);

// --- Keyword tool input schemas --------------------------------------------

export const researchKeywordsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  terms: z.array(z.string().min(1)).min(1).max(50, 'max 50 terms per call'),
  market: z.string().optional(),
});

export const addKeywordToStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  research_handle: handleIdSchema.optional(),
  term: z.string().min(1).optional(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing_page'), page_url: z.string().url() }),
    z.object({
      kind: z.literal('new_page'),
      topic: z.string().min(1),
      intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']).optional(),
    }),
  ]),
}).refine(
  (data) => data.research_handle != null || data.term != null,
  { message: 'must provide either research_handle or term' },
);

// --- Content tool input schemas --------------------------------------------

export const prepareBriefContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  topic: z.string().min(1),
  target_keyword: z.string().trim().min(1).optional(),
  target_page_path: z.string().trim().min(1).optional(),
  layout: layoutSchema,
});

const briefContentSchema = z.object({
  targetKeyword: z.string().min(1),
  secondaryKeywords: z.array(z.string()),
  suggestedTitle: z.string().min(1),
  suggestedMetaDesc: z.string().min(1),
  outline: z.array(z.object({
    heading: z.string(),
    subheadings: z.array(z.string()).optional(),
    notes: z.string().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    keywords: z.array(z.string()).optional(),
  })),
  wordCountTarget: z.number().int().positive(),
  intent: z.string(),
  audience: z.string(),
  competitorInsights: z.string(),
  internalLinkSuggestions: z.array(z.string()),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']).optional(),
  executiveSummary: z.string().optional(),
}).passthrough();

export const saveBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_request_handle: handleIdSchema,
  content: briefContentSchema,
  parent_request_id: z.string().optional(),
});

export const preparePostContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1),
});

const postContentSchema = z.object({
  briefId: z.string().min(1),
  targetKeyword: z.string().min(1),
  title: z.string().min(1),
  metaDescription: z.string().min(1),
  introduction: z.string(),
  sections: z.array(z.object({
    index: z.number().int().nonnegative(),
    heading: z.string(),
    content: z.string(),
    wordCount: z.number().int().nonnegative(),
    targetWordCount: z.number().int().positive(),
    keywords: z.array(z.string()),
    status: z.enum(['pending', 'generating', 'done', 'error']),
    error: z.string().optional(),
  })),
  conclusion: z.string(),
  totalWordCount: z.number().int().nonnegative(),
  targetWordCount: z.number().int().positive(),
}).passthrough();

export const savePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_request_handle: handleIdSchema,
  content: postContentSchema,
  parent_request_id: z.string().optional(),
});

const briefPatchContentSchema = z.object({
  targetKeyword: z.string().trim().min(1).max(200).optional(),
  secondaryKeywords: z.array(z.string().trim().min(1).max(200)).optional(),
  suggestedTitle: z.string().trim().min(1).max(300).optional(),
  suggestedMetaDesc: z.string().trim().min(1).max(500).optional(),
  outline: z.array(z.object({
    heading: z.string(),
    subheadings: z.array(z.string()).optional(),
    notes: z.string().optional(),
    wordCount: z.number().int().nonnegative().optional(),
    keywords: z.array(z.string()).optional(),
  })).optional(),
  wordCountTarget: z.number().int().min(100).max(10000).optional(),
  intent: z.string().trim().min(1).max(100).optional(),
  audience: z.string().trim().min(1).max(1000).optional(),
  competitorInsights: z.string().trim().max(10000).optional(),
  internalLinkSuggestions: z.array(z.string().trim().min(1).max(500)).optional(),
  pageType: z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource']).optional(),
  executiveSummary: z.string().trim().max(5000).optional(),
}).strict().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one editable field required' },
);

const postPatchSectionSchema = z.object({
  index: z.number().int().nonnegative(),
  heading: z.string().optional(),
  content: z.string().optional(),
  targetWordCount: z.number().int().positive().optional(),
  keywords: z.array(z.string()).optional(),
});

const postPatchContentSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
  metaDescription: z.string().trim().min(1).max(500).optional(),
  introduction: z.string().optional(),
  sections: z.array(postPatchSectionSchema).optional(),
  conclusion: z.string().optional(),
  seoTitle: z.string().trim().min(1).max(200).optional(),
  seoMetaDescription: z.string().trim().min(1).max(500).optional(),
}).strict().refine(
  (body) => Object.values(body).some((value) => value !== undefined),
  { message: 'At least one editable field required' },
);

const postReplaceContentSchema = z.object({
  title: z.string().trim().min(1).max(500),
  metaDescription: z.string().trim().min(1).max(500),
  introduction: z.string(),
  sections: z.array(z.object({
    index: z.number().int().nonnegative(),
    heading: z.string(),
    content: z.string(),
    wordCount: z.number().int().nonnegative(),
    targetWordCount: z.number().int().positive(),
    keywords: z.array(z.string()),
    status: z.enum(['pending', 'generating', 'done', 'error']),
    error: z.string().optional(),
  })).min(1),
  conclusion: z.string(),
  seoTitle: z.string().trim().min(1).max(200).optional(),
  seoMetaDescription: z.string().trim().min(1).max(500).optional(),
}).strict();

export const listBriefsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  limit: z.number().int().positive().max(200).optional(),
  status: contentRequestStatusSchema.optional(),
  page_type: pageTypeSchema.optional(),
});

export const getBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1),
});

export const updateBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1),
  expected_revision: revisionSchema,
  mode: z.enum(['patch', 'replace']),
  updates: briefPatchContentSchema.optional(),
  content: briefContentSchema.optional(),
}).strict().superRefine((data, ctx) => {
  if (data.mode === 'patch') {
    if (!data.updates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updates'],
        message: 'updates is required when mode is patch',
      });
    }
    if (data.content !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is not allowed when mode is patch',
      });
    }
  }
  if (data.mode === 'replace') {
    if (!data.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required when mode is replace',
      });
    }
    if (data.updates !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updates'],
        message: 'updates is not allowed when mode is replace',
      });
    }
  }
});

export const listPostsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  limit: z.number().int().positive().max(200).optional(),
  status: postStatusSchema.optional(),
  page_type: pageTypeSchema.optional(),
});

export const getPostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1),
});

export const updatePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1),
  expected_revision: revisionSchema,
  mode: z.enum(['patch', 'replace']),
  updates: postPatchContentSchema.optional(),
  content: postReplaceContentSchema.optional(),
}).strict().superRefine((data, ctx) => {
  if (data.mode === 'patch') {
    if (!data.updates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updates'],
        message: 'updates is required when mode is patch',
      });
    }
    if (data.content !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is not allowed when mode is patch',
      });
    }
  }
  if (data.mode === 'replace') {
    if (!data.content) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['content'],
        message: 'content is required when mode is replace',
      });
    }
    if (data.updates !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['updates'],
        message: 'updates is not allowed when mode is replace',
      });
    }
  }
});

export const sendToClientInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_handle: handleIdSchema.optional(),
  post_handle: handleIdSchema.optional(),
  brief_id: z.string().min(1).optional(),
  post_id: z.string().min(1).optional(),
  note: z.string().optional(),
}).refine(
  (data) => [data.brief_handle, data.post_handle, data.brief_id, data.post_id].filter(Boolean).length === 1,
  { message: 'must provide exactly one target: brief_handle, post_handle, brief_id, or post_id' },
);

export const listContentRequestsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  limit: z.number().int().positive().max(200).optional(),
});

export const getContentRequestInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  request_id: z.string().min(1),
});

export const createContentRequestInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  topic: z.string().trim().min(1).max(500),
  target_keyword: z.string().trim().min(1).max(200),
  intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']).optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  rationale: z.string().trim().max(5000).optional(),
  client_note: z.string().trim().max(5000).optional(),
  source: z.enum(['strategy', 'client']).optional(),
  service_type: z.enum(['brief_only', 'full_post']).optional(),
  page_type: pageTypeSchema.optional(),
  initial_status: z.enum(['pending_payment', 'requested', 'brief_generated', 'in_progress']).optional(),
  target_page_id: z.string().trim().min(1).max(200).optional(),
  target_page_slug: z.string().trim().min(1).max(200).optional(),
  dedupe: z.boolean().optional(),
}).strict();

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  webflow_site_id: z.string().trim().min(1).max(200).optional(),
  webflow_site_name: z.string().trim().min(1).max(200).optional(),
}).strict();

const businessProfileContactSchema = z.object({
  phone: z.string().max(30).optional(),
  email: z.string().email().optional(),
  address: z.object({
    street: z.string().max(200).optional(),
    city: z.string().max(100).optional(),
    state: z.string().max(100).optional(),
    zip: z.string().max(20).optional(),
    country: z.string().max(100).optional(),
  }).optional(),
  socialProfiles: z.array(z.string().url()).max(10).optional(),
  openingHours: z.string().max(500).optional(),
  foundedDate: z.string().max(20).optional(),
  numberOfEmployees: z.string().max(50).optional(),
}).strict();

const intelligenceProfileSchema = z.object({
  industry: z.string().max(200).optional(),
  goals: z.array(z.string().max(500)).max(20).optional(),
  targetAudience: z.string().max(2000).optional(),
}).strict();

const publishTargetSchema = z.object({
  collectionId: z.string().min(1),
  collectionName: z.string().min(1),
  fieldMap: z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    body: z.string().min(1),
    metaTitle: z.string().optional(),
    metaDescription: z.string().optional(),
    summary: z.string().optional(),
    featuredImage: z.string().optional(),
    author: z.string().optional(),
    publishDate: z.string().optional(),
    category: z.string().optional(),
  }).strict(),
}).strict();

export const updateWorkspaceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  updates: z.object({
    name: z.string().trim().min(1).max(200).optional(),
    webflow_site_id: z.string().trim().min(1).max(200).optional(),
    webflow_site_name: z.string().trim().min(1).max(200).optional(),
    live_domain: z.string().trim().max(500).optional(),
    gsc_property_url: z.string().trim().max(500).optional(),
    ga4_property_id: z.string().trim().max(200).optional(),
    client_email: z.string().email().optional(),
    tier: z.enum(['free', 'growth', 'premium']).optional(),
    trial_ends_at: z.string().trim().refine(
      (value) => !Number.isNaN(Date.parse(value)),
      { message: 'trial_ends_at must be a valid date/datetime string' },
    ).optional(),
    client_portal_enabled: z.boolean().optional(),
    seo_client_view: z.boolean().optional(),
    analytics_client_view: z.boolean().optional(),
    site_intelligence_client_view: z.boolean().optional(),
    onboarding_enabled: z.boolean().optional(),
    onboarding_completed: z.boolean().optional(),
    publish_target: publishTargetSchema.optional(),
    seo_data_provider: z.literal('dataforseo').optional(),
    business_profile: businessProfileContactSchema.nullable().optional(),
    intelligence_profile: intelligenceProfileSchema.optional(),
  }).strict().refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    { message: 'At least one update field is required' },
  ),
}).strict();

export const deleteWorkspaceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  confirm: z.literal('delete_workspace'),
}).strict();

export const getContentPerformanceInputSchema = z.object({
  workspaceId: z.string().min(1),
});

export const deleteBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1),
}).strict();

export const deletePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1),
}).strict();

export const listPostVersionsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1),
  limit: z.number().int().positive().max(200).optional(),
}).strict();

export const revertPostVersionInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1),
  version_id: z.string().min(1),
}).strict();

export const getUnresolvedInsightsInputSchema = z.object({
  workspaceId: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
});

export const getInsightsInputSchema = z.object({
  workspaceId: z.string().min(1),
  type: insightTypeSchema.optional(),
  domain: z.enum(['search', 'traffic', 'cross']).optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export const getAnomaliesInputSchema = z.object({
  workspaceId: z.string().min(1),
  resolved: z.boolean().optional(),
});

export const getWorkspaceIntelligenceInputSchema = z.object({
  workspaceId: z.string().min(1),
  slices: z.array(z.string()).optional(),
  pagePath: z.string().optional(),
  siteId: z.string().optional(),
  siteBaseUrl: z.string().optional(),
  enrich_with_backlinks: z.boolean().optional(),
  resolve_entity_references: z.boolean().optional(),
  include_site_inventory: z.boolean().optional(),
});

// --- Job tool input schemas -------------------------------------------------

export const startKeywordStrategyGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  options: z.object({
    mode: z.enum(['full', 'incremental']).optional(),
    seoDataProvider: z.literal('dataforseo').optional(),
    competitorDomains: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().optional(),
  }).optional(),
});

export const startSeoAuditInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  site_id: z.string().min(1, 'site_id (Webflow site) is required'),
  options: z.object({
    skip_link_check: z.boolean().optional(),
  }).optional(),
});

export const startLocalSeoRefreshInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  refresh_body: z.object({
    marketIds: z.array(z.string().min(1)).max(3).optional(),
    keywords: z.array(z.string().min(1).max(200)).max(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP).optional(),
    device: z.enum([LOCAL_SEO_DEVICE.DESKTOP, LOCAL_SEO_DEVICE.MOBILE]).optional(),
    languageCode: z.string().min(2).max(8).optional(),
  }).strict(),
});

export const getJobStatusInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  job_id: z.string().min(1),
});

export const listJobsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  status: z.enum(['pending', 'running', 'done', 'error', 'cancelled']).optional(),
  limit: z.number().int().positive().max(200).optional(),
});

export const cancelJobInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  job_id: z.string().min(1),
});

const pageKeywordEntrySchema = z.object({
  pagePath: z.string().min(1),
  pageTitle: z.string().min(1),
  primaryKeyword: z.string().min(1),
  secondaryKeywords: z.array(z.string().min(1)),
  searchIntent: z.string().optional(),
  volume: z.number().nonnegative().optional(),
  difficulty: z.number().nonnegative().optional(),
  cpc: z.number().nonnegative().optional(),
  metricsSource: z.string().optional(),
  validated: z.boolean().optional(),
}).passthrough();

export const getKeywordStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  lite: z.boolean().optional(),
});

export const removePageKeywordInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  page_path: z.string().min(1),
});

export const addKeywordsBatchInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  entries: z.array(pageKeywordEntrySchema).min(1).max(500),
});

export const replaceKeywordStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  entries: z.array(pageKeywordEntrySchema).max(500),
});

// --- Type exports -----------------------------------------------------------

export type ResearchKeywordsInput = z.infer<typeof researchKeywordsInputSchema>;
export type AddKeywordToStrategyInput = z.infer<typeof addKeywordToStrategyInputSchema>;
export type PrepareBriefContextInput = z.infer<typeof prepareBriefContextInputSchema>;
export type SaveBriefInput = z.infer<typeof saveBriefInputSchema>;
export type PreparePostContextInput = z.infer<typeof preparePostContextInputSchema>;
export type SavePostInput = z.infer<typeof savePostInputSchema>;
export type ListBriefsInput = z.infer<typeof listBriefsInputSchema>;
export type GetBriefInput = z.infer<typeof getBriefInputSchema>;
export type UpdateBriefInput = z.infer<typeof updateBriefInputSchema>;
export type ListPostsInput = z.infer<typeof listPostsInputSchema>;
export type GetPostInput = z.infer<typeof getPostInputSchema>;
export type UpdatePostInput = z.infer<typeof updatePostInputSchema>;
export type SendToClientInput = z.infer<typeof sendToClientInputSchema>;
export type ListContentRequestsInput = z.infer<typeof listContentRequestsInputSchema>;
export type GetContentRequestInput = z.infer<typeof getContentRequestInputSchema>;
export type CreateContentRequestInput = z.infer<typeof createContentRequestInputSchema>;
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;
export type DeleteWorkspaceInput = z.infer<typeof deleteWorkspaceInputSchema>;
export type GetContentPerformanceInput = z.infer<typeof getContentPerformanceInputSchema>;
export type DeleteBriefInput = z.infer<typeof deleteBriefInputSchema>;
export type DeletePostInput = z.infer<typeof deletePostInputSchema>;
export type ListPostVersionsInput = z.infer<typeof listPostVersionsInputSchema>;
export type RevertPostVersionInput = z.infer<typeof revertPostVersionInputSchema>;
export type GetUnresolvedInsightsInput = z.infer<typeof getUnresolvedInsightsInputSchema>;
export type GetInsightsInput = z.infer<typeof getInsightsInputSchema>;
export type GetAnomaliesInput = z.infer<typeof getAnomaliesInputSchema>;
export type GetWorkspaceIntelligenceInput = z.infer<typeof getWorkspaceIntelligenceInputSchema>;
export type StartKeywordStrategyGenerationInput = z.infer<typeof startKeywordStrategyGenerationInputSchema>;
export type StartSeoAuditInput = z.infer<typeof startSeoAuditInputSchema>;
export type StartLocalSeoRefreshInput = z.infer<typeof startLocalSeoRefreshInputSchema>;
export type GetJobStatusInput = z.infer<typeof getJobStatusInputSchema>;
export type ListJobsInput = z.infer<typeof listJobsInputSchema>;
export type CancelJobInput = z.infer<typeof cancelJobInputSchema>;
export type GetKeywordStrategyInput = z.infer<typeof getKeywordStrategyInputSchema>;
export type RemovePageKeywordInput = z.infer<typeof removePageKeywordInputSchema>;
export type AddKeywordsBatchInput = z.infer<typeof addKeywordsBatchInputSchema>;
export type ReplaceKeywordStrategyInput = z.infer<typeof replaceKeywordStrategyInputSchema>;
