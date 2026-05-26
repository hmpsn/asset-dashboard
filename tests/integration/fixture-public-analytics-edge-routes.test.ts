import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13764);
const { api } = ctx;

let wsId = '';

beforeAll(async () => {
  await ctx.startServer();
  wsId = createWorkspace('Fixture Public Analytics Edge').id;
});

afterAll(async () => {
  deleteWorkspace(wsId);
  await ctx.stopServer();
});

describe('Fixture public-analytics edge routes', () => {
  it('event-trend validates required event query', async () => {
    const res = await api(`/api/public/analytics-event-trend/${wsId}`);
    expect(res.status).toBe(400);
  });

  it('overview route returns JSON error contract when credentials missing', async () => {
    const res = await api(`/api/public/analytics-overview/${wsId}`);
    expect([200, 400]).toContain(res.status);
    const contentType = res.headers.get('content-type') || '';
    expect(contentType).toContain('application/json');
  });

  it('unknown workspace trend route does not 500-crash', async () => {
    const res = await api('/api/public/analytics-trend/ws_fixture_analytics_missing');
    expect([400, 404]).toContain(res.status);
  });
});
