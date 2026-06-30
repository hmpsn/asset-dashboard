import { z } from 'zod';
import {
  LOCAL_SEO_DEVICE,
  LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP,
} from './local-seo.js';

// --- Shared building blocks -------------------------------------------------

const workspaceIdSchema = z.string().min(1, 'workspace_id is required')
  .describe('The workspace (client) ID this operation targets. Get IDs from list_workspaces.');
const revisionSchema = z.string().trim().min(1, 'expected_revision is required')
  .describe('Optimistic-concurrency token from the matching get_brief/get_post call. The write is rejected with a conflict if the stored record changed since you read it — re-fetch and retry.');
const pageTypeSchema = z.enum(['blog', 'landing', 'service', 'location', 'product', 'pillar', 'resource'])
  .describe('Page type: one of blog, landing, service, location, product, pillar, resource.');
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
]).describe('Content request lifecycle status: pending_payment, requested, brief_generated, client_review, approved, changes_requested, in_progress, post_review, delivered, published, or declined.');
const postStatusSchema = z.enum(['generating', 'draft', 'review', 'approved', 'error'])
  .describe('Post lifecycle status: generating, draft, review, approved, or error.');
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
]).describe('Insight category to filter by, e.g. page_health, ranking_opportunity, content_decay, cannibalization, keyword_cluster, competitor_gap, ctr_opportunity, anomaly_digest, audit_finding, or site_health.');

const handleIdSchema = z.string().regex(
  /^(keyword-research|keyword-research-bulk|brief-request|brief|post-request|post)_[0-9a-f-]{36}$/,
  'must be a valid handle id of the form `<kind>_<uuid>`',
).describe('A short-lived handle of the form `<kind>_<uuid>` issued by a prepare_*/research call (e.g. prepare_brief_context, prepare_post_context, research_keywords). Pass it to the matching save/mutation tool.');

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
  terms: z.array(z.string().min(1)).min(1).max(50, 'max 50 terms per call')
    .describe('[Paid API] Seed keyword terms to research (1-50 per call). Each call hits paid SEO providers and returns reusable research handles.'),
  market: z.string().optional()
    .describe('Optional market/locale for metrics (e.g. a country or location code). Defaults to the workspace primary market when omitted.'),
});

export const addKeywordToStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  research_handle: handleIdSchema.optional()
    .describe('Optional handle from a prior research_keywords call to attach researched metrics to this keyword. Provide either research_handle OR term.'),
  term: z.string().min(1).optional()
    .describe('The keyword phrase to target, used when no research_handle is supplied. Provide either research_handle OR term.'),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('existing_page'), page_url: z.string().url() }),
    z.object({
      kind: z.literal('new_page'),
      topic: z.string().min(1),
      intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']).optional(),
    }),
  ]).describe("Where this keyword is assigned. Discriminated by `kind`: `existing_page` requires `page_url` (the live page to target); `new_page` requires `topic` (the planned page subject) and accepts an optional `intent` of informational/commercial/transactional/navigational."),
}).refine(
  (data) => data.research_handle != null || data.term != null,
  { message: 'must provide either research_handle or term' },
);

// --- Content tool input schemas --------------------------------------------

export const prepareBriefContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  topic: z.string().min(1)
    .describe('The subject/topic of the brief to write context for.'),
  target_keyword: z.string().trim().min(1).optional()
    .describe('Optional primary keyword the brief should target.'),
  target_page_path: z.string().trim().min(1).optional()
    .describe('Optional path of an existing page this brief is for (e.g. /blog/my-post).'),
  layout: layoutSchema
    .describe("Output layout, discriminated by `type`: `cms` (requires `collection_id` for a Webflow CMS collection) or `outline` (requires a typed `structure` of heading sections)."),
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
  brief_request_handle: handleIdSchema
    .describe('The brief-request handle returned by prepare_brief_context. Persists the brief against that prepared context.'),
  content: briefContentSchema
    .describe('The full brief content payload — build it from the structured context returned by prepare_brief_context (targetKeyword, suggestedTitle, outline, wordCountTarget, intent, audience, etc.).'),
  parent_request_id: z.string().optional()
    .describe('Optional id of an existing content request this brief fulfills (links the brief to the request pipeline).'),
});

