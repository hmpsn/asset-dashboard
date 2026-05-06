/**
 * Integration tests for client-facing copy review routes.
 *
 * Covers:
 * - POST /api/public/copy/:workspaceId/section/:sectionId/suggest
 * - POST /api/public/copy/:workspaceId/section/:sectionId/approve
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13348); // port-ok: 13201-13347 already allocated in integration suite
const { api } = ctx;

let wsId = '';
let otherWsId = '';
let cleanupA: (() => void) | undefined;
let cleanupB: (() => void) | undefined;
let clientUserId = '';
let clientToken = '';
let otherClientUserId = '';
let otherClientToken = '';

const now = new Date().toISOString();

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

function insertSection(status: string, workspaceId = wsId): string {
  const id = `public-copy-section-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_sections (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status, steering_history, client_suggestions, version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    `public-copy-entry-${randomUUID().slice(0, 8)}`,
    `public-copy-plan-${randomUUID().slice(0, 8)}`,
    'Original copy for client review',
    status,
    '[]',
    null,
    1,
    now,
    now,
  );
  return id;
}

function getSectionRow(sectionId: string): { status: string; client_suggestions: string | null } {
  return db.prepare('SELECT status, client_suggestions FROM copy_sections WHERE id = ?').get(sectionId) as {
    status: string;
    client_suggestions: string | null;
  };
}

beforeAll(async () => {
  await ctx.startServer();

  const wsA = seedWorkspace({ clientPassword: '' });
  const wsB = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  otherWsId = wsB.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;

  const user = await createClientUser(
    `copy-review-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Copy Review Client',
    wsId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);

  const otherUser = await createClientUser(
    `copy-review-other-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Other Copy Review Client',
    otherWsId,
    'client_member',
  );
  otherClientUserId = otherUser.id;
  otherClientToken = signClientToken(otherUser);
}, 25_000);

afterAll(async () => {
  await ctx.stopServer();

  db.prepare('DELETE FROM copy_sections WHERE workspace_id IN (?, ?)').run(wsId, otherWsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  if (otherClientUserId) deleteClientUser(otherClientUserId, otherWsId);
  cleanupA?.();
  cleanupB?.();
});

describe('Public copy review suggestions', () => {
  it('requires client auth before validating suggestion payloads', async () => {
    const sectionId = insertSection('client_review');

    const res = await api(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ originalText: { text: 'Structured' } }),
    });

    expect(res.status).toBe(401);
    const row = getSectionRow(sectionId);
    expect(row.status).toBe('client_review');
    expect(row.client_suggestions).toBeNull();
  });

  it('rejects structured suggestion text without mutating the section', async () => {
    const sectionId = insertSection('client_review');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: { text: 'Original copy for client review' },
      suggestedText: 'Better copy from the client',
    });

    expect(res.status).toBe(400);
    const row = getSectionRow(sectionId);
    expect(row.status).toBe('client_review');
    expect(row.client_suggestions).toBeNull();
  });

  it('adds a valid suggestion and returns only the client-safe section shape', async () => {
    const sectionId = insertSection('client_review');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: 'Original copy for client review',
      suggestedText: 'Better copy from the client',
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.section.status).toBe('revision_requested');
    expect(body.section.clientSuggestions).toHaveLength(1);
    expect(body.section.clientSuggestions[0]).toMatchObject({
      originalText: 'Original copy for client review',
      suggestedText: 'Better copy from the client',
      status: 'pending',
    });
    expect(body.section).not.toHaveProperty('workspaceId');
    expect(body.section).not.toHaveProperty('aiReasoning');
    expect(body.section).not.toHaveProperty('steeringHistory');
    expect(body.section).not.toHaveProperty('qualityFlags');
  });

  it('does not add suggestions to sections outside client review', async () => {
    const sectionId = insertSection('draft');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: 'Original copy for client review',
      suggestedText: 'Better copy from the client',
    });

    expect(res.status).toBe(400);
    const row = getSectionRow(sectionId);
    expect(row.status).toBe('draft');
    expect(row.client_suggestions).toBeNull();
  });
});

describe('Public copy review approval', () => {
  it('does not approve sections outside client review', async () => {
    const sectionId = insertSection('draft');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/approve`, {});

    expect(res.status).toBe(400);
    const row = getSectionRow(sectionId);
    expect(row.status).toBe('draft');
  });

  it('does not approve a section through the wrong workspace with valid other-workspace auth', async () => {
    const sectionId = insertSection('client_review');

    const res = await clientPostJson(
      `/api/public/copy/${otherWsId}/section/${sectionId}/approve`,
      {},
      otherWsId,
      otherClientToken,
    );

    expect(res.status).toBe(400);
    const row = getSectionRow(sectionId);
    expect(row.status).toBe('client_review');
  });
});
