import { randomUUID } from 'node:crypto';
import type { Tool } from '@modelcontextprotocol/sdk/types';
import {
  layoutSchema,
  prepareBriefContextInputSchema,
  preparePostContextInputSchema,
  saveBriefInputSchema,
  savePostInputSchema,
  sendToClientInputSchema,
} from '../../../shared/types/mcp-action-schemas.js';
import type { ContentBrief, GeneratedPost } from '../../../shared/types/content.js';
import { addActivity } from '../../activity-log.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { getBrief, upsertBrief } from '../../content-brief.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../content-requests.js';
import { getPost, savePost } from '../../content-posts-db.js';
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

export const contentActionTools: Tool[] = [
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
  if (name === 'prepare_brief_context') return handlePrepareBriefContext(args);
  if (name === 'save_brief') return handleSaveBrief(args);
  if (name === 'prepare_post_context') return handlePreparePostContext(args);
  if (name === 'save_post') return handleSavePost(args);
  if (name === 'send_to_client') return handleSendToClient(args);
  return mcpError(`Unknown content action tool: ${name}`);
}