export const preparePostContextInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1)
    .describe('The id of the saved brief to draft a post from. Returns structured drafting context plus a handle for save_post.'),
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
  post_request_handle: handleIdSchema
    .describe('The post-request handle returned by prepare_post_context. Persists the generated post against that prepared context.'),
  content: postContentSchema
    .describe('The full generated post payload — build it from the structured context returned by prepare_post_context (briefId, title, metaDescription, introduction, sections, conclusion, word counts).'),
  parent_request_id: z.string().optional()
    .describe('Optional id of an existing content request this post fulfills (links the post to the request pipeline).'),
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
  limit: z.number().int().positive().max(200).optional()
    .describe('Optional max number of briefs to return (1-200).'),
  status: contentRequestStatusSchema.optional()
    .describe('Optional filter to briefs at a specific content request lifecycle status.'),
  page_type: pageTypeSchema.optional()
    .describe('Optional filter to briefs of a specific page type (blog, landing, service, location, product, pillar, resource).'),
});

export const getBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1)
    .describe('The id of the brief to fetch. The response includes a revision token for safe optimistic write-back via update_brief.'),
});

export const updateBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1)
    .describe('The id of the brief to update.'),
  expected_revision: revisionSchema,
  mode: z.enum(['patch', 'replace'])
    .describe("Update mode: `patch` merges only the fields in `updates` into the existing brief (requires `updates`, forbids `content`); `replace` overwrites the whole brief with `content` (requires `content`, forbids `updates`)."),
  updates: briefPatchContentSchema.optional()
    .describe('Partial brief fields to merge when mode is `patch`. At least one editable field must be present.'),
  content: briefContentSchema.optional()
    .describe('The full replacement brief payload when mode is `replace`.'),
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
  limit: z.number().int().positive().max(200).optional()
    .describe('Optional max number of posts to return (1-200).'),
  status: postStatusSchema.optional()
    .describe('Optional filter to posts at a specific lifecycle status (generating, draft, review, approved, error).'),
  page_type: pageTypeSchema.optional()
    .describe('Optional filter to posts of a specific page type (blog, landing, service, location, product, pillar, resource).'),
});

export const getPostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe('The id of the post to fetch. The response includes a revision token for safe optimistic write-back via update_post.'),
});

export const updatePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe('The id of the post to update.'),
  expected_revision: revisionSchema,
  mode: z.enum(['patch', 'replace'])
    .describe("Update mode: `patch` merges only the fields in `updates` into the existing post (requires `updates`, forbids `content`); `replace` overwrites the whole post with `content` (requires `content`, forbids `updates`)."),
  updates: postPatchContentSchema.optional()
    .describe('Partial post fields to merge when mode is `patch`. At least one editable field must be present.'),
  content: postReplaceContentSchema.optional()
    .describe('The full replacement post payload when mode is `replace`.'),
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
  brief_handle: handleIdSchema.optional()
    .describe('Target a brief by its save_brief handle. Provide EXACTLY ONE of brief_handle, post_handle, brief_id, or post_id.'),
  post_handle: handleIdSchema.optional()
    .describe('Target a post by its save_post handle. Provide EXACTLY ONE of brief_handle, post_handle, brief_id, or post_id.'),
  brief_id: z.string().min(1).optional()
    .describe('Target an already-saved brief by id. Provide EXACTLY ONE of brief_handle, post_handle, brief_id, or post_id.'),
  post_id: z.string().min(1).optional()
    .describe('Target an already-saved post by id. Provide EXACTLY ONE of brief_handle, post_handle, brief_id, or post_id.'),
  note: z.string().optional()
    .describe('Optional note to the client included with the content request.'),
}).refine(
  (data) => [data.brief_handle, data.post_handle, data.brief_id, data.post_id].filter(Boolean).length === 1,
  { message: 'must provide exactly one target: brief_handle, post_handle, brief_id, or post_id' },
);

