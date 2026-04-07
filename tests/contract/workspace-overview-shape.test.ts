// tests/contract/workspace-overview-shape.test.ts
//
// CONTRACT TEST: GET /api/workspace-overview returns the expected aggregate shape.
//
// Uses in-process DB seeding via seedWorkspace, then verifies every field present
// in the documented response contract. Shape assertions only — no specific data values.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

import { seedWorkspace } from '../fixtures/workspace-seed.js';
import { createTestContext } from '../integration/helpers.js';

const ctx = createTestContext(13307);
const { api } = ctx;

let workspaceId = '';
let cleanup: () => void = () => {};

beforeAll(async () => {
  await ctx.startServer();
  // Seed the workspace directly into the DB (in-process pattern)
  const seeded = seedWorkspace();
  workspaceId = seeded.workspaceId;
  cleanup = seeded.cleanup;
}, 25_000);

afterAll(() => {
  cleanup();
  ctx.stopServer();
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function getOverview(): Promise<unknown[]> {
  const res = await api('/api/workspace-overview');
  expect(res.status).toBe(200);
  return res.json() as Promise<unknown[]>;
}

async function getOurWorkspace(): Promise<Record<string, unknown>> {
  const body = await getOverview();
  expect(Array.isArray(body)).toBe(true);
  const ws = (body as Array<Record<string, unknown>>).find(w => w.id === workspaceId);
  expect(ws).toBeDefined();
  return ws as Record<string, unknown>;
}

// ── 1. Response shape for fresh workspace ─────────────────────────────────────

describe('response shape for fresh workspace', () => {
  it('GET /api/workspace-overview returns a 200 array', async () => {
    const res = await api('/api/workspace-overview');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('seeded workspace appears in the overview', async () => {
    const ws = await getOurWorkspace();
    expect(ws).toBeDefined();
  });

  it('has all required top-level fields', async () => {
    const ws = await getOurWorkspace();
    expect(ws).toHaveProperty('id');
    expect(ws).toHaveProperty('name');
    expect(ws).toHaveProperty('webflowSiteId');
    expect(ws).toHaveProperty('webflowSiteName');
    expect(ws).toHaveProperty('hasGsc');
    expect(ws).toHaveProperty('hasGa4');
    expect(ws).toHaveProperty('hasPassword');
    expect(ws).toHaveProperty('tier');
    expect(ws).toHaveProperty('isTrial');
    expect(ws).toHaveProperty('audit');
    expect(ws).toHaveProperty('requests');
    expect(ws).toHaveProperty('approvals');
    expect(ws).toHaveProperty('contentRequests');
    expect(ws).toHaveProperty('workOrders');
    expect(ws).toHaveProperty('contentPlan');
    expect(ws).toHaveProperty('churnSignals');
    expect(ws).toHaveProperty('clientSignals');
    expect(ws).toHaveProperty('pageStates');
  });
});

// ── 2. Nested aggregate shapes ────────────────────────────────────────────────

describe('nested aggregate shapes', () => {
  it('requests has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const requests = ws.requests as Record<string, unknown>;
    expect(requests).toHaveProperty('total');
    expect(requests).toHaveProperty('new');
    expect(requests).toHaveProperty('active');
    expect(requests).toHaveProperty('latestDate');
  });

  it('approvals has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const approvals = ws.approvals as Record<string, unknown>;
    expect(approvals).toHaveProperty('pending');
    expect(approvals).toHaveProperty('total');
  });

  it('contentRequests has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const contentRequests = ws.contentRequests as Record<string, unknown>;
    expect(contentRequests).toHaveProperty('pending');
    expect(contentRequests).toHaveProperty('inProgress');
    expect(contentRequests).toHaveProperty('delivered');
    expect(contentRequests).toHaveProperty('total');
  });

  it('workOrders has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const workOrders = ws.workOrders as Record<string, unknown>;
    expect(workOrders).toHaveProperty('pending');
    expect(workOrders).toHaveProperty('total');
  });

  it('contentPlan has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const contentPlan = ws.contentPlan as Record<string, unknown>;
    expect(contentPlan).toHaveProperty('review');
  });

  it('churnSignals has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const churnSignals = ws.churnSignals as Record<string, unknown>;
    expect(churnSignals).toHaveProperty('critical');
    expect(churnSignals).toHaveProperty('warning');
  });

  it('clientSignals has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const clientSignals = ws.clientSignals as Record<string, unknown>;
    expect(clientSignals).toHaveProperty('new');
  });

  it('pageStates has correct sub-fields', async () => {
    const ws = await getOurWorkspace();
    const pageStates = ws.pageStates as Record<string, unknown>;
    expect(pageStates).toHaveProperty('issueDetected');
    expect(pageStates).toHaveProperty('inReview');
    expect(pageStates).toHaveProperty('approved');
    expect(pageStates).toHaveProperty('rejected');
    expect(pageStates).toHaveProperty('live');
    expect(pageStates).toHaveProperty('total');
  });
});

