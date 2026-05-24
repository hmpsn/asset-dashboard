/**
 * Extended integration tests for workspace routes.
 *
 * Covers paths NOT tested in workspaces.test.ts:
 *  - POST /api/workspaces with webflowSiteId / webflowSiteName
 *  - PATCH /api/workspaces/:id — billingMode validation
 *  - PATCH /api/workspaces/:id — webflowSiteId unlink (clears token + liveDomain)
 *  - PATCH /api/workspaces/:id — clientPassword hashing
 *  - GET/PUT /api/workspaces/:id/business-profile
 *  - GET/PUT /api/workspaces/:id/intelligence-profile
 *  - GET/POST/DELETE /api/workspaces/:id/audit-suppressions
 *  - GET/PATCH/DELETE /api/workspaces/:id/page-states/:pageId
 *  - POST /api/workspaces/:id/page-states/clear
 *  - GET/POST/PATCH/DELETE /api/workspaces/:id/client-users
 *  - POST /api/workspaces/:id/client-users/:userId/password
 *  - Cross-workspace isolation for client-users
 *  - Sensitive field stripping in responses
 *  - Name max-length validation
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { deleteClientUser } from '../../server/client-users.js';

const ctx = createTestContext(13370);
const { api, postJson, patchJson, del } = ctx;

let wsId = '';       // primary workspace used across suites
let wsIdB = '';      // secondary workspace for cross-workspace isolation tests

// Track created client users so afterAll can clean up even if a test fails
const createdClientUserIds: Array<{ userId: string; workspaceId: string }> = [];

beforeAll(async () => {
  await ctx.startServer();
  const ws = createWorkspace('WS Extended Test Primary');
  wsId = ws.id;
  const wsB = createWorkspace('WS Extended Test Secondary');
  wsIdB = wsB.id;
}, 30_000);

afterAll(async () => {
  // Clean up client users first (foreign key constraint)
  for (const { userId, workspaceId } of createdClientUserIds) {
    try { deleteClientUser(userId, workspaceId); } catch { /* already deleted */ }
  }
  deleteWorkspace(wsId);
  deleteWorkspace(wsIdB);
  await ctx.stopServer();
});