export const listContentRequestsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  limit: z.number().int().positive().max(200).optional()
    .describe('Optional max number of content topic requests to return (1-200).'),
});

export const getContentRequestInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  request_id: z.string().min(1)
    .describe('The id of the content topic request to fetch.'),
});

export const advanceContentStatusInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  request_id: z.string().min(1)
    .describe('The content request id (from list_content_requests / get_content_request).'),
  status: z.enum(['in_progress', 'delivered'])
    .describe("Operator-workflow status to advance the request to: 'in_progress' (production started) or 'delivered' (delivered to the client). Only these two operator states are settable via MCP — client-review states (client_review / post_review) go through send_to_client (which notifies the client), client decisions (approved / changes_requested) are made by the client in their portal, and publishing is a separate publish_post call."),
  internal_note: z.string().max(2000).optional()
    .describe('Optional internal note recorded on the request (not shown to the client).'),
});
export type AdvanceContentStatusInput = z.infer<typeof advanceContentStatusInputSchema>;

export const publishPostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe("The id of the post to publish to the live Webflow site (from list_posts / get_post). The post must be status 'approved' — un-reviewed drafts cannot be published via MCP."),
  generate_image: z.boolean().optional()
    .describe('Generate + attach the featured image during publish (only has an effect when the publish target maps a featuredImage field). Default false.'),
});
export type PublishPostInput = z.infer<typeof publishPostInputSchema>;

export const createContentRequestInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  topic: z.string().trim().min(1).max(500)
    .describe('The subject of the content topic request (what should be written).'),
  target_keyword: z.string().trim().min(1).max(200)
    .describe('The primary keyword the requested content should target.'),
  intent: z.enum(['informational', 'commercial', 'transactional', 'navigational']).optional()
    .describe('Optional search intent: informational, commercial, transactional, or navigational.'),
  priority: z.enum(['high', 'medium', 'low']).optional()
    .describe('Optional priority of the request: high, medium, or low.'),
  rationale: z.string().trim().max(5000).optional()
    .describe('Optional internal rationale explaining why this content is being requested.'),
  client_note: z.string().trim().max(5000).optional()
    .describe('Optional note from/to the client surfaced in the request pipeline.'),
  source: z.enum(['strategy', 'client']).optional()
    .describe('Optional origin of the request: `strategy` (created from SEO strategy) or `client` (client-initiated).'),
  service_type: z.enum(['brief_only', 'full_post']).optional()
    .describe('Optional deliverable scope: `brief_only` (just a brief) or `full_post` (brief plus drafted post).'),
  page_type: pageTypeSchema.optional()
    .describe('Optional page type for the requested content (blog, landing, service, location, product, pillar, resource).'),
  initial_status: z.enum(['pending_payment', 'requested', 'brief_generated', 'in_progress']).optional()
    .describe('Optional starting lifecycle status: pending_payment, requested, brief_generated, or in_progress.'),
  target_page_id: z.string().trim().min(1).max(200).optional()
    .describe('Optional id of an existing page the content targets.'),
  target_page_slug: z.string().trim().min(1).max(200).optional()
    .describe('Optional slug of an existing page the content targets.'),
  dedupe: z.boolean().optional()
    .describe('When true, skip creating a duplicate request if a matching topic/keyword request already exists.'),
}).strict();

// --- Recommendation lifecycle tool input schemas ---------------------------

export const listRecommendationsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  filter: z.enum(['active', 'all']).optional()
    .describe("Which recommendations to return: 'active' (default — only the live, surfaceable set: not completed/dismissed/struck/throttled and not already sent to the client) or 'all' (every recommendation regardless of lifecycle/clientStatus)."),
}).strict();
export type ListRecommendationsInput = z.infer<typeof listRecommendationsInputSchema>;