// ── 3. Default values for empty workspace ─────────────────────────────────────

describe('default values for empty (freshly seeded) workspace', () => {
  it('requests counts are numbers, not undefined', async () => {
    const ws = await getOurWorkspace();
    const requests = ws.requests as Record<string, unknown>;
    expect(typeof requests.total).toBe('number');
    expect(typeof requests.new).toBe('number');
    expect(typeof requests.active).toBe('number');
  });

  it('requests.total is 0 for a fresh workspace', async () => {
    const ws = await getOurWorkspace();
    const requests = ws.requests as Record<string, unknown>;
    expect(requests.total).toBe(0);
  });

  it('approvals counts are numbers, not undefined', async () => {
    const ws = await getOurWorkspace();
    const approvals = ws.approvals as Record<string, unknown>;
    expect(typeof approvals.pending).toBe('number');
    expect(typeof approvals.total).toBe('number');
  });

  it('approvals.pending and total are 0 for a fresh workspace', async () => {
    const ws = await getOurWorkspace();
    const approvals = ws.approvals as Record<string, unknown>;
    expect(approvals.pending).toBe(0);
    expect(approvals.total).toBe(0);
  });

  it('contentRequests counts are numbers and 0 for fresh workspace', async () => {
    const ws = await getOurWorkspace();
    const cr = ws.contentRequests as Record<string, unknown>;
    expect(typeof cr.pending).toBe('number');
    expect(typeof cr.inProgress).toBe('number');
    expect(typeof cr.delivered).toBe('number');
    expect(typeof cr.total).toBe('number');
    expect(cr.total).toBe(0);
  });

  it('workOrders counts are numbers and 0 for fresh workspace', async () => {
    const ws = await getOurWorkspace();
    const wo = ws.workOrders as Record<string, unknown>;
    expect(typeof wo.pending).toBe('number');
    expect(typeof wo.total).toBe('number');
    expect(wo.total).toBe(0);
  });

  it('contentPlan.review is a number', async () => {
    const ws = await getOurWorkspace();
    const contentPlan = ws.contentPlan as Record<string, unknown>;
    expect(typeof contentPlan.review).toBe('number');
  });

  it('churnSignals counts are numbers', async () => {
    const ws = await getOurWorkspace();
    const cs = ws.churnSignals as Record<string, unknown>;
    expect(typeof cs.critical).toBe('number');
    expect(typeof cs.warning).toBe('number');
  });

  it('clientSignals.new is a number', async () => {
    const ws = await getOurWorkspace();
    const cliSig = ws.clientSignals as Record<string, unknown>;
    expect(typeof cliSig.new).toBe('number');
  });

  it('pageStates counts are numbers and total is 0 for fresh workspace', async () => {
    const ws = await getOurWorkspace();
    const ps = ws.pageStates as Record<string, unknown>;
    expect(typeof ps.issueDetected).toBe('number');
    expect(typeof ps.inReview).toBe('number');
    expect(typeof ps.approved).toBe('number');
    expect(typeof ps.rejected).toBe('number');
    expect(typeof ps.live).toBe('number');
    expect(typeof ps.total).toBe('number');
    expect(ps.total).toBe(0);
  });

  it('audit is null when no snapshot exists for fresh workspace', async () => {
    const ws = await getOurWorkspace();
    expect(ws.audit).toBeNull();
  });
});