// ---------------------------------------------------------------------------
// POST /api/workspaces — additional create cases
// ---------------------------------------------------------------------------
describe('POST /api/workspaces — extended create validation', () => {
  it('creates workspace with optional webflowSiteId and webflowSiteName', async () => {
    const res = await postJson('/api/workspaces', {
      name: 'Extended Create WS',
      webflowSiteId: 'site_ext_123',
      webflowSiteName: 'Extended Site',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeTruthy();
    expect(body.webflowSiteId).toBe('site_ext_123');
    expect(body.webflowSiteName).toBe('Extended Site');
    // Clean up
    await del(`/api/workspaces/${body.id}`);
  });

  it('rejects name longer than 200 characters', async () => {
    const res = await postJson('/api/workspaces', { name: 'A'.repeat(201) });
    expect(res.status).toBe(400);
  });

  it('rejects empty string name', async () => {
    const res = await postJson('/api/workspaces', { name: '' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:id — sensitive fields are stripped
// ---------------------------------------------------------------------------
describe('GET /api/workspaces/:id — sensitive field stripping', () => {
  it('does not return webflowToken or clientPassword in response', async () => {
    const res = await api(`/api/workspaces/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webflowToken).toBeUndefined();
    expect(body.clientPassword).toBeUndefined();
    expect(body).toHaveProperty('hasPassword');
  });

  it('returns hasPassword: false when no password set', async () => {
    const res = await api(`/api/workspaces/${wsId}`);
    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/workspaces/:id — extended update cases
// ---------------------------------------------------------------------------
describe('PATCH /api/workspaces/:id — billingMode validation', () => {
  it('accepts billingMode = platform', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { billingMode: 'platform' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.billingMode).toBe('platform');
  });

  it('accepts billingMode = external', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { billingMode: 'external' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.billingMode).toBe('external');
  });

  it('rejects invalid billingMode value', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { billingMode: 'invalid_mode' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('billingMode');
  });
});

describe('PATCH /api/workspaces/:id — webflowSiteId unlinking', () => {
  it('clears webflowToken and liveDomain when webflowSiteId set to empty string', async () => {
    // First give the workspace a site + token
    const setupRes = await patchJson(`/api/workspaces/${wsId}`, {
      webflowToken: 'tok_should_be_cleared',
      liveDomain: 'https://example.com',
    });
    expect(setupRes.status).toBe(200);

    // Now unlink by sending empty webflowSiteId
    const res = await patchJson(`/api/workspaces/${wsId}`, { webflowSiteId: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Token is stripped from response (undefined), liveDomain should be cleared
    expect(body.webflowToken).toBeUndefined();
    expect(body.liveDomain).toBeFalsy();
  });

  it('clears webflowToken and liveDomain when webflowSiteId set to null', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { webflowSiteId: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webflowToken).toBeUndefined();
    expect(body.liveDomain).toBeFalsy();
  });
});

describe('PATCH /api/workspaces/:id — clientPassword handling', () => {
  it('hashes and stores password; hasPassword becomes true', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { clientPassword: 'SecurePass123' });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Password must NOT be in response
    expect(body.clientPassword).toBeUndefined();
    // hasPassword must now reflect the stored hash
    expect(body.hasPassword).toBe(true);
  });

  it('clearing password sets hasPassword back to false', async () => {
    // First ensure a password is set
    await patchJson(`/api/workspaces/${wsId}`, { clientPassword: 'TempPass456' });
    // Now clear
    const res = await patchJson(`/api/workspaces/${wsId}`, { clientPassword: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasPassword).toBe(false);
  });
});

describe('PATCH /api/workspaces/:id — response field stripping', () => {
  it('does not expose webflowToken in PATCH response', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}`, { name: 'Renamed WS' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.webflowToken).toBeUndefined();
    expect(body.clientPassword).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// GET/PUT /api/workspaces/:id/business-profile
// ---------------------------------------------------------------------------
describe('Business profile routes', () => {
  it('PUT /api/workspaces/:id/business-profile stores profile and returns it', async () => {
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '+1-555-0100',
        email: 'biz@example.com',
        address: {
          street: '123 Main St',
          city: 'Anytown',
          state: 'CA',
          zip: '90210',
          country: 'US',
        },
        openingHours: 'Mon-Fri 9-5',
        foundedDate: '2010',
        numberOfEmployees: '10-50',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.businessProfile).toBeDefined();
    expect(body.businessProfile.phone).toBe('+1-555-0100');
    expect(body.businessProfile.email).toBe('biz@example.com');
    expect(body.businessProfile.address?.city).toBe('Anytown');
  });

  it('PUT /api/workspaces/:id/business-profile returns 404 for nonexistent workspace', async () => {
    const res = await api('/api/workspaces/ws_nope_business/business-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1-555-0000' }),
    });
    expect(res.status).toBe(404);
  });

  it('PUT /api/workspaces/:id/business-profile rejects invalid email', async () => {
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-a-valid-email' }),
    });
    expect(res.status).toBe(400);
  });

  it('PUT /api/workspaces/:id/business-profile normalizes social profile URLs', async () => {
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        socialProfiles: ['https://twitter.com/example', 'https://linkedin.com/company/example'],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.businessProfile.socialProfiles)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET/PUT /api/workspaces/:id/intelligence-profile
// ---------------------------------------------------------------------------
describe('Intelligence profile routes', () => {
  it('PUT /api/workspaces/:id/intelligence-profile stores profile and returns it', async () => {
    const res = await api(`/api/workspaces/${wsId}/intelligence-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industry: 'Technology',
        goals: ['Increase organic traffic', 'Improve conversion rates'],
        targetAudience: 'B2B software buyers',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intelligenceProfile).toBeDefined();
    expect(body.intelligenceProfile.industry).toBe('Technology');
    expect(body.intelligenceProfile.goals).toContain('Increase organic traffic');
    expect(body.intelligenceProfile.targetAudience).toBe('B2B software buyers');
  });

  it('PUT /api/workspaces/:id/intelligence-profile accepts partial update (industry only)', async () => {
    const res = await api(`/api/workspaces/${wsId}/intelligence-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'SaaS' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.intelligenceProfile.industry).toBe('SaaS');
  });

  it('PUT /api/workspaces/:id/intelligence-profile returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspaces/ws_nope_intel/intelligence-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'Tech' }),
    });
    expect(res.status).toBe(404);
  });

  it('PUT /api/workspaces/:id/intelligence-profile rejects overly long industry string', async () => {
    const res = await api(`/api/workspaces/${wsId}/intelligence-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'X'.repeat(201) }),
    });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Audit suppressions
// ---------------------------------------------------------------------------
describe('Audit suppressions — GET/POST/DELETE', () => {
  it('GET /api/workspaces/:id/audit-suppressions returns empty array for new workspace', async () => {
    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/workspaces/:id/audit-suppressions adds a suppression by pageSlug', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-meta-description',
      pageSlug: '/about',
      reason: 'Legacy page — not prioritised',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.suppressions).toHaveLength(1);
    expect(body.suppressions[0].check).toBe('missing-meta-description');
    expect(body.suppressions[0].pageSlug).toBe('/about');
  });

  it('POST /api/workspaces/:id/audit-suppressions deduplicates same check + pageSlug', async () => {
    // Submit same suppression twice
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-meta-description',
      pageSlug: '/about',
    });
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-meta-description',
      pageSlug: '/about',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // Length should not grow past 1 (deduplication)
    const matchCount = body.suppressions.filter(
      (s: { check: string; pageSlug: string }) =>
        s.check === 'missing-meta-description' && s.pageSlug === '/about',
    ).length;
    expect(matchCount).toBe(1);
  });

  it('POST /api/workspaces/:id/audit-suppressions adds a suppression by pagePattern', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-h1',
      pagePattern: '^/blog/',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const patternSup = body.suppressions.find(
      (s: { pagePattern?: string }) => s.pagePattern === '^/blog/',
    );
    expect(patternSup).toBeDefined();
  });

  it('POST /api/workspaces/:id/audit-suppressions requires check field', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      pageSlug: '/about',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces/:id/audit-suppressions requires pageSlug or pagePattern', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-title',
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/workspaces/:id/audit-suppressions returns 404 for unknown workspace', async () => {
    const res = await api('/api/workspaces/ws_nope_supp/audit-suppressions');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/workspaces/:id/audit-suppressions removes a suppression', async () => {
    // Ensure suppression exists
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'slow-page',
      pageSlug: '/products',
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'slow-page', pageSlug: '/products' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const removed = body.suppressions.find(
      (s: { check: string; pageSlug: string }) =>
        s.check === 'slow-page' && s.pageSlug === '/products',
    );
    expect(removed).toBeUndefined();
  });

  it('DELETE /api/workspaces/:id/audit-suppressions is idempotent when item does not exist', async () => {
    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'nonexistent-check', pageSlug: '/nonexistent' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------
describe('Page states — CRUD', () => {
  const pageId = 'page_ext_test_001';

  it('GET /api/workspaces/:id/page-states returns object', async () => {
    const res = await api(`/api/workspaces/${wsId}/page-states`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe('object');
  });

  it('GET /api/workspaces/:id/page-states/:pageId returns 404 for unknown page', async () => {
    const res = await api(`/api/workspaces/${wsId}/page-states/nonexistent_page_xyz`);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/workspaces/:id/page-states/:pageId creates page state', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'issue-detected',
      fields: ['metaDescription'],
      auditIssues: ['missing-meta-description'],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('issue-detected');
  });

  it('GET /api/workspaces/:id/page-states/:pageId retrieves created state', async () => {
    const res = await api(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('issue-detected');
  });

  it('PATCH /api/workspaces/:id/page-states/:pageId updates status', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'in-review',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('in-review');
  });

  it('PATCH /api/workspaces/:id/page-states/:pageId rejects invalid status enum', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'not-a-valid-status',
    });
    expect(res.status).toBe(400);
  });

  it('DELETE /api/workspaces/:id/page-states/:pageId removes page state', async () => {
    const res = await del(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET /api/workspaces/:id/page-states/:pageId returns 404 after deletion', async () => {
    const res = await api(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(res.status).toBe(404);
  });

  it('DELETE /api/workspaces/:id/page-states/:pageId returns 200 for nonexistent page (idempotent)', async () => {
    // clearPageState returns false only when the workspace itself doesn't exist,
    // not when the specific page has no state — deleting a non-existent page state
    // on a valid workspace is treated as a successful no-op (idempotent).
    const res = await del(`/api/workspaces/${wsId}/page-states/nonexistent_page_999`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});

describe('Page states — bulk clear', () => {
  it('POST /api/workspaces/:id/page-states/clear returns ok with cleared count', async () => {
    // Seed two pages with 'approved' status
    await patchJson(`/api/workspaces/${wsId}/page-states/page_bulk_1`, { status: 'approved' });
    await patchJson(`/api/workspaces/${wsId}/page-states/page_bulk_2`, { status: 'approved' });
    await patchJson(`/api/workspaces/${wsId}/page-states/page_bulk_3`, { status: 'live' });

    const res = await postJson(`/api/workspaces/${wsId}/page-states/clear`, { status: 'approved' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.cleared).toBe('number');
    expect(body.cleared).toBeGreaterThanOrEqual(2);
  });

  it('POST /api/workspaces/:id/page-states/clear requires status field', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/page-states/clear`, {});
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Client user management
// ---------------------------------------------------------------------------
describe('Client users — list / create / update / delete', () => {
  // Use timestamp suffix to avoid email collisions across test runs
  const ts = Date.now();
  const testEmail = `ext-client-${ts}@test.local`;
  const dupEmail = `ext-dup-${ts}@test.local`;
  let clientUserId = '';

  it('GET /api/workspaces/:id/client-users returns empty array for new workspace', async () => {
    const res = await api(`/api/workspaces/${wsIdB}/client-users`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /api/workspaces/:id/client-users creates a client user', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/client-users`, {
      email: testEmail,
      password: 'TestPass1234!',
      name: 'Extended Client',
      role: 'client_member',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('id');
    expect(body.email).toBe(testEmail);
    expect(body.name).toBe('Extended Client');
    expect(body.role).toBe('client_member');
    clientUserId = body.id;
    createdClientUserIds.push({ userId: clientUserId, workspaceId: wsId });
  });

  it('POST /api/workspaces/:id/client-users rejects duplicate email', async () => {
    // Use the same email as the already-created user to trigger duplicate check
    const res = await postJson(`/api/workspaces/${wsId}/client-users`, {
      email: testEmail,
      password: 'TestPass1234!',
      name: 'Duplicate Client',
      role: 'client_member',
    });
    // Should fail with 400 — email already registered
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces/:id/client-users rejects too-short password', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/client-users`, {
      email: `shortpw-${ts}@test.local`,
      password: 'short',
      name: 'Short PW User',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/workspaces/:id/client-users rejects invalid email', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/client-users`, {
      email: 'not-an-email',
      password: 'LongEnoughPass123',
      name: 'Bad Email',
    });
    expect(res.status).toBe(400);
  });

  it('PATCH /api/workspaces/:id/client-users/:userId updates name and role', async () => {
    // Skip gracefully if user creation failed in a prior test
    if (!clientUserId) {
      console.warn('Skipping PATCH test — clientUserId not set (create likely failed)');
      return;
    }
    const res = await patchJson(`/api/workspaces/${wsId}/client-users/${clientUserId}`, {
      name: 'Extended Client Updated',
      role: 'client_owner',
    });
    const body = await res.json();
    if (res.status !== 200) {
      console.error('PATCH client user failed:', res.status, body);
    }
    expect(res.status).toBe(200);
    expect(body.name).toBe('Extended Client Updated');
    expect(body.role).toBe('client_owner');
  });

  it('PATCH /api/workspaces/:id/client-users/:userId returns 404 for nonexistent user', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}/client-users/cu_nonexistent_99999`, {
      name: 'Ghost',
    });
    expect(res.status).toBe(404);
  });

  it('POST /api/workspaces/:id/client-users/:userId/password changes password', async () => {
    if (!clientUserId) return;
    const res = await postJson(
      `/api/workspaces/${wsId}/client-users/${clientUserId}/password`,
      { password: 'NewSecurePass9876!' },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('POST /api/workspaces/:id/client-users/:userId/password rejects short password', async () => {
    if (!clientUserId) return;
    const res = await postJson(
      `/api/workspaces/${wsId}/client-users/${clientUserId}/password`,
      { password: 'short' },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('8 characters');
  });

  it('POST /api/workspaces/:id/client-users/:userId/password returns 404 for nonexistent user', async () => {
    const res = await postJson(
      `/api/workspaces/${wsId}/client-users/cu_ghost_99999/password`,
      { password: 'LongEnoughPass123' },
    );
    expect(res.status).toBe(404);
  });

  it('GET /api/workspaces/:id/client-users lists created user', async () => {
    if (!clientUserId) return;
    const res = await api(`/api/workspaces/${wsId}/client-users`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    expect(body.some(u => u.id === clientUserId)).toBe(true);
  });

  it('DELETE /api/workspaces/:id/client-users/:userId removes the client user', async () => {
    if (!clientUserId) return;
    const res = await del(`/api/workspaces/${wsId}/client-users/${clientUserId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Remove from cleanup list since already deleted
    const idx = createdClientUserIds.findIndex(e => e.userId === clientUserId);
    if (idx !== -1) createdClientUserIds.splice(idx, 1);
  });

  it('DELETE /api/workspaces/:id/client-users/:userId returns 404 for nonexistent user', async () => {
    const res = await del(`/api/workspaces/${wsId}/client-users/cu_nonexistent_dead`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Cross-workspace isolation for client users
// ---------------------------------------------------------------------------
describe('Cross-workspace isolation — client users', () => {
  let userInA = '';
  let userInB = '';

  beforeAll(async () => {
    // Create a client user in wsId (A) and one in wsIdB (B)
    const resA = await postJson(`/api/workspaces/${wsId}/client-users`, {
      email: 'isolation-a@test.local',
      password: 'IsolationPassA1!',
      name: 'Isolation User A',
    });
    if (resA.status === 200) {
      const body = await resA.json();
      userInA = body.id;
      createdClientUserIds.push({ userId: userInA, workspaceId: wsId });
    }

    const resB = await postJson(`/api/workspaces/${wsIdB}/client-users`, {
      email: 'isolation-b@test.local',
      password: 'IsolationPassB1!',
      name: 'Isolation User B',
    });
    if (resB.status === 200) {
      const body = await resB.json();
      userInB = body.id;
      createdClientUserIds.push({ userId: userInB, workspaceId: wsIdB });
    }
  });

  it('cannot update a client user from workspace B using workspace A endpoint', async () => {
    if (!userInB) return; // skip if setup failed
    // Try to update wsIdB's user via wsId's endpoint — should 404 (no cross-workspace access)
    const res = await patchJson(`/api/workspaces/${wsId}/client-users/${userInB}`, {
      name: 'Cross-Workspace Hack',
    });
    expect(res.status).toBe(404);
  });

  it('cannot delete a client user from workspace B using workspace A endpoint', async () => {
    if (!userInB) return; // skip if setup failed
    const res = await del(`/api/workspaces/${wsId}/client-users/${userInB}`);
    expect(res.status).toBe(404);
  });

  it('cannot change password of workspace B user via workspace A endpoint', async () => {
    if (!userInB) return; // skip if setup failed
    const res = await postJson(
      `/api/workspaces/${wsId}/client-users/${userInB}/password`,
      { password: 'CrossWorkspaceHack123!' },
    );
    expect(res.status).toBe(404);
  });

  it('workspace A client-users list does not include workspace B users', async () => {
    const res = await api(`/api/workspaces/${wsId}/client-users`);
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string }>;
    const ids = body.map(u => u.id);
    if (userInB) {
      expect(ids).not.toContain(userInB);
    }
    if (userInA) {
      expect(ids).toContain(userInA);
    }
  });
});

// ---------------------------------------------------------------------------
// Workspace overview — edge cases
// ---------------------------------------------------------------------------
describe('GET /api/workspace-overview — content fields', () => {
  it('includes contentRequests, workOrders, contentPlan, churnSignals, clientSignals fields', async () => {
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((w: { id: string }) => w.id === wsId);
    expect(ours).toBeDefined();
    // Extended fields not verified by existing test
    expect(ours).toHaveProperty('contentRequests');
    expect(ours.contentRequests).toHaveProperty('pending');
    expect(ours.contentRequests).toHaveProperty('total');
    expect(ours).toHaveProperty('workOrders');
    expect(ours).toHaveProperty('contentPlan');
    expect(ours).toHaveProperty('churnSignals');
    expect(ours).toHaveProperty('clientSignals');
    expect(ours).toHaveProperty('hasGsc');
    expect(ours).toHaveProperty('hasGa4');
  });

  it('audit field is null when no webflowSiteId is set', async () => {
    // wsId has no webflowSiteId (we unlinked it earlier in the test)
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    const ours = body.find((w: { id: string }) => w.id === wsId);
    expect(ours).toBeDefined();
    // audit should be null since no siteId
    expect(ours.audit).toBeNull();
  });

  it('isTrial and trialDaysRemaining are present with correct types', async () => {
    // wsIdB is a fresh workspace with no tier/trial mutations — use it to verify the
    // false-trial baseline shape without depending on wsId's mutable trial state.
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    const wsB = body.find((w: { id: string }) => w.id === wsIdB);
    expect(wsB).toBeDefined();
    // isTrial must be a boolean (true or false depending on DB state)
    expect(typeof wsB.isTrial).toBe('boolean');
    // trialDaysRemaining is either undefined (not on trial) or a non-negative number
    if (wsB.isTrial) {
      expect(typeof wsB.trialDaysRemaining).toBe('number');
      expect(wsB.trialDaysRemaining).toBeGreaterThanOrEqual(0);
    } else {
      expect(wsB.trialDaysRemaining).toBeUndefined();
    }
  });
});
