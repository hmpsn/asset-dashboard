// @vitest-environment node
/**
 * Integration tests for churn-signals lifecycle.
 *
 * Covers:
 * - Churn signals: dismiss, workspace-specific reads, admin global reads,
 *   field persistence, workspace isolation, multiple signals
 *
 * Architecture: in-process server with dynamic port (listen(0)) so vi.mock works.
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import db from '../../server/db/index.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';

// ─── Hoisted broadcast capture ────────────────────────────────────────────────

const broadcastState = vi.hoisted(() => ({
  calls: [] as Array<{ workspaceId: string; event: string; payload: unknown }>,
}));

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn((workspaceId: string, event: string, payload: unknown) => {
    broadcastState.calls.push({ workspaceId, event, payload });
  }),
}));

vi.mock('../../server/email.js', () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(),
  notifyApprovalReady: vi.fn(),
  notifyTeamActionApproved: vi.fn(),
  notifyTeamChangesRequested: vi.fn(),
  notifyTeamNewRequest: vi.fn(),
  notifyClientBriefReady: vi.fn(),
  notifyClientContentPublished: vi.fn(),
  notifyClientPostReady: vi.fn(),
  notifyClientFixesApplied: vi.fn(),
  notifyClientStatusChange: vi.fn(),
  notifyTeamContentRequest: vi.fn(),
  notifyTeamChurnSignal: vi.fn(),
}));

// ─── Test server helpers ───────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 25_000;

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ─── Churn signal seeding helper ──────────────────────────────────────────────

interface SeedSignalOpts {
  workspaceId: string;
  workspaceName?: string;
  type?: string;
  severity?: string;
  title?: string;
  description?: string;
  dismissedAt?: string | null;
}

function seedChurnSignal(opts: SeedSignalOpts): string {
  const id = `cs_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  db.prepare(`
    INSERT INTO churn_signals
      (id, workspace_id, workspace_name, type, severity, title, description, detected_at, dismissed_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    opts.workspaceId,
    opts.workspaceName ?? 'Test Workspace',
    opts.type ?? 'no_login_14d',
    opts.severity ?? 'warning',
    opts.title ?? 'No client login in 14 days',
    opts.description ?? 'Client has not logged in for 14 days.',
    new Date().toISOString(),
    opts.dismissedAt ?? null,
  );
  return id;
}

function deleteChurnSignals(workspaceId: string): void {
  db.prepare('DELETE FROM churn_signals WHERE workspace_id = ?').run(workspaceId);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('integration: churn signals', () => {
  let seeded: SeededFullWorkspace;
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  beforeAll(async () => {
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    closeServer = server.close;
  }, REQUEST_TIMEOUT_MS);

  afterAll(async () => {
    await closeServer?.();
  }, REQUEST_TIMEOUT_MS);

  beforeEach(() => {
    seeded = seedWorkspace();
    broadcastState.calls = [];
    vi.clearAllMocks();
  });

  afterEach(() => {
    deleteChurnSignals(seeded.workspaceId);
    seeded.cleanup();
  });

  // ── Workspace-scoped GET ───────────────────────────────────────────────────

  describe('GET /api/churn-signals/:workspaceId', () => {
    it('returns empty array for fresh workspace with no signals', async () => {
      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });

    it('returns seeded signals for workspace', async () => {
      seedChurnSignal({ workspaceId: seeded.workspaceId });
      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
    });

    it('returned signal has expected fields', async () => {
      seedChurnSignal({
        workspaceId: seeded.workspaceId,
        type: 'health_score_drop',
        severity: 'critical',
        title: 'Health dropped 15 points',
        description: 'Score went from 85 to 70.',
      });
      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      const body = await res.json();
      const signal = body[0];
      expect(signal).toMatchObject({
        workspaceId: seeded.workspaceId,
        type: 'health_score_drop',
        severity: 'critical',
        title: 'Health dropped 15 points',
        description: 'Score went from 85 to 70.',
      });
      expect(typeof signal.id).toBe('string');
      expect(typeof signal.detectedAt).toBe('string');
    });

    it('returns multiple signals for the same workspace', async () => {
      seedChurnSignal({ workspaceId: seeded.workspaceId, type: 'no_login_14d' });
      seedChurnSignal({ workspaceId: seeded.workspaceId, type: 'chat_dropoff' });
      seedChurnSignal({ workspaceId: seeded.workspaceId, type: 'payment_failed', severity: 'critical' });

      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(3);
    });

    it('does not return dismissed signals', async () => {
      const signalId = seedChurnSignal({ workspaceId: seeded.workspaceId });
      // Dismiss directly in DB
      db.prepare('UPDATE churn_signals SET dismissed_at = ? WHERE id = ?').run(new Date().toISOString(), signalId);

      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      const body = await res.json();
      expect(body).toHaveLength(0);
    });

    it('type and severity fields persist correctly after seeding', async () => {
      seedChurnSignal({
        workspaceId: seeded.workspaceId,
        type: 'trial_ending',
        severity: 'warning',
      });
      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      const body = await res.json();
      expect(body[0].type).toBe('trial_ending');
      expect(body[0].severity).toBe('warning');
    });
  });

  // ── Global admin GET ───────────────────────────────────────────────────────

  describe('GET /api/churn-signals (global admin)', () => {
    it('returns 200 with an array', async () => {
      const res = await fetch(`${baseUrl}/api/churn-signals`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body)).toBe(true);
    });

    it('includes signals from the seeded workspace', async () => {
      seedChurnSignal({
        workspaceId: seeded.workspaceId,
        type: 'high_engagement',
        severity: 'positive',
        title: 'Highly engaged this week',
      });

      const res = await fetch(`${baseUrl}/api/churn-signals`);
      const body: Array<{ workspaceId: string; id: string }> = await res.json();
      const inResult = body.some((s) => s.workspaceId === seeded.workspaceId);
      expect(inResult).toBe(true);
    });
  });

  // ── Workspace isolation ───────────────────────────────────────────────────

  describe('workspace isolation', () => {
    let wsB: SeededFullWorkspace;

    beforeEach(() => {
      wsB = seedWorkspace();
    });

    afterEach(() => {
      deleteChurnSignals(wsB.workspaceId);
      wsB.cleanup();
    });

    it('signals from wsA are not visible in wsB GET', async () => {
      const signalId = seedChurnSignal({
        workspaceId: seeded.workspaceId,
        type: 'no_login_14d',
      });

      const res = await fetch(`${baseUrl}/api/churn-signals/${wsB.workspaceId}`);
      const body: Array<{ id: string }> = await res.json();
      const ids = body.map((s) => s.id);
      expect(ids).not.toContain(signalId);
    });

    it('signals from wsB are not visible in wsA GET', async () => {
      const signalId = seedChurnSignal({
        workspaceId: wsB.workspaceId,
        type: 'chat_dropoff',
      });

      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      const body: Array<{ id: string }> = await res.json();
      const ids = body.map((s) => s.id);
      expect(ids).not.toContain(signalId);
    });
  });

  // ── Dismiss ───────────────────────────────────────────────────────────────

  describe('POST /api/churn-signals/:signalId/dismiss', () => {
    it('returns 200 with dismissed:true for an existing signal', async () => {
      const signalId = seedChurnSignal({ workspaceId: seeded.workspaceId });
      const res = await fetch(`${baseUrl}/api/churn-signals/${signalId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ dismissed: true });
    });

    it('dismissed signal no longer appears in subsequent GET', async () => {
      const signalId = seedChurnSignal({ workspaceId: seeded.workspaceId });

      // Dismiss via API
      await fetch(`${baseUrl}/api/churn-signals/${signalId}/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      // Should no longer appear in workspace-scoped GET (active signals only)
      const res = await fetch(`${baseUrl}/api/churn-signals/${seeded.workspaceId}`);
      const body: Array<{ id: string }> = await res.json();
      const ids = body.map((s) => s.id);
      expect(ids).not.toContain(signalId);
    });

    it('returns 404 for a nonexistent signalId', async () => {
      const res = await fetch(`${baseUrl}/api/churn-signals/cs_nonexistent_xyz_999/dismiss`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    });
  });
});
