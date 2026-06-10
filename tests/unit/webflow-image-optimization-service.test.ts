import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsImageUsage } from '../../shared/types/cms-images.js';

const state = vi.hoisted(() => ({
  optimizeSvgResult: '<svg>tiny</svg>',
  optimizeSvgShouldThrow: false,
  sharpOutputs: {
    jpeg: Buffer.alloc(200),
    png: Buffer.alloc(250),
    webp: Buffer.alloc(150),
  },
  uploadResult: { success: true, assetId: 'asset-new', hostedUrl: 'https://cdn.example.test/new.jpg' } as
    | { success: true; assetId?: string; hostedUrl?: string }
    | { success: false; error: string },
  uploadCalls: [] as Array<{ siteId: string; fileName: string; altText?: string; token?: string }>,
  deleteCalls: [] as Array<{ assetId: string; token?: string }>,
}));

vi.mock('svgo', () => ({
  optimize: vi.fn(() => {
    if (state.optimizeSvgShouldThrow) {
      throw new Error('bad svg');
    }
    return { data: state.optimizeSvgResult };
  }),
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => {
    let format: 'jpeg' | 'png' | 'webp' = 'jpeg';
    const api = {
      jpeg: vi.fn(() => {
        format = 'jpeg';
        return api;
      }),
      png: vi.fn(() => {
        format = 'png';
        return api;
      }),
      webp: vi.fn(() => {
        format = 'webp';
        return api;
      }),
      toBuffer: vi.fn(() => Promise.resolve(state.sharpOutputs[format])),
    };
    return api;
  }),
}));

vi.mock('../../server/webflow.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../server/webflow.js')>();
  return {
    ...actual,
    uploadAsset: vi.fn(async (siteId: string, _tmpPath: string, fileName: string, altText?: string, token?: string) => {
      state.uploadCalls.push({ siteId, fileName, altText, token });
      return state.uploadResult;
    }),
    deleteAsset: vi.fn(async (assetId: string, token?: string) => {
      state.deleteCalls.push({ assetId, token });
      return { success: true };
    }),
  };
});

import {
  compressImageBuffer,
  replaceCompressedAsset,
} from '../../server/domains/webflow-assets/image-optimization.js';

describe('compressImageBuffer', () => {
  beforeEach(() => {
    state.optimizeSvgResult = '<svg>tiny</svg>';
    state.optimizeSvgShouldThrow = false;
    state.sharpOutputs.jpeg = Buffer.alloc(200);
    state.sharpOutputs.png = Buffer.alloc(250);
    state.sharpOutputs.webp = Buffer.alloc(150);
    state.uploadResult = { success: true, assetId: 'asset-new', hostedUrl: 'https://cdn.example.test/new.jpg' };
    state.uploadCalls = [];
    state.deleteCalls = [];
  });

  it('keeps jpg output extension and reports savings', async () => {
    const original = Buffer.alloc(1000);
    const result = await compressImageBuffer(original, 'photo.jpg');

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) return;
    expect(result.newFileName).toBe('photo.jpg');
    expect(result.originalSize).toBe(1000);
    expect(result.newSize).toBe(200);
    expect(result.savingsPercent).toBe(80);
  });

  it('uses a safe fallback base name when sourceName is a URL', async () => {
    const original = Buffer.alloc(1000);
    const result = await compressImageBuffer(original, 'https://cdn.example.test/path/photo.jpg?fit=max', {
      outputBaseName: 'image',
    });

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) return;
    expect(result.newFileName).toBe('image.jpg');
  });

  it('skips raster outputs below the 5 percent threshold', async () => {
    state.sharpOutputs.jpeg = Buffer.alloc(970);
    const original = Buffer.alloc(1000);
    const result = await compressImageBuffer(original, 'photo.jpeg');

    expect(result).toEqual({
      skipped: true,
      reason: 'Already optimized (only 3% savings)',
      originalSize: 1000,
      newSize: 970,
    });
  });

  it('uses the smaller png/webp result for png inputs', async () => {
    state.sharpOutputs.webp = Buffer.alloc(140);
    state.sharpOutputs.png = Buffer.alloc(220);
    const original = Buffer.alloc(1000);
    const result = await compressImageBuffer(original, 'graphic.png');

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) return;
    expect(result.newFileName).toBe('graphic.webp');
    expect(result.newSize).toBe(140);
  });

  it('uses the svg threshold and preserves svg extension', async () => {
    state.optimizeSvgResult = '<svg>small</svg>';
    const original = Buffer.from('<svg>' + 'x'.repeat(1000) + '</svg>');
    const result = await compressImageBuffer(original, 'icon.svg');

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) return;
    expect(result.newFileName).toBe('icon.svg');
    expect(result.savingsPercent).toBeGreaterThanOrEqual(3);
  });

  it('returns the legacy skip response when svgo throws', async () => {
    state.optimizeSvgShouldThrow = true;
    const original = Buffer.from('<svg>bad</svg>');
    const result = await compressImageBuffer(original, 'icon.svg');

    expect(result).toEqual({
      skipped: true,
      reason: 'SVGO optimization failed: bad svg',
      originalSize: original.length,
      newSize: original.length,
    });
  });

  it('allows the legacy job threshold override for raster assets', async () => {
    state.sharpOutputs.jpeg = Buffer.alloc(970);
    const original = Buffer.alloc(1000);
    const result = await compressImageBuffer(original, 'photo.jpeg', {
      rasterThresholdPercent: 3,
    });

    expect('skipped' in result).toBe(false);
    if ('skipped' in result) return;
    expect(result.newFileName).toBe('photo.jpg');
    expect(result.savingsPercent).toBe(3);
  });

  it('can throw on svgo failure for legacy job callers', async () => {
    state.optimizeSvgShouldThrow = true;

    await expect(
      compressImageBuffer(Buffer.from('<svg>bad</svg>'), 'icon.svg', {
        svgFailureMode: 'throw',
      }),
    ).rejects.toThrow('bad svg');
  });

  it('supports the legacy job skip labels for svg assets', async () => {
    state.optimizeSvgResult = '<svg>' + 'x'.repeat(980) + '</svg>';
    const original = Buffer.from('<svg>' + 'x'.repeat(1000) + '</svg>');
    const result = await compressImageBuffer(original, 'icon.svg', {
      svgSkipReasonLabel: 'Already optimized',
    });

    expect(result).toEqual({
      skipped: true,
      reason: expect.stringContaining('Already optimized'),
      originalSize: original.length,
      newSize: Buffer.from(state.optimizeSvgResult).length,
    });
  });
});

