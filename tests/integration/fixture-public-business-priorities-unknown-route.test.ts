import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import db from '../../server/db/index.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13727);
const UNKNOWN_WORKSPACE_ID = 'ws_fixture_public_business_priorities_missing';
let authFixture: SeededAuth | null = null;

beforeAll(async () => {
  await ctx.startServer();
  authFixture = await seedAuthData();
});

afterAll(async () => {
  authFixture?.cleanup();
  await ctx.stopServer();
});

describe('Fixture public business priorities unknown workspace boundary', () => {
  it('GET /api/public/business-priorities/:workspaceId returns 404 for unknown workspace', async () => {
    const res = await ctx.api(`/api/public/business-priorities/${UNKNOWN_WORKSPACE_ID}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });

  it('POST /api/public/business-priorities/:workspaceId returns 401 before workspace lookup when unauthenticated', async () => {
    const res = await ctx.api(`/api/public/business-priorities/${UNKNOWN_WORKSPACE_ID}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        priorities: [{ text: 'Test unknown workspace boundary', category: 'other' }],
      }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Authentication required');
  });

  it('POST /api/public/business-priorities/:workspaceId returns 404 after auth passes and workspace is missing', async () => {
    const existingWorkspaceId = authFixture!.workspaceId;
    const existingToken = authFixture!.clientToken;
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(existingWorkspaceId);

    const res = await ctx.api(`/api/public/business-priorities/${existingWorkspaceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `client_user_token_${existingWorkspaceId}=${existingToken}`,
      },
      body: JSON.stringify({
        priorities: [{ text: 'Test deleted workspace boundary', category: 'other' }],
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Workspace not found');
  });
});