export const applyRecommendationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  recommendation_id: z.string().min(1)
    .describe('The id of the recommendation to act on (from list_recommendations).'),
  action: z.enum(['send', 'throttle', 'strike'])
    .describe("Lifecycle action: 'send' (deliver the curated rec to the client — clientStatus → sent), 'throttle' (hide it for a fixed window — lifecycle → throttled; requires throttle_days), or 'strike' (permanently suppress it so it is never re-suggested — lifecycle → struck)."),
  throttle_days: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional()
    .describe('Required when action is `throttle`: how many days to hide the recommendation (7, 30, or 90). The rec auto-resurfaces on-read once the window passes. Ignored for send/strike.'),
}).strict();
export type ApplyRecommendationInput = z.infer<typeof applyRecommendationInputSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(200)
    .describe('Display name for the new workspace (client).'),
  webflow_site_id: z.string().trim().min(1).max(200).optional()
    .describe('Optional Webflow site ID to connect to this workspace at creation.'),
  webflow_site_name: z.string().trim().min(1).max(200).optional()
    .describe('Optional human-readable Webflow site name shown alongside the connected site.'),
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
  ).describe('The fields to update (an allowlist of safe operational fields: name, Webflow site, live_domain, gsc_property_url, ga4_property_id, client_email, tier, trial_ends_at, client-portal toggles, onboarding flags, publish_target, seo_data_provider, business_profile, intelligence_profile). At least one field is required; only the keys you pass are changed.'),
}).strict();

export const deleteWorkspaceInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  confirm: z.literal('delete_workspace')
    .describe('Safety confirmation. Must be exactly the string "delete_workspace" or the deletion is rejected.'),
}).strict();

export const getContentPerformanceInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID whose post/request content performance (GSC + GA4 metrics, publish age, brief coverage) to fetch.'),
});

export const deleteBriefInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_id: z.string().min(1)
    .describe('The id of the content brief to permanently delete.'),
}).strict();

export const deletePostInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe('The id of the generated post to permanently delete.'),
}).strict();

export const listPostVersionsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe('The id of the post whose historical versions to list.'),
  limit: z.number().int().positive().max(200).optional()
    .describe('Optional max number of versions to return (1-200).'),
}).strict();

export const revertPostVersionInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  post_id: z.string().min(1)
    .describe('The id of the post to revert.'),
  version_id: z.string().min(1)
    .describe('The id of the historical version to revert the post back to (from list_post_versions).'),
}).strict();

export const getUnresolvedInsightsInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID whose unresolved insight queue (ordered by impact) to fetch.'),
  limit: z.number().int().positive().max(500).optional()
    .describe('Optional max number of unresolved insights to return (1-500).'),
});

export const getInsightsInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID whose stored insights to fetch.'),
  type: insightTypeSchema.optional()
    .describe('Optional filter to a single insight type (e.g. content_decay, ranking_opportunity, page_health).'),
  domain: z.enum(['search', 'traffic', 'cross']).optional()
    .describe('Optional filter by insight domain: `search` (rankings/SERP), `traffic` (GA4/sessions), or `cross` (spans both).'),
  limit: z.number().int().positive().max(500).optional()
    .describe('Optional max number of insights to return (1-500).'),
});

export const getAnomaliesInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID whose detected anomalies (traffic drops, rank changes, indexation issues) to fetch.'),
  resolved: z.boolean().optional()
    .describe('When true, include resolved anomalies; when false or omitted, only unresolved anomalies are returned.'),
});

export const resolveInsightInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID that owns the insight.'),
  insightId: z.string().min(1)
    .describe('The id of the insight to resolve (from get_insights / get_unresolved_insights). Must belong to this workspace.'),
  status: z.enum(['in_progress', 'resolved'])
    .describe("New resolution status: `resolved` (acted on / done — records an outcome baseline) or `in_progress` (being worked)."),
  note: z.string().max(500).optional()
    .describe('Optional note explaining the resolution (max 500 chars).'),
});
export type ResolveInsightInput = z.infer<typeof resolveInsightInputSchema>;

