import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEphemeralTestContext } from './helpers.js';
import { seedStrategyData, type SeededStrategy } from '../fixtures/strategy-seed.js';
import { seedWorkspace, type SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import { seedAuthData, type SeededAuth } from '../fixtures/auth-seed.js';

const ctx = createEphemeralTestContext(import.meta.url);

let seededStrategy: SeededStrategy | null = null;
let emptyControl: SeededFullWorkspace | null = null;
let authPrimary: SeededAuth | null = null;
let authSecondary: SeededAuth | null = null;

beforeAll(async () => {
  await ctx.startServer();
  seededStrategy = seedStrategyData();
  emptyControl = seedWorkspace();
  authPrimary = await seedAuthData();
  authSecondary = await seedAuthData();
});

afterAll(async () => {
  seededStrategy?.cleanup();
  emptyControl?.cleanup();
  authPrimary?.cleanup();
  authSecondary?.cleanup();
  await ctx.stopServer();
});

describe('Keyword strategy routes with fixture-seeded strategy data', () => {
  it('GET /api/webflow/keyword-strategy/:workspaceId returns seeded non-null strategy payload', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).not.toBeNull();

    expect(Array.isArray(body.siteKeywords)).toBe(true);
    expect(body.siteKeywords).toContain('seo agency');

    expect(Array.isArray(body.contentGaps)).toBe(true);
    expect(body.contentGaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKeyword: 'technical seo',
        }),
      ]),
    );

    expect(Array.isArray(body.quickWins)).toBe(true);
    expect(body.quickWins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'Optimize title tag for primary keyword',
        }),
      ]),
    );
  });

  it('GET /api/webflow/keyword-strategy/:workspaceId/diff returns null when no history exists', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}/diff`);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('GET /api/webflow/keyword-strategy/:workspaceId returns null for control workspace with no strategy', async () => {
    const res = await ctx.api(`/api/webflow/keyword-strategy/${emptyControl!.workspaceId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
  });

  it('enforces workspace isolation for JWT users on GET route', async () => {
    ctx.setAuthToken(authPrimary!.adminToken);
    const res = await ctx.authApi(`/api/webflow/keyword-strategy/${authSecondary!.workspaceId}`);
    expect(res.status).toBe(403);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('You do not have access to this workspace');

    ctx.setAuthToken('');
  });

  it('PATCH rejects unknown top-level keys with 400', async () => {
    const res = await ctx.patchJson(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`, {
      unknownTopLevelKey: true,
    });
    expect(res.status).toBe(400);

    const body = await res.json() as { error: string; errors?: Array<{ path: string; message: string }> };
    expect(typeof body.error).toBe('string');
    expect(body.errors?.length).toBeGreaterThan(0);
  });

  it('PATCH rejects invalid nested enum values and leaves persisted data unchanged', async () => {
    const before = await ctx.api(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`);
    expect(before.status).toBe(200);
    const beforeBody = await before.json() as {
      contentGaps: Array<{ targetKeyword: string }>;
      quickWins: Array<{ action: string }>;
    };

    const badPatch = await ctx.patchJson(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`, {
      contentGaps: [
        {
          topic: 'Broken enum payload',
          targetKeyword: 'invalid-intent-keyword',
          intent: 'invalid-intent-value',
          priority: 'high',
          rationale: 'Should fail schema validation',
        },
      ],
    });
    expect(badPatch.status).toBe(400);

    const after = await ctx.api(`/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`);
    expect(after.status).toBe(200);
    const afterBody = await after.json() as {
      contentGaps: Array<{ targetKeyword: string }>;
      quickWins: Array<{ action: string }>;
    };

    expect(afterBody.contentGaps).toEqual(beforeBody.contentGaps);
    expect(afterBody.quickWins).toEqual(beforeBody.quickWins);
  });

  it('PATCH table-backed arrays overwrite previous values instead of appending', async () => {
    const path = `/api/webflow/keyword-strategy/${seededStrategy!.workspaceId}`;

    const firstPatch = await ctx.patchJson(path, {
      contentGaps: [
        {
          topic: 'Topic A',
          targetKeyword: 'keyword-a',
          intent: 'informational',
          priority: 'high',
          rationale: 'First pass',
        },
        {
          topic: 'Topic B',
          targetKeyword: 'keyword-b',
          intent: 'commercial',
          priority: 'medium',
          rationale: 'First pass second row',
        },
      ],
      quickWins: [
        {
          pagePath: '/services',
          currentKeyword: 'seo agency',
          action: 'First quick win',
          estimatedImpact: 'high',
          rationale: 'Initial overwrite baseline',
          roiScore: 70,
        },
      ],
    });
    expect(firstPatch.status).toBe(200);

    const secondPatch = await ctx.patchJson(path, {
      contentGaps: [
        {
          topic: 'Topic B',
          targetKeyword: 'keyword-b',
          intent: 'commercial',
          priority: 'medium',
          rationale: 'Second pass keeps only B',
        },
      ],
      quickWins: [],
    });
    expect(secondPatch.status).toBe(200);

    const res = await ctx.api(path);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      contentGaps: Array<{ targetKeyword: string }>;
      quickWins: Array<{ action: string }>;
    };

    expect(body.contentGaps).toHaveLength(1);
    expect(body.contentGaps[0].targetKeyword).toBe('keyword-b');
    expect(body.quickWins).toEqual([]);
  });

  it('PATCH on workspace without strategy blob returns synthesized shell and stable table-backed state', async () => {
    const path = `/api/webflow/keyword-strategy/${emptyControl!.workspaceId}`;
    const pageMap = [
      {
        pagePath: '/landing',
        pageTitle: 'Landing',
        primaryKeyword: 'landing keyword',
        secondaryKeywords: ['landing variant'],
      },
    ];

    const first = await ctx.patchJson(path, { pageMap });
    expect(first.status).toBe(200);
    const firstBody = await first.json() as {
      siteKeywords: string[];
      opportunities: string[];
      pageMap: Array<{ pagePath: string; primaryKeyword: string }>;
      generatedAt: string | null;
    };
    expect(firstBody.siteKeywords).toEqual([]);
    expect(firstBody.opportunities).toEqual([]);
    expect(firstBody.generatedAt).toBeNull();
    expect(firstBody.pageMap).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pagePath: '/landing',
          primaryKeyword: 'landing keyword',
        }),
      ]),
    );

    const second = await ctx.patchJson(path, { pageMap });
    expect(second.status).toBe(200);
    const secondBody = await second.json() as {
      generatedAt: string | null;
      pageMap: Array<{ pagePath: string; primaryKeyword: string }>;
    };
    expect(secondBody.generatedAt).toBeNull();
    expect(secondBody.pageMap).toEqual(firstBody.pageMap);

    const getRes = await ctx.api(path);
    expect(getRes.status).toBe(200);
    const getBody = await getRes.json() as {
      generatedAt: string | null;
      pageMap: Array<{ pagePath: string; primaryKeyword: string }>;
    };
    expect(getBody.generatedAt).toBeNull();
    expect(getBody.pageMap).toEqual(firstBody.pageMap);
  });
});