// ── 4. Tier and trial fields ──────────────────────────────────────────────────

describe('tier and trial fields', () => {
  it('tier is one of the expected string values', async () => {
    const ws = await getOurWorkspace();
    expect(['free', 'growth', 'premium']).toContain(ws.tier);
  });

  it('tier defaults to "free" for fresh workspace', async () => {
    const ws = await getOurWorkspace();
    expect(ws.tier).toBe('free');
  });

  it('isTrial is a boolean', async () => {
    const ws = await getOurWorkspace();
    expect(typeof ws.isTrial).toBe('boolean');
  });

  it('isTrial is false for a workspace with no trial set', async () => {
    const ws = await getOurWorkspace();
    expect(ws.isTrial).toBe(false);
  });

  it('trialDaysRemaining is undefined when isTrial is false', async () => {
    const ws = await getOurWorkspace();
    expect(ws.isTrial).toBe(false);
    expect(ws.trialDaysRemaining).toBeUndefined();
  });

  it('tier workspace seeded with "growth" reports tier "growth"', async () => {
    const seeded = seedWorkspace({ tier: 'growth' });
    try {
      const body = await getOverview();
      const growthWs = (body as Array<Record<string, unknown>>).find(
        w => w.id === seeded.workspaceId,
      );
      expect(growthWs).toBeDefined();
      expect(growthWs!.tier).toBe('growth');
    } finally {
      seeded.cleanup();
    }
  });
});

// ── 5. Boolean integration flags ──────────────────────────────────────────────

describe('boolean integration flags', () => {
  it('hasGsc is a boolean', async () => {
    const ws = await getOurWorkspace();
    expect(typeof ws.hasGsc).toBe('boolean');
  });

  it('hasGa4 is a boolean', async () => {
    const ws = await getOurWorkspace();
    expect(typeof ws.hasGa4).toBe('boolean');
  });

  it('hasPassword is a boolean', async () => {
    const ws = await getOurWorkspace();
    expect(typeof ws.hasPassword).toBe('boolean');
  });

  it('hasGsc is false when no gscPropertyUrl is set', async () => {
    const ws = await getOurWorkspace();
    // Default seedWorkspace sets gscPropertyUrl to null
    expect(ws.hasGsc).toBe(false);
  });

  it('hasGa4 is false when no ga4PropertyId is set', async () => {
    const ws = await getOurWorkspace();
    // Default seedWorkspace sets ga4PropertyId to null
    expect(ws.hasGa4).toBe(false);
  });

  it('hasPassword is true when clientPassword is set', async () => {
    const ws = await getOurWorkspace();
    // Default seedWorkspace sets client_password to 'test-password'
    expect(ws.hasPassword).toBe(true);
  });

  it('hasGsc is true when gscPropertyUrl is provided', async () => {
    const seeded = seedWorkspace({ gscPropertyUrl: 'sc-domain:example.com' });
    try {
      const body = await getOverview();
      const gscWs = (body as Array<Record<string, unknown>>).find(
        w => w.id === seeded.workspaceId,
      );
      expect(gscWs).toBeDefined();
      expect(gscWs!.hasGsc).toBe(true);
    } finally {
      seeded.cleanup();
    }
  });

  it('hasGa4 is true when ga4PropertyId is provided', async () => {
    const seeded = seedWorkspace({ ga4PropertyId: 'properties/123456789' });
    try {
      const body = await getOverview();
      const ga4Ws = (body as Array<Record<string, unknown>>).find(
        w => w.id === seeded.workspaceId,
      );
      expect(ga4Ws).toBeDefined();
      expect(ga4Ws!.hasGa4).toBe(true);
    } finally {
      seeded.cleanup();
    }
  });
});
