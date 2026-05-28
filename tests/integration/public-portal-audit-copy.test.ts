/**
 * Integration tests: public-portal audit, pricing, and copy routes.
 *
 * Covers routes NOT already tested by public-portal-auth.test.ts or
 * public-portal-routes.test.ts:
 *
 *   GET  /api/public/audit-summary/:workspaceId
 *   GET  /api/public/audit-detail/:workspaceId
 *   GET  /api/public/audit-traffic/:workspaceId
 *   GET  /api/public/pricing/:id
 *   GET  /api/public/copy/:workspaceId/entries
 *   GET  /api/public/copy/:workspaceId/entry/:entryId/sections  (additional shape tests)
 *   POST /api/public/copy/:workspaceId/section/:sectionId/approve
 *   POST /api/public/copy/:workspaceId/section/:sectionId/suggest
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13369); // port-ok: confirmed free
const { api, postJson, clearCookies } = ctx;

// ── Test state ────────────────────────────────────────────────────────────────

let ws: SeededFullWorkspace;
let clientUserId = '';
let clientToken = '';

// Seeded blueprint + entry + copy section IDs for copy route tests
let blueprintId = '';
let entryId = '';
let sectionId = '';         // status: client_review (approvals/suggest tests)
let draftSectionId = '';    // status: draft (must NOT appear in client response)

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Cookie header for the client JWT. */
function clientCookie(workspaceId: string, token: string): string {
  return `client_user_token_${workspaceId}=${token}`;
}

/** Authenticated fetch bypassing the ctx cookie jar to prevent interference. */
async function authedFetch(
  url: string,
  opts: RequestInit & { workspaceId: string; token: string },
): Promise<Response> {
  const { workspaceId, token, ...rest } = opts;
  return fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string> || {}),
      Cookie: clientCookie(workspaceId, token),
    },
    redirect: 'manual',
  });
}

async function authedPost(
  path: string,
  body: unknown,
  workspaceId: string,
  token: string,
): Promise<Response> {
  return authedFetch(`${ctx.BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    workspaceId,
    token,
  });
}

// ── Insert helpers ─────────────────────────────────────────────────────────────

/**
 * Insert a site_blueprint row directly and return its id.
 */
function insertBlueprint(workspaceId: string): string {
  const id = `sb_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO site_blueprints (id, workspace_id, name, version, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, 'Test Blueprint', 1, 'active', now, now);
  return id;
}

/**
 * Insert a blueprint_entry row and return its id.
 */
function insertEntry(bpId: string, name: string): string {
  const id = `be_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO blueprint_entries (id, blueprint_id, name, page_type, scope, sort_order, section_plan_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, bpId, name, 'landing', 'included', 0, '[]', now, now);
  return id;
}

/**
 * Insert a copy_section row and return its id.
 */
function insertSection(workspaceId: string, eid: string, status: string): string {
  const id = `cs_${randomUUID().slice(0, 8)}`;
  const planItemId = `spi_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO copy_sections
      (id, workspace_id, entry_id, section_plan_item_id, generated_copy, status,
       ai_annotation, ai_reasoning, steering_history, client_suggestions, quality_flags,
       version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId, eid, planItemId,
    'Generated copy text for section test.',
    status,
    'AI annotation here', null, '[]', null, null,
    1, now, now,
  );
  return id;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  ws = seedWorkspace({ clientPassword: '' });
  updateWorkspace(ws.workspaceId, { clientPortalEnabled: true });

  const user = await createClientUser(
    `audit-copy-test-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Audit Copy Client',
    ws.workspaceId,
    'client_member',
  );
  clientUserId = user.id;
  clientToken = signClientToken(user);

  // Seed blueprint, entry, and copy sections for copy route tests
  blueprintId = insertBlueprint(ws.workspaceId);
  entryId = insertEntry(blueprintId, 'Homepage');
  sectionId = insertSection(ws.workspaceId, entryId, 'client_review');
  draftSectionId = insertSection(ws.workspaceId, entryId, 'draft');
}, 30_000);

afterAll(async () => {
  // Clean up copy sections first (FK: blueprint_entries → copy_sections)
  db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(ws.workspaceId);
  db.prepare('DELETE FROM blueprint_entries WHERE blueprint_id = ?').run(blueprintId);
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(ws.workspaceId);

  if (clientUserId) deleteClientUser(clientUserId, ws.workspaceId);
  ws.cleanup();
  await ctx.stopServer();
});

// ══════════════════════════════════════════════════════════════════════════════
// AUDIT ROUTES
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/audit-summary/:workspaceId — no site linked', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/audit-summary/nonexistent-ws-audit-99');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId', async () => {
    // ws was seeded via seedWorkspace which sets webflow_site_id — create a fresh
    // workspace without one.
    const bare = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET webflow_site_id = NULL WHERE id = ?').run(bare.workspaceId);
    try {
      const res = await api(`/api/public/audit-summary/${bare.workspaceId}`);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    } finally {
      bare.cleanup();
    }
  });

  it('returns null when no audit snapshot exists for the workspace', async () => {
    // ws has a webflow_site_id but no audit_snapshots rows → server returns null
    const res = await api(`/api/public/audit-summary/${ws.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // Route: `if (!latest) return res.json(null)`
    expect(body).toBeNull();
  });
});

