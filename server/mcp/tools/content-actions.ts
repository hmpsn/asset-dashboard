import { createHash, randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  getBriefInputSchema,
  getPostInputSchema,
  layoutSchema,
  listBriefsInputSchema,
  listPostsInputSchema,
  prepareBriefContextInputSchema,
  preparePostContextInputSchema,
  saveBriefInputSchema,
  savePostInputSchema,
  sendToClientInputSchema,
  updateBriefInputSchema,
  updatePostInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { ContentBrief, GeneratedPost } from '../../../shared/types/content.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { getBrief, listBriefs, updateBrief, upsertBrief } from '../../content-brief.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../content-requests.js';
import { getPost, listPosts, savePost, updatePostField } from '../../content-posts-db.js';
import { countHtmlWords } from '../../content-posts-ai.js';
import { invalidateContentPipelineIntelligence } from '../../intelligence-freshness.js';
import { buildContentGenerationContext } from '../../intelligence/generation-context-builders.js';
import { createLogger } from '../../logger.js';
import { WS_EVENTS } from '../../ws-events.js';
import { consumeHandle, issueHandle } from '../handles.js';
import { toMcpJsonSchema } from '../json-schema.js';
import {
  buildDashboardUrl,
  mcpError,
  mcpSuccess,
  requireWorkspace,
  zodErrorToMcp,
  type McpToolErrorResponse,
  type McpToolSuccessResponse,
} from '../tool-helpers.js';

const log = createLogger('mcp-tools-content-actions');

const briefContentSchema = saveBriefInputSchema.shape.content;
const postContentSchema = savePostInputSchema.shape.content;

type PostPatchUpdates = Exclude<typeof updatePostInputSchema['_output'], { mode: 'replace' }>['updates'];

interface BriefRequestPayload {
  topic: string;
  layout: unknown;
  briefId: string;
}

interface PostRequestPayload {
  briefId: string;
  postId: string;
  parentRequestId?: string;
}

interface BriefSavedPayload {
  briefId: string;
  parentRequestId?: string;
}

interface PostSavedPayload {
  postId: string;
  briefId: string;
  parentRequestId?: string;
}

interface RevisionConflictResult {
  isConflict: true;
  currentRevision: string;
}

export const contentActionTools: Tool[] = [
  {
    name: 'list_briefs',
    description: 'List content briefs for a workspace with revision tokens for safe MCP write-back.',
    inputSchema: toMcpJsonSchema(listBriefsInputSchema),
  },
  {
    name: 'get_brief',
    description: 'Get a single content brief with a revision token for optimistic write-back safety.',
    inputSchema: toMcpJsonSchema(getBriefInputSchema),
  },
  {
    name: 'update_brief',
    description: 'Patch or replace an existing brief using expected_revision conflict checks.',
    inputSchema: toMcpJsonSchema(updateBriefInputSchema),
  },
  {
    name: 'list_posts',
    description: 'List content posts for a workspace with revision tokens for safe MCP write-back.',
    inputSchema: toMcpJsonSchema(listPostsInputSchema),
  },
  {
    name: 'get_post',
    description: 'Get a single content post with a revision token for optimistic write-back safety.',
    inputSchema: toMcpJsonSchema(getPostInputSchema),
  },
  {
    name: 'update_post',
    description: 'Patch or replace an existing post using expected_revision conflict checks.',
    inputSchema: toMcpJsonSchema(updatePostInputSchema),
  },
  {
    name: 'prepare_brief_context',
    description: 'Build structured context for brief writing and return a short-lived handle for save_brief.',
    inputSchema: toMcpJsonSchema(prepareBriefContextInputSchema),
  },
  {
    name: 'save_brief',
    description: 'Validate and persist a content brief produced from a prepare_brief_context request.',
    inputSchema: toMcpJsonSchema(saveBriefInputSchema),
  },
  {
    name: 'prepare_post_context',
    description: 'Build structured context for post drafting from a saved brief and return a handle for save_post.',
    inputSchema: toMcpJsonSchema(preparePostContextInputSchema),
  },
  {
    name: 'save_post',
    description: 'Validate and persist a generated post produced from a prepare_post_context request.',
    inputSchema: toMcpJsonSchema(savePostInputSchema),
  },
  {
    name: 'send_to_client',
    description: 'Create or update client-facing content requests from a saved brief/post handle.',
    inputSchema: toMcpJsonSchema(sendToClientInputSchema),
  },
];

function canonicalizeForRevision(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForRevision);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const normalized: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      normalized[key] = canonicalizeForRevision(entryValue);
    }
    return normalized;
  }
  return value;
}

