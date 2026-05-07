import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: { sectionId?: string; status?: string } }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: { sectionId?: string; status?: string }) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import db from '../../server/db/index.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

let baseUrl = '';
let server: http.Server | undefined;
let wsId = '';
let clientUserId = '';
let clientToken = '';
const originalAppPassword = process.env.APP_PASSWORD;

async function startTestServer(): Promise<void> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js');
  const app = createApp();
  server = http.createServer(app);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopTestServer(): Promise<void> {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close(err => err ? reject(err) : resolve());
  });
  server = undefined;
}

async function api(path: string, opts?: RequestInit): Promise<Response> {
  return fetch(`${baseUrl}${path}`, opts);
}

async function clientPostJson(path: string, body: unknown): Promise<Response> {
  return api(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `client_user_token_${wsId}=${clientToken}`,
    },
    body: JSON.stringify(body),
  });
}

function insertSection(status: string, entryId = createCopyEntry()): string {
  const now = new Date().toISOString();
  const id = `copy-section-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_sections (
      id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
      ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
      version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    wsId,
    entryId,
    `copy-plan-${randomUUID().slice(0, 8)}`,
    'Original copy for client review broadcasts.',
    status,
    'Client-facing note',
    'Internal rationale',
    '[]',
    null,
    '[]',
    1,
    now,
    now,
  );
  return id;
}

function createCopyEntry(name = `Copy Broadcast Page ${randomUUID().slice(0, 8)}`): string {
  const blueprint = createBlueprint({ workspaceId: wsId, name: `Copy Broadcast Blueprint ${randomUUID().slice(0, 8)}` });
  const entry = addEntry(wsId, blueprint.id, {
    name,
    pageType: 'service',
    sectionPlan: [],
  });
  if (!entry) throw new Error('Expected copy broadcast test entry to be created');
  return entry.id;
}

function getSectionRow(sectionId: string): { status: string; client_suggestions: string | null } {
  return db.prepare('SELECT status, client_suggestions FROM copy_sections WHERE id = ?').get(sectionId) as {
    status: string;
    client_suggestions: string | null;
  };
}

function countActivities(type: string): number {
  const row = db.prepare(`
    SELECT COALESCE(COUNT(*), 0) AS count
    FROM activity_log
    WHERE workspace_id = ?
      AND type = ?
  `).get(wsId, type) as { count: number };
  return row.count;
}

function copySectionBroadcasts() {
  return broadcastState.calls.filter(call => call.event === WS_EVENTS.COPY_SECTION_UPDATED);
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('Public Copy Review Broadcasts');
  wsId = ws.id;
  const user = await createClientUser(
    `copy-broadcast-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Copy Broadcast Client',
    wsId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);
});

beforeEach(() => {
  broadcastState.calls = [];
});

afterAll(async () => {
  db.prepare('DELETE FROM activity_log WHERE workspace_id = ?').run(wsId);
  db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(wsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('public copy review broadcasts and workflow side effects', () => {
  it('broadcasts exactly once when a client approves reviewable copy', async () => {
    const entryId = createCopyEntry('Approve Broadcast Page');
    const sectionId = insertSection('client_review', entryId);
    insertSection('draft', entryId);
    const beforeActivity = countActivities('copy_approved');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/approve`, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { id: string; status: string } };
    expect(body.section).toMatchObject({ id: sectionId, status: 'approved' });

    expect(getSectionRow(sectionId).status).toBe('approved');
    expect(copySectionBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.COPY_SECTION_UPDATED,
        payload: { sectionId, status: 'approved' },
      },
    ]);
    expect(countActivities('copy_approved')).toBe(beforeActivity + 1);
  });

  it('does not broadcast or mutate when approval is not reviewable', async () => {
    const sectionId = insertSection('draft');
    const beforeActivity = countActivities('copy_approved');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/approve`, {});
    expect(res.status).toBe(400);

    expect(getSectionRow(sectionId).status).toBe('draft');
    expect(copySectionBroadcasts()).toHaveLength(0);
    expect(countActivities('copy_approved')).toBe(beforeActivity);
  });

  it('broadcasts exactly once when a client suggests a copy edit', async () => {
    const sectionId = insertSection('client_review');
    const beforeActivity = countActivities('copy_suggestion_added');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: 'Original copy for client review broadcasts.',
      suggestedText: 'Updated client suggestion for the copy.',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { id: string; status: string; clientSuggestions: unknown[] } };
    expect(body.section.id).toBe(sectionId);
    expect(body.section.status).toBe('revision_requested');
    expect(body.section.clientSuggestions).toHaveLength(1);

    const stored = getSectionRow(sectionId);
    expect(stored.status).toBe('revision_requested');
    expect(stored.client_suggestions).not.toBeNull();
    expect(copySectionBroadcasts()).toEqual([
      {
        workspaceId: wsId,
        event: WS_EVENTS.COPY_SECTION_UPDATED,
        payload: { sectionId, status: 'revision_requested' },
      },
    ]);
    expect(countActivities('copy_suggestion_added')).toBe(beforeActivity + 1);
  });

  it('does not broadcast or mutate when suggestion validation fails', async () => {
    const sectionId = insertSection('client_review');
    const beforeActivity = countActivities('copy_suggestion_added');

    const res = await clientPostJson(`/api/public/copy/${wsId}/section/${sectionId}/suggest`, {
      originalText: { text: 'Structured input should fail validation.' },
      suggestedText: 'Updated copy.',
    });
    expect(res.status).toBe(400);

    const stored = getSectionRow(sectionId);
    expect(stored.status).toBe('client_review');
    expect(stored.client_suggestions).toBeNull();
    expect(copySectionBroadcasts()).toHaveLength(0);
    expect(countActivities('copy_suggestion_added')).toBe(beforeActivity);
  });
});
