/**
 * Integration tests for server/routes/revenue.ts
 *
 * Routes covered:
 *  - GET /api/revenue/summary — returns a well-shaped summary object
 *  - GET /api/revenue/summary — fresh instance has zero totals
 *  - DELETE /api/revenue/payments/:id — 404 for unknown id
 *  - DELETE /api/revenue/payments — purge returns ok + count
 */

// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../server/broadcast.js', () => ({
  setBroadcast: vi.fn(),
  broadcast: vi.fn(),
  broadcastToWorkspace: vi.fn(),
}));

async function startTestServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  delete process.env.APP_PASSWORD;
  const { createApp } = await import('../../server/app.js'); // dynamic-import-ok
  const app = createApp();
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function getJson(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

async function del(baseUrl: string, path: string) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

describe('GET /api/revenue/summary', () => {
  let baseUrl = '';
  let close: () => Promise<void>;

  beforeAll(async () => {
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    close = srv.close;
  }, 30_000);

  afterAll(async () => {
    await close?.();
  }, 15_000);

  it('returns 200 with the expected summary shape', async () => {
    const { status, body } = await getJson(baseUrl, '/api/revenue/summary');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b.totalRevenue).toBe('number');
    expect(typeof b.totalTransactions).toBe('number');
    expect(typeof b.currentMonthRevenue).toBe('number');
    expect(typeof b.prevMonthRevenue).toBe('number');
    expect(Array.isArray(b.months)).toBe(true);
    expect(Array.isArray(b.byWorkspace)).toBe(true);
    expect(Array.isArray(b.byProduct)).toBe(true);
    expect(Array.isArray(b.recent)).toBe(true);
  });

  it('has exactly 12 months in the months array', async () => {
    const { status, body } = await getJson(baseUrl, '/api/revenue/summary');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect((b.months as unknown[]).length).toBe(12);
  });

  it('returns zero totals on a fresh instance with no paid payments', async () => {
    const { status, body } = await getJson(baseUrl, '/api/revenue/summary');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    // The test DB starts empty — no paid payments exist.
    expect(b.totalRevenue).toBe(0);
    expect(b.totalTransactions).toBe(0);
    expect(b.currentMonthRevenue).toBe(0);
    expect(b.prevMonthRevenue).toBe(0);
  });
});

describe('DELETE /api/revenue/payments/:id', () => {
  let baseUrl = '';
  let close: () => Promise<void>;

  beforeAll(async () => {
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    close = srv.close;
  }, 30_000);

  afterAll(async () => {
    await close?.();
  }, 15_000);

  it('returns 404 when the payment id does not exist', async () => {
    const { status, body } = await del(baseUrl, '/api/revenue/payments/nonexistent-payment-id');
    expect(status).toBe(404);
    expect((body as Record<string, unknown>).error).toBeTruthy();
  });
});

describe('DELETE /api/revenue/payments — bulk purge', () => {
  let baseUrl = '';
  let close: () => Promise<void>;

  beforeAll(async () => {
    const srv = await startTestServer();
    baseUrl = srv.baseUrl;
    close = srv.close;
  }, 30_000);

  afterAll(async () => {
    await close?.();
  }, 15_000);

  it('returns ok:true and a numeric deleted count', async () => {
    const { status, body } = await del(baseUrl, '/api/revenue/payments');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b.ok).toBe(true);
    expect(typeof b.deleted).toBe('number');
  });
});
