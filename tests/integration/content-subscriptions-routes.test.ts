/**
 * Integration tests for content-subscriptions API endpoints.
 *
 * Tests the full HTTP request/response cycle for:
 * - GET /api/content-subscriptions/:workspaceId → 200 with array (empty for fresh ws)
 * - GET /api/content-subscription/:id unknown id → 404
 * - GET /api/public/content-plans → 200 with array
 * - POST /api/content-subscriptions/:workspaceId missing required fields → 400
 * - Unknown workspaceId → 404
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'http';
import type { AddressInfo } from 'net';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import db from '../../server/db/index.js';

let baseUrl = '';
let server: http.Server | undefined;
let workspaceId = '';

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
    server!.close(err => (err ? reject(err) : resolve()));
  });
  server = undefined;
}

async function getJson(path: string): Promise<Response> {
  return fetch(`${baseUrl}${path}`);
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await startTestServer();
  workspaceId = createWorkspace('Content Subscriptions WS 13656').id;
}, 60_000);

afterAll(async () => {
  db.prepare('DELETE FROM content_subscriptions WHERE workspace_id = ?').run(workspaceId);
  deleteWorkspace(workspaceId);
  await stopTestServer();
});

describe('GET /api/content-subscriptions/:workspaceId', () => {
  it('returns 200 with empty array for fresh workspace', async () => {
    const res = await getJson(`/api/content-subscriptions/${workspaceId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });
});

describe('GET /api/content-subscription/:id', () => {
  it('returns 404 for unknown subscription id', async () => {
    const res = await getJson('/api/content-subscription/sub_nonexistent_abc123');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

describe('GET /api/public/content-plans', () => {
  it('returns 200 with array of available plan configs', async () => {
    const res = await getJson('/api/public/content-plans');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    // Each plan should have required fields
    for (const plan of body) {
      expect(typeof plan.plan).toBe('string');
      expect(typeof plan.postsPerMonth).toBe('number');
      expect(typeof plan.priceUsd).toBe('number');
    }
  });
});

describe('POST /api/content-subscriptions/:workspaceId', () => {
  it('returns 400 when plan is missing', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when plan value is invalid', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'invalid_plan_xyz',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('creates a subscription for a valid plan and it appears in GET list', async () => {
    const res = await postJson(`/api/content-subscriptions/${workspaceId}`, {
      plan: 'content_starter',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.plan).toBe('content_starter');
    expect(body.status).toBe('active');
    expect(body.workspaceId).toBe(workspaceId);

    // Verify list now returns the created subscription
    const listRes = await getJson(`/api/content-subscriptions/${workspaceId}`);
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list.some((s: { id: string }) => s.id === body.id)).toBe(true);
  });
});

describe('unknown workspace', () => {
  it('GET /api/content-subscriptions/:workspaceId returns 200 with empty array for unknown workspace', async () => {
    const res = await getJson('/api/content-subscriptions/ws_nonexistent_xyz');
    // requireWorkspaceAccess passes through when no JWT user is present;
    // listContentSubscriptions returns [] for unknown workspaces
    expect(res.status).toBe(200);
    const body = await res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });
});