describe('GET /api/public/audit-detail/:workspaceId — no site linked', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/audit-detail/nonexistent-ws-audit-detail-99');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId', async () => {
    const bare = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET webflow_site_id = NULL WHERE id = ?').run(bare.workspaceId);
    try {
      const res = await api(`/api/public/audit-detail/${bare.workspaceId}`);
      expect(res.status).toBe(400);
    } finally {
      bare.cleanup();
    }
  });

  it('returns null when no audit snapshot exists', async () => {
    const res = await api(`/api/public/audit-detail/${ws.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });
});

describe('GET /api/public/audit-traffic/:workspaceId', () => {
  // Behavior change 2026-05-27 (sprint-platform-health-wave8 Plan A Task 1):
  // endpoint now requires authenticated portal access. Auth runs before the
  // handler's graceful-degradation logic, so an unknown workspace returns
  // 404 from the middleware instead of the previous 200-with-empty-object.
  // We add a shared password + session login so the body-shape assertions
  // can still exercise the handler's GSC/GA4 fallback path.
  beforeAll(async () => {
    updateWorkspace(ws.workspaceId, { clientPassword: 'audit-test-password' });
    const authRes = await postJson(`/api/public/auth/${ws.workspaceId}`, { password: 'audit-test-password' });
    expect(authRes.status).toBe(200);
  });

  // Restore the workspace to its passwordless seed state and drop the session
  // so later describes in this file (pricing, copy) see the same state they
  // had before this block ran.
  afterAll(() => {
    updateWorkspace(ws.workspaceId, { clientPassword: '' });
    clearCookies();
  });

  it('returns 404 for unknown workspace (auth middleware short-circuits)', async () => {
    const res = await api('/api/public/audit-traffic/nonexistent-ws-traffic-99');
    expect(res.status).toBe(404);
  });

  it('returns an object for a valid workspace with no GSC/GA4 configured', async () => {
    const res = await api(`/api/public/audit-traffic/${ws.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
  });

  it('response is a flat object mapping paths to traffic data (or empty)', async () => {
    const res = await api(`/api/public/audit-traffic/${ws.workspaceId}`);
    const body = await res.json() as Record<string, unknown>;
    for (const key of Object.keys(body)) {
      expect(key.startsWith('/')).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PRICING ROUTE
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/pricing/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/pricing/nonexistent-ws-pricing-99');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns pricing data for a valid workspace', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('products');
    expect(body).toHaveProperty('bundles');
    expect(body).toHaveProperty('currency');
    expect(body).toHaveProperty('stripeEnabled');
  });

  it('products is an object (type→price map)', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as { products: unknown };
    expect(typeof body.products).toBe('object');
    expect(body.products).not.toBeNull();
    expect(Array.isArray(body.products)).toBe(false);
  });

  it('bundles is an array', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as { bundles: unknown };
    expect(Array.isArray(body.bundles)).toBe(true);
  });

  it('bundles array contains expected bundle ids', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as { bundles: Array<{ id: string }> };
    const ids = body.bundles.map(b => b.id);
    expect(ids).toContain('content_starter');
    expect(ids).toContain('content_engine');
    expect(ids).toContain('full_service');
  });

  it('stripeEnabled is a boolean, not the secret key', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as { stripeEnabled: unknown };
    expect(typeof body.stripeEnabled).toBe('boolean');
  });

  it('currency defaults to USD when no workspace override', async () => {
    // ws has no contentPricing set — should default to 'USD'
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as { currency: string };
    expect(body.currency).toBe('USD');
  });

  it('does NOT leak Stripe secret keys or workspace sensitive fields', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('stripeSecretKey');
    expect(raw).not.toContain('stripeCustomerId');
    expect(raw).not.toContain('webflowToken');
    expect(raw).not.toContain('knowledgeBase');
  });

  it('each product entry has displayName, price, category, enabled fields', async () => {
    const res = await api(`/api/public/pricing/${ws.workspaceId}`);
    const body = await res.json() as {
      products: Record<string, { displayName: string; price: number; category: string; enabled: boolean }>;
    };
    for (const [, product] of Object.entries(body.products)) {
      expect(product).toHaveProperty('displayName');
      expect(product).toHaveProperty('price');
      expect(product).toHaveProperty('category');
      expect(product).toHaveProperty('enabled');
      expect(typeof product.enabled).toBe('boolean');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY ROUTES — entries listing
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/copy/:workspaceId/entries', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/copy/nonexistent-ws-copy-99/entries');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(
      disabledWs.workspaceId,
    );
    try {
      const res = await api(`/api/public/copy/${disabledWs.workspaceId}/entries`);
      expect(res.status).toBe(403);
    } finally {
      disabledWs.cleanup();
    }
  });

  it('returns entries array for a valid workspace', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: unknown[] };
    expect(body).toHaveProperty('entries');
    expect(Array.isArray(body.entries)).toBe(true);
  });

  it('only includes entries with client_review or approved sections (not draft-only)', async () => {
    // Our seeded entry has one client_review section and one draft section.
    // The entry should appear because clientReviewSections > 0.
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    const body = await res.json() as {
      entries: Array<{ id: string; copyStatus: { clientReviewSections: number; approvedSections: number } }>;
    };
    for (const entry of body.entries) {
      const { clientReviewSections, approvedSections } = entry.copyStatus;
      // Every returned entry must have at least one visible section
      expect(clientReviewSections + approvedSections).toBeGreaterThan(0);
    }
  });

  it('returned entry shape includes expected fields', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entries`);
    const body = await res.json() as {
      entries: Array<{
        id: string;
        name: string;
        pageType: string;
        blueprintId: string;
        blueprintName: string;
        copyStatus: Record<string, unknown>;
      }>;
    };
    // At least our seeded entry should appear
    if (body.entries.length > 0) {
      const entry = body.entries[0];
      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('name');
      expect(entry).toHaveProperty('pageType');
      expect(entry).toHaveProperty('blueprintId');
      expect(entry).toHaveProperty('blueprintName');
      expect(entry).toHaveProperty('copyStatus');
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY ROUTES — sections for an entry (deeper coverage beyond existing tests)
// ══════════════════════════════════════════════════════════════════════════════

describe('GET /api/public/copy/:workspaceId/entry/:entryId/sections — field safety', () => {
  it('returns client_review sections with correct fields', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entry/${entryId}/sections`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      sections: Array<Record<string, unknown>>;
    };
    const reviewSection = body.sections.find(s => s.id === sectionId);
    expect(reviewSection).toBeDefined();
    // Verify expected public fields
    expect(reviewSection).toHaveProperty('id');
    expect(reviewSection).toHaveProperty('entryId');
    expect(reviewSection).toHaveProperty('sectionPlanItemId');
    expect(reviewSection).toHaveProperty('generatedCopy');
    expect(reviewSection).toHaveProperty('status', 'client_review');
    expect(reviewSection).toHaveProperty('version');
    expect(reviewSection).toHaveProperty('createdAt');
    expect(reviewSection).toHaveProperty('updatedAt');
  });

  it('strips aiReasoning from section responses (internal only)', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entry/${entryId}/sections`);
    const body = await res.json() as { sections: Array<Record<string, unknown>> };
    for (const section of body.sections) {
      expect('aiReasoning' in section).toBe(false);
    }
  });

  it('does NOT return draft sections to the client', async () => {
    const res = await api(`/api/public/copy/${ws.workspaceId}/entry/${entryId}/sections`);
    const body = await res.json() as { sections: Array<{ id: string; status: string }> };
    const draftSection = body.sections.find(s => s.id === draftSectionId);
    expect(draftSection).toBeUndefined();
    // No section has status 'draft' in the response
    for (const s of body.sections) {
      expect(s.status).not.toBe('draft');
    }
  });

  it('cross-workspace: sections from wsA do not appear under wsB', async () => {
    const wsB = seedWorkspace({ clientPassword: '' });
    updateWorkspace(wsB.workspaceId, { clientPortalEnabled: true });
    try {
      const res = await api(`/api/public/copy/${wsB.workspaceId}/entry/${entryId}/sections`);
      expect(res.status).toBe(200);
      const body = await res.json() as { sections: Array<{ id: string }> };
      const ids = body.sections.map(s => s.id);
      expect(ids).not.toContain(sectionId);
    } finally {
      wsB.cleanup();
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY ROUTES — approve a section
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/public/copy/:workspaceId/section/:sectionId/approve', () => {
  it('returns 401 without auth', async () => {
    const res = await api(
      `/api/public/copy/${ws.workspaceId}/section/${sectionId}/approve`,
      { method: 'POST' },
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(disabledWs.workspaceId);
    const disabledEntry = insertEntry(insertBlueprint(disabledWs.workspaceId), 'Disabled WS Entry');
    const disabledSection = insertSection(disabledWs.workspaceId, disabledEntry, 'client_review');
    const disabledUser = await createClientUser(
      `disabled-ws-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!', 'Disabled WS User', disabledWs.workspaceId, 'client_member',
    );
    const disabledToken = signClientToken(disabledUser);
    try {
      const res = await authedFetch(
        `${ctx.BASE}/api/public/copy/${disabledWs.workspaceId}/section/${disabledSection}/approve`,
        { method: 'POST', workspaceId: disabledWs.workspaceId, token: disabledToken },
      );
      expect(res.status).toBe(403);
    } finally {
      db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(disabledWs.workspaceId);
      db.prepare('DELETE FROM blueprint_entries WHERE blueprint_id IN (SELECT id FROM site_blueprints WHERE workspace_id = ?)').run(disabledWs.workspaceId);
      db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(disabledWs.workspaceId);
      deleteClientUser(disabledUser.id, disabledWs.workspaceId);
      disabledWs.cleanup();
    }
  });

  it('returns 400 when section is not in client_review state', async () => {
    // draftSectionId has status='draft' — cannot be approved via client portal
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${draftSectionId}/approve`,
      { method: 'POST', workspaceId: ws.workspaceId, token: clientToken },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBeTruthy();
  });

  it('returns 400 for a non-existent sectionId', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/cs_nonexistent999/approve`,
      { method: 'POST', workspaceId: ws.workspaceId, token: clientToken },
    );
    expect(res.status).toBe(400);
  });

  it('approves a client_review section and returns the updated section', async () => {
    // Create a fresh section in client_review for this test so we don't
    // interfere with the suggest tests below.
    const freshEntry = insertEntry(blueprintId, 'Approve Test Entry');
    const freshSection = insertSection(ws.workspaceId, freshEntry, 'client_review');

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection}/approve`,
      { method: 'POST', workspaceId: ws.workspaceId, token: clientToken },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { id: string; status: string } };
    expect(body).toHaveProperty('section');
    expect(body.section.id).toBe(freshSection);
    expect(body.section.status).toBe('approved');

    // Cleanup
    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry);
  });

  it('approved section response does NOT include aiReasoning', async () => {
    // Create another fresh section for this assertion
    const freshEntry2 = insertEntry(blueprintId, 'Approve Strip Test Entry');
    const freshSection2 = insertSection(ws.workspaceId, freshEntry2, 'client_review');

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection2}/approve`,
      { method: 'POST', workspaceId: ws.workspaceId, token: clientToken },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: Record<string, unknown> };
    expect('aiReasoning' in body.section).toBe(false);

    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection2);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry2);
  });

  it('persists the approved status to the database', async () => {
    const freshEntry3 = insertEntry(blueprintId, 'Approve Persist Test Entry');
    const freshSection3 = insertSection(ws.workspaceId, freshEntry3, 'client_review');

    await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection3}/approve`,
      { method: 'POST', workspaceId: ws.workspaceId, token: clientToken },
    );

    const row = db
      .prepare('SELECT status FROM copy_sections WHERE id = ?')
      .get(freshSection3) as { status: string } | undefined;
    expect(row?.status).toBe('approved');

    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection3);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry3);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COPY ROUTES — suggest edits on a section
// ══════════════════════════════════════════════════════════════════════════════

describe('POST /api/public/copy/:workspaceId/section/:sectionId/suggest', () => {
  const validSuggestion = {
    originalText: 'Original copy text here.',
    suggestedText: 'Improved copy text from client.',
  };

  it('returns 401 without auth', async () => {
    const res = await api(
      `/api/public/copy/${ws.workspaceId}/section/${sectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSuggestion),
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing originalText', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${sectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestedText: 'Only suggested, no original' }),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing suggestedText', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${sectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'Only original, no suggestion' }),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty suggestedText string', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${sectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'Some original text.', suggestedText: '' }),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when section is not in client_review state', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${draftSectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSuggestion),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for extra/unknown fields (strict schema)', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${sectionId}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...validSuggestion, injectedField: 'evil' }),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('submits a suggestion and returns updated section', async () => {
    const freshEntry = insertEntry(blueprintId, 'Suggest Test Entry');
    const freshSection = insertSection(ws.workspaceId, freshEntry, 'client_review');

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSuggestion),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { id: string; clientSuggestions: unknown[] } };
    expect(body).toHaveProperty('section');
    expect(body.section.id).toBe(freshSection);
    // clientSuggestions should now contain the suggestion
    expect(Array.isArray(body.section.clientSuggestions)).toBe(true);
    expect(body.section.clientSuggestions!.length).toBeGreaterThan(0);

    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry);
  });

  it('suggestion response does NOT include aiReasoning', async () => {
    const freshEntry = insertEntry(blueprintId, 'Suggest Strip Test Entry');
    const freshSection = insertSection(ws.workspaceId, freshEntry, 'client_review');

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSuggestion),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: Record<string, unknown> };
    expect('aiReasoning' in body.section).toBe(false);

    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry);
  });

  it('persists suggestion to the database', async () => {
    const freshEntry = insertEntry(blueprintId, 'Suggest Persist Test Entry');
    const freshSection = insertSection(ws.workspaceId, freshEntry, 'client_review');

    await authedFetch(
      `${ctx.BASE}/api/public/copy/${ws.workspaceId}/section/${freshSection}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validSuggestion),
        workspaceId: ws.workspaceId,
        token: clientToken,
      },
    );

    const row = db
      .prepare('SELECT client_suggestions FROM copy_sections WHERE id = ?')
      .get(freshSection) as { client_suggestions: string | null } | undefined;
    expect(row?.client_suggestions).toBeTruthy();
    const suggestions = JSON.parse(row!.client_suggestions!) as Array<Record<string, string>>;
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].suggestedText).toBe(validSuggestion.suggestedText);

    db.prepare('DELETE FROM copy_sections WHERE id = ?').run(freshSection);
    db.prepare('DELETE FROM blueprint_entries WHERE id = ?').run(freshEntry);
  });
});
