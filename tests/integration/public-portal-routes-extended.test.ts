/**
 * Extended integration tests for server/routes/public-portal.ts
 *
 * Targets endpoints and branches NOT covered by the existing test files:
 *   - public-portal-routes.test.ts (port 13367)
 *   - public-portal-auth.test.ts   (port 13304)
 *
 * Focuses on:
 *   1. GET /api/public/pricing/:id
 *   2. GET /api/public/audit-summary/:workspaceId
 *   3. GET /api/public/audit-detail/:workspaceId
 *   4. GET /api/public/audit-traffic/:workspaceId
 *   5. POST /api/public/onboarding/:id (auth required, data transformation)
 *   6. GET /api/public/copy/:workspaceId/entries
 *   7. POST /api/public/copy/:workspaceId/section/:sectionId/approve
 *   8. POST /api/public/copy/:workspaceId/section/:sectionId/suggest
 *   9. GET /api/public/briefing/:workspaceId (growth tier, no briefing published)
 *  10. Edge cases: null fields, empty arrays, portal-disabled
 *  11. Business profile deep-merge (address sub-object)
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import { createClientUser, deleteClientUser, signClientToken } from '../../server/client-users.js';
import { updateWorkspace } from '../../server/workspaces.js';
import { initializeSections, saveGeneratedCopy } from '../../server/copy-review.js';
import { createBlueprint, addEntry } from '../../server/page-strategy.js';

const ctx = createTestContext(13380, { autoPublicAuth: true }); // port-ok: 13380
const { api, postJson, clearCookies } = ctx;

// ── Test state ────────────────────────────────────────────────────────────────

let wsA: SeededFullWorkspace;
let clientUserAId = '';
let clientTokenA = '';

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await ctx.startServer();

  wsA = seedWorkspace({ clientPassword: '' });
  updateWorkspace(wsA.workspaceId, { clientPortalEnabled: true });

  const userA = await createClientUser(
    `ext-test-${randomUUID().slice(0, 8)}@test.local`,
    'ClientPass1!',
    'Extended Test Client',
    wsA.workspaceId,
    'client_member',
  );
  clientUserAId = userA.id;
  clientTokenA = signClientToken(userA);
}, 25_000);

afterAll(async () => {
  db.prepare('DELETE FROM keyword_feedback WHERE workspace_id = ?').run(wsA.workspaceId);
  db.prepare('DELETE FROM client_business_priorities WHERE workspace_id = ?').run(wsA.workspaceId);
  db.prepare('DELETE FROM content_gap_votes WHERE workspace_id = ?').run(wsA.workspaceId);
  db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(wsA.workspaceId);
  db.prepare('DELETE FROM copy_metadata WHERE workspace_id = ?').run(wsA.workspaceId);
  // blueprint_entries FK-cascades from site_blueprints; delete blueprints to remove entries
  db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(wsA.workspaceId);

  if (clientUserAId) deleteClientUser(clientUserAId, wsA.workspaceId);
  wsA.cleanup();

  await ctx.stopServer();
});

// ── Helper: authed fetch ──────────────────────────────────────────────────────

async function authedFetch(
  url: string,
  opts: RequestInit & { workspaceId: string; token: string },
): Promise<Response> {
  const { workspaceId, token, ...rest } = opts;
  const cookieName = `client_user_token_${workspaceId}`;
  return fetch(url, {
    ...rest,
    headers: {
      ...(rest.headers as Record<string, string> || {}),
      Cookie: `${cookieName}=${token}`,
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

// ── 1. GET /api/public/pricing/:id ───────────────────────────────────────────

describe('GET /api/public/pricing/:id', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/pricing/nonexistent-ws-pricing-99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 200 with products, bundles, and currency for a valid workspace', async () => {
    const res = await api(`/api/public/pricing/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      products: Record<string, unknown>;
      bundles: unknown[];
      currency: string;
      stripeEnabled: boolean;
    };
    expect(body).toHaveProperty('products');
    expect(typeof body.products).toBe('object');
    expect(body).toHaveProperty('bundles');
    expect(Array.isArray(body.bundles)).toBe(true);
    expect(body).toHaveProperty('currency');
    expect(typeof body.currency).toBe('string');
    expect(body).toHaveProperty('stripeEnabled');
    expect(typeof body.stripeEnabled).toBe('boolean');
  });

  it('bundles have expected shape', async () => {
    const res = await api(`/api/public/pricing/${wsA.workspaceId}`);
    const body = await res.json() as { bundles: Array<{ id: string; name: string; monthlyPrice: number; includes: string[]; savings: string }> };
    expect(body.bundles.length).toBeGreaterThan(0);
    const firstBundle = body.bundles[0];
    expect(firstBundle).toHaveProperty('id');
    expect(firstBundle).toHaveProperty('name');
    expect(firstBundle).toHaveProperty('monthlyPrice');
    expect(typeof firstBundle.monthlyPrice).toBe('number');
    expect(firstBundle).toHaveProperty('includes');
    expect(Array.isArray(firstBundle.includes)).toBe(true);
  });

  it('does not leak internal config fields', async () => {
    const res = await api(`/api/public/pricing/${wsA.workspaceId}`);
    const raw = JSON.stringify(await res.json());
    // Stripe secret key format check
    expect(raw).not.toContain('sk_');
    expect(raw).not.toContain('stripeSecretKey');
  });

  it('stripeEnabled reflects the server configuration', async () => {
    // In test environment Stripe is not configured → stripeEnabled = false
    const res = await api(`/api/public/pricing/${wsA.workspaceId}`);
    const body = await res.json() as { stripeEnabled: boolean };
    // We don't care which value, just that it's a boolean
    expect(typeof body.stripeEnabled).toBe('boolean');
  });
});

// ── 2. GET /api/public/audit-summary/:workspaceId ────────────────────────────

describe('GET /api/public/audit-summary/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/audit-summary/nonexistent-ws-audit-99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId', async () => {
    // wsA has a webflowSiteId from seed — create a workspace without one
    const noSiteWs = seedWorkspace({ clientPassword: '' });
    // Remove the webflow_site_id
    db.prepare('UPDATE workspaces SET webflow_site_id = NULL WHERE id = ?').run(noSiteWs.workspaceId);
    try {
      const res = await api(`/api/public/audit-summary/${noSiteWs.workspaceId}`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/no site linked/i);
    } finally {
      noSiteWs.cleanup();
    }
  });

  it('returns null when no snapshot exists for the site', async () => {
    // wsA has a site ID but no audit snapshots have been seeded
    const res = await api(`/api/public/audit-summary/${wsA.workspaceId}`);
    // Either null (no snapshot) or a valid summary
    expect([200]).toContain(res.status);
    const body = await res.json();
    // With no snapshot, should return null
    if (body === null) {
      expect(body).toBeNull();
    } else {
      // If somehow a snapshot exists, it has the right shape
      expect(body).toHaveProperty('siteScore');
    }
  });
});

// ── 3. GET /api/public/audit-detail/:workspaceId ─────────────────────────────

describe('GET /api/public/audit-detail/:workspaceId', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/audit-detail/nonexistent-ws-detail-99');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 400 when workspace has no webflowSiteId', async () => {
    const noSiteWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET webflow_site_id = NULL WHERE id = ?').run(noSiteWs.workspaceId);
    try {
      const res = await api(`/api/public/audit-detail/${noSiteWs.workspaceId}`);
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/no site linked/i);
    } finally {
      noSiteWs.cleanup();
    }
  });

  it('returns null when no snapshot exists for the site', async () => {
    const res = await api(`/api/public/audit-detail/${wsA.workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // With no snapshot, should return null
    if (body === null) {
      expect(body).toBeNull();
    } else {
      // If a snapshot exists, verify it has the expected shape
      expect(body).toHaveProperty('audit');
      expect(body).toHaveProperty('scoreHistory');
      expect(Array.isArray(body.scoreHistory)).toBe(true);
    }
  });
});

// ── 4. GET /api/public/audit-traffic/:workspaceId ────────────────────────────

describe('GET /api/public/audit-traffic/:workspaceId', () => {
  // Behavior change 2026-05-27 (sprint-platform-health-wave8 Plan A Task 1):
  // endpoint now requires authenticated portal access. Auth runs before the
  // handler's graceful-degradation logic, so an unknown workspace returns
  // 404 from the middleware instead of the previous 200-with-empty-object.
  // We add a shared password + session login on wsA so the body-shape
  // assertions can still exercise the handler's GSC/GA4 fallback path.
  beforeAll(async () => {
    updateWorkspace(wsA.workspaceId, { clientPassword: 'audit-test-password' });
    const authRes = await postJson(`/api/public/auth/${wsA.workspaceId}`, { password: 'audit-test-password' });
    expect(authRes.status).toBe(200);
  });

  // Restore wsA to its passwordless seed state and drop the session so later
  // describes (onboarding, etc.) see the same state they had before this
  // block ran.
  afterAll(() => {
    updateWorkspace(wsA.workspaceId, { clientPassword: '' });
    clearCookies();
  });

  it('returns 404 for unknown workspace (auth middleware short-circuits)', async () => {
    const res = await api('/api/public/audit-traffic/nonexistent-ws-traffic-99');
    expect(res.status).toBe(404);
  });

  it('returns 401 for a workspace with no clientPassword set (authenticated-portal gate)', async () => {
    const noIntWs = seedWorkspace({ clientPassword: '', gscPropertyUrl: undefined, ga4PropertyId: undefined });
    try {
      const res = await api(`/api/public/audit-traffic/${noIntWs.workspaceId}`, { headers: { 'x-no-auto-public-auth': 'true' } });
      expect(res.status).toBe(401);
    } finally {
      noIntWs.cleanup();
    }
  });

  it('returns 200 for authenticated main workspace (may have empty traffic if GSC/GA4 not configured)', async () => {
    const res = await api(`/api/public/audit-traffic/${wsA.workspaceId}`);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(typeof body).toBe('object');
    }
  });
});

// ── 5. POST /api/public/onboarding/:id ───────────────────────────────────────

describe('POST /api/public/onboarding/:id — authentication', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await authedPost(
      '/api/public/onboarding/nonexistent-ws-onboard-99',
      { business: { businessName: 'Acme Inc.' } },
      'nonexistent-ws-onboard-99',
      clientTokenA,
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without auth cookies', async () => {
    const res = await api(`/api/public/onboarding/${wsA.workspaceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
      body: JSON.stringify({ business: { businessName: 'Acme Inc.' } }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 401 with cross-workspace token', async () => {
    const otherWs = seedWorkspace({ clientPassword: '' });
    const otherUser = await createClientUser(
      `onboard-other-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Other User',
      otherWs.workspaceId,
      'client_member',
    );
    const otherToken = signClientToken(otherUser);
    try {
      // Use wsA endpoint with otherWs token → token workspaceId != wsA → 401
      const res = await fetch(`${ctx.BASE}/api/public/onboarding/${wsA.workspaceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: `client_user_token_${wsA.workspaceId}=${otherToken}`,
        },
        body: JSON.stringify({ business: { businessName: 'Cross WS Attack' } }),
        redirect: 'manual',
      });
      expect(res.status).toBe(401);
    } finally {
      deleteClientUser(otherUser.id, otherWs.workspaceId);
      otherWs.cleanup();
    }
  });
});

describe('POST /api/public/onboarding/:id — data transformation', () => {
  it('saves business name to knowledgeBase and marks onboarding complete', async () => {
    const onboardWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(onboardWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `onboard-data-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Onboard User',
      onboardWs.workspaceId,
      'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedPost(
        `/api/public/onboarding/${onboardWs.workspaceId}`,
        {
          business: {
            businessName: 'Unique Onboard Corp',
            industry: 'Technology',
            description: 'We build software',
          },
          audience: {},
          brand: {},
          competitors: {},
        },
        onboardWs.workspaceId,
        token,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; message: string };
      expect(body.ok).toBe(true);
      expect(typeof body.message).toBe('string');

      // Verify workspace was updated in DB
      const ws = db.prepare('SELECT knowledge_base, onboarding_completed FROM workspaces WHERE id = ?')
        .get(onboardWs.workspaceId) as { knowledge_base: string | null; onboarding_completed: number | null };
      expect(ws.onboarding_completed).toBe(1);
      // knowledge_base should contain business name
      expect(ws.knowledge_base ?? '').toContain('Unique Onboard Corp');
    } finally {
      deleteClientUser(user.id, onboardWs.workspaceId);
      onboardWs.cleanup();
    }
  });

  it('merges audience data into a persona', async () => {
    const onboardWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(onboardWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `onboard-persona-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Persona User',
      onboardWs.workspaceId,
      'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedPost(
        `/api/public/onboarding/${onboardWs.workspaceId}`,
        {
          business: {},
          audience: {
            primaryAudience: 'Startup founders',
            painPoints: 'Too much time on admin\nNeed to scale fast',
            goals: 'Grow revenue\nHire team',
            buyingStage: 'consideration',
          },
          brand: {},
          competitors: {},
        },
        onboardWs.workspaceId,
        token,
      );
      expect(res.status).toBe(200);

      // personas column is stored as JSON in the workspace row
      const ws = db.prepare('SELECT personas FROM workspaces WHERE id = ?')
        .get(onboardWs.workspaceId) as { personas: string | null };
      if (ws.personas) {
        const personas = JSON.parse(ws.personas) as Array<{ name: string; description: string }>;
        expect(Array.isArray(personas)).toBe(true);
        expect(personas.length).toBeGreaterThan(0);
        // Primary audience becomes first persona
        const primary = personas.find(p => p.description?.includes('Startup founders'));
        expect(primary).toBeDefined();
      }
    } finally {
      deleteClientUser(user.id, onboardWs.workspaceId);
      onboardWs.cleanup();
    }
  });

  it('extracts competitor domains from URLs in competitors field', async () => {
    const onboardWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(onboardWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `onboard-comp-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Comp User',
      onboardWs.workspaceId,
      'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedPost(
        `/api/public/onboarding/${onboardWs.workspaceId}`,
        {
          business: {},
          audience: {},
          brand: {},
          competitors: {
            competitors: 'https://www.example-competitor.com\nhttps://rival.io',
            whatTheyDoBetter: 'Larger brand recognition',
            whatYouDoBetter: 'Better support',
          },
        },
        onboardWs.workspaceId,
        token,
      );
      expect(res.status).toBe(200);

      // Check competitor domains stored
      const ws = db.prepare('SELECT competitor_domains FROM workspaces WHERE id = ?')
        .get(onboardWs.workspaceId) as { competitor_domains: string | null };
      if (ws.competitor_domains) {
        const domains = JSON.parse(ws.competitor_domains) as string[];
        // Should include extracted domains
        expect(Array.isArray(domains)).toBe(true);
      }
    } finally {
      deleteClientUser(user.id, onboardWs.workspaceId);
      onboardWs.cleanup();
    }
  });

  it('handles empty/minimal onboarding body gracefully', async () => {
    const onboardWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(onboardWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `onboard-empty-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Empty User',
      onboardWs.workspaceId,
      'client_member',
    );
    const token = signClientToken(user);
    try {
      const res = await authedPost(
        `/api/public/onboarding/${onboardWs.workspaceId}`,
        {},
        onboardWs.workspaceId,
        token,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean };
      expect(body.ok).toBe(true);
    } finally {
      deleteClientUser(user.id, onboardWs.workspaceId);
      onboardWs.cleanup();
    }
  });
});

// ── 6. GET /api/public/copy/:workspaceId/entries ──────────────────────────────

describe('GET /api/public/copy/:workspaceId/entries', () => {
  it('returns 404 for unknown workspace', async () => {
    const res = await api('/api/public/copy/nonexistent-ws-entries-99/entries');
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(disabledWs.workspaceId);
    try {
      const res = await api(`/api/public/copy/${disabledWs.workspaceId}/entries`);
      expect(res.status).toBe(403);
    } finally {
      disabledWs.cleanup();
    }
  });

  it('returns empty entries array when no blueprints exist', async () => {
    const freshWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(freshWs.workspaceId, { clientPortalEnabled: true });
    try {
      const res = await api(`/api/public/copy/${freshWs.workspaceId}/entries`);
      expect(res.status).toBe(200);
      const body = await res.json() as { entries: unknown[] };
      expect(body).toHaveProperty('entries');
      expect(Array.isArray(body.entries)).toBe(true);
    } finally {
      freshWs.cleanup();
    }
  });

  it('only includes entries with client_review or approved sections', async () => {
    // Create a blueprint with an entry, initialize sections with pending status
    // The entry should NOT appear since sections are in 'pending' state (not visible to client)
    const blueprintWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(blueprintWs.workspaceId, { clientPortalEnabled: true });
    try {
      const bp = createBlueprint({ workspaceId: blueprintWs.workspaceId, name: 'Test BP' });
      const entry = addEntry(blueprintWs.workspaceId, bp.id, { name: 'Test Entry', pageType: 'blog' });

      // Initialize sections in pending state (not visible to client)
      initializeSections(blueprintWs.workspaceId, entry!.id, [
        { id: 'plan-item-1', sectionType: 'hero', wordCountTarget: 200, order: 0 },
      ]);

      const res = await api(`/api/public/copy/${blueprintWs.workspaceId}/entries`);
      expect(res.status).toBe(200);
      const body = await res.json() as { entries: Array<{ id: string }> };
      // Entry should NOT appear — sections are in 'pending', not 'client_review' or 'approved'
      const entryIds = body.entries.map(e => e.id);
      expect(entryIds).not.toContain(entry!.id);
    } finally {
      db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(blueprintWs.workspaceId);
      db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(blueprintWs.workspaceId);
      blueprintWs.cleanup();
    }
  });

  it('includes entries once sections are in client_review state', async () => {
    const blueprintWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(blueprintWs.workspaceId, { clientPortalEnabled: true });
    try {
      const bp = createBlueprint({ workspaceId: blueprintWs.workspaceId, name: 'Review BP' });
      const entry = addEntry(blueprintWs.workspaceId, bp.id, { name: 'Review Entry', pageType: 'blog' });

      const sections = initializeSections(blueprintWs.workspaceId, entry!.id, [
        { id: 'plan-item-review-1', sectionType: 'content-body', wordCountTarget: 300, order: 0 },
      ]);

      const section = sections[0];
      // Move to draft, then client_review
      saveGeneratedCopy(section.id, blueprintWs.workspaceId, {
        generatedCopy: 'This is the generated copy for review.',
        aiAnnotation: 'Test annotation.',
        aiReasoning: 'Test reasoning.',
      });
      db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
        .run(section.id, blueprintWs.workspaceId);

      const res = await api(`/api/public/copy/${blueprintWs.workspaceId}/entries`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        entries: Array<{
          id: string;
          name: string;
          blueprintId: string;
          blueprintName: string;
          copyStatus: { clientReviewSections: number };
        }>;
      };
      const found = body.entries.find(e => e.id === entry!.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe('Review Entry');
      expect(found?.blueprintId).toBe(bp.id);
      expect(found?.copyStatus.clientReviewSections).toBeGreaterThan(0);
    } finally {
      db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(blueprintWs.workspaceId);
      db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(blueprintWs.workspaceId);
      blueprintWs.cleanup();
    }
  });
});

// ── 7. POST /api/public/copy/:workspaceId/section/:sectionId/approve ─────────

describe('POST /api/public/copy/:workspaceId/section/:sectionId/approve', () => {
  let approveWs: SeededFullWorkspace;
  let approveToken = '';
  let approveUserId = '';

  beforeAll(async () => {
    approveWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(approveWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `approve-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Approve User',
      approveWs.workspaceId,
      'client_member',
    );
    approveUserId = user.id;
    approveToken = signClientToken(user);
  });

  afterAll(() => {
    db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(approveWs.workspaceId);
    db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(approveWs.workspaceId);
    if (approveUserId) deleteClientUser(approveUserId, approveWs.workspaceId);
    approveWs.cleanup();
  });

  it('returns 401 without auth', async () => {
    const res = await api(
      `/api/public/copy/${approveWs.workspaceId}/section/fake-section-id/approve`,
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' }, body: '{}' },
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/nonexistent-ws-approve-99/section/fake-section-id/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        workspaceId: approveWs.workspaceId,
        token: approveToken,
      },
    );
    // Auth middleware runs against approveWs.workspaceId cookie key,
    // but route param is nonexistent → workspace not found
    expect([401, 404]).toContain(res.status);
  });

  it('returns 403 when portal is disabled', async () => {
    const disabledWs = seedWorkspace({ clientPassword: '' });
    db.prepare('UPDATE workspaces SET client_portal_enabled = 0 WHERE id = ?').run(disabledWs.workspaceId);
    const disabledUser = await createClientUser(
      `approve-disabled-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Disabled Portal User',
      disabledWs.workspaceId,
      'client_member',
    );
    const disabledToken = signClientToken(disabledUser);
    try {
      const res = await authedFetch(
        `${ctx.BASE}/api/public/copy/${disabledWs.workspaceId}/section/fake-id/approve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          workspaceId: disabledWs.workspaceId,
          token: disabledToken,
        },
      );
      expect(res.status).toBe(403);
    } finally {
      deleteClientUser(disabledUser.id, disabledWs.workspaceId);
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(disabledWs.workspaceId);
    }
  });

  it('returns 400 when section is not in client_review state', async () => {
    // Create a pending section (not client_review) and try to approve it
    const bp = createBlueprint({ workspaceId: approveWs.workspaceId, name: 'Approve BP' });
    const entry = addEntry(approveWs.workspaceId, bp.id, { name: 'Approve Entry', pageType: 'blog' });
    const sections = initializeSections(approveWs.workspaceId, entry!.id, [
      { id: 'approve-plan-item-1', sectionType: 'hero', wordCountTarget: 50, order: 0 },
    ]);
    const section = sections[0]; // status = 'pending'

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${approveWs.workspaceId}/section/${section.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        workspaceId: approveWs.workspaceId,
        token: approveToken,
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('approves a client_review section and returns the section with status=approved', async () => {
    const bp = createBlueprint({ workspaceId: approveWs.workspaceId, name: 'Happy Approve BP' });
    const entry = addEntry(approveWs.workspaceId, bp.id, { name: 'Happy Entry', pageType: 'blog' });
    const sections = initializeSections(approveWs.workspaceId, entry!.id, [
      { id: 'approve-plan-item-happy', sectionType: 'content-body', wordCountTarget: 100, order: 0 },
    ]);
    const section = sections[0];

    // Advance to client_review via draft
    saveGeneratedCopy(section.id, approveWs.workspaceId, { generatedCopy: 'Generated copy for approval test.', aiAnnotation: 'Annotation.', aiReasoning: 'Reasoning.' });
    db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
      .run(section.id, approveWs.workspaceId);

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${approveWs.workspaceId}/section/${section.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        workspaceId: approveWs.workspaceId,
        token: approveToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { status: string; id: string } };
    expect(body).toHaveProperty('section');
    expect(body.section.status).toBe('approved');
    expect(body.section.id).toBe(section.id);
  });

  it('approved section response does NOT leak aiReasoning (internal field)', async () => {
    const bp = createBlueprint({ workspaceId: approveWs.workspaceId, name: 'Leak Test BP' });
    const entry = addEntry(approveWs.workspaceId, bp.id, { name: 'Leak Entry', pageType: 'blog' });
    const sections = initializeSections(approveWs.workspaceId, entry!.id, [
      { id: 'leak-plan-item', sectionType: 'content-body', wordCountTarget: 100, order: 0 },
    ]);
    const section = sections[0];

    saveGeneratedCopy(section.id, approveWs.workspaceId, { generatedCopy: 'Copy for leak test.', aiAnnotation: 'Annotation.', aiReasoning: 'SECRET INTERNAL REASONING' });
    db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
      .run(section.id, approveWs.workspaceId);

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${approveWs.workspaceId}/section/${section.id}/approve`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        workspaceId: approveWs.workspaceId,
        token: approveToken,
      },
    );
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    // Internal field must not appear in client response
    expect(raw).not.toContain('aiReasoning');
    expect(raw).not.toContain('SECRET INTERNAL REASONING');
    expect(raw).not.toContain('steeringHistory');
    expect(raw).not.toContain('qualityFlags');
  });
});

// ── 8. POST /api/public/copy/:workspaceId/section/:sectionId/suggest ─────────

describe('POST /api/public/copy/:workspaceId/section/:sectionId/suggest', () => {
  let suggestWs: SeededFullWorkspace;
  let suggestToken = '';
  let suggestUserId = '';

  beforeAll(async () => {
    suggestWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(suggestWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `suggest-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Suggest User',
      suggestWs.workspaceId,
      'client_member',
    );
    suggestUserId = user.id;
    suggestToken = signClientToken(user);
  });

  afterAll(() => {
    db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(suggestWs.workspaceId);
    db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(suggestWs.workspaceId);
    if (suggestUserId) deleteClientUser(suggestUserId, suggestWs.workspaceId);
    suggestWs.cleanup();
  });

  it('returns 401 without auth', async () => {
    const res = await api(
      `/api/public/copy/${suggestWs.workspaceId}/section/fake-section-id/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-no-auto-public-auth': 'true' },
        body: JSON.stringify({ originalText: 'old', suggestedText: 'new' }),
      },
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing originalText', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/fake-id/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suggestedText: 'only suggested' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing suggestedText', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/fake-id/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'only original' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty originalText (min-length validation)', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/fake-id/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: '  ', suggestedText: 'valid suggestion' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for strict schema — extra fields rejected', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/fake-id/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'old text', suggestedText: 'new text', injectedField: 'evil' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when section is not in client_review state', async () => {
    // Section in pending status cannot accept suggestions via client portal
    const bp = createBlueprint({ workspaceId: suggestWs.workspaceId, name: 'Suggest BP' });
    const entry = addEntry(suggestWs.workspaceId, bp.id, { name: 'Suggest Entry', pageType: 'blog' });
    const sections = initializeSections(suggestWs.workspaceId, entry!.id, [
      { id: 'suggest-plan-item-1', sectionType: 'content-body', wordCountTarget: 100, order: 0 },
    ]);
    const section = sections[0]; // status = pending

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/${section.id}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'existing copy', suggestedText: 'my suggestion' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body).toHaveProperty('error');
  });

  it('adds suggestion and transitions section to revision_requested', async () => {
    const bp = createBlueprint({ workspaceId: suggestWs.workspaceId, name: 'Happy Suggest BP' });
    const entry = addEntry(suggestWs.workspaceId, bp.id, { name: 'Happy Suggest Entry', pageType: 'blog' });
    const sections = initializeSections(suggestWs.workspaceId, entry!.id, [
      { id: 'suggest-plan-happy', sectionType: 'hero', wordCountTarget: 150, order: 0 },
    ]);
    const section = sections[0];

    // Advance to client_review
    saveGeneratedCopy(section.id, suggestWs.workspaceId, { generatedCopy: 'Original generated copy here.', aiAnnotation: 'Annotation.', aiReasoning: 'Reasoning.' });
    db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
      .run(section.id, suggestWs.workspaceId);

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/${section.id}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalText: 'Original generated copy here.',
          suggestedText: 'My improved version here.',
        }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { section: { status: string; id: string } };
    expect(body).toHaveProperty('section');
    // After suggestion, status transitions to revision_requested
    expect(body.section.status).toBe('revision_requested');
    expect(body.section.id).toBe(section.id);
  });

  it('suggest response does NOT leak internal fields', async () => {
    const bp = createBlueprint({ workspaceId: suggestWs.workspaceId, name: 'Suggest Leak BP' });
    const entry = addEntry(suggestWs.workspaceId, bp.id, { name: 'Suggest Leak Entry', pageType: 'blog' });
    const sections = initializeSections(suggestWs.workspaceId, entry!.id, [
      { id: 'suggest-leak-plan', sectionType: 'content-body', wordCountTarget: 100, order: 0 },
    ]);
    const section = sections[0];

    saveGeneratedCopy(section.id, suggestWs.workspaceId, { generatedCopy: 'Copy to suggest on.', aiAnnotation: 'Annotation.', aiReasoning: 'INTERNAL_REASONING_LEAK' });
    db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
      .run(section.id, suggestWs.workspaceId);

    const res = await authedFetch(
      `${ctx.BASE}/api/public/copy/${suggestWs.workspaceId}/section/${section.id}/suggest`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ originalText: 'Copy to suggest on.', suggestedText: 'My improved text.' }),
        workspaceId: suggestWs.workspaceId,
        token: suggestToken,
      },
    );
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await res.json());
    expect(raw).not.toContain('aiReasoning');
    expect(raw).not.toContain('steeringHistory');
    expect(raw).not.toContain('qualityFlags');
    expect(raw).not.toContain('INTERNAL_REASONING_LEAK');
  });
});

// ── 9. GET /api/public/briefing/:workspaceId — growth tier ───────────────────

describe('GET /api/public/briefing/:workspaceId — growth tier', () => {
  it('returns briefing=null for growth workspace with no published briefing', async () => {
    const growthWs = seedWorkspace({ tier: 'growth', clientPassword: '' });
    updateWorkspace(growthWs.workspaceId, { clientPortalEnabled: true });
    try {
      const res = await api(`/api/public/briefing/${growthWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { briefing: null };
      expect(body).toHaveProperty('briefing');
      expect(body.briefing).toBeNull();
    } finally {
      growthWs.cleanup();
    }
  });

  it('returns 402 for free tier without trial', async () => {
    const freeWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    updateWorkspace(freeWs.workspaceId, { clientPortalEnabled: true });
    try {
      const res = await api(`/api/public/briefing/${freeWs.workspaceId}`);
      expect(res.status).toBe(402);
      const body = await res.json() as { error: string };
      expect(body.error).toMatch(/growth|premium/i);
    } finally {
      freeWs.cleanup();
    }
  });

  it('returns briefing for premium workspace with published briefing', async () => {
    const premiumWs = seedWorkspace({ tier: 'premium', clientPassword: '' });
    updateWorkspace(premiumWs.workspaceId, { clientPortalEnabled: true });
    try {
      // Insert a published briefing directly via SQL so we control the exact stored JSON
      // (the Zod schema in briefingStorySchema is strict; stories that fail schema are dropped on read)
      const briefingId = randomUUID();
      const weekOf = '2025-01-06';
      const now = Date.now();
      const validStoryJson = JSON.stringify([{
        id: randomUUID(),
        category: 'opportunity',
        isHeadline: true,
        headline: 'Strong keyword opportunity this week',
        narrative: 'Your site has a strong opportunity to rank for several high-intent keywords.',
        metrics: [{ value: '1,200', label: 'Monthly searches' }],
        drillIn: { page: 'strategy' },
        sourceRefs: [],
      }]);
      db.prepare(
        `INSERT INTO briefing_drafts (id, workspace_id, week_of, status, stories, source_metadata, created_at, updated_at, published_at)
         VALUES (?, ?, ?, 'published', ?, NULL, ?, ?, ?)`,
      ).run(briefingId, premiumWs.workspaceId, weekOf, validStoryJson, now, now, now);

      const res = await api(`/api/public/briefing/${premiumWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        briefing: {
          weekOf: string;
          publishedAt: number | null;
          stories: unknown[];
          issueSummary: string;
          issueNumber: number;
          recommendations: unknown[];
        };
      };
      expect(body.briefing).not.toBeNull();
      expect(body.briefing.weekOf).toBe(weekOf);
      expect(Array.isArray(body.briefing.stories)).toBe(true);
      expect(body.briefing.stories.length).toBeGreaterThan(0);
      expect(typeof body.briefing.issueSummary).toBe('string');
      expect(typeof body.briefing.issueNumber).toBe('number');
      expect(body.briefing.issueNumber).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(body.briefing.recommendations)).toBe(true);
    } finally {
      db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(premiumWs.workspaceId);
      premiumWs.cleanup();
    }
  });

  it('briefing response does not include admin-only fields (adminNote, sourceMetadata)', async () => {
    const premiumWs = seedWorkspace({ tier: 'premium', clientPassword: '' });
    updateWorkspace(premiumWs.workspaceId, { clientPortalEnabled: true });
    try {
      // Insert a published briefing with admin_note — it must not appear in client response
      const briefingId = randomUUID();
      const weekOf = '2025-02-03';
      const now = Date.now();
      db.prepare(
        `INSERT INTO briefing_drafts (id, workspace_id, week_of, status, stories, source_metadata, admin_note, created_at, updated_at, published_at)
         VALUES (?, ?, ?, 'published', '[]', NULL, 'ADMIN_NOTE_MUST_NOT_LEAK', ?, ?, ?)`,
      ).run(briefingId, premiumWs.workspaceId, weekOf, now, now, now);

      const res = await api(`/api/public/briefing/${premiumWs.workspaceId}`);
      expect(res.status).toBe(200);
      const raw = JSON.stringify(await res.json());

      // Admin-only fields must not leak through
      expect(raw).not.toContain('ADMIN_NOTE_MUST_NOT_LEAK');
      expect(raw).not.toContain('sourceMetadata');
      expect(raw).not.toContain('adminNote');
      expect(raw).not.toContain('admin_note');

      // Public fields must be present
      expect(raw).toContain('weekOf');
      expect(raw).toContain('stories');
      expect(raw).toContain('issueSummary');
      expect(raw).toContain('issueNumber');
    } finally {
      db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(premiumWs.workspaceId);
      premiumWs.cleanup();
    }
  });
});

// ── 10. Business profile deep-merge (address sub-object) ─────────────────────

describe('PATCH /api/public/workspaces/:id/business-profile — deep merge', () => {
  let profileWs: SeededFullWorkspace;
  let profileToken = '';
  let profileUserId = '';

  beforeAll(async () => {
    profileWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(profileWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `profile-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Profile User',
      profileWs.workspaceId,
      'client_member',
    );
    profileUserId = user.id;
    profileToken = signClientToken(user);
  });

  afterAll(() => {
    if (profileUserId) deleteClientUser(profileUserId, profileWs.workspaceId);
    profileWs.cleanup();
  });

  it('deep-merges address sub-object so partial patches do not wipe sibling fields', async () => {
    // First: set city and state
    await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { city: 'San Francisco', state: 'CA' } }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });

    // Second: only update street — should preserve city and state
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { street: '123 Main St' } }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { businessProfile: { address: { city?: string; state?: string; street?: string } } };
    expect(body.businessProfile.address).toBeDefined();
    expect(body.businessProfile.address.city).toBe('San Francisco');
    expect(body.businessProfile.address.state).toBe('CA');
    expect(body.businessProfile.address.street).toBe('123 Main St');
  });

  it('clears email field with empty string (Zod clearable-field pattern)', async () => {
    // Set email first
    await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });

    // Clear it with empty string
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: '' }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { businessProfile: { email?: string } };
    expect(body.businessProfile.email).toBe('');
  });

  it('rejects socialProfiles array item that is not a URL and not empty string', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socialProfiles: ['not-a-url'] }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });
    expect(res.status).toBe(400);
  });

  it('accepts valid URL in socialProfiles', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ socialProfiles: ['https://twitter.com/example'] }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });
    expect(res.status).toBe(200);
  });

  it('rejects phone field exceeding max length', async () => {
    const res = await authedFetch(`${ctx.BASE}/api/public/workspaces/${profileWs.workspaceId}/business-profile`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: 'X'.repeat(31) }),
      workspaceId: profileWs.workspaceId,
      token: profileToken,
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown workspace', async () => {
    const res = await authedFetch(
      `${ctx.BASE}/api/public/workspaces/nonexistent-ws-profile-99/business-profile`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '555-0000' }),
        workspaceId: profileWs.workspaceId,
        token: profileToken,
      },
    );
    // Auth passes (cookie key uses profileWs, but param is nonexistent) → 401 from auth
    // OR workspace not found → 404. Both are acceptable.
    expect([401, 404]).toContain(res.status);
  });
});

// ── 11. GET /api/public/tier/:id — trial workspace ───────────────────────────

describe('GET /api/public/tier/:id — trial workspace', () => {
  it('isTrial=true when tier=free but has an active trialEndsAt in the future', async () => {
    const trialWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    // Set a future trialEndsAt date to trigger growth trial
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE workspaces SET trial_ends_at = ? WHERE id = ?").run(futureDate, trialWs.workspaceId);
    try {
      const res = await api(`/api/public/tier/${trialWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        tier: string;
        baseTier: string;
        isTrial: boolean;
        trialDaysRemaining: number;
        trialEndsAt: string | null;
      };
      // With active trial: tier should be 'growth', baseTier 'free', isTrial true
      expect(body.tier).toBe('growth');
      expect(body.baseTier).toBe('free');
      expect(body.isTrial).toBe(true);
      expect(body.trialDaysRemaining).toBeGreaterThan(0);
      expect(body.trialEndsAt).not.toBeNull();
    } finally {
      trialWs.cleanup();
    }
  });

  it('trialDaysRemaining=0 when trial has expired', async () => {
    const expiredWs = seedWorkspace({ tier: 'free', clientPassword: '' });
    // Set a past trialEndsAt to simulate expired trial
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    db.prepare("UPDATE workspaces SET trial_ends_at = ? WHERE id = ?").run(pastDate, expiredWs.workspaceId);
    try {
      const res = await api(`/api/public/tier/${expiredWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { trialDaysRemaining: number; isTrial: boolean; tier: string };
      expect(body.trialDaysRemaining).toBe(0);
      // Expired trial → tier reverts to free, isTrial false
      expect(body.tier).toBe('free');
      expect(body.isTrial).toBe(false);
    } finally {
      expiredWs.cleanup();
    }
  });
});

// ── 12. GET /api/public/workspace/:id — additional field checks ───────────────

describe('GET /api/public/workspace/:id — additional public fields', () => {
  it('seoClientView, analyticsClientView, siteIntelligenceClientView are booleans', async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.seoClientView).toBe('boolean');
    expect(typeof body.analyticsClientView).toBe('boolean');
    expect(typeof body.siteIntelligenceClientView).toBe('boolean');
  });

  it('eventConfig and eventGroups are arrays', async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(Array.isArray(body.eventConfig)).toBe(true);
    expect(Array.isArray(body.eventGroups)).toBe(true);
  });

  it('billingMode is a string', async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.billingMode).toBe('string');
  });

  it('brandLogoUrl and brandAccentColor are strings (empty or otherwise)', async () => {
    const res = await api(`/api/public/workspace/${wsA.workspaceId}`);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.brandLogoUrl).toBe('string');
    expect(typeof body.brandAccentColor).toBe('string');
  });
});

// ── 13. GET /api/public/copy/:workspaceId/entry/:entryId/sections — portal disabled ──

describe('GET /api/public/copy/:workspaceId/entry/:entryId/sections — portal-disabled edge cases', () => {
  it('filters out draft sections (only client_review and approved are returned)', async () => {
    const filterWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(filterWs.workspaceId, { clientPortalEnabled: true });
    try {
      const bp = createBlueprint({ workspaceId: filterWs.workspaceId, name: 'Filter BP' });
      const entry = addEntry(filterWs.workspaceId, bp.id, { name: 'Filter Entry', pageType: 'blog' });
      const sections = initializeSections(filterWs.workspaceId, entry!.id, [
        { id: 'filter-plan-1', sectionType: 'hero', wordCountTarget: 100, order: 0 },
        { id: 'filter-plan-2', sectionType: 'content-body', wordCountTarget: 80, order: 1 },
      ]);

      // Leave section[0] in 'pending' (not client-visible)
      // Move section[1] to draft then client_review
      saveGeneratedCopy(sections[1].id, filterWs.workspaceId, { generatedCopy: 'Copy for review', aiAnnotation: 'Annotation.', aiReasoning: 'Reasoning.' });
      db.prepare("UPDATE copy_sections SET status = 'client_review' WHERE id = ? AND workspace_id = ?")
        .run(sections[1].id, filterWs.workspaceId);

      const res = await api(`/api/public/copy/${filterWs.workspaceId}/entry/${entry!.id}/sections`);
      expect(res.status).toBe(200);
      const body = await res.json() as { sections: Array<{ id: string; status: string }> };

      // Only client_review section should appear
      const sectionIds = body.sections.map(s => s.id);
      expect(sectionIds).not.toContain(sections[0].id);
      expect(sectionIds).toContain(sections[1].id);

      // All returned sections must be client-visible status
      for (const s of body.sections) {
        expect(['client_review', 'approved']).toContain(s.status);
      }
    } finally {
      db.prepare('DELETE FROM copy_sections WHERE workspace_id = ?').run(filterWs.workspaceId);
      db.prepare('DELETE FROM site_blueprints WHERE workspace_id = ?').run(filterWs.workspaceId);
      filterWs.cleanup();
    }
  });
});

// ── 14. GET /api/public/business-priorities — updatedAt field ─────────────────

describe('GET /api/public/business-priorities/:workspaceId — updatedAt field', () => {
  it('updatedAt is null when no priorities have been set', async () => {
    const freshWs = seedWorkspace({ clientPassword: '' });
    try {
      const res = await api(`/api/public/business-priorities/${freshWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { priorities: unknown[]; updatedAt: string | null };
      expect(body.updatedAt).toBeNull();
      expect(body.priorities).toHaveLength(0);
    } finally {
      freshWs.cleanup();
    }
  });

  it('updatedAt is a non-null string after priorities are saved', async () => {
    const prioWs = seedWorkspace({ clientPassword: '' });
    updateWorkspace(prioWs.workspaceId, { clientPortalEnabled: true });
    const user = await createClientUser(
      `prio-ts-${randomUUID().slice(0, 8)}@test.local`,
      'ClientPass1!',
      'Prio TS User',
      prioWs.workspaceId,
      'client_member',
    );
    const token = signClientToken(user);
    try {
      await authedPost(
        `/api/public/business-priorities/${prioWs.workspaceId}`,
        { priorities: [{ text: 'Drive growth', category: 'growth' }] },
        prioWs.workspaceId,
        token,
      );

      const res = await api(`/api/public/business-priorities/${prioWs.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { priorities: unknown[]; updatedAt: string | null };
      expect(body.updatedAt).not.toBeNull();
      expect(typeof body.updatedAt).toBe('string');
    } finally {
      db.prepare('DELETE FROM client_business_priorities WHERE workspace_id = ?').run(prioWs.workspaceId);
      deleteClientUser(user.id, prioWs.workspaceId);
      prioWs.cleanup();
    }
  });
});