describe('replaceCompressedAsset', () => {
  beforeEach(() => {
    state.uploadResult = { success: true, assetId: 'asset-new', hostedUrl: 'https://cdn.example.test/new.jpg' };
    state.uploadCalls = [];
    state.deleteCalls = [];
  });

  it('uploads the compressed asset and deletes the old asset when no CMS repairs are needed', async () => {
    const result = await replaceCompressedAsset({
      assetId: 'asset-old',
      imageUrl: 'https://cdn.example.test/old.jpg',
      siteId: 'site-1',
      compression: {
        compressed: Buffer.alloc(200),
        newFileName: 'hero.jpg',
        originalSize: 1000,
        newSize: 200,
        savings: 800,
        savingsPercent: 80,
      },
      altText: 'Hero alt',
      token: 'wf-token',
    });

    expect(result).toMatchObject({
      success: true,
      newAssetId: 'asset-new',
      newHostedUrl: 'https://cdn.example.test/new.jpg',
      savings: 800,
      newFileName: 'hero.jpg',
      oldAssetPreserved: false,
    });
    expect(state.uploadCalls).toEqual([
      { siteId: 'site-1', fileName: 'hero.jpg', altText: 'Hero alt', token: 'wf-token' },
    ]);
    expect(state.deleteCalls).toEqual([
      { assetId: 'asset-old', token: 'wf-token' },
    ]);
  });

  it('preserves the old asset when CMS repairs are needed but cannot run', async () => {
    state.uploadResult = { success: true, assetId: 'asset-new' };
    const cmsUsages: CmsImageUsage[] = [
      {
        collectionId: 'collection-1',
        itemId: 'item-1',
        itemName: 'Item 1',
        fieldSlug: 'heroImage',
        fieldType: 'Image',
      },
    ];

    const result = await replaceCompressedAsset({
      assetId: 'asset-old',
      imageUrl: 'https://cdn.example.test/old.jpg',
      siteId: 'site-1',
      compression: {
        compressed: Buffer.alloc(200),
        newFileName: 'hero.jpg',
        originalSize: 1000,
        newSize: 200,
        savings: 800,
        savingsPercent: 80,
      },
      cmsUsages,
      token: 'wf-token',
    });

    expect(result).toMatchObject({
      success: true,
      oldAssetPreserved: true,
    });
    expect(state.deleteCalls).toHaveLength(0);
  });
});
