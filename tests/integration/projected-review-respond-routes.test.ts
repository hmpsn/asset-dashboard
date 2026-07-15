/**
 * R4 — in-shell projected review respond routes (integration).
 *
 * The unified client inbox mounts the bespoke review surfaces (ClientCopyReview / ContentTab) for
 * the two PROJECTED deliverable types (copy_section / content_request) and lets the client respond
 * IN-SHELL. Respond MUST go through the EXISTING bespoke routes — projected ids must NEVER hit the
 * unified `/respond` (which does a PK lookup on the physical client_deliverable table and 404s on a
 * projected id). This test pins both halves of that contract:
 *
 *   (a) POSITIVE — the bespoke respond routes emit the domain events the new UnifiedInbox handlers
 *       listen on, so an in-shell respond invalidates the unified-inbox query (card leaves the list,
 *       modal auto-closes):
 *         - a content-request brief approve → CONTENT_REQUEST_UPDATE
 *         - a copy section approve          → COPY_SECTION_UPDATED
 *
 *   (b) NEGATIVE — PATCH /api/public/deliverables/:ws/:projectedId/respond with a projected id
 *       (`copy:<entryId>` / `content_request:<id>`) returns 404 (projected types must not use the
 *       unified route).
 *
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { randomUUID } from 'crypto';

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: Record<string, unknown> }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: Record<string, unknown>) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

// Avoid real outbound team email on the respond paths.
vi.mock('../../server/email.js', () => ({
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamCopyApproved: vi.fn(),
  notifyTeamCopySuggestion: vi.fn(),
}));

import db from '../../server/db/index.js';
import { WS_EVENTS } from '../../server/ws-events.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { createContentRequest, updateContentRequest } from '../../server/content-requests.js';
import { addEntry, createBlueprint } from '../../server/page-strategy.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';

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

function clientHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Cookie: `client_user_token_${wsId}=${clientToken}`,
  };
}

/** Insert a reviewable copy section under a fresh entry. */
function seedCopySection(): { entryId: string; sectionId: string; updatedAt: string } {
  const blueprint = createBlueprint({ workspaceId: wsId, name: `R4 Copy Blueprint ${randomUUID().slice(0, 8)}` });
  const entry = addEntry(wsId, blueprint.id, {
    name: `R4 Copy Page ${randomUUID().slice(0, 8)}`,
    pageType: 'service',
    sectionPlan: [],
  });
  if (!entry) throw new Error('Expected copy entry to be created');
  const now = new Date().toISOString();
  const sectionId = `copy-section-${randomUUID().slice(0, 8)}`;
  db.prepare(`
    INSERT INTO copy_sections (
      id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
      ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
      version, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, 'client_review', ?, ?, '[]', NULL, '[]', 1, ?, ?)
  `).run(
    sectionId,
    wsId,
    entry.id,
    `copy-plan-${randomUUID().slice(0, 8)}`,
    'Original copy for R4 projected review respond test.',
    'Client-facing note',
    'Internal rationale',
    now,
    now,
  );
  return { entryId: entry.id, sectionId, updatedAt: now };
}

beforeAll(async () => {
  await startTestServer();
  const ws = createWorkspace('R4 Projected Review Respond');
  wsId = ws.id;
  const user = await createClientUser(
    `r4-projected-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'R4 Projected Client',
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
  db.prepare('DELETE FROM content_topic_requests WHERE workspace_id = ?').run(wsId);
  if (clientUserId) deleteClientUser(clientUserId, wsId);
  deleteWorkspace(wsId);
  await stopTestServer();
  if (originalAppPassword === undefined) {
    delete process.env.APP_PASSWORD;
  } else {
    process.env.APP_PASSWORD = originalAppPassword;
  }
});

describe('R4 projected review respond routes', () => {
  // ── (a) POSITIVE: bespoke respond routes emit the events the new UnifiedInbox handlers listen on ──

  it('content-request brief approve emits CONTENT_REQUEST_UPDATE (drives unified-inbox invalidation)', async () => {
    const created = createContentRequest(wsId, {
      topic: `R4 Brief ${randomUUID().slice(0, 6)}`,
      targetKeyword: `r4-brief-${randomUUID().slice(0, 6)}`,
      intent: 'informational',
      priority: 'medium',
      rationale: 'R4 projected review respond guard',
      serviceType: 'brief_only',
      initialStatus: 'brief_generated',
      dedupe: false,
    });
    const review = updateContentRequest(wsId, created.id, {
      status: 'client_review',
      briefId: `brief_r4_${randomUUID().slice(0, 8)}`,
    })!;

    const res = await fetch(`${baseUrl}/api/public/content-request/${wsId}/${review.id}/approve`, {
      method: 'POST',
      headers: clientHeaders(),
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    const events = broadcastState.calls.filter(c => c.event === WS_EVENTS.CONTENT_REQUEST_UPDATE);
    expect(events).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.CONTENT_REQUEST_UPDATE, payload: { id: review.id, status: 'approved' } },
    ]);
  });

  it('copy section approve emits COPY_SECTION_UPDATED (drives unified-inbox invalidation)', async () => {
    const { sectionId, updatedAt } = seedCopySection();

    const res = await fetch(`${baseUrl}/api/public/copy/${wsId}/section/${sectionId}/approve`, {
      method: 'POST',
      headers: clientHeaders(),
      body: JSON.stringify({ expectedUpdatedAt: updatedAt }),
    });
    expect(res.status).toBe(200);

    const events = broadcastState.calls.filter(c => c.event === WS_EVENTS.COPY_SECTION_UPDATED);
    expect(events).toEqual([
      { workspaceId: wsId, event: WS_EVENTS.COPY_SECTION_UPDATED, payload: { sectionId, status: 'approved' } },
    ]);
  });

  // ── (b) NEGATIVE: a projected id must NOT be respondable via the unified /respond route ──

  it('PATCH unified /respond with a projected content_request id returns 404 (no physical row)', async () => {
    const projectedId = `content_request:${randomUUID().slice(0, 8)}`;
    const res = await fetch(`${baseUrl}/api/public/deliverables/${wsId}/${encodeURIComponent(projectedId)}/respond`, {
      method: 'PATCH',
      headers: clientHeaders(),
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(res.status).toBe(404);
    // No source mutation/broadcast happened for a projected id on the unified route.
    expect(broadcastState.calls).toHaveLength(0);
  });

  it('PATCH unified /respond with a projected copy id returns 404 (no physical row)', async () => {
    const { entryId } = seedCopySection();
    const projectedId = `copy:${entryId}`;
    const res = await fetch(`${baseUrl}/api/public/deliverables/${wsId}/${encodeURIComponent(projectedId)}/respond`, {
      method: 'PATCH',
      headers: clientHeaders(),
      body: JSON.stringify({ decision: 'approved' }),
    });
    expect(res.status).toBe(404);
    expect(broadcastState.calls).toHaveLength(0);
  });
});
