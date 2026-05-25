import { z } from 'zod';

// --- Shared building blocks -------------------------------------------------

const workspaceIdSchema = z.string().min(1, 'workspace_id is required');

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
});

export const sendToClientInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  brief_handle: handleIdSchema.optional(),
  post_handle: handleIdSchema.optional(),
  note: z.string().optional(),
}).refine(
  (data) => (data.brief_handle != null) !== (data.post_handle != null),
  { message: 'must provide exactly one of brief_handle or post_handle' },
);

// --- Job tool input schemas -------------------------------------------------

export const startKeywordStrategyGenerationInputSchema = z.object({
  workspace_id: workspaceIdSchema,
  options: z.object({
    mode: z.enum(['full', 'incremental']).optional(),
    seoDataProvider: z.enum(['dataforseo', 'semrush']).optional(),
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
  refresh_body: z.unknown(),
});

// --- Type exports -----------------------------------------------------------

export type ResearchKeywordsInput = z.infer<typeof researchKeywordsInputSchema>;
export type AddKeywordToStrategyInput = z.infer<typeof addKeywordToStrategyInputSchema>;
export type PrepareBriefContextInput = z.infer<typeof prepareBriefContextInputSchema>;
export type SaveBriefInput = z.infer<typeof saveBriefInputSchema>;
export type PreparePostContextInput = z.infer<typeof preparePostContextInputSchema>;
export type SavePostInput = z.infer<typeof savePostInputSchema>;
export type SendToClientInput = z.infer<typeof sendToClientInputSchema>;
export type StartKeywordStrategyGenerationInput = z.infer<typeof startKeywordStrategyGenerationInputSchema>;
export type StartSeoAuditInput = z.infer<typeof startSeoAuditInputSchema>;
export type StartLocalSeoRefreshInput = z.infer<typeof startLocalSeoRefreshInputSchema>;