export const bulkResolveInsightsInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID that owns the insights.'),
  insightIds: z.array(z.string().min(1)).min(1).max(100)
    .describe('Array of insight ids to resolve in one call (1-100). Ids not found in this workspace are returned under `notFound`.'),
  status: z.enum(['in_progress', 'resolved'])
    .describe("Status to apply to every listed insight: `resolved` (done) or `in_progress` (being worked)."),
  note: z.string().max(500).optional()
    .describe('Optional note applied to all resolved insights (max 500 chars).'),
});
export type BulkResolveInsightsInput = z.infer<typeof bulkResolveInsightsInputSchema>;

export const respondToClientActionInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID that owns the client action.'),
  actionId: z.string().min(1)
    .describe("The id of the client action to update (from get_pending_work's clientActions)."),
  status: z.enum(['approved', 'changes_requested', 'completed', 'archived', 'pending'])
    .describe("New status: `completed` (done), `archived` (dismiss), `approved`, `changes_requested`, or `pending` (reopen). Resolving (completed/approved) also updates the linked insight + outcome learning. An illegal status transition is rejected."),
  clientNote: z.string().max(2000).optional()
    .describe('Optional note recorded with the status change (max 2000 chars).'),
});
export type RespondToClientActionMcpInput = z.infer<typeof respondToClientActionInputSchema>;

// Decline-only by design: an MCP agent may request changes on (decline) an approval
// item but may NOT approve one on the client's behalf (approval is the client's review
// decision and triggers "approved" team emails). So this tool takes no status — it
// always rejects/requests-changes.
export const respondToApprovalItemInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID that owns the approval item.'),
  batchId: z.string().min(1)
    .describe("The approval batch id containing the item (from get_pending_work's approvalBatches)."),
  itemId: z.string().min(1)
    .describe('The id of the specific approval item to decline / request changes on.'),
  clientNote: z.string().max(2000).optional()
    .describe('Recommended: the requested changes communicated to the team (max 2000 chars). This tool only declines/requests-changes — it can never approve on the client\'s behalf.'),
});
export type RespondToApprovalItemMcpInput = z.infer<typeof respondToApprovalItemInputSchema>;

export const getWorkspaceIntelligenceInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID to assemble the intelligence bundle for.'),
  slices: z.array(z.string()).optional()
    .describe('Optional list of intelligence slice names to assemble (omit to return the full default set). Valid slices: seoContext, insights, learnings, pageProfile, contentPipeline, siteHealth, clientSignals, operational, pageElements, siteInventory, localSeo, entityResolution, eeatAssets, generationQuality, brand. Pass a subset to reduce response size.'),
  pagePath: z.string().optional()
    .describe('Optional page path (e.g. /blog/post) to scope page-level slices like pageProfile and pageElements.'),
  siteId: z.string().optional()
    .describe('Optional Webflow site id to scope the siteInventory slice (defaults to the workspace site when include_site_inventory is set).'),
  siteBaseUrl: z.string().optional()
    .describe('Optional base URL for the site; bare hosts are auto-prefixed with https://. Used by inventory/inspection slices.'),
  enrich_with_backlinks: z.boolean().optional()
    .describe('When true, enrich the bundle with backlink data (may call paid providers).'),
  resolve_entity_references: z.boolean().optional()
    .describe('When true, run entity resolution (Wikidata disambiguation) for the entityResolution slice.'),
  include_site_inventory: z.boolean().optional()
    .describe('When true, force-include the siteInventory slice and use the workspace Webflow site/domain to populate it.'),
});

export const getBrandIdentityInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID whose brand identity (mission, vision, values, tagline, positioning, voice status) to fetch.'),
  includeDeliverables: z.boolean().optional()
    .describe('When true, also return every brand deliverable with its draft/approved status and version (needed to get deliverable ids/versions for update_brand_deliverable).'),
});
export type GetBrandIdentityInput = z.infer<typeof getBrandIdentityInputSchema>;

