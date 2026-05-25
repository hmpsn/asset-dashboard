import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHandleStoreForTests } from '../../server/mcp/handles.js';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildContentGenerationContext: vi.fn(),
}));
vi.mock('../../server/content-brief.js', () => ({
  getBrief: vi.fn(),
  upsertBrief: vi.fn(),
}));
vi.mock('../../server/content-posts-db.js', () => ({
  getPost: vi.fn(),
  savePost: vi.fn(),
}));
vi.mock('../../server/content-requests.js', () => ({
  createContentRequest: vi.fn(),
  getContentRequest: vi.fn(),
  updateContentRequest: vi.fn(),
}));
vi.mock('../../server/broadcast.js', () => ({
  broadcastToWorkspace: vi.fn(),
}));
vi.mock('../../server/activity-log.js', () => ({
  addActivity: vi.fn(),
}));

import { getWorkspace } from '../../server/workspaces.js';
import { buildContentGenerationContext } from '../../server/intelligence/generation-context-builders.js';
import { getBrief, upsertBrief } from '../../server/content-brief.js';
import { getPost, savePost } from '../../server/content-posts-db.js';
import { createContentRequest, getContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { broadcastToWorkspace } from '../../server/broadcast.js';
import { addActivity } from '../../server/activity-log.js';
import { contentActionTools, handleContentActionTool } from '../../server/mcp/tools/content-actions.js';

describe('mcp content action tools', () => {
  beforeEach(() => {
    __resetHandleStoreForTests();
    vi.clearAllMocks();
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'ws-1',
      name: 'Workspace',
    });
    (buildContentGenerationContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      promptContext: 'intel-context',
    });
    (createContentRequest as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'cr_1' });
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
  });

  it('registers content action tool names', () => {
    expect(contentActionTools.map(t => t.name)).toEqual([
      'prepare_brief_context',
      'save_brief',
      'prepare_post_context',
      'save_post',
      'send_to_client',
    ]);
  });

  it('prepare_brief_context returns a brief request handle', async () => {
    const result = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { brief_request_handle: string; prompt_context: string };
    expect(payload.brief_request_handle).toMatch(/^brief-request_/);
    expect(payload.prompt_context).toBe('intel-context');
  });

  it('save_brief persists brief, broadcasts, logs, and returns brief handle', async () => {
    const prepared = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };

    const result = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedPayload.brief_request_handle,
      content: {
        targetKeyword: 'hvac tips',
        secondaryKeywords: ['ac maintenance'],
        suggestedTitle: 'Best HVAC Tips',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2', notes: 'n' }],
        wordCountTarget: 1200,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });

    expect(result.isError).toBeUndefined();
    expect(upsertBrief).toHaveBeenCalledOnce();
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'brief:updated',
      expect.objectContaining({ action: 'mcp_brief_saved' }),
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'brief_generated',
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ source: 'mcp-chat' }),
    );
    const payload = JSON.parse(result.content[0].text) as { brief_handle: string };
    expect(payload.brief_handle).toMatch(/^brief_/);
  });

  it('prepare_post_context requires an existing brief', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const result = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_missing',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Brief not found/);
  });

  it('save_post persists + broadcasts', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const prepared = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { post_request_handle: string };
    const result = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPayload.post_request_handle,
      content: {
        briefId: 'brief_1',
        targetKeyword: 'hvac',
        title: 'Post title',
        metaDescription: 'Meta',
        introduction: '<p>Intro</p>',
        sections: [
          {
            index: 0,
            heading: 'H2',
            content: '<p>Body</p>',
            wordCount: 100,
            targetWordCount: 120,
            keywords: ['hvac'],
            status: 'done',
          },
        ],
        conclusion: '<p>End</p>',
        totalWordCount: 1000,
        targetWordCount: 1200,
      },
    });
    expect(result.isError).toBeUndefined();
    expect(savePost).toHaveBeenCalledOnce();
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'post:updated',
      expect.objectContaining({ action: 'mcp_post_saved' }),
    );
  });

  it('save_post rejects brief mismatch between handle and content payload', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const prepared = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { post_request_handle: string };
    const result = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPayload.post_request_handle,
      content: {
        briefId: 'brief_2',
        targetKeyword: 'hvac',
        title: 'Post title',
        metaDescription: 'Meta',
        introduction: '<p>Intro</p>',
        sections: [
          {
            index: 0,
            heading: 'H2',
            content: '<p>Body</p>',
            wordCount: 100,
            targetWordCount: 120,
            keywords: ['hvac'],
            status: 'done',
          },
        ],
        conclusion: '<p>End</p>',
        totalWordCount: 1000,
        targetWordCount: 1200,
      },
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/does not match prepared request briefId/);
    expect(savePost).not.toHaveBeenCalled();
  });

  it('save_post accepts parent_request_id and post send_to_client updates parent request', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const prepared = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { post_request_handle: string };

    const saved = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPayload.post_request_handle,
      parent_request_id: 'cr_parent_post',
      content: {
        briefId: 'brief_1',
        targetKeyword: 'hvac',
        title: 'Post title',
        metaDescription: 'Meta',
        introduction: '<p>Intro</p>',
        sections: [
          {
            index: 0,
            heading: 'H2',
            content: '<p>Body</p>',
            wordCount: 100,
            targetWordCount: 120,
            keywords: ['hvac'],
            status: 'done',
          },
        ],
        conclusion: '<p>End</p>',
        totalWordCount: 1000,
        targetWordCount: 1200,
      },
    });
    const savedPayload = JSON.parse(saved.content[0].text) as { post_id: string; post_handle: string };
    (getPost as ReturnType<typeof vi.fn>).mockReturnValue({
      id: savedPayload.post_id,
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac',
      title: 'Post title',
    });
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: 'cr_parent_post' });

    const result = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      post_handle: savedPayload.post_handle,
      note: 'Ready for client',
    });

    expect(result.isError).toBeUndefined();
    expect(createContentRequest).not.toHaveBeenCalled();
    expect(updateContentRequest).toHaveBeenCalledWith(
      'ws-1',
      'cr_parent_post',
      expect.objectContaining({
        briefId: 'brief_1',
        postId: savedPayload.post_id,
        status: 'post_review',
      }),
    );
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'content-request:update',
      expect.objectContaining({ id: 'cr_parent_post' }),
    );
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'post_sent_for_review',
      expect.stringContaining('for review'),
      expect.any(String),
      expect.objectContaining({
        source: 'mcp-chat',
        action: 'mcp_post_sent_to_client',
      }),
    );
  });

  it('send_to_client from brief handle creates a request', async () => {
    const prepared = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };
    const saved = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedPayload.brief_request_handle,
      content: {
        targetKeyword: 'hvac tips',
        secondaryKeywords: ['ac maintenance'],
        suggestedTitle: 'Best HVAC Tips',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2', notes: 'n' }],
        wordCountTarget: 1200,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string; brief_handle: string };
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: savedPayload.brief_id,
      suggestedTitle: 'Best HVAC Tips',
      targetKeyword: 'hvac tips',
    });

    const result = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_handle: savedPayload.brief_handle,
      note: 'Please review',
    });
    expect(result.isError).toBeUndefined();
    expect(createContentRequest).toHaveBeenCalledOnce();
    expect(updateContentRequest).toHaveBeenCalled();
    expect(addActivity).toHaveBeenCalledWith(
      'ws-1',
      'brief_sent_for_review',
      expect.stringContaining('for review'),
      expect.any(String),
      expect.objectContaining({
        source: 'mcp-chat',
        action: 'mcp_brief_sent_to_client',
      }),
    );
  });

  it('send_to_client updates existing parent request with update event', async () => {
    const prepared = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };
    const parentRequestId = 'cr_parent';
    const saved = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedPayload.brief_request_handle,
      parent_request_id: parentRequestId,
      content: {
        targetKeyword: 'hvac tips',
        secondaryKeywords: ['ac maintenance'],
        suggestedTitle: 'Best HVAC Tips',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2', notes: 'n' }],
        wordCountTarget: 1200,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_id: string; brief_handle: string };
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: savedPayload.brief_id,
      suggestedTitle: 'Best HVAC Tips',
      targetKeyword: 'hvac tips',
      intent: 'informational',
      pageType: 'blog',
    });
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValueOnce({ id: parentRequestId });

    const result = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_handle: savedPayload.brief_handle,
      note: 'Please review',
    });

    expect(result.isError).toBeUndefined();
    expect(createContentRequest).not.toHaveBeenCalled();
    expect(updateContentRequest).toHaveBeenCalledWith(
      'ws-1',
      parentRequestId,
      expect.objectContaining({
        briefId: savedPayload.brief_id,
        status: 'client_review',
      }),
    );
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'content-request:update',
      expect.objectContaining({ id: parentRequestId }),
    );
  });
});
