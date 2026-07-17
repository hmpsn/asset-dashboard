import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { STUDIO_NAME } from '../../server/constants.js';
import {
  addNote,
  createRequest,
  getPendingRepliesSummary,
  updateRequest,
} from '../../server/requests.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

describe('getPendingRepliesSummary', () => {
  let workspaceId = '';

  beforeEach(() => {
    workspaceId = createWorkspace('Pending Replies Unit Workspace').id;
  });

  afterEach(() => {
    deleteWorkspace(workspaceId);
  });

  it('classifies by newest author, excludes operator-created and terminal threads, and orders by recency', async () => {
    createRequest(workspaceId, {
      title: 'Operator-created task',
      description: 'This is work for the client, not a client reply.',
      category: 'content',
      submittedBy: STUDIO_NAME,
    });
    const first = createRequest(workspaceId, {
      title: 'Client thread',
      description: 'The initial client message is unanswered.',
      category: 'seo',
      submittedBy: 'Acme client',
    });

    expect(getPendingRepliesSummary(workspaceId)).toMatchObject({
      count: 1,
      requestIds: [first.id],
    });

    addNote(workspaceId, first.id, 'team', 'We replied.');
    expect(getPendingRepliesSummary(workspaceId).count).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const firstReply = addNote(workspaceId, first.id, 'client', 'A new client reply.');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newest = createRequest(workspaceId, {
      title: 'Newest client thread',
      description: 'This should lead the ordered summary.',
      category: 'feature',
      submittedBy: 'Acme client',
    });

    expect(getPendingRepliesSummary(workspaceId)).toEqual({
      count: 2,
      requestIds: [newest.id, first.id],
      newestAt: newest.createdAt,
    });

    updateRequest(workspaceId, newest.id, { status: 'completed' });
    expect(getPendingRepliesSummary(workspaceId)).toEqual({
      count: 1,
      requestIds: [first.id],
      newestAt: firstReply?.updatedAt,
    });
  });
});