export const updateBrandDeliverableInputSchema = z.object({
  workspaceId: z.string().min(1)
    .describe('The workspace ID that owns the brand deliverable.'),
  deliverableId: z.string().min(1)
    .describe('The id of the existing brand deliverable to update (from get_brand_identity with includeDeliverables:true). Updates the existing row only — does not create new deliverables.'),
  content: z.string().min(1)
    .describe('The new content for the deliverable. Saving resets the deliverable to draft status.'),
  /**
   * Optional optimistic-concurrency guard. Pass the `version` returned by
   * `get_brand_identity(includeDeliverables:true)`; if it no longer matches the
   * stored version the write is rejected as a conflict (re-fetch and retry).
   * Omit for last-write-wins.
   */
  expectedVersion: z.number().int().positive().optional()
    .describe('Optional optimistic-concurrency guard — the `version` from get_brand_identity(includeDeliverables:true). A mismatch is rejected as a conflict (re-fetch and retry); omit for last-write-wins.'),
});
export type UpdateBrandDeliverableInput = z.infer<typeof updateBrandDeliverableInputSchema>;

// --- Job tool input schemas -------------------------------------------------

export const startKeywordStrategyGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  options: z.object({
    mode: z.enum(['full', 'incremental']).optional(),
    seoDataProvider: z.literal('dataforseo').optional(),
    competitorDomains: z.array(z.string()).optional(),
    maxPages: z.number().int().positive().optional(),
  }).optional()
    .describe('[Paid API] Optional generation options: `mode` (`full` or `incremental`), `seoDataProvider` (`dataforseo`), `competitorDomains` (array of competitor domains to mine), and `maxPages` (cap on pages processed).'),
});

export const startSeoAuditInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  site_id: z.string().min(1, 'site_id (Webflow site) is required')
    .describe('The Webflow site id to audit. Required.'),
  options: z.object({
    skip_link_check: z.boolean().optional(),
  }).optional()
    .describe('Optional audit options: `skip_link_check` (when true, skip the broken-link crawl for a faster audit).'),
});

export const startLocalSeoRefreshInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  refresh_body: z.object({
    marketIds: z.array(z.string().min(1)).max(3).optional(),
    keywords: z.array(z.string().min(1).max(200)).max(LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP).optional(),
    device: z.enum([LOCAL_SEO_DEVICE.DESKTOP, LOCAL_SEO_DEVICE.MOBILE]).optional(),
    languageCode: z.string().min(2).max(8).optional(),
  }).strict()
    .describe(`[Paid API] Local SEO refresh scope: \`marketIds\` (up to 3 markets to refresh), \`keywords\` (terms to track, up to ${LOCAL_SEO_MAX_KEYWORDS_PER_REFRESH_CAP}), \`device\` (\`${LOCAL_SEO_DEVICE.DESKTOP}\` or \`${LOCAL_SEO_DEVICE.MOBILE}\`), and \`languageCode\` (e.g. "en"). Calls paid SERP/visibility providers.`),
});

export const getJobStatusInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  job_id: z.string().min(1)
    .describe('The id of the background job to poll (returned by a start_* job tool).'),
});

export const listJobsInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  status: z.enum(['pending', 'running', 'done', 'error', 'cancelled']).optional()
    .describe('Optional filter by job status: pending, running, done, error, or cancelled.'),
  limit: z.number().int().positive().max(200).optional()
    .describe('Optional max number of recent jobs to return (1-200).'),
});

export const cancelJobInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  job_id: z.string().min(1)
    .describe('The id of the running background job to cancel.'),
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
  lite: z.boolean().optional()
    .describe('When true, return a slimmer strategy payload (omits heavier per-page metric detail) for cheaper reads.'),
});

export const removePageKeywordInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  page_path: z.string().min(1)
    .describe('The page path (e.g. /services/seo) whose keyword targeting should be removed.'),
});

export const addKeywordsBatchInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  entries: z.array(pageKeywordEntrySchema).min(1).max(500)
    .describe('Page-keyword entries to upsert (1-500). Each entry sets pagePath, pageTitle, primaryKeyword, secondaryKeywords, and optional metrics; existing pages are updated, new ones added.'),
});

export const replaceKeywordStrategyInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  entries: z.array(pageKeywordEntrySchema).max(500)
    .describe('The complete page-keyword set that REPLACES the entire existing strategy (0-500 entries). Pages not present in this array are removed — pass an empty array to clear the strategy.'),
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
