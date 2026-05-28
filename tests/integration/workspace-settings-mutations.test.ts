/**
 * Integration tests for workspace sub-resource endpoints:
 * - PUT /api/workspaces/:id/business-profile
 * - PUT /api/workspaces/:id/intelligence-profile
 * - GET+POST+DELETE /api/workspaces/:id/audit-suppressions
 * - PATCH/GET/DELETE /api/workspaces/:id/page-states/:pageId
 * - POST /api/workspaces/:id/page-states/clear
 *
 * Port: 13858
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

vi.mock('../../server/email.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../server/email.js')>();
  return {
    ...actual,
    notifyClientWelcome: vi.fn(),
    notifyClientTeamResponse: vi.fn(),
    notifyClientStatusChange: vi.fn(),
    notifyTeamNewRequest: vi.fn(),
    notifyTeamActionApproved: vi.fn(),
    notifyTeamContentRequest: vi.fn(),
    notifyTeamChangesRequested: vi.fn(),
    notifyTeamPaymentReceived: vi.fn(),
    notifyTeamChurnSignal: vi.fn(),
    notifyTeamClientSignal: vi.fn(),
  };
});

import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13858); // port-ok: unique in integration suite
const { api, postJson, patchJson, del } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Settings Mutations Test Workspace').id;
}, 25_000);

afterAll(async () => {
  if (wsId) deleteWorkspace(wsId);
  await ctx.stopServer();
}, 15_000);

// ── Business Profile ───────────────────────────────────────────────────────────

describe('PUT /api/workspaces/:id/business-profile', () => {
  it('stores business profile and returns it with the sent fields', async () => {
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: '555-0100',
        email: 'contact@example.com',
        address: {
          city: 'Seattle',
          state: 'WA',
          country: 'US',
        },
        openingHours: 'Mon-Fri 9am-5pm',
        numberOfEmployees: '10-50',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('businessProfile');
    const bp = body.businessProfile;
    expect(bp.phone).toBe('555-0100');
    expect(bp.email).toBe('contact@example.com');
    expect(bp.address?.city).toBe('Seattle');
    expect(bp.address?.state).toBe('WA');
    expect(bp.address?.country).toBe('US');
    expect(bp.openingHours).toBe('Mon-Fri 9am-5pm');
    expect(bp.numberOfEmployees).toBe('10-50');
  });

  it('PUT replaces the entire profile (fields not sent are gone)', async () => {
    // First PUT with a full profile
    await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-1111', email: 'a@example.com' }),
    });
    // Second PUT with only city — email and phone should NOT persist (it's a replace)
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: { city: 'Portland' } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const bp = body.businessProfile;
    expect(bp.address?.city).toBe('Portland');
    // phone and email were not sent in this request; route passes req.body directly to updateWorkspace
    expect(bp.phone).toBeUndefined();
    expect(bp.email).toBeUndefined();
  });

  it('GET /api/workspaces/:id shows updated businessProfile in workspace object', async () => {
    await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-9999', address: { city: 'Tacoma' } }),
    });

    const res = await api(`/api/workspaces/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('businessProfile');
    expect(body.businessProfile.phone).toBe('555-9999');
    expect(body.businessProfile.address?.city).toBe('Tacoma');
  });

  it('returns 400 for invalid schema (bad email format)', async () => {
    const res = await api(`/api/workspaces/${wsId}/business-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });

  it('returns 404 for unknown workspace id', async () => {
    const res = await api('/api/workspaces/ws_nonexistent_999/business-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '555-0000' }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Intelligence Profile ───────────────────────────────────────────────────────

describe('PUT /api/workspaces/:id/intelligence-profile', () => {
  it('stores intelligence profile and returns 200 with the profile', async () => {
    const res = await api(`/api/workspaces/${wsId}/intelligence-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industry: 'E-commerce',
        goals: ['Increase organic traffic', 'Improve conversion rate'],
        targetAudience: 'Small business owners aged 25-45',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('intelligenceProfile');
    const ip = body.intelligenceProfile;
    expect(ip.industry).toBe('E-commerce');
    expect(ip.goals).toEqual(['Increase organic traffic', 'Improve conversion rate']);
    expect(ip.targetAudience).toBe('Small business owners aged 25-45');
  });

  it('GET /api/workspaces/:id shows updated intelligenceProfile in workspace object', async () => {
    await api(`/api/workspaces/${wsId}/intelligence-profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ industry: 'SaaS', goals: ['Grow MRR'] }),
    });

    const res = await api(`/api/workspaces/${wsId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('intelligenceProfile');
    expect(body.intelligenceProfile.industry).toBe('SaaS');
    expect(body.intelligenceProfile.goals).toEqual(['Grow MRR']);
  });
});

// ── Audit Suppressions ─────────────────────────────────────────────────────────

describe('GET+POST+DELETE /api/workspaces/:id/audit-suppressions', () => {
  it('GET returns empty array for a fresh workspace', async () => {
    // Create a fresh workspace to isolate from any suppressions added by other tests
    const freshWs = createWorkspace('Audit Suppression Test Workspace');
    try {
      const res = await api(`/api/workspaces/${freshWs.id}/audit-suppressions`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
      expect(body).toHaveLength(0);
    } finally {
      deleteWorkspace(freshWs.id);
    }
  });

  it('POST adds a suppression and response includes the suppression with expected fields', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-meta-description',
      pageSlug: '/about',
      reason: 'This page intentionally has no meta description',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.suppressions)).toBe(true);
    const added = body.suppressions.find(
      (s: { check: string; pageSlug: string }) =>
        s.check === 'missing-meta-description' && s.pageSlug === '/about',
    );
    expect(added).toBeDefined();
    expect(added.reason).toBe('This page intentionally has no meta description');
    expect(added.createdAt).toBeDefined();
  });

  it('GET after POST includes the new suppression', async () => {
    // Ensure at least one suppression exists (may already from previous test)
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'missing-h1',
      pageSlug: '/contact',
      reason: 'Contact page layout does not need an H1',
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const found = body.find(
      (s: { check: string; pageSlug: string }) =>
        s.check === 'missing-h1' && s.pageSlug === '/contact',
    );
    expect(found).toBeDefined();
  });

  it('POST same check+pageSlug again is deduped (returns ok without duplicating)', async () => {
    const payload = { check: 'duplicate-check', pageSlug: '/home', reason: 'first' };
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, payload);
    const res = await postJson(`/api/workspaces/${wsId}/audit-suppressions`, payload);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Should not have duplicates
    const matches = body.suppressions.filter(
      (s: { check: string; pageSlug?: string }) =>
        s.check === 'duplicate-check' && s.pageSlug === '/home',
    );
    expect(matches).toHaveLength(1);
  });

  it('DELETE removes the suppression by check+pageSlug', async () => {
    // Add one to delete
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'to-be-deleted',
      pageSlug: '/delete-me',
      reason: 'temporary',
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'to-be-deleted', pageSlug: '/delete-me' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('GET after DELETE shows the suppression is gone', async () => {
    // Add then remove
    await postJson(`/api/workspaces/${wsId}/audit-suppressions`, {
      check: 'transient-check',
      pageSlug: '/transient',
    });
    await api(`/api/workspaces/${wsId}/audit-suppressions`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ check: 'transient-check', pageSlug: '/transient' }),
    });

    const res = await api(`/api/workspaces/${wsId}/audit-suppressions`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const stillPresent = body.find(
      (s: { check: string; pageSlug?: string }) =>
        s.check === 'transient-check' && s.pageSlug === '/transient',
    );
    expect(stillPresent).toBeUndefined();
  });
});

// ── Page States ────────────────────────────────────────────────────────────────

describe('PATCH /api/workspaces/:id/page-states/:pageId', () => {
  const pageId = 'test-page-abc';

  it('sets page state and returns the updated state', async () => {
    const res = await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'fix-proposed',
      fields: ['meta-description', 'title'],
      source: 'audit',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('fix-proposed');
    expect(body.fields).toEqual(expect.arrayContaining(['meta-description', 'title']));
    expect(body.source).toBe('audit');
  });

  it('GET /api/workspaces/:id/page-states/:pageId returns the stored state', async () => {
    await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'in-review',
      fields: ['h1'],
    });

    const res = await api(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('in-review');
    expect(body.fields).toEqual(expect.arrayContaining(['h1']));
  });

  it('GET /api/workspaces/:id/page-states returns object including the page keyed by pageId', async () => {
    await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, {
      status: 'approved',
    });

    const res = await api(`/api/workspaces/${wsId}/page-states`);
    expect(res.status).toBe(200);
    const body = await res.json();
    // getAllPageStates returns a Record<string, PageEditState> keyed by pageId
    expect(typeof body).toBe('object');
    expect(body).not.toBeNull();
    expect(body[pageId]).toBeDefined();
    expect(body[pageId].status).toBe('approved');
  });

  it('DELETE /api/workspaces/:id/page-states/:pageId removes it', async () => {
    // Ensure it exists first
    await patchJson(`/api/workspaces/${wsId}/page-states/${pageId}`, { status: 'clean' });

    const res = await del(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // Confirm it's gone
    const getRes = await api(`/api/workspaces/${wsId}/page-states/${pageId}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Page States — bulk clear ───────────────────────────────────────────────────

describe('POST /api/workspaces/:id/page-states/clear', () => {
  it('clears all page states matching the given status and returns cleared count', async () => {
    // Seed a couple of pages with status "issue-detected"
    await patchJson(`/api/workspaces/${wsId}/page-states/page-clear-1`, {
      status: 'issue-detected',
      source: 'audit',
    });
    await patchJson(`/api/workspaces/${wsId}/page-states/page-clear-2`, {
      status: 'issue-detected',
      source: 'audit',
    });
    // Seed one with a different status that should NOT be cleared
    await patchJson(`/api/workspaces/${wsId}/page-states/page-keep-1`, {
      status: 'approved',
      source: 'audit',
    });

    const res = await postJson(`/api/workspaces/${wsId}/page-states/clear`, {
      status: 'issue-detected',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.cleared).toBe('number');
    expect(body.cleared).toBeGreaterThanOrEqual(2);

    // The "approved" page should still be present
    const keepRes = await api(`/api/workspaces/${wsId}/page-states/page-keep-1`);
    expect(keepRes.status).toBe(200);
    const keepBody = await keepRes.json();
    expect(keepBody.status).toBe('approved');
  });

  it('returns 400 when status field is missing', async () => {
    const res = await postJson(`/api/workspaces/${wsId}/page-states/clear`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
