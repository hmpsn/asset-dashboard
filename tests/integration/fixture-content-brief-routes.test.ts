import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestContext } from './helpers.js';
import { seedContentData, type SeededContent } from '../fixtures/content-seed.js';

const ctx = createTestContext(13714); // port-ok: unique in integration suite
const { api, del, patchJson, postJson } = ctx;

let seeded: SeededContent | null = null;
let isolatedSeeded: SeededContent | null = null;

describe('Content brief routes with fixture-seeded content data', () => {
  beforeAll(async () => {
    await ctx.startServer();
    seeded = seedContentData();
    isolatedSeeded = seedContentData();
  }, 25_000);

  afterAll(async () => {
    try {
      isolatedSeeded?.cleanup();
      seeded?.cleanup();
    } finally {
      await ctx.stopServer();
    }
  });

  it('GET /api/content-briefs/:workspaceId includes the seeded brief', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Array<Record<string, unknown>>;
    expect(Array.isArray(body)).toBe(true);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: seeded.briefId,
        }),
      ]),
    );
  });

  it('GET /api/content-briefs/:workspaceId/:briefId returns the seeded brief', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`);
    expect(res.status).toBe(200);

    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe(seeded.briefId);
    expect(body.workspaceId).toBe(seeded.workspaceId);
    expect(typeof body.targetKeyword).toBe('string');
    expect(typeof body.suggestedTitle).toBe('string');
  });

  it('GET /api/content-briefs/:workspaceId/:briefId/export returns HTML with seeded keyword/title signal', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const briefRes = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`);
    expect(briefRes.status).toBe(200);
    const brief = await briefRes.json() as { targetKeyword: string; suggestedTitle: string };

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const html = await res.text();
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain(brief.targetKeyword);
    expect(html).toContain(brief.suggestedTitle);
  });

  it('returns 404 for unknown brief id', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/brief_unknown_fixture_404`);
    expect(res.status).toBe(404);

    const body = await res.json() as { error: string };
    expect(body.error).toBe('Brief not found');
  });

  it('enforces workspace isolation for brief reads across seeded workspaces', async () => {
    expect(seeded).toBeTruthy();
    expect(isolatedSeeded).toBeTruthy();
    if (!seeded || !isolatedSeeded) return;

    const res = await api(`/api/content-briefs/${seeded.workspaceId}/${isolatedSeeded.briefId}`);
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Brief not found');
  });

  it('rejects PATCH with empty body and keeps brief unchanged', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const beforeRes = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`);
    expect(beforeRes.status).toBe(200);
    const before = await beforeRes.json() as { suggestedTitle: string; targetKeyword: string };

    const res = await patchJson(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`, {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('At least one editable field required');

    const afterRes = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`);
    expect(afterRes.status).toBe(200);
    const after = await afterRes.json() as { suggestedTitle: string; targetKeyword: string };
    expect(after.suggestedTitle).toBe(before.suggestedTitle);
    expect(after.targetKeyword).toBe(before.targetKeyword);
  });

  it('rejects invalid PATCH payloads for keyword strategy fields', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await patchJson(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`, {
      wordCountTarget: 99,
      keywordSource: 'invalid-source',
      secondaryKeywords: ['valid', ''],
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; errors: Array<{ path: string; message: string }> };
    expect(typeof body.error).toBe('string');
    expect(body.errors.length).toBeGreaterThan(0);
  });

  it('enforces workspace isolation for brief writes across seeded workspaces', async () => {
    expect(seeded).toBeTruthy();
    expect(isolatedSeeded).toBeTruthy();
    if (!seeded || !isolatedSeeded) return;

    const res = await patchJson(`/api/content-briefs/${seeded.workspaceId}/${isolatedSeeded.briefId}`, {
      suggestedTitle: 'Cross-tenant write attempt',
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Brief not found');

    const isolatedRead = await api(`/api/content-briefs/${isolatedSeeded.workspaceId}/${isolatedSeeded.briefId}`);
    expect(isolatedRead.status).toBe(200);
    const isolatedBrief = await isolatedRead.json() as { suggestedTitle: string };
    expect(isolatedBrief.suggestedTitle).not.toBe('Cross-tenant write attempt');
  });

  it('accepts keyword-lock patch updates and reflects them in reads/exports', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const patchedKeyword = 'fixture adversarial keyword update';
    const patchedTitle = 'Adversarial keyword brief title';
    const res = await patchJson(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}`, {
      targetKeyword: patchedKeyword,
      suggestedTitle: patchedTitle,
      keywordLocked: true,
      keywordSource: 'manual',
      keywordValidation: {
        volume: 120,
        difficulty: 41,
        cpc: 3.25,
        validatedAt: new Date().toISOString(),
      },
      secondaryKeywords: ['fixture edge keyword', 'seo strategy fixture'],
    });
    expect(res.status).toBe(200);
    const body = await res.json() as {
      targetKeyword: string;
      suggestedTitle: string;
      keywordLocked: boolean;
      keywordSource: string;
      keywordValidation: { volume: number; difficulty: number; cpc: number };
    };
    expect(body.targetKeyword).toBe(patchedKeyword);
    expect(body.suggestedTitle).toBe(patchedTitle);
    expect(body.keywordLocked).toBe(true);
    expect(body.keywordSource).toBe('manual');
    expect(body.keywordValidation.volume).toBe(120);
    expect(body.keywordValidation.difficulty).toBe(41);
    expect(body.keywordValidation.cpc).toBe(3.25);

    const exportRes = await api(`/api/content-briefs/${seeded.workspaceId}/${seeded.briefId}/export`);
    expect(exportRes.status).toBe(200);
    const html = await exportRes.text();
    expect(html).toContain(patchedKeyword);
    expect(html).toContain(patchedTitle);
  });

  it('returns 400 for invalid keyword validation payloads', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const missingKeywordRes = await postJson(`/api/content-briefs/${seeded.workspaceId}/validate-keyword`, {});
    expect(missingKeywordRes.status).toBe(400);
    const missingKeywordBody = await missingKeywordRes.json() as { error: string };
    expect(missingKeywordBody.error).toBe('keyword is required');

    const invalidKeywordsRes = await postJson(`/api/content-briefs/${seeded.workspaceId}/validate-keywords`, { keywords: '' });
    expect(invalidKeywordsRes.status).toBe(400);
    const invalidKeywordsBody = await invalidKeywordsRes.json() as { error: string };
    expect(invalidKeywordsBody.error).toBe('keywords array is required');
  });

  it('returns 400 for empty bulk keyword arrays (edge-state keyword flow guard)', async () => {
    expect(seeded).toBeTruthy();
    if (!seeded) return;

    const res = await postJson(`/api/content-briefs/${seeded.workspaceId}/validate-keywords`, { keywords: [] });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('keywords array is required');
  });

  it('deletes isolated seeded brief and returns 404 on edge-state reads', async () => {
    expect(isolatedSeeded).toBeTruthy();
    if (!isolatedSeeded) return;

    const deleteRes = await del(`/api/content-briefs/${isolatedSeeded.workspaceId}/${isolatedSeeded.briefId}`);
    expect(deleteRes.status).toBe(200);
    const deleteBody = await deleteRes.json() as { ok: boolean };
    expect(deleteBody.ok).toBe(true);

    const getRes = await api(`/api/content-briefs/${isolatedSeeded.workspaceId}/${isolatedSeeded.briefId}`);
    expect(getRes.status).toBe(404);
    const getBody = await getRes.json() as { error: string };
    expect(getBody.error).toBe('Brief not found');

    const exportRes = await api(`/api/content-briefs/${isolatedSeeded.workspaceId}/${isolatedSeeded.briefId}/export`);
    expect(exportRes.status).toBe(404);
    const exportBody = await exportRes.json() as { error: string };
    expect(exportBody.error).toBe('Brief not found');
  });
});