function buildBriefEditablePayload(brief: ContentBrief): Record<string, unknown> {
  return {
    targetKeyword: brief.targetKeyword,
    secondaryKeywords: brief.secondaryKeywords,
    suggestedTitle: brief.suggestedTitle,
    suggestedMetaDesc: brief.suggestedMetaDesc,
    outline: brief.outline,
    wordCountTarget: brief.wordCountTarget,
    intent: brief.intent,
    audience: brief.audience,
    competitorInsights: brief.competitorInsights,
    internalLinkSuggestions: brief.internalLinkSuggestions,
    executiveSummary: brief.executiveSummary,
    contentFormat: brief.contentFormat,
    toneAndStyle: brief.toneAndStyle,
    peopleAlsoAsk: brief.peopleAlsoAsk,
    topicalEntities: brief.topicalEntities,
    serpAnalysis: brief.serpAnalysis,
    difficultyScore: brief.difficultyScore,
    trafficPotential: brief.trafficPotential,
    ctaRecommendations: brief.ctaRecommendations,
    eeatGuidance: brief.eeatGuidance,
    contentChecklist: brief.contentChecklist,
    schemaRecommendations: brief.schemaRecommendations,
    pageType: brief.pageType,
    referenceUrls: brief.referenceUrls,
    realPeopleAlsoAsk: brief.realPeopleAlsoAsk,
    realTopResults: brief.realTopResults,
    keywordLocked: brief.keywordLocked,
    keywordSource: brief.keywordSource,
    keywordValidation: brief.keywordValidation,
    templateId: brief.templateId,
    titleVariants: brief.titleVariants,
    metaDescVariants: brief.metaDescVariants,
    generationStyle: brief.generationStyle,
  };
}

function buildPostEditablePayload(post: GeneratedPost): Record<string, unknown> {
  return {
    title: post.title,
    metaDescription: post.metaDescription,
    introduction: post.introduction,
    sections: post.sections,
    conclusion: post.conclusion,
    seoTitle: post.seoTitle,
    seoMetaDescription: post.seoMetaDescription,
  };
}

