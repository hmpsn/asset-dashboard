import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHandleStoreForTests } from '../../server/mcp/handles.js';

vi.mock('../../server/workspaces.js', () => ({
  getWorkspace: vi.fn(),
}));
vi.mock('../../server/intelligence/generation-context-builders.js', () => ({
  buildContentGenerationContext: vi.fn(),
}));
vi.mock('../../server/content-brief.js', () => ({
  deleteBrief: vi.fn(),
  getBrief: vi.fn(),
  listBriefs: vi.fn(),
  updateBrief: vi.fn(),
  upsertBrief: vi.fn(),
}));
vi.mock('../../server/content-posts-db.js', () => ({
  deletePost: vi.fn(),
  getPost: vi.fn(),
  listPostVersions: vi.fn(),
  listPosts: vi.fn(),
  revertToVersion: vi.fn(),
  savePost: vi.fn(),
  updatePostField: vi.fn(),
}));
vi.mock('../../server/content-requests.js', () => ({
  createContentRequest: vi.fn(),
  getContentRequest: vi.fn(),
  listContentRequests: vi.fn(),
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
import { deleteBrief, getBrief, listBriefs, updateBrief, upsertBrief } from '../../server/content-brief.js';
import { deletePost, getPost, listPostVersions, listPosts, revertToVersion, savePost, updatePostField } from '../../server/content-posts-db.js';
import { createContentRequest, getContentRequest, listContentRequests, updateContentRequest } from '../../server/content-requests.js';
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
    (listBriefs as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (updateBrief as ReturnType<typeof vi.fn>).mockImplementation((_: string, __: string, updates: unknown) => ({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'kw',
      secondaryKeywords: [],
      suggestedTitle: 'Title',
      suggestedMetaDesc: 'Meta',
      outline: [],
      wordCountTarget: 1000,
      intent: 'informational',
      audience: 'general',
      competitorInsights: '',
      internalLinkSuggestions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      ...updates as Record<string, unknown>,
    }));
    (listPosts as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (updatePostField as ReturnType<typeof vi.fn>).mockImplementation((_: string, postId: string, updates: unknown) => ({
      id: postId,
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'kw',
      title: 'Post title',
      metaDescription: 'Meta',
      introduction: '<p>Intro</p>',
      sections: [],
      conclusion: '<p>End</p>',
      totalWordCount: 100,
      targetWordCount: 120,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...updates as Record<string, unknown>,
    }));
    (createContentRequest as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'cr_1' });
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    (listContentRequests as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (deleteBrief as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (deletePost as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (listPostVersions as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (revertToVersion as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it('registers content action tool names', () => {
    expect(contentActionTools.map(t => t.name)).toEqual([
      'list_briefs',
      'get_brief',
      'update_brief',
      'list_posts',
      'get_post',
      'update_post',
      'prepare_brief_context',
      'save_brief',
      'prepare_post_context',
      'save_post',
      'send_to_client',
      'list_content_requests',
      'get_content_request',
      'create_content_request',
      'delete_brief',
      'delete_post',
      'list_post_versions',
      'revert_post_version',
    ]);
  });

  it('lists, gets, and creates content requests', async () => {
    (listContentRequests as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'cr_1',
        topic: 'Topic',
        targetKeyword: 'kw',
        status: 'requested',
        priority: 'medium',
        serviceType: 'brief_only',
        pageType: 'blog',
        requestedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'cr_1',
      topic: 'Topic',
      targetKeyword: 'kw',
      status: 'requested',
      priority: 'medium',
      serviceType: 'brief_only',
      pageType: 'blog',
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const listed = await handleContentActionTool('list_content_requests', { workspace_id: 'ws-1' });
    expect(listed.isError).toBeUndefined();
    const listPayload = JSON.parse(listed.content[0].text) as { requests: Array<{ request_id: string }> };
    expect(listPayload.requests).toHaveLength(1);
    expect(listPayload.requests[0]?.request_id).toBe('cr_1');

    const fetched = await handleContentActionTool('get_content_request', { workspace_id: 'ws-1', request_id: 'cr_1' });
    expect(fetched.isError).toBeUndefined();

    const created = await handleContentActionTool('create_content_request', {
      workspace_id: 'ws-1',
      topic: 'Topic',
      target_keyword: 'keyword',
    });
    expect(created.isError).toBeUndefined();
    expect(createContentRequest).toHaveBeenCalledWith(
      'ws-1',
      expect.objectContaining({ topic: 'Topic', targetKeyword: 'keyword' }),
    );
  });

  it('create_content_request does not emit created side effects when dedupe returns existing request', async () => {
    (listContentRequests as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'cr_existing',
        topic: 'Existing Topic',
        targetKeyword: 'keyword',
        status: 'requested',
        priority: 'medium',
        requestedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    (createContentRequest as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'cr_existing',
      topic: 'Existing Topic',
      targetKeyword: 'keyword',
      status: 'requested',
      priority: 'medium',
      requestedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const created = await handleContentActionTool('create_content_request', {
      workspace_id: 'ws-1',
      topic: 'Existing Topic',
      target_keyword: 'keyword',
    });
    expect(created.isError).toBeUndefined();
    const payload = JSON.parse(created.content[0].text) as { created: boolean; deduped: boolean };
    expect(payload.created).toBe(false);
    expect(payload.deduped).toBe(true);
    expect(broadcastToWorkspace).not.toHaveBeenCalled();
    expect(addActivity).not.toHaveBeenCalled();
  });

  it('lists and fetches briefs with revision tokens', async () => {
    const brief = {
      id: 'brief_1',
      workspaceId: 'ws-1',
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
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    (listBriefs as ReturnType<typeof vi.fn>).mockReturnValue([brief]);
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue(brief);

    const listed = await handleContentActionTool('list_briefs', { workspace_id: 'ws-1' });
    expect(listed.isError).toBeUndefined();
    const listedPayload = JSON.parse(listed.content[0].text) as { briefs: Array<{ brief_id: string; revision: string }> };
    expect(listedPayload.briefs).toHaveLength(1);
    expect(listedPayload.briefs[0].brief_id).toBe('brief_1');
    expect(typeof listedPayload.briefs[0].revision).toBe('string');

    const fetched = await handleContentActionTool('get_brief', { workspace_id: 'ws-1', brief_id: 'brief_1' });
    expect(fetched.isError).toBeUndefined();
    const fetchedPayload = JSON.parse(fetched.content[0].text) as { brief: { id: string }; revision: string };
    expect(fetchedPayload.brief.id).toBe('brief_1');
    expect(typeof fetchedPayload.revision).toBe('string');
  });

  it('updates brief in patch and replace modes with revision checks', async () => {
    const baseBrief = {
      id: 'brief_1',
      workspaceId: 'ws-1',
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
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue(baseBrief);

    const fetched = await handleContentActionTool('get_brief', { workspace_id: 'ws-1', brief_id: 'brief_1' });
    const revision = (JSON.parse(fetched.content[0].text) as { revision: string }).revision;

    const patched = await handleContentActionTool('update_brief', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_revision: revision,
      mode: 'patch',
      updates: { suggestedTitle: 'Tighter HVAC Tips' },
    });
    expect(patched.isError).toBeUndefined();
    expect(updateBrief).toHaveBeenCalledWith('ws-1', 'brief_1', expect.objectContaining({ suggestedTitle: 'Tighter HVAC Tips' }));
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'brief:updated', expect.objectContaining({ action: 'mcp_brief_updated' }));

    const replaced = await handleContentActionTool('update_brief', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_revision: revision,
      mode: 'replace',
      content: {
        targetKeyword: 'hvac checklist',
        secondaryKeywords: ['ac tuneup'],
        suggestedTitle: 'HVAC Checklist',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2', notes: 'n' }],
        wordCountTarget: 1000,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });
    expect(replaced.isError).toBeUndefined();

    const conflicted = await handleContentActionTool('update_brief', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
      expected_revision: 'stale-revision',
      mode: 'patch',
      updates: { suggestedTitle: 'Should fail' },
    });
    expect(conflicted.isError).toBe(true);
    expect(conflicted.content[0].text).toContain('Revision conflict');
  });

  it('lists, fetches, and updates posts with revision checks', async () => {
    const basePost = {
      id: 'post_1',
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac tips',
      title: 'Post title',
      metaDescription: 'Meta',
      introduction: '<p>Intro</p>',
      sections: [{
        index: 0,
        heading: 'H2',
        content: '<p>Body</p>',
        wordCount: 1,
        targetWordCount: 120,
        keywords: ['hvac'],
        status: 'done' as const,
      }],
      conclusion: '<p>End</p>',
      totalWordCount: 3,
      targetWordCount: 1200,
      status: 'draft' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    (listPosts as ReturnType<typeof vi.fn>).mockReturnValue([basePost]);
    (getPost as ReturnType<typeof vi.fn>).mockReturnValue(basePost);

    const listed = await handleContentActionTool('list_posts', { workspace_id: 'ws-1' });
    expect(listed.isError).toBeUndefined();
    const listedPayload = JSON.parse(listed.content[0].text) as { posts: Array<{ post_id: string; revision: string }> };
    expect(listedPayload.posts[0].post_id).toBe('post_1');

    const fetched = await handleContentActionTool('get_post', { workspace_id: 'ws-1', post_id: 'post_1' });
    const revision = (JSON.parse(fetched.content[0].text) as { revision: string }).revision;

    const patched = await handleContentActionTool('update_post', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
      expected_revision: revision,
      mode: 'patch',
      updates: { title: 'Updated title', sections: [{ index: 0, content: '<p>Updated body</p>' }] },
    });
    expect(patched.isError).toBeUndefined();
    expect(updatePostField).toHaveBeenCalled();

    const conflicted = await handleContentActionTool('update_post', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
      expected_revision: 'stale-revision',
      mode: 'patch',
      updates: { title: 'Should fail' },
    });
    expect(conflicted.isError).toBe(true);
    expect(conflicted.content[0].text).toContain('Revision conflict');
  });

  it('applies optional status/page_type filters to list_briefs and list_posts', async () => {
    (listBriefs as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'brief_blog',
        workspaceId: 'ws-1',
        targetKeyword: 'hvac blog',
        secondaryKeywords: [],
        suggestedTitle: 'Blog brief',
        suggestedMetaDesc: 'Meta',
        outline: [],
        wordCountTarget: 1000,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: '',
        internalLinkSuggestions: [],
        pageType: 'blog',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'brief_service',
        workspaceId: 'ws-1',
        targetKeyword: 'hvac service',
        secondaryKeywords: [],
        suggestedTitle: 'Service brief',
        suggestedMetaDesc: 'Meta',
        outline: [],
        wordCountTarget: 1000,
        intent: 'commercial',
        audience: 'homeowners',
        competitorInsights: '',
        internalLinkSuggestions: [],
        pageType: 'service',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);
    (listContentRequests as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 'req1', briefId: 'brief_blog', status: 'approved', updatedAt: '2026-01-02T00:00:00.000Z' },
      { id: 'req2', briefId: 'brief_service', status: 'requested', updatedAt: '2026-01-03T00:00:00.000Z' },
    ]);

    const briefs = await handleContentActionTool('list_briefs', {
      workspace_id: 'ws-1',
      status: 'approved',
      page_type: 'blog',
    });
    const briefPayload = JSON.parse(briefs.content[0].text) as { briefs: Array<{ brief_id: string; status: string | null }> };
    expect(briefPayload.briefs).toHaveLength(1);
    expect(briefPayload.briefs[0]).toMatchObject({ brief_id: 'brief_blog', status: 'approved' });

    (listPosts as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'post_blog',
        workspaceId: 'ws-1',
        briefId: 'brief_blog',
        targetKeyword: 'hvac blog',
        title: 'Blog post',
        metaDescription: 'Meta',
        introduction: '<p>Intro</p>',
        sections: [],
        conclusion: '<p>End</p>',
        totalWordCount: 120,
        targetWordCount: 120,
        status: 'draft',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'post_service',
        workspaceId: 'ws-1',
        briefId: 'brief_service',
        targetKeyword: 'hvac service',
        title: 'Service post',
        metaDescription: 'Meta',
        introduction: '<p>Intro</p>',
        sections: [],
        conclusion: '<p>End</p>',
        totalWordCount: 120,
        targetWordCount: 120,
        status: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const posts = await handleContentActionTool('list_posts', {
      workspace_id: 'ws-1',
      status: 'approved',
      page_type: 'service',
    });
    const postPayload = JSON.parse(posts.content[0].text) as {
      posts: Array<{ post_id: string; page_type: string | null; status: string }>;
    };
    expect(postPayload.posts).toHaveLength(1);
    expect(postPayload.posts[0]).toMatchObject({ post_id: 'post_service', page_type: 'service', status: 'approved' });
  });

  it('supports delete_brief and delete_post mutation tools', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
      suggestedTitle: 'HVAC brief',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    const briefDeleted = await handleContentActionTool('delete_brief', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    expect(briefDeleted.isError).toBeUndefined();
    expect(deleteBrief).toHaveBeenCalledWith('ws-1', 'brief_1');
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'content:updated', expect.objectContaining({ action: 'mcp_brief_deleted' }));

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const missingBrief = await handleContentActionTool('delete_brief', {
      workspace_id: 'ws-1',
      brief_id: 'brief_missing',
    });
    expect(missingBrief.isError).toBe(true);

    (getPost as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'post_1',
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac',
      title: 'HVAC post',
      metaDescription: 'Meta',
      introduction: '<p>Intro</p>',
      sections: [],
      conclusion: '<p>End</p>',
      totalWordCount: 100,
      targetWordCount: 120,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const postDeleted = await handleContentActionTool('delete_post', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
    });
    expect(postDeleted.isError).toBeUndefined();
    expect(deletePost).toHaveBeenCalledWith('ws-1', 'post_1');
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'post:updated', expect.objectContaining({ action: 'mcp_post_deleted' }));

    (getPost as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const missingPost = await handleContentActionTool('delete_post', {
      workspace_id: 'ws-1',
      post_id: 'post_missing',
    });
    expect(missingPost.isError).toBe(true);
  });

  it('supports list_post_versions and revert_post_version branches', async () => {
    (getPost as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'post_1',
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac',
      title: 'HVAC post',
      metaDescription: 'Meta',
      introduction: '<p>Intro</p>',
      sections: [],
      conclusion: '<p>End</p>',
      totalWordCount: 100,
      targetWordCount: 120,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    (listPostVersions as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        id: 'ver_1',
        workspaceId: 'ws-1',
        postId: 'post_1',
        versionNumber: 1,
        trigger: 'manual_edit',
        triggerDetail: 'before review',
        totalWordCount: 100,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const listed = await handleContentActionTool('list_post_versions', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
    });
    const listedPayload = JSON.parse(listed.content[0].text) as { versions: Array<{ version_id: string }> };
    expect(listedPayload.versions).toHaveLength(1);
    expect(listedPayload.versions[0]?.version_id).toBe('ver_1');

    (revertToVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'post_1',
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac',
      title: 'HVAC reverted',
      metaDescription: 'Meta',
      introduction: '<p>Intro</p>',
      sections: [],
      conclusion: '<p>End</p>',
      totalWordCount: 100,
      targetWordCount: 120,
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });

    const reverted = await handleContentActionTool('revert_post_version', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
      version_id: 'ver_1',
    });
    expect(reverted.isError).toBeUndefined();
    expect(revertToVersion).toHaveBeenCalledWith('ws-1', 'post_1', 'ver_1');
    expect(broadcastToWorkspace).toHaveBeenCalledWith('ws-1', 'post:updated', expect.objectContaining({ action: 'mcp_post_reverted' }));

    (revertToVersion as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const missing = await handleContentActionTool('revert_post_version', {
      workspace_id: 'ws-1',
      post_id: 'post_1',
      version_id: 'ver_missing',
    });
    expect(missing.isError).toBe(true);
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

  it('send_to_client supports brief_id without a handle', async () => {
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_123',
      workspaceId: 'ws-1',
      targetKeyword: 'kw',
      secondaryKeywords: [],
      suggestedTitle: 'Brief title',
      suggestedMetaDesc: 'Meta',
      outline: [],
      wordCountTarget: 1000,
      intent: 'informational',
      audience: 'audience',
      competitorInsights: '',
      internalLinkSuggestions: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    (createContentRequest as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'cr_123' });

    const result = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_id: 'brief_123',
    });

    expect(result.isError).toBeUndefined();
    const payload = JSON.parse(result.content[0].text) as { request_id: string; target: string };
    expect(payload.request_id).toBe('cr_123');
    expect(payload.target).toBe('brief');
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

  it('returns validation/workspace errors and unknown tool errors', async () => {
    const invalid = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
    });
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toContain('Validation failed');

    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const noWorkspace = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-missing',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    expect(noWorkspace.isError).toBe(true);
    expect(noWorkspace.content[0].text).toContain('Workspace not found');

    const unknown = await handleContentActionTool('unknown_content_action', { workspace_id: 'ws-1' });
    expect(unknown.isError).toBe(true);
    expect(unknown.content[0].text).toContain('Unknown content action tool');
  });

  it('returns context-build errors in prepare flows', async () => {
    (buildContentGenerationContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('context failed'));
    const briefCtx = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    expect(briefCtx.isError).toBe(true);
    expect(briefCtx.content[0].text).toContain('Failed to prepare brief context: context failed');

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    (buildContentGenerationContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce('boom');
    const postCtx = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    expect(postCtx.isError).toBe(true);
    expect(postCtx.content[0].text).toContain('Failed to prepare post context: boom');
  });

  it('returns handle and parent-request update failures for save paths', async () => {
    const badBriefHandle = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: 'brief-request_00000000-0000-0000-0000-000000000000',
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
    expect(badBriefHandle.isError).toBe(true);

    const preparedBrief = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    (updateContentRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('request write failed');
    });
    const failedParentBrief = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedBriefPayload.brief_request_handle,
      parent_request_id: 'cr_parent',
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
    expect(failedParentBrief.isError).toBe(true);
    expect(failedParentBrief.content[0].text).toContain('Brief saved but failed to update parent request');

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const preparedPost = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };
    (updateContentRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error('post parent write failed');
    });
    const failedParentPost = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPostPayload.post_request_handle,
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
    expect(failedParentPost.isError).toBe(true);
    expect(failedParentPost.content[0].text).toContain('Post saved but failed to update parent request');
  });

  it('returns send_to_client failures for missing entities and invalid handles', async () => {
    const invalidHandle = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_handle: 'brief_00000000-0000-0000-0000-000000000000',
      note: 'Please review',
    });
    expect(invalidHandle.isError).toBe(true);

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
    const savedPayload = JSON.parse(saved.content[0].text) as { brief_handle: string };
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const missingBrief = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_handle: savedPayload.brief_handle,
      note: 'Please review',
    });
    expect(missingBrief.isError).toBe(true);
    expect(missingBrief.content[0].text).toContain('Brief not found');

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const preparedPost = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };

    const savedPost = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPostPayload.post_request_handle,
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
    if (!savedPost.isError) {
      const postPayload = JSON.parse(savedPost.content[0].text) as { post_handle: string };
      (getPost as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
      const missingPost = await handleContentActionTool('send_to_client', {
        workspace_id: 'ws-1',
        post_handle: postPayload.post_handle,
      });
      expect(missingPost.isError).toBe(true);
      expect(missingPost.content[0].text).toContain('Post not found');
    }
  });

  it('normalizes brief outline notes and handles non-Error throws in brief paths', async () => {
    (buildContentGenerationContext as ReturnType<typeof vi.fn>).mockRejectedValueOnce('plain-failure');
    const prepFailure = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    expect(prepFailure.isError).toBe(true);
    expect(prepFailure.content[0].text).toContain('Failed to prepare brief context: plain-failure');

    const prepared = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedPayload = JSON.parse(prepared.content[0].text) as { brief_request_handle: string };

    await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedPayload.brief_request_handle,
      content: {
        targetKeyword: 'hvac tips',
        secondaryKeywords: ['ac maintenance'],
        suggestedTitle: 'Best HVAC Tips',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2' }],
        wordCountTarget: 1200,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });
    const savedBrief = (upsertBrief as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1] as { outline: Array<{ notes: string }> };
    expect(savedBrief.outline[0]?.notes).toBe('');

    const preparedForParent = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedForParentPayload = JSON.parse(preparedForParent.content[0].text) as { brief_request_handle: string };

    (updateContentRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'brief-parent-failed';
    });
    const failedParent = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedForParentPayload.brief_request_handle,
      parent_request_id: 'cr_parent',
      content: {
        targetKeyword: 'hvac tips',
        secondaryKeywords: ['ac maintenance'],
        suggestedTitle: 'Best HVAC Tips',
        suggestedMetaDesc: 'Meta',
        outline: [{ heading: 'H2', notes: 'x' }],
        wordCountTarget: 1200,
        intent: 'informational',
        audience: 'homeowners',
        competitorInsights: 'none',
        internalLinkSuggestions: ['/a'],
      },
    });
    expect(failedParent.isError).toBe(true);
    expect(failedParent.content[0].text).toContain('brief-parent-failed');
  });

  it('covers validation/workspace and catch branches for post paths', async () => {
    const invalidPrepare = await handleContentActionTool('prepare_post_context', { workspace_id: 'ws-1' });
    expect(invalidPrepare.isError).toBe(true);

    const invalidSave = await handleContentActionTool('save_post', { workspace_id: 'ws-1' });
    expect(invalidSave.isError).toBe(true);

    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const noWorkspacePrepare = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-missing',
      brief_id: 'brief_1',
    });
    expect(noWorkspacePrepare.isError).toBe(true);

    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const noWorkspaceSave = await handleContentActionTool('save_post', {
      workspace_id: 'ws-missing',
      post_request_handle: 'post-request_00000000-0000-0000-0000-000000000000',
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
    expect(noWorkspaceSave.isError).toBe(true);

    const badHandle = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: 'post-request_00000000-0000-0000-0000-000000000000',
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
    expect(badHandle.isError).toBe(true);

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const preparedPost = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };
    (updateContentRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'post-parent-failed';
    });
    const failedParent = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPostPayload.post_request_handle,
      parent_request_id: 'cr_parent',
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
    expect(failedParent.isError).toBe(true);
    expect(failedParent.content[0].text).toContain('post-parent-failed');
  });

  it('covers send_to_client validation/workspace and post-create request branches', async () => {
    const invalid = await handleContentActionTool('send_to_client', { workspace_id: 'ws-1' });
    expect(invalid.isError).toBe(true);

    const preparedBrief = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    const savedBrief = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedBriefPayload.brief_request_handle,
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
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_handle: string };

    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const noWorkspace = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-missing',
      brief_handle: savedBriefPayload.brief_handle,
    });
    expect(noWorkspace.isError).toBe(true);
    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValue({ id: 'ws-1', name: 'Workspace' });

    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      workspaceId: 'ws-1',
      targetKeyword: 'hvac',
    });
    const preparedPost = await handleContentActionTool('prepare_post_context', {
      workspace_id: 'ws-1',
      brief_id: 'brief_1',
    });
    const preparedPostPayload = JSON.parse(preparedPost.content[0].text) as { post_request_handle: string };
    const savedPost = await handleContentActionTool('save_post', {
      workspace_id: 'ws-1',
      post_request_handle: preparedPostPayload.post_request_handle,
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
    expect(savedPost.isError).toBeUndefined();
    const savedPostPayload = JSON.parse(savedPost.content[0].text) as { post_id: string; post_handle: string };
    (getPost as ReturnType<typeof vi.fn>).mockReturnValue({
      id: savedPostPayload.post_id,
      workspaceId: 'ws-1',
      briefId: 'brief_1',
      targetKeyword: 'hvac',
      title: 'Post title',
    });
    (getContentRequest as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const sent = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      post_handle: savedPostPayload.post_handle,
      note: 'Please review',
    });
    expect(sent.isError).toBeUndefined();
    expect(createContentRequest).toHaveBeenCalled();
    expect(broadcastToWorkspace).toHaveBeenCalledWith(
      'ws-1',
      'content-request:created',
      expect.objectContaining({ id: 'cr_1' }),
    );
  });

  it('covers remaining prepare/save validation and send_to_client catch fallback', async () => {
    const invalidPrepareBrief = await handleContentActionTool('prepare_brief_context', {});
    expect(invalidPrepareBrief.isError).toBe(true);

    (getWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce(undefined);
    const saveBriefNoWorkspace = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-missing',
      brief_request_handle: 'brief-request_00000000-0000-0000-0000-000000000000',
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
    expect(saveBriefNoWorkspace.isError).toBe(true);

    const preparedBrief = await handleContentActionTool('prepare_brief_context', {
      workspace_id: 'ws-1',
      topic: 'HVAC tips',
      layout: { type: 'outline', structure: { sections: [{ heading: { level: 1, text: 'Intro' } }] } },
    });
    const preparedBriefPayload = JSON.parse(preparedBrief.content[0].text) as { brief_request_handle: string };
    const savedBrief = await handleContentActionTool('save_brief', {
      workspace_id: 'ws-1',
      brief_request_handle: preparedBriefPayload.brief_request_handle,
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
    const savedBriefPayload = JSON.parse(savedBrief.content[0].text) as { brief_handle: string };

    (createContentRequest as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw 'send-to-client-exploded';
    });
    (getBrief as ReturnType<typeof vi.fn>).mockReturnValue({
      id: 'brief_1',
      suggestedTitle: 'Best HVAC Tips',
      targetKeyword: 'hvac tips',
      intent: 'informational',
      pageType: 'blog',
    });
    const sendFailure = await handleContentActionTool('send_to_client', {
      workspace_id: 'ws-1',
      brief_handle: savedBriefPayload.brief_handle,
      note: 'Please review',
    });
    expect(sendFailure.isError).toBe(true);
    expect(sendFailure.content[0].text).toContain('send-to-client-exploded');
  });
});
