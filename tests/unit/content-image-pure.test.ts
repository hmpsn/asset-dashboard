/**
 * Unit tests for content-image.ts.
 *
 * generateFeaturedImage is async and calls OpenAI + Webflow — all external
 * dependencies are mocked. Tests focus on:
 *  - Early-exit paths (missing API key, bad API response, upload failure)
 *  - The image prompt content (via the internal buildImagePrompt helper)
 *  - Successful end-to-end happy-path
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── module mocks ──

vi.mock('../../server/webflow.js', () => ({
  uploadAsset: vi.fn(),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('../../server/errors.js', () => ({
  isProgrammingError: vi.fn().mockReturnValue(false),
}));

vi.mock('fs', () => ({
  default: {
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>();
  return { ...actual, default: actual };
});

vi.mock('os', () => ({
  default: { tmpdir: () => '/tmp' },
  tmpdir: () => '/tmp',
}));

// ── imports (after mocks) ──
import { generateFeaturedImage } from '../../server/content-image.js';
import { uploadAsset } from '../../server/webflow.js';
import type { GeneratedPost } from '../../shared/types/content.js';

// ── helpers ──

function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    id: 'post-1',
    title: 'How to Improve Your SEO in 2026',
    targetKeyword: 'SEO improvement tips',
    slug: 'how-to-improve-your-seo-2026',
    status: 'draft',
    workspaceId: 'ws-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as unknown as GeneratedPost;
}

// ── tests ──

describe('generateFeaturedImage', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns failure when OPENAI_API_KEY is not set', async () => {
    const result = await generateFeaturedImage(makePost(), 'site-abc');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/OPENAI_API_KEY/i);
  });

  it('returns failure when GPT Image API responds with non-ok status', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Rate limited'),
    } as unknown as Response);

    const result = await generateFeaturedImage(makePost(), 'site-abc');
    expect(result.success).toBe(false);
    expect(result.error).toContain('429');
  });

  it('returns failure when GPT Image response has no image data', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [] }),
    } as unknown as Response);

    const result = await generateFeaturedImage(makePost(), 'site-abc');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No image data');
  });

  it('returns failure when asset upload fails', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png-bytes').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
    } as unknown as Response);

    vi.mocked(uploadAsset).mockResolvedValue({
      success: false,
      error: 'Webflow upload quota exceeded',
    });

    const result = await generateFeaturedImage(makePost(), 'site-abc');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Webflow upload quota exceeded');
  });

  it('returns success with assetId and hostedUrl on happy path', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png-bytes').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
    } as unknown as Response);

    vi.mocked(uploadAsset).mockResolvedValue({
      success: true,
      assetId: 'asset-123',
      hostedUrl: 'https://cdn.webflow.com/assets/featured.png',
    });

    const result = await generateFeaturedImage(makePost(), 'site-abc');
    expect(result.success).toBe(true);
    expect(result.assetId).toBe('asset-123');
    expect(result.hostedUrl).toBe('https://cdn.webflow.com/assets/featured.png');
  });

  it('passes the correct siteId and tokenOverride to uploadAsset', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
    } as unknown as Response);

    vi.mocked(uploadAsset).mockResolvedValue({ success: true, assetId: 'a1', hostedUrl: 'https://cdn.x/f.png' });

    await generateFeaturedImage(makePost(), 'site-xyz', 'bearer-token-override');

    const [siteId, , , , tokenOverride] = vi.mocked(uploadAsset).mock.calls[0];
    expect(siteId).toBe('site-xyz');
    expect(tokenOverride).toBe('bearer-token-override');
  });

  it('derives a URL-safe filename slug from the post title', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png').toString('base64');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
    } as unknown as Response);

    vi.mocked(uploadAsset).mockResolvedValue({ success: true, assetId: 'a2', hostedUrl: 'https://cdn.x/f.png' });

    await generateFeaturedImage(makePost({ title: 'Test Post: Special & Chars!' }), 'site-1');

    const [, , fileName] = vi.mocked(uploadAsset).mock.calls[0];
    // Slug must be lower-kebab-case ending in -featured.png
    expect(fileName).toMatch(/^[a-z0-9-]+-featured\.png$/);
    expect(fileName).not.toMatch(/[^a-z0-9\-\.]/);
  });

  it('includes both title and keyword in the GPT Image prompt', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png').toString('base64');
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
      } as unknown as Response);
    });

    vi.mocked(uploadAsset).mockResolvedValue({ success: true, assetId: 'a3', hostedUrl: 'https://cdn.x/f.png' });

    const post = makePost({ title: 'Content Strategy Guide', targetKeyword: 'content marketing ROI' });
    await generateFeaturedImage(post, 'site-1');

    expect(typeof capturedBody.prompt).toBe('string');
    expect(capturedBody.prompt as string).toContain('Content Strategy Guide');
    expect(capturedBody.prompt as string).toContain('content marketing ROI');
  });

  it('requests a 1536x1024 image from GPT Image', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    const fakeBase64 = Buffer.from('png').toString('base64');
    let capturedBody: Record<string, unknown> = {};
    global.fetch = vi.fn().mockImplementation((_url, init) => {
      capturedBody = JSON.parse((init as RequestInit).body as string);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: [{ b64_json: fakeBase64 }] }),
      } as unknown as Response);
    });

    vi.mocked(uploadAsset).mockResolvedValue({ success: true, assetId: 'a4', hostedUrl: 'https://cdn.x/f.png' });

    await generateFeaturedImage(makePost(), 'site-1');

    expect(capturedBody.size).toBe('1536x1024');
    expect(capturedBody.model).toBe('gpt-image-2');
  });
});