function computeRevisionToken(payload: Record<string, unknown>): string {
  const normalized = canonicalizeForRevision(payload);
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function checkExpectedRevision(
  expectedRevision: string,
  payload: Record<string, unknown>,
): true | RevisionConflictResult {
  const currentRevision = computeRevisionToken(payload);
  if (expectedRevision !== currentRevision) {
    return { isConflict: true, currentRevision };
  }
  return true;
}

function mergePostSectionUpdates(
  currentSections: GeneratedPost['sections'],
  sectionUpdates: PostPatchUpdates['sections'],
): { sections: GeneratedPost['sections'] } | { error: string } {
  if (!sectionUpdates || sectionUpdates.length === 0) {
    return { sections: currentSections };
  }
  const seen = new Set<number>();
  for (const update of sectionUpdates) {
    if (seen.has(update.index)) return { error: `Duplicate section index in updates: ${update.index}` };
    seen.add(update.index);
  }
  const sectionByIndex = new Map(currentSections.map(section => [section.index, section]));
  const merged = currentSections.map(section => {
    const update = sectionUpdates.find(item => item.index === section.index);
    if (!update) return section;
    const nextContent = update.content ?? section.content;
    return {
      ...section,
      heading: update.heading ?? section.heading,
      content: nextContent,
      wordCount: update.content !== undefined ? countHtmlWords(nextContent) : section.wordCount,
      targetWordCount: update.targetWordCount ?? section.targetWordCount,
      keywords: update.keywords ?? section.keywords,
    };
  });
  const missing = sectionUpdates.find(update => !sectionByIndex.has(update.index));
  if (missing) return { error: `Section index not found: ${missing.index}` };
  return { sections: merged };
}

function computePostTotalWordCount(post: Pick<GeneratedPost, 'introduction' | 'sections' | 'conclusion'>): number {
  return countHtmlWords(post.introduction)
    + post.sections.reduce((sum, section) => sum + countHtmlWords(section.content), 0)
    + countHtmlWords(post.conclusion);
}

async function handleListBriefs(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = listBriefsInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, limit } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const rows = listBriefs(workspaceId)
    .slice(0, limit ?? 50)
    .map((brief) => ({
      brief_id: brief.id,
      target_keyword: brief.targetKeyword,
      suggested_title: brief.suggestedTitle,
      page_type: brief.pageType ?? null,
      created_at: brief.createdAt,
      revision: computeRevisionToken(buildBriefEditablePayload(brief)),
    }));

  return mcpSuccess({
    briefs: rows,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handleGetBrief(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = getBriefInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, brief_id: briefId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const brief = getBrief(workspaceId, briefId);
  if (!brief) return mcpError(`Brief not found: ${briefId}`);

  return mcpSuccess({
    brief,
    revision: computeRevisionToken(buildBriefEditablePayload(brief)),
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handleUpdateBrief(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = updateBriefInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, brief_id: briefId, expected_revision: expectedRevision } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const existing = getBrief(workspaceId, briefId);
  if (!existing) return mcpError(`Brief not found: ${briefId}`);

  const revisionCheck = checkExpectedRevision(expectedRevision, buildBriefEditablePayload(existing));
  if (revisionCheck !== true) {
    return mcpError(`Revision conflict. Current revision: ${revisionCheck.currentRevision}. Re-fetch via get_brief.`);
  }

  let updates: Partial<Omit<ContentBrief, 'id' | 'workspaceId' | 'createdAt'>>;
  if (parsed.data.mode === 'patch') {
    const patch = parsed.data.updates;
    updates = {
      ...(patch.targetKeyword !== undefined ? { targetKeyword: patch.targetKeyword } : {}),
      ...(patch.secondaryKeywords !== undefined ? { secondaryKeywords: patch.secondaryKeywords } : {}),
      ...(patch.suggestedTitle !== undefined ? { suggestedTitle: patch.suggestedTitle } : {}),
      ...(patch.suggestedMetaDesc !== undefined ? { suggestedMetaDesc: patch.suggestedMetaDesc } : {}),
      ...(patch.wordCountTarget !== undefined ? { wordCountTarget: patch.wordCountTarget } : {}),
      ...(patch.intent !== undefined ? { intent: patch.intent } : {}),
      ...(patch.audience !== undefined ? { audience: patch.audience } : {}),
      ...(patch.competitorInsights !== undefined ? { competitorInsights: patch.competitorInsights } : {}),
      ...(patch.internalLinkSuggestions !== undefined ? { internalLinkSuggestions: patch.internalLinkSuggestions } : {}),
      ...(patch.pageType !== undefined ? { pageType: patch.pageType } : {}),
      ...(patch.executiveSummary !== undefined ? { executiveSummary: patch.executiveSummary } : {}),
      ...(patch.outline
        ? {
          outline: patch.outline.map(section => ({
            ...section,
            notes: section.notes ?? '',
          })),
        }
        : {}),
    };
  } else {
    updates = {
      ...(buildBriefEditablePayload(existing) as Partial<Omit<ContentBrief, 'id' | 'workspaceId' | 'createdAt'>>),
      ...parsed.data.content,
      outline: parsed.data.content.outline.map(section => ({
        ...section,
        notes: section.notes ?? '',
      })),
    };
  }

  const updated = updateBrief(workspaceId, briefId, updates);
  if (!updated) return mcpError(`Brief not found: ${briefId}`);

  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEF_UPDATED, {
    workspaceId,
    briefId: updated.id,
    action: 'mcp_brief_updated',
  });
  addActivity(
    workspaceId,
    'content_updated',
    `Updated content brief "${updated.suggestedTitle || updated.targetKeyword}"`,
    undefined,
    {
      source: 'mcp-chat',
      briefId: updated.id,
      action: 'mcp_brief_updated',
    },
  );

  return mcpSuccess({
    ok: true,
    brief_id: updated.id,
    revision: computeRevisionToken(buildBriefEditablePayload(updated)),
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handleListPosts(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = listPostsInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, limit } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const rows = listPosts(workspaceId)
    .slice(0, limit ?? 50)
    .map((post) => ({
      post_id: post.id,
      brief_id: post.briefId,
      title: post.title,
      target_keyword: post.targetKeyword,
      status: post.status,
      updated_at: post.updatedAt,
      revision: computeRevisionToken(buildPostEditablePayload(post)),
    }));

  return mcpSuccess({
    posts: rows,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handleGetPost(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = getPostInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, post_id: postId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const post = getPost(workspaceId, postId);
  if (!post) return mcpError(`Post not found: ${postId}`);

  return mcpSuccess({
    post,
    revision: computeRevisionToken(buildPostEditablePayload(post)),
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handleUpdatePost(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = updatePostInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);
  const { workspace_id: workspaceId, post_id: postId, expected_revision: expectedRevision } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const existing = getPost(workspaceId, postId);
  if (!existing) return mcpError(`Post not found: ${postId}`);

  const revisionCheck = checkExpectedRevision(expectedRevision, buildPostEditablePayload(existing));
  if (revisionCheck !== true) {
    return mcpError(`Revision conflict. Current revision: ${revisionCheck.currentRevision}. Re-fetch via get_post.`);
  }

  const updates: Partial<Omit<GeneratedPost, 'id' | 'workspaceId' | 'createdAt'>> = {};
  if (parsed.data.mode === 'patch') {
    const patch = parsed.data.updates;
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.metaDescription !== undefined) updates.metaDescription = patch.metaDescription;
    if (patch.introduction !== undefined) updates.introduction = patch.introduction;
    if (patch.conclusion !== undefined) updates.conclusion = patch.conclusion;
    if (patch.seoTitle !== undefined) updates.seoTitle = patch.seoTitle;
    if (patch.seoMetaDescription !== undefined) updates.seoMetaDescription = patch.seoMetaDescription;
    if (patch.sections !== undefined) {
      const merged = mergePostSectionUpdates(existing.sections, patch.sections);
      if ('error' in merged) return mcpError(merged.error);
      updates.sections = merged.sections;
    }
    if (patch.introduction !== undefined || patch.conclusion !== undefined || patch.sections !== undefined) {
      updates.totalWordCount = computePostTotalWordCount({
        introduction: updates.introduction ?? existing.introduction,
        sections: updates.sections ?? existing.sections,
        conclusion: updates.conclusion ?? existing.conclusion,
      });
    }
  } else {
    const replacement = parsed.data.content;
    updates.title = replacement.title;
    updates.metaDescription = replacement.metaDescription;
    updates.introduction = replacement.introduction;
    updates.sections = replacement.sections;
    updates.conclusion = replacement.conclusion;
    updates.seoTitle = replacement.seoTitle;
    updates.seoMetaDescription = replacement.seoMetaDescription;
    updates.totalWordCount = computePostTotalWordCount({
      introduction: replacement.introduction,
      sections: replacement.sections,
      conclusion: replacement.conclusion,
    });
  }

  const updated = updatePostField(workspaceId, postId, updates);
  if (!updated) return mcpError(`Post not found: ${postId}`);

  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
    workspaceId,
    postId: updated.id,
    action: 'mcp_post_updated',
  });
  addActivity(
    workspaceId,
    'content_updated',
    `Updated post "${updated.title}"`,
    `Keyword: ${updated.targetKeyword}`,
    {
      source: 'mcp-chat',
      postId: updated.id,
      briefId: updated.briefId,
      action: 'mcp_post_updated',
    },
  );

  return mcpSuccess({
    ok: true,
    post_id: updated.id,
    revision: computeRevisionToken(buildPostEditablePayload(updated)),
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handlePrepareBriefContext(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = prepareBriefContextInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, topic, layout } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  try {
    const context = await buildContentGenerationContext(workspaceId, {
      learningsDomain: 'content',
    });
    const briefId = `brief_${randomUUID()}`;
    const handle = issueHandle('brief-request', workspaceId, {
      topic,
      layout,
      briefId,
    } satisfies BriefRequestPayload);
    return mcpSuccess({
      brief_request_handle: handle,
      topic,
      layout,
      layout_schema: toMcpJsonSchema(layoutSchema),
      brief_schema: toMcpJsonSchema(briefContentSchema),
      prompt_context: context.promptContext,
      dashboard_url: buildDashboardUrl(workspaceId, 'content'),
    });
  } catch (err) {
    log.error({ err, workspaceId, topic }, 'prepare_brief_context failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Failed to prepare brief context: ${message}`);
  }
}

function buildBriefEntity(
  workspaceId: string,
  content: (typeof saveBriefInputSchema.shape.content)['_output'],
  source: BriefRequestPayload,
): ContentBrief {
  const now = new Date().toISOString();
  return {
    id: source.briefId,
    workspaceId,
    targetKeyword: content.targetKeyword,
    secondaryKeywords: content.secondaryKeywords,
    suggestedTitle: content.suggestedTitle,
    suggestedMetaDesc: content.suggestedMetaDesc,
    outline: content.outline.map(section => ({
      ...section,
      notes: section.notes ?? '',
    })),
    wordCountTarget: content.wordCountTarget,
    intent: content.intent,
    audience: content.audience,
    competitorInsights: content.competitorInsights,
    internalLinkSuggestions: content.internalLinkSuggestions,
    pageType: content.pageType,
    executiveSummary: content.executiveSummary,
    createdAt: now,
  };
}

async function handleSaveBrief(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = saveBriefInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    brief_request_handle: briefRequestHandle,
    content,
    parent_request_id: parentRequestId,
  } = parsed.data;

  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  let payload: BriefRequestPayload;
  try {
    payload = consumeHandle<BriefRequestPayload>(briefRequestHandle, 'brief-request', workspaceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(message);
  }

  const brief = buildBriefEntity(workspaceId, content, payload);
  upsertBrief(workspaceId, brief);
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.BRIEF_UPDATED, {
    workspaceId,
    briefId: brief.id,
    action: 'mcp_brief_saved',
  });

  if (parentRequestId) {
    try {
      updateContentRequest(workspaceId, parentRequestId, {
        briefId: brief.id,
        status: 'brief_generated',
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, {
        id: parentRequestId,
        action: 'mcp_brief_linked',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpError(`Brief saved but failed to update parent request: ${message}`);
    }
  }

  addActivity(
    workspaceId,
    'brief_generated',
    `Saved content brief for "${brief.targetKeyword}"`,
    brief.suggestedTitle,
    {
      source: 'mcp-chat',
      briefId: brief.id,
      parentRequestId,
      action: 'mcp_brief_saved',
    },
  );

  const briefHandle = issueHandle('brief', workspaceId, {
    briefId: brief.id,
    parentRequestId,
  } satisfies BriefSavedPayload);

  return mcpSuccess({
    ok: true,
    brief_id: brief.id,
    brief_handle: briefHandle,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

async function handlePreparePostContext(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = preparePostContextInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, brief_id: briefId } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  const brief = getBrief(workspaceId, briefId);
  if (!brief) return mcpError(`Brief not found: ${briefId}`);

  try {
    const context = await buildContentGenerationContext(workspaceId, {
      learningsDomain: 'content',
    });
    const postId = `post_${randomUUID()}`;
    const handle = issueHandle('post-request', workspaceId, {
      briefId,
      postId,
    } satisfies PostRequestPayload);

    return mcpSuccess({
      post_request_handle: handle,
      brief,
      post_schema: toMcpJsonSchema(postContentSchema),
      prompt_context: context.promptContext,
      dashboard_url: buildDashboardUrl(workspaceId, 'content'),
    });
  } catch (err) {
    log.error({ err, workspaceId, briefId }, 'prepare_post_context failed');
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(`Failed to prepare post context: ${message}`);
  }
}

function buildPostEntity(
  workspaceId: string,
  content: (typeof savePostInputSchema.shape.content)['_output'],
  payload: PostRequestPayload,
): GeneratedPost {
  const now = new Date().toISOString();
  return {
    id: payload.postId,
    workspaceId,
    briefId: content.briefId,
    targetKeyword: content.targetKeyword,
    title: content.title,
    metaDescription: content.metaDescription,
    introduction: content.introduction,
    sections: content.sections,
    conclusion: content.conclusion,
    totalWordCount: content.totalWordCount,
    targetWordCount: content.targetWordCount,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

async function handleSavePost(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = savePostInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const {
    workspace_id: workspaceId,
    post_request_handle: postRequestHandle,
    content,
    parent_request_id: parentRequestIdFromArgs,
  } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  let payload: PostRequestPayload;
  try {
    payload = consumeHandle<PostRequestPayload>(postRequestHandle, 'post-request', workspaceId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(message);
  }

  const post = buildPostEntity(workspaceId, content, payload);
  if (post.briefId !== payload.briefId) {
    return mcpError(
      `Post briefId (${post.briefId}) does not match prepared request briefId (${payload.briefId})`,
    );
  }
  savePost(workspaceId, post);
  invalidateContentPipelineIntelligence(workspaceId);
  broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
    workspaceId,
    postId: post.id,
    action: 'mcp_post_saved',
  });

  const parentRequestId = parentRequestIdFromArgs ?? payload.parentRequestId;

  if (parentRequestId) {
    try {
      updateContentRequest(workspaceId, parentRequestId, {
        postId: post.id,
        status: 'in_progress',
      });
      broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_REQUEST_UPDATE, {
        id: parentRequestId,
        action: 'mcp_post_linked',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return mcpError(`Post saved but failed to update parent request: ${message}`);
    }
  }

  addActivity(
    workspaceId,
    'content_updated',
    `Saved generated post "${post.title}"`,
    `Keyword: ${post.targetKeyword}`,
    {
      source: 'mcp-chat',
      postId: post.id,
      briefId: post.briefId,
      parentRequestId,
      action: 'mcp_post_saved',
    },
  );

  const postHandle = issueHandle('post', workspaceId, {
    postId: post.id,
    briefId: post.briefId,
    parentRequestId,
  } satisfies PostSavedPayload);

  return mcpSuccess({
    ok: true,
    post_id: post.id,
    post_handle: postHandle,
    dashboard_url: buildDashboardUrl(workspaceId, 'content'),
  });
}

function ensureBriefRequest(workspaceId: string, brief: ContentBrief, note: string | undefined): string {
  const request = createContentRequest(workspaceId, {
    topic: brief.suggestedTitle,
    targetKeyword: brief.targetKeyword,
    intent: brief.intent || 'informational',
    priority: 'medium',
    rationale: brief.executiveSummary || `Content brief for "${brief.targetKeyword}"`,
    source: 'strategy',
    serviceType: 'brief_only',
    pageType: brief.pageType || 'blog',
    initialStatus: 'brief_generated',
    dedupe: false,
    clientNote: note,
  });
  updateContentRequest(workspaceId, request.id, {
    briefId: brief.id,
    status: 'client_review',
    internalNote: note,
  });
  return request.id;
}

function ensurePostRequest(workspaceId: string, post: GeneratedPost, note: string | undefined): string {
  const request = createContentRequest(workspaceId, {
    topic: post.title,
    targetKeyword: post.targetKeyword,
    intent: 'informational',
    priority: 'medium',
    rationale: 'Post shared from MCP',
    source: 'strategy',
    serviceType: 'full_post',
    pageType: 'blog',
    initialStatus: 'in_progress',
    dedupe: false,
    clientNote: note,
  });
  updateContentRequest(workspaceId, request.id, {
    briefId: post.briefId,
    postId: post.id,
    status: 'post_review',
    internalNote: note,
  });
  return request.id;
}

async function handleSendToClient(
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  const parsed = sendToClientInputSchema.safeParse(args);
  if (!parsed.success) return zodErrorToMcp(parsed.error);

  const { workspace_id: workspaceId, brief_handle: briefHandle, post_handle: postHandle, note } = parsed.data;
  const workspace = requireWorkspace(workspaceId);
  if ('isError' in workspace) return workspace;

  try {
    if (briefHandle) {
      const payload = consumeHandle<BriefSavedPayload>(briefHandle, 'brief', workspaceId);
      const brief = getBrief(workspaceId, payload.briefId);
      if (!brief) return mcpError(`Brief not found: ${payload.briefId}`);

      const requestId = payload.parentRequestId && getContentRequest(workspaceId, payload.parentRequestId)
        ? payload.parentRequestId
        : ensureBriefRequest(workspaceId, brief, note);

      if (requestId === payload.parentRequestId) {
        updateContentRequest(workspaceId, requestId, {
          briefId: brief.id,
          status: 'client_review',
          internalNote: note,
        });
      }

      const requestEvent = requestId === payload.parentRequestId
        ? WS_EVENTS.CONTENT_REQUEST_UPDATE
        : WS_EVENTS.CONTENT_REQUEST_CREATED;
      invalidateContentPipelineIntelligence(workspaceId);
      broadcastToWorkspace(workspaceId, requestEvent, { id: requestId });
      broadcastToWorkspace(workspaceId, WS_EVENTS.CONTENT_UPDATED, {
        action: 'mcp_brief_sent_to_client',
        briefId: brief.id,
        requestId,
      });
      addActivity(
        workspaceId,
        'brief_sent_for_review',
        `Sent brief "${brief.suggestedTitle}" to client for review`,
        `Keyword: ${brief.targetKeyword}`,
        {
          source: 'mcp-chat',
          briefId: brief.id,
          requestId,
          note,
          action: 'mcp_brief_sent_to_client',
        },
      );
      return mcpSuccess({
        ok: true,
        request_id: requestId,
        target: 'brief',
        dashboard_url: buildDashboardUrl(workspaceId, 'content'),
      });
    }

    const payload = consumeHandle<PostSavedPayload>(postHandle!, 'post', workspaceId);
    const post = getPost(workspaceId, payload.postId);
    if (!post) return mcpError(`Post not found: ${payload.postId}`);

    const requestId = payload.parentRequestId && getContentRequest(workspaceId, payload.parentRequestId)
      ? payload.parentRequestId
      : ensurePostRequest(workspaceId, post, note);

    if (requestId === payload.parentRequestId) {
      updateContentRequest(workspaceId, requestId, {
        briefId: post.briefId,
        postId: post.id,
        status: 'post_review',
        internalNote: note,
      });
    }

    const requestEvent = requestId === payload.parentRequestId
      ? WS_EVENTS.CONTENT_REQUEST_UPDATE
      : WS_EVENTS.CONTENT_REQUEST_CREATED;
    invalidateContentPipelineIntelligence(workspaceId);
    broadcastToWorkspace(workspaceId, requestEvent, { id: requestId });
    broadcastToWorkspace(workspaceId, WS_EVENTS.POST_UPDATED, {
      action: 'mcp_post_sent_to_client',
      postId: post.id,
      requestId,
    });
    addActivity(
      workspaceId,
      'post_sent_for_review',
      `Sent post "${post.title}" to client for review`,
      `Keyword: ${post.targetKeyword}`,
      {
        source: 'mcp-chat',
        postId: post.id,
        briefId: post.briefId,
        requestId,
        note,
        action: 'mcp_post_sent_to_client',
      },
    );
    return mcpSuccess({
      ok: true,
      request_id: requestId,
      target: 'post',
      dashboard_url: buildDashboardUrl(workspaceId, 'content'),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return mcpError(message);
  }
}

export async function handleContentActionTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolSuccessResponse | McpToolErrorResponse> {
  if (name === 'list_briefs') return handleListBriefs(args);
  if (name === 'get_brief') return handleGetBrief(args);
  if (name === 'update_brief') return handleUpdateBrief(args);
  if (name === 'list_posts') return handleListPosts(args);
  if (name === 'get_post') return handleGetPost(args);
  if (name === 'update_post') return handleUpdatePost(args);
  if (name === 'prepare_brief_context') return handlePrepareBriefContext(args);
  if (name === 'save_brief') return handleSaveBrief(args);
  if (name === 'prepare_post_context') return handlePreparePostContext(args);
  if (name === 'save_post') return handleSavePost(args);
  if (name === 'send_to_client') return handleSendToClient(args);
  return mcpError(`Unknown content action tool: ${name}`);
}
