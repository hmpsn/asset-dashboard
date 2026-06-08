import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';
import { createTestContext } from './helpers.js';

const ctx = createTestContext(13717);

let primary: SeededAuth | null = null;
let secondary: SeededAuth | null = null;

async function postPriorities(
  workspaceId: string,
  priorities: Array<{ text: string; category: 'growth' | 'brand' | 'other' }>,
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Cookie = `client_user_token_${workspaceId}=${token}`;
  }

  return ctx.api(`/api/public/business-priorities/${workspaceId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ priorities }),
  });
}

beforeAll(async () => {
  await ctx.startServer();
  primary = await seedAuthData();
  secondary = await seedAuthData();
});

afterAll(async () => {
  primary?.cleanup();
  secondary?.cleanup();
  await ctx.stopServer();
});

describe('Public business priorities auth boundaries (fixture-backed)', () => {
  it('GET returns 200 with empty priorities initially', async () => {
    const res = await ctx.api(`/api/public/business-priorities/${primary!.workspaceId}`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priorities).toEqual([]);
  });

  it('POST without auth returns 401', async () => {
    const res = await postPriorities(primary!.workspaceId, [
      { text: 'Increase qualified leads', category: 'growth' },
    ]);

    expect(res.status).toBe(401);
  });

  it('POST with valid client workspace cookie returns 200 and persists priorities', async () => {
    const res = await postPriorities(
      primary!.workspaceId,
      [
        { text: 'Increase qualified leads', category: 'growth' },
        { text: 'Improve brand visibility', category: 'brand' },
      ],
      primary!.clientToken,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(expect.objectContaining({
      saved: 2,
      priorities: [
        { text: 'Increase qualified leads', category: 'growth' },
        { text: 'Improve brand visibility', category: 'brand' },
      ],
      updatedAt: expect.any(String),
    }));

    const followUp = await ctx.api(`/api/public/business-priorities/${primary!.workspaceId}`);
    expect(followUp.status).toBe(200);

    const body = await followUp.json();
    expect(body.priorities).toEqual([
      { text: 'Increase qualified leads', category: 'growth' },
      { text: 'Improve brand visibility', category: 'brand' },
    ]);
  });

  it('POST with token from different workspace returns 401', async () => {
    const res = await postPriorities(
      primary!.workspaceId,
      [{ text: 'Unauthorized cross-workspace write', category: 'other' }],
      secondary!.clientToken,
    );

    expect(res.status).toBe(401);
  });
});
