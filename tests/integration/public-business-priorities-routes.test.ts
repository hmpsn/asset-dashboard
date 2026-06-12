/**
 * Integration tests for client-facing business priorities routes.
 *
 * Covers:
 * - GET  /api/public/business-priorities/:workspaceId
 * - POST /api/public/business-priorities/:workspaceId
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { CLIENT_BUSINESS_PRIORITIES_MARKER } from '../../server/schemas/client-business-priorities.js';
import { getWorkspace, updateWorkspace } from '../../server/workspaces.js';
import type { ClientSignalsSlice } from '../../shared/types/intelligence.js';
import type { KeywordStrategy } from '../../shared/types/workspace.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createEphemeralTestContext } from './helpers.js';

const ctx = createEphemeralTestContext(import.meta.url, { autoPublicAuth: true });
const { api } = ctx;

let wsId = '';
let otherWsId = '';
let cleanupA: (() => void) | undefined;
let cleanupB: (() => void) | undefined;
let clientUserId = '';
let clientToken = '';
let otherClientUserId = '';
let otherClientToken = '';

function buildKeywordStrategy(businessContext = 'Existing context'): KeywordStrategy {
  return {
    siteKeywords: [],
    opportunities: [],
    contentGaps: [],
    quickWins: [],
    keywordGaps: [],
    businessContext,
    generatedAt: new Date().toISOString(),
  };
}

async function clientPostJson(path: string, body: unknown, workspaceId = wsId, token = clientToken): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${workspaceId}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

function getStoredPriorities(workspaceId = wsId): unknown[] | null {
  const row = db.prepare('SELECT priorities FROM client_business_priorities WHERE workspace_id = ?').get(workspaceId) as
    | { priorities: string }
    | undefined;
  return row ? JSON.parse(row.priorities) as unknown[] : null;
}

function seedLegacyPriorities(workspaceId = wsId) {
  db.prepare(`
    INSERT INTO client_business_priorities (workspace_id, priorities, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(workspace_id) DO UPDATE SET
      priorities = excluded.priorities,
      updated_at = datetime('now')
  `).run(workspaceId, JSON.stringify([
    'Launch APAC market',
    { text: 'Expand brand awareness', category: 'brand' },
    { text: '   ', category: 'growth' },
  ]));
}

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  otherWsId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;
  updateWorkspace(wsId, { keywordStrategy: buildKeywordStrategy() });
  updateWorkspace(otherWsId, { keywordStrategy: buildKeywordStrategy('Other workspace context') });
  seedLegacyPriorities(wsId);

  const user = await createClientUser(
    `priorities-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Priorities Client',
    wsId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);

  const otherUser = await createClientUser(
    `priorities-other-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Other Priorities Client',
    otherWsId,
    'client_member',
  );
  otherClientUserId = otherUser.id;
  otherClientToken = signClientToken(otherUser);
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();

  db.prepare('DELETE FROM client_business_priorities WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  if (otherClientUserId) deleteClientUser(otherClientUserId, otherWsId);
  cleanupA?.();
  cleanupB?.();
});

describe('Public business priorities reads', () => {
  it('normalizes stored legacy string and object priorities', async () => {
    const res = await api(`/api/public/business-priorities/${wsId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priorities).toEqual([
      { text: 'Launch APAC market', category: 'other' },
      { text: 'Expand brand awareness', category: 'brand' },
    ]);
    expect(body.updatedAt).toBeTruthy();
  });
});

describe('Public business priorities mutations', () => {
  beforeEach(() => {
    seedLegacyPriorities(wsId);
    updateWorkspace(wsId, { keywordStrategy: buildKeywordStrategy() });
  });

  it('requires client auth before validating malformed priority payloads', async () => {
    const res = await api(`/api/public/business-priorities/${wsId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
      body: JSON.stringify({ priorities: [null] }),
    });

    expect(res.status).toBe(401);
    expect(getStoredPriorities(wsId)).toHaveLength(3);
  });

  it('rejects malformed priority items without changing stored priorities or strategy context', async () => {
    const beforePriorities = getStoredPriorities(wsId);
    const beforeContext = getWorkspace(wsId)?.keywordStrategy?.businessContext;

    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [null],
    });

    expect(res.status).toBe(400);
    expect(getStoredPriorities(wsId)).toEqual(beforePriorities);
    expect(getWorkspace(wsId)?.keywordStrategy?.businessContext).toBe(beforeContext);
  });

  it('saves valid priorities and injects them into workspace strategy context', async () => {
    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [
        { text: '  Grow enterprise pipeline  ', category: 'growth' },
        { text: 'Clarify premium positioning', category: 'brand' },
      ],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      saved: 2,
      priorities: [
        { text: 'Grow enterprise pipeline', category: 'growth' },
        { text: 'Clarify premium positioning', category: 'brand' },
      ],
      updatedAt: expect.any(String),
    }));
    expect(getStoredPriorities(wsId)).toEqual([
      { text: 'Grow enterprise pipeline', category: 'growth' },
      { text: 'Clarify premium positioning', category: 'brand' },
    ]);
    expect(getWorkspace(wsId)?.keywordStrategy?.businessContext).toContain(
      `${CLIENT_BUSINESS_PRIORITIES_MARKER}[growth] Grow enterprise pipeline; [brand] Clarify premium positioning`,
    );
  });

  it('invalidates clientSignals intelligence even before a keyword strategy exists', async () => {
    const fresh = seedWorkspace({ clientPassword: '' });
    let freshClientUserId = '';
    try {
      const user = await createClientUser(
        `priorities-nostrategy-${randomUUID().slice(0, 8)}@test.local`,
        'ClientPass1!',
        'No Strategy Client',
        fresh.workspaceId,
        'client_member',
      );
      freshClientUserId = user.id;
      const token = signClientToken(user);

      const beforeRes = await api(`/api/intelligence/${fresh.workspaceId}?slices=clientSignals`);
      expect(beforeRes.status).toBe(200);
      const before = await beforeRes.json() as { clientSignals: ClientSignalsSlice };
      expect(before.clientSignals.effectiveBusinessPriorities).toEqual([]);

      const res = await clientPostJson(
        `/api/public/business-priorities/${fresh.workspaceId}`,
        { priorities: [{ text: 'Win local emergency searches', category: 'growth' }] },
        fresh.workspaceId,
        token,
      );
      expect(res.status).toBe(200);

      const afterRes = await api(`/api/intelligence/${fresh.workspaceId}?slices=clientSignals`);
      expect(afterRes.status).toBe(200);
      const after = await afterRes.json() as { clientSignals: ClientSignalsSlice };
      expect(after.clientSignals.effectiveBusinessPriorities).toEqual([
        '[growth] Win local emergency searches',
      ]);
    } finally {
      db.prepare('DELETE FROM client_business_priorities WHERE workspace_id = ?').run(fresh.workspaceId);
      if (freshClientUserId) deleteClientUser(freshClientUserId, fresh.workspaceId);
      fresh.cleanup();
    }
  });

  it('clears stale strategy context when the client clears all priorities', async () => {
    const setupRes = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [
        { text: 'Grow enterprise pipeline', category: 'growth' },
        { text: 'Clarify premium positioning', category: 'brand' },
      ],
    });
    expect(setupRes.status).toBe(200);
    expect(getWorkspace(wsId)?.keywordStrategy?.businessContext).toContain(CLIENT_BUSINESS_PRIORITIES_MARKER);

    const res = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      saved: 0,
      priorities: [],
      updatedAt: expect.any(String),
    }));
    expect(getStoredPriorities(wsId)).toEqual([]);
    expect(getWorkspace(wsId)?.keywordStrategy?.businessContext).toBe('Existing context');
  });

  it('rejects stale whole-list saves with the current priorities and updatedAt', async () => {
    const first = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'Grow enterprise pipeline', category: 'growth' }],
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as { updatedAt: string };

    await new Promise(resolve => setTimeout(resolve, 2));
    const second = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'Clarify premium positioning', category: 'brand' }],
      expectedUpdatedAt: firstBody.updatedAt,
    });
    expect(second.status).toBe(200);

    const stale = await clientPostJson(`/api/public/business-priorities/${wsId}`, {
      priorities: [{ text: 'Overwrite from stale tab', category: 'competitive' }],
      expectedUpdatedAt: firstBody.updatedAt,
    });

    expect(stale.status).toBe(409);
    const body = await stale.json();
    expect(body).toEqual({
      error: 'Business priorities changed. Please refresh and try again.',
      priorities: [{ text: 'Clarify premium positioning', category: 'brand' }],
      updatedAt: expect.any(String),
    });
    expect(getStoredPriorities(wsId)).toEqual([
      { text: 'Clarify premium positioning', category: 'brand' },
    ]);
  });

  it('does not allow a client token from another workspace to mutate priorities', async () => {
    const res = await clientPostJson(
      `/api/public/business-priorities/${wsId}`,
      { priorities: [{ text: 'Wrong workspace write', category: 'growth' }] },
      wsId,
      otherClientToken,
    );

    expect(res.status).toBe(401);
    expect(getStoredPriorities(wsId)).toHaveLength(3);
    expect(getWorkspace(wsId)?.keywordStrategy?.businessContext).toBe('Existing context');
  });
});
