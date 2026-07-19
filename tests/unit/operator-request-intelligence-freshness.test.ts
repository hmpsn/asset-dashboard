import { afterEach, describe, expect, it } from 'vitest';
import { createRequest, updateRequest } from '../../server/requests.js';
import { invalidateIntelligenceCache } from '../../server/intelligence/cache-invalidation.js';
import { buildWorkspaceIntelligence } from '../../server/workspace-intelligence.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

let workspace: SeededFullWorkspace | undefined;

afterEach(() => {
  if (workspace) invalidateIntelligenceCache(workspace.workspaceId);
  workspace?.cleanup();
  workspace = undefined;
});

describe('request-backed operator intelligence freshness', () => {
  it('invalidates cached operational decisions after request create and status changes', async () => {
    workspace = seedWorkspace();
    const before = await buildWorkspaceIntelligence(workspace.workspaceId, {
      slices: ['operational'],
    });
    expect(before.operational?.pendingDecisions?.counts.requests).toBe(0);

    const request = createRequest(workspace.workspaceId, {
      title: 'Review the new service page',
      description: 'Please review the service page.',
      category: 'content',
      priority: 'high',
    });
    const afterCreate = await buildWorkspaceIntelligence(workspace.workspaceId, {
      slices: ['operational'],
    });
    expect(afterCreate.operational?.pendingDecisions?.items).toContainEqual(
      expect.objectContaining({ sourceType: 'client_request', sourceId: request.id }),
    );

    updateRequest(workspace.workspaceId, request.id, { status: 'in_review' });
    const afterStatusChange = await buildWorkspaceIntelligence(workspace.workspaceId, {
      slices: ['operational'],
    });
    expect(afterStatusChange.operational?.pendingDecisions?.items)
      .not.toContainEqual(expect.objectContaining({ sourceId: request.id }));
  });
});
