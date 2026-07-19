/**
 * Integration tests: GET /api/workspace-badges/:id
 *
 * Covers:
 *   - 404 for unknown workspace
 *   - Fresh workspace → zero pending content and reply counts
 *   - Pending replies follow the last-author server contract
 *   - Shape validation: all fields present and correctly typed
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { addNote, createRequest } from '../../server/requests.js';

const ctx = createEphemeralTestContext(import.meta.url);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Workspace Badges Routes WS').id;
}, 25_000);

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('GET /api/workspace-badges/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspace-badges/ws_does_not_exist_badges_99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(typeof body.error).toBe('string');
  });

  it('returns 200 for a fresh workspace', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    expect(res.status).toBe(200);
  });

  it('returns zero pending counts for a fresh workspace', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      pendingRequests: number;
      hasContent: boolean;
      pendingReplies: { count: number; requestIds: string[]; newestAt: string | null };
    };
    expect(body.pendingRequests).toBe(0);
    expect(body.hasContent).toBe(false);
    expect(body.pendingReplies).toEqual({ count: 0, requestIds: [], newestAt: null });
  });

  it('returns a number for pendingRequests field', async () => {
    const res = await api(`/api/workspace-badges/${wsId}`);
    const body = await res.json() as {
      pendingRequests: number;
      hasContent: boolean;
      pendingReplies: { count: number; requestIds: string[]; newestAt: string | null };
    };
    expect(typeof body.pendingRequests).toBe('number');
    expect(typeof body.hasContent).toBe('boolean');
    expect(typeof body.pendingReplies.count).toBe('number');
    expect(Array.isArray(body.pendingReplies.requestIds)).toBe(true);
  });

  it('counts only non-terminal requests whose newest message is from the client', async () => {
    const waiting = createRequest(wsId, {
      title: 'Waiting client request',
      description: 'A client-created request starts pending.',
      category: 'seo',
      submittedBy: 'Acme client',
    });
    const replied = createRequest(wsId, {
      title: 'Team replied request',
      description: 'The team has already answered.',
      category: 'content',
      submittedBy: 'Acme client',
    });
    addNote(wsId, replied.id, 'team', 'We are on it.');

    let res = await api(`/api/workspace-badges/${wsId}`);
    let body = await res.json() as {
      pendingReplies: { count: number; requestIds: string[]; newestAt: string | null };
    };
    expect(body.pendingReplies.count).toBe(1);
    expect(body.pendingReplies.requestIds).toEqual([waiting.id]);
    expect(body.pendingReplies.newestAt).toBe(waiting.createdAt);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const clientReply = addNote(wsId, replied.id, 'client', 'One more detail from us.');
    res = await api(`/api/workspace-badges/${wsId}`);
    body = await res.json() as {
      pendingReplies: { count: number; requestIds: string[]; newestAt: string | null };
    };
    expect(body.pendingReplies.count).toBe(2);
    expect(body.pendingReplies.requestIds).toEqual([replied.id, waiting.id]);
    expect(body.pendingReplies.newestAt).toBe(clientReply?.updatedAt);
  });
});
