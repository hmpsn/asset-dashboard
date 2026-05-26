import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers.js';
import { createWorkspace, deleteWorkspace, updateWorkspace } from '../../server/workspaces.js';

const ctx = createTestContext(13732);
const { api } = ctx;

let openWs = '';
let protectedWs = '';

beforeAll(async () => {
  await ctx.startServer();
  openWs = createWorkspace('Fixture Public Analytics Open').id;
  protectedWs = createWorkspace('Fixture Public Analytics Protected').id;
  updateWorkspace(protectedWs, { clientPassword: 'analytics-protected' });
});

afterAll(async () => {
  deleteWorkspace(openWs);
  deleteWorkspace(protectedWs);
  await ctx.stopServer();
});

describe('Fixture public analytics data routes', () => {
  it('enforces auth for protected workspace overview routes', async () => {
    const overview = await api(`/api/public/analytics-overview/${protectedWs}`);
    expect(overview.status).toBe(401);

    const insights = await api(`/api/public/insights/${protectedWs}`);
    expect(insights.status).toBe(401);
  });

  it('returns credential guard errors for GA4 endpoints when not configured', async () => {
    const trend = await api(`/api/public/analytics-trend/${openWs}`);
    expect(trend.status).toBe(400);

    const topPages = await api(`/api/public/analytics-top-pages/${openWs}`);
    expect(topPages.status).toBe(400);
  });

  it('validates analytics-event-trend query requirements', async () => {
    const res = await api(`/api/public/analytics-event-trend/${openWs}`);
    expect(res.status).toBe(400);
  });
});
