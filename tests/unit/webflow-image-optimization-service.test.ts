import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  optimizeSvgResult: '<svg>tiny</svg>',
  optimizeSvgShouldThrow: false,
  sharpOutputs: {
    jpeg: Buffer.alloc(200),
    png: Buffer.alloc(250),
    webp: Buffer.alloc(150),
  },
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

import { compressImageBuffer } from '../../server/domains/webflow-assets/image-optimization.js';

describe('compressImageBuffer', () => {
  beforeEach(() => {
    state.optimizeSvgResult = '<svg>tiny</svg>';
    state.optimizeSvgShouldThrow = false;
    state.sharpOutputs.jpeg = Buffer.alloc(200);
    state.sharpOutputs.png = Buffer.alloc(250);
    state.sharpOutputs.webp = Buffer.alloc(150);
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
});
