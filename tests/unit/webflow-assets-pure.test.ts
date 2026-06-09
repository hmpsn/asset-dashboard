/**
 * Wave 22 — Unit tests for server/webflow-assets.ts
 *
 * Tests the HTTP-boundary functions by mocking webflowFetch and getToken,
 * covering response handling, error degradation, and data normalization logic.
 *
 * Covers:
 *   - listAssets: pagination loop, empty-on-error, token guard
 *   - getAsset: returns asset or null on error/not-found
 *   - updateAsset: displayName fallback, altText handling, error shape
 *   - deleteAsset: success on 204, failure on non-204 error, error degradation
 *   - createAssetFolder: success shape, error shape, parentFolderId inclusion
 *   - moveAssetToFolder: uses current displayName/altText from getAsset
 *   - listAssetFolders: empty on error, passes token
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  webflowFetch: vi.fn(),
  getToken: vi.fn(() => 'test-token'),
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  resolvePagePath: vi.fn((p: Record<string, unknown>) => `/${p.slug}`),
  getWorkspacePages: vi.fn(async () => []),
  getWorkspaceAllPages: vi.fn(async () => []),
  listWorkspaces: vi.fn(() => []),
}));

vi.mock('../../server/webflow-client.js', () => ({
  webflowFetch: mocks.webflowFetch,
  getToken: mocks.getToken,
  webflowJson: async <T>(endpoint: string, options: RequestInit = {}, tokenOverride?: string) => {
    const res = await mocks.webflowFetch(endpoint, options, tokenOverride);
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        errorText: await res.text(),
      };
    }
    return { ok: true as const, data: await res.json() as T };
  },
  paginateWebflow: async <TPage, TItem>({
    buildEndpoint,
    extractItems,
    getTotal,
    tokenOverride,
    limit = 100,
    advanceBy = 'page-size',
  }: {
    buildEndpoint: (offset: number, limit: number) => string;
    extractItems: (page: TPage) => TItem[] | undefined;
    getTotal?: (page: TPage) => number | undefined;
    tokenOverride?: string;
    limit?: number;
    advanceBy?: 'items-length' | 'page-size';
  }) => {
    const allItems: TItem[] = [];
    let offset = 0;

    while (true) {
      const result = await (async () => {
        const res = await mocks.webflowFetch(buildEndpoint(offset, limit), {}, tokenOverride);
        if (!res.ok) {
          return {
            ok: false as const,
            status: res.status,
            errorText: await res.text(),
          };
        }
        return { ok: true as const, data: await res.json() as TPage };
      })();
      if (!result.ok) break;

      const items = extractItems(result.data) || [];
      allItems.push(...items);

      if (items.length === 0) break;

      offset += advanceBy === 'items-length' ? items.length : limit;

      const total = getTotal?.(result.data);
      if (typeof total === 'number') {
        if (offset >= total) break;
        continue;
      }

      if (items.length < limit) break;
    }

    return allItems;
  },
  webflowMutation: async <T = undefined>(
    endpoint: string,
    options: RequestInit,
    tokenOverride?: string,
    parse: 'json' | 'none' = 'none',
  ) => {
    const res = await mocks.webflowFetch(endpoint, options, tokenOverride);
    if (!res.ok) {
      return {
        ok: false as const,
        status: res.status,
        errorText: await res.text(),
      };
    }
    if (parse === 'none') {
      return { ok: true as const, data: undefined as T };
    }
    return { ok: true as const, data: await res.json() as T };
  },
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));

vi.mock('../../server/helpers.js', () => ({
  resolvePagePath: mocks.resolvePagePath,
}));

vi.mock('../../server/workspace-data.js', () => ({
  getWorkspacePages: mocks.getWorkspacePages,
  getWorkspaceAllPages: mocks.getWorkspaceAllPages,
}));

vi.mock('../../server/workspaces.js', () => ({
  listWorkspaces: mocks.listWorkspaces,
}));

import {
  listAssets,
  getAsset,
  updateAsset,
  deleteAsset,
  createAssetFolder,
  listAssetFolders,
  moveAssetToFolder,
  type WebflowAsset,
} from '../../server/webflow-assets.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function makeOkResponse(body: unknown, status = 200): Response {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function makeErrorResponse(status: number, body = 'API error'): Response {
  return {
    ok: false,
    status,
    json: async () => ({ message: body }),
    text: async () => body,
  } as unknown as Response;
}

function makeAsset(overrides: Partial<WebflowAsset> = {}): WebflowAsset {
  return {
    id: 'asset-1',
    displayName: 'hero.jpg',
    originalFileName: 'hero.jpg',
    size: 12345,
    contentType: 'image/jpeg',
    url: 'https://cdn.example.com/hero.jpg',
    hostedUrl: 'https://cdn.example.com/hero.jpg',
    altText: 'Hero image',
    ...overrides,
  };
}

beforeEach(() => {
  mocks.webflowFetch.mockReset();
  mocks.getToken.mockReturnValue('test-token');
});

// ════════════════════════════════════════════════════════════════════════════
// listAssets
// ════════════════════════════════════════════════════════════════════════════

describe('listAssets', () => {
  it('returns empty array when no token configured', async () => {
    mocks.getToken.mockReturnValue(null);
    const result = await listAssets('site-1');
    expect(result).toEqual([]);
    expect(mocks.webflowFetch).not.toHaveBeenCalled();
  });

  it('returns assets from a single page response', async () => {
    const assets = [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })];
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ assets }));
    const result = await listAssets('site-1');
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('a1');
  });

  it('paginates until fewer than limit assets returned', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => makeAsset({ id: `a${i}` }));
    const page2 = [makeAsset({ id: 'b0' })];
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse({ assets: page1 }))
      .mockResolvedValueOnce(makeOkResponse({ assets: page2 }));
    const result = await listAssets('site-1');
    expect(result).toHaveLength(101);
    expect(mocks.webflowFetch).toHaveBeenCalledTimes(2);
  });

  it('breaks pagination loop on non-ok response', async () => {
    mocks.webflowFetch.mockResolvedValue(makeErrorResponse(500));
    const result = await listAssets('site-1');
    expect(result).toEqual([]);
  });

  it('uses tokenOverride when provided', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ assets: [] }));
    await listAssets('site-1', 'override-token');
    expect(mocks.webflowFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      'override-token',
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// getAsset
// ════════════════════════════════════════════════════════════════════════════

describe('getAsset', () => {
  it('returns the asset on success', async () => {
    const asset = makeAsset({ id: 'asset-42' });
    mocks.webflowFetch.mockResolvedValue(makeOkResponse(asset));
    const result = await getAsset('asset-42');
    expect(result).not.toBeNull();
    expect(result?.id).toBe('asset-42');
  });

  it('returns null when response is not ok', async () => {
    mocks.webflowFetch.mockResolvedValue(makeErrorResponse(404));
    const result = await getAsset('missing');
    expect(result).toBeNull();
  });

  it('returns null and does not throw on network error', async () => {
    mocks.webflowFetch.mockRejectedValue(new Error('Network failure'));
    const result = await getAsset('net-err');
    expect(result).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// updateAsset
// ════════════════════════════════════════════════════════════════════════════

describe('updateAsset', () => {
  it('returns success: true on ok PATCH response', async () => {
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(makeAsset()))  // getAsset
      .mockResolvedValueOnce(makeOkResponse(makeAsset())); // PATCH
    const result = await updateAsset('asset-1', { altText: 'New alt text' });
    expect(result.success).toBe(true);
  });

  it('uses asset-{id} as displayName fallback when current asset has no displayName', async () => {
    const assetWithoutName = makeAsset({ displayName: undefined });
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(assetWithoutName))
      .mockResolvedValueOnce(makeOkResponse(assetWithoutName));
    await updateAsset('asset-1', {});
    const patchCall = mocks.webflowFetch.mock.calls[1];
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.displayName).toBe('asset-asset-1');
  });

  it('preserves existing altText when update does not specify altText', async () => {
    const existingAsset = makeAsset({ altText: 'Existing alt' });
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(existingAsset))
      .mockResolvedValueOnce(makeOkResponse(existingAsset));
    await updateAsset('asset-1', { displayName: 'new-name.jpg' });
    const patchCall = mocks.webflowFetch.mock.calls[1];
    const body = JSON.parse(patchCall[1].body as string);
    expect(body.altText).toBe('Existing alt');
  });

  it('returns success: false with error string on PATCH failure', async () => {
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(makeAsset()))
      .mockResolvedValueOnce(makeErrorResponse(400, 'Validation error'));
    const result = await updateAsset('asset-1', { altText: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('400');
  });

  it('returns success: false and does not throw on network error', async () => {
    mocks.webflowFetch.mockRejectedValue(new Error('Connection refused'));
    const result = await updateAsset('asset-1', { altText: 'Test' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Connection refused');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// deleteAsset
// ════════════════════════════════════════════════════════════════════════════

describe('deleteAsset', () => {
  it('returns success: true on 200 response', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({}));
    const result = await deleteAsset('asset-1');
    expect(result.success).toBe(true);
  });

  it('returns success: true on 204 No Content (common for DELETE)', async () => {
    mocks.webflowFetch.mockResolvedValue({ ok: false, status: 204, text: async () => '' } as unknown as Response);
    const result = await deleteAsset('asset-1');
    expect(result.success).toBe(true);
  });

  it('returns success: false with error string on non-204 error response', async () => {
    mocks.webflowFetch.mockResolvedValue(makeErrorResponse(403, 'Forbidden'));
    const result = await deleteAsset('asset-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('403');
  });

  it('returns success: false and does not throw on network error', async () => {
    mocks.webflowFetch.mockRejectedValue(new Error('Timeout'));
    const result = await deleteAsset('asset-1');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Timeout');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// createAssetFolder
// ════════════════════════════════════════════════════════════════════════════

describe('createAssetFolder', () => {
  it('returns success: true and folderId on successful create', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ id: 'folder-123' }));
    const result = await createAssetFolder('site-1', 'Images');
    expect(result.success).toBe(true);
    expect(result.folderId).toBe('folder-123');
  });

  it('includes parentFolderId in request body when provided', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ id: 'subfolder-1' }));
    await createAssetFolder('site-1', 'Subfolder', 'parent-folder-id');
    const body = JSON.parse(mocks.webflowFetch.mock.calls[0][1].body as string);
    expect(body.parentFolderId).toBe('parent-folder-id');
  });

  it('does not include parentFolderId in body when not provided', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ id: 'folder-1' }));
    await createAssetFolder('site-1', 'Root Folder');
    const body = JSON.parse(mocks.webflowFetch.mock.calls[0][1].body as string);
    expect(body.parentFolderId).toBeUndefined();
  });

  it('returns success: false with error on API failure', async () => {
    mocks.webflowFetch.mockResolvedValue(makeErrorResponse(422, 'Unprocessable'));
    const result = await createAssetFolder('site-1', 'Bad Folder');
    expect(result.success).toBe(false);
    expect(result.error).toContain('422');
  });

  it('returns success: false and does not throw on network error', async () => {
    mocks.webflowFetch.mockRejectedValue(new Error('Network unreachable'));
    const result = await createAssetFolder('site-1', 'Folder');
    expect(result.success).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// listAssetFolders
// ════════════════════════════════════════════════════════════════════════════

describe('listAssetFolders', () => {
  it('returns asset folders array on success', async () => {
    const folders = [{ id: 'f1', displayName: 'Images' }];
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({ assetFolders: folders }));
    const result = await listAssetFolders('site-1');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('f1');
  });

  it('returns empty array when response is not ok', async () => {
    mocks.webflowFetch.mockResolvedValue(makeErrorResponse(500));
    const result = await listAssetFolders('site-1');
    expect(result).toEqual([]);
  });

  it('returns empty array when assetFolders field is missing from response', async () => {
    mocks.webflowFetch.mockResolvedValue(makeOkResponse({}));
    const result = await listAssetFolders('site-1');
    expect(result).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// moveAssetToFolder
// ════════════════════════════════════════════════════════════════════════════

describe('moveAssetToFolder', () => {
  it('uses asset-{id} as displayName when asset is not found', async () => {
    // First call is getAsset (returns null via error), second is PATCH
    mocks.webflowFetch
      .mockResolvedValueOnce(makeErrorResponse(404))  // getAsset → null
      .mockResolvedValueOnce(makeOkResponse({}));     // PATCH
    const result = await moveAssetToFolder('asset-xyz', 'folder-1');
    expect(result.success).toBe(true);
    const patchBody = JSON.parse(mocks.webflowFetch.mock.calls[1][1].body as string);
    expect(patchBody.displayName).toBe('asset-asset-xyz');
  });

  it('includes altText in PATCH body when asset has altText', async () => {
    const asset = makeAsset({ id: 'asset-1', altText: 'Product photo' });
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(asset))
      .mockResolvedValueOnce(makeOkResponse({}));
    await moveAssetToFolder('asset-1', 'folder-1');
    const patchBody = JSON.parse(mocks.webflowFetch.mock.calls[1][1].body as string);
    expect(patchBody.altText).toBe('Product photo');
    expect(patchBody.parentFolder).toBe('folder-1');
  });

  it('returns success: false with error on PATCH failure', async () => {
    mocks.webflowFetch
      .mockResolvedValueOnce(makeOkResponse(makeAsset()))
      .mockResolvedValueOnce(makeErrorResponse(500, 'Server error'));
    const result = await moveAssetToFolder('asset-1', 'folder-1');
    expect(result.success).toBe(false);
    expect(result.error).toContain('500');
  });
});
