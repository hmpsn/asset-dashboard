/**
 * Integration tests for client-facing copy review routes.
 *
 * Covers:
 * - GET  /api/public/copy/:workspaceId/entries
 * - GET  /api/public/copy/:workspaceId/entry/:entryId/sections
 * - POST /api/public/copy/:workspaceId/section/:sectionId/suggest
 * - POST /api/public/copy/:workspaceId/section/:sectionId/approve
 */
import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13348); // port-ok: 13201-13347 already allocated in integration suite
const { api } = ctx;

let wsId = '';
let otherWsId = '';
let cleanupA: (() => void) | undefined;
let cleanupB: (() => void) | undefined;
let disabledPortalWsId = '';
let cleanupDisabledPortal: (() => void) | undefined;
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

function createCopyEntry(workspaceId = wsId, name = `Copy Review Page ${randomUUID().slice(0, 8)}`): string {
  const blueprint = createBlueprint({ workspaceId, name: `Copy Review Blueprint ${randomUUID().slice(0, 8)}` });
  const entry = addEntry(workspaceId, blueprint.id, {
    name,
    pageType: 'service',
    sectionPlan: [],
  });
  if (!entry) throw new Error('Expected copy review test entry to be created');
  return entry.id;
}

function insertSection(status: string, workspaceId = wsId, entryId = `public-copy-entry-${randomUUID().slice(0, 8)}`): string {
  const id = `public-copy-section-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_sections (
      id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
      ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
      version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    workspaceId,
    entryId,
    `public-copy-plan-${randomUUID().slice(0, 8)}`,
    'Original copy for client review',
    status,
    'Client-facing AI note',
    'Internal rationale for admins only',
    '[]',
    null,
    '[]',
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
  const disabledWs = seedWorkspace({ clientPassword: '' });
  wsId = wsA.workspaceId;
  otherWsId = wsB.workspaceId;
  disabledPortalWsId = disabledWs.workspaceId;
  cleanupA = wsA.cleanup;
  cleanupB = wsB.cleanup;
  cleanupDisabledPortal = disabledWs.cleanup;
  updateWorkspace(disabledPortalWsId, { clientPortalEnabled: false });

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

  db.prepare('DELETE FROM copy_sections WHERE workspace_id IN (?, ?, ?)').run(wsId, otherWsId, disabledPortalWsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  if (otherClientUserId) deleteClientUser(otherClientUserId, otherWsId);
  cleanupA?.();
  cleanupB?.();
  cleanupDisabledPortal?.();
});

describe('Public copy review reads', () => {
  it('returns 404 for a missing workspace and 403 when the client portal is disabled', async () => {
    const missingRes = await api('/api/public/copy/ws_missing_copy_review/entries');
    expect(missingRes.status).toBe(404);

    const disabledEntriesRes = await api(`/api/public/copy/${disabledPortalWsId}/entries`);
    expect(disabledEntriesRes.status).toBe(403);

    const disabledSectionsRes = await api(`/api/public/copy/${disabledPortalWsId}/entry/missing-entry/sections`);
    expect(disabledSectionsRes.status).toBe(403);
  });

  it('lists only entries with client-visible sections in the requested workspace', async () => {
    const visibleEntryId = createCopyEntry(wsId, 'Visible Service Page');
    const draftOnlyEntryId = createCopyEntry(wsId, 'Draft Only Page');
    const otherWorkspaceEntryId = createCopyEntry(otherWsId, 'Other Workspace Page');

    insertSection('client_review', wsId, visibleEntryId);
    insertSection('approved', wsId, visibleEntryId);
    insertSection('draft', wsId, draftOnlyEntryId);
    insertSection('client_review', otherWsId, otherWorkspaceEntryId);

    const res = await api(`/api/public/copy/${wsId}/entries`);

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.entries.map((entry: { id: string }) => entry.id);
    expect(ids).toContain(visibleEntryId);
    expect(ids).not.toContain(draftOnlyEntryId);
    expect(ids).not.toContain(otherWorkspaceEntryId);

    const visibleEntry = body.entries.find((entry: { id: string }) => entry.id === visibleEntryId);
    expect(visibleEntry).toMatchObject({
      id: visibleEntryId,
      name: 'Visible Service Page',
      pageType: 'service',
      copyStatus: {
        entryId: visibleEntryId,
        totalSections: 2,
        clientReviewSections: 1,
        approvedSections: 1,
      },
    });
    expect(visibleEntry).not.toHaveProperty('workspaceId');
  });

  it('returns only client-reviewable sections and omits internal copy review fields', async () => {
    const entryId = createCopyEntry(wsId, 'Reviewable Sections Page');

    const draftSectionId = insertSection('draft', wsId, entryId);
    const reviewSectionId = insertSection('client_review', wsId, entryId);
    const approvedSectionId = insertSection('approved', wsId, entryId);
    const revisionSectionId = insertSection('revision_requested', wsId, entryId);
    insertSection('client_review', otherWsId, entryId);

    const res = await api(`/api/public/copy/${wsId}/entry/${entryId}/sections`);

    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.sections.map((section: { id: string }) => section.id);
    expect(ids).toEqual([reviewSectionId, approvedSectionId]);
    expect(ids).not.toContain(draftSectionId);
    expect(ids).not.toContain(revisionSectionId);

    for (const section of body.sections) {
      expect(section.entryId).toBe(entryId);
      expect(section).not.toHaveProperty('workspaceId');
      expect(section).not.toHaveProperty('aiReasoning');
      expect(section).not.toHaveProperty('steeringHistory');
      expect(section).not.toHaveProperty('qualityFlags');
    }
  });
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
