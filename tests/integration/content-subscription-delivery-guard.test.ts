// @vitest-environment node
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import {
  createContentSubscription,
  deleteContentSubscription,
  getContentSubscription,
} from '../../server/content-subscriptions.js';

const TIMEOUT_MS = 20_000;

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

describe('integration: content subscription delivered count guard', () => {
  let seeded: SeededFullWorkspace;
  let baseUrl = '';
  let closeServer: () => Promise<void>;
  let subscriptionId = '';

  beforeAll(async () => {
    const server = await startTestServer();
    baseUrl = server.baseUrl;
    closeServer = server.close;
  }, TIMEOUT_MS);

  afterAll(async () => {
    await closeServer?.();
  }, TIMEOUT_MS);

  beforeEach(() => {
    seeded = seedWorkspace();
    const sub = createContentSubscription(seeded.workspaceId, {
      plan: 'starter',
      postsPerMonth: 4,
      priceUsd: 249,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    subscriptionId = sub.id;
  });

  afterEach(() => {
    if (subscriptionId) {
      deleteContentSubscription(seeded.workspaceId, subscriptionId);
    }
    seeded.cleanup();
  });

  it('rejects negative delivered count and keeps existing tally unchanged', async () => {
    const before = getContentSubscription(subscriptionId);
    expect(before).not.toBeNull();

    const res = await fetch(`${baseUrl}/api/content-subscription/${subscriptionId}/delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: -3 }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'count must be a positive integer' });

    const after = getContentSubscription(subscriptionId);
    expect(after?.postsDeliveredThisPeriod).toBe(before?.postsDeliveredThisPeriod);
  });

  it('rejects non-integer delivered count and keeps existing tally unchanged', async () => {
    const before = getContentSubscription(subscriptionId);
    expect(before).not.toBeNull();

    const res = await fetch(`${baseUrl}/api/content-subscription/${subscriptionId}/delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: 1.5 }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: 'count must be a positive integer' });

    const after = getContentSubscription(subscriptionId);
    expect(after?.postsDeliveredThisPeriod).toBe(before?.postsDeliveredThisPeriod);
  });
});
