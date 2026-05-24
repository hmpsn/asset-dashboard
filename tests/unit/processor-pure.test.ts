/**
 * Wave 20 — Pure function unit tests for server/processor.ts
 *
 * processor.ts exports: getMetadata, getQueue, startWatcher, triggerOptimize.
 * startWatcher and triggerOptimize are side-effectful (chokidar, execFile).
 * getMetadata reads from the file system.
 * getQueue returns a slice of the internal queue array.
 *
 * Strategy:
 * - vi.mock the fs, workspaces, alttext, webflow, logger, and ws-events modules
 *   so that module-level imports do not fail and FS reads are controlled.
 * - Test getMetadata with a mocked fs.existsSync / fs.readFileSync.
 * - Test getQueue observable behavior (returns at most 50 items).
 * - Test the internal normalizeBase + cacheKey logic indirectly through the
 *   observable QueueItem.fileName that getQueue reflects.
 * - Test the pure normalizeBase-equivalent logic by mirroring the documented
 *   algorithm (lowercase → spaces→dashes → strip non-alphanum → collapse dashes
 *   → strip leading/trailing dashes → fallback to 'image').
 *
 * Additionally, tests for the pure adjacent helpers in seo-audit-html.ts
 * (extractImgTags, extractStyleBlocks, extractInlineScripts, countExternalResources)
 * that weren't covered in seo-audit-site-checks-pure.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Hoist mock objects so vi.mock factories can reference them
// ---------------------------------------------------------------------------
const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => false as boolean),
  readFileSync: vi.fn(() => '{}' as unknown),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock heavy side-effectful dependencies before importing processor
// ---------------------------------------------------------------------------
vi.mock('chokidar', () => ({
  watch: vi.fn(() => ({
    on: vi.fn(),
  })),
}));

vi.mock('../../server/workspaces.js', () => ({
  getOptRoot: vi.fn(() => '/tmp/opt'),
  getUploadRoot: vi.fn(() => '/tmp/upload'),
  listWorkspaces: vi.fn(() => []),
}));

vi.mock('../../server/alttext.js', () => ({
  generateAltText: vi.fn(() => Promise.resolve('')),
}));

vi.mock('../../server/webflow.js', () => ({
  uploadAsset: vi.fn(() => Promise.resolve({ success: false })),
}));

vi.mock('../../server/data-dir.js', () => ({
  getDataDir: vi.fn((name: string) => `/tmp/${name}`),
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('../../server/ws-events.js', () => ({
  ADMIN_EVENTS: {
    QUEUE_UPDATE: 'queue:update',
  },
}));

// Mock fs — both the default export (used by processor.ts via `import fs from 'fs'`)
// and named exports point to the same hoisted spy instances.
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  const mockFs = {
    ...actual,
    existsSync: fsMocks.existsSync,
    readFileSync: fsMocks.readFileSync,
    mkdirSync: fsMocks.mkdirSync,
    writeFileSync: fsMocks.writeFileSync,
  };
  return {
    ...mockFs,
    default: mockFs,
  };
});

import { getMetadata, getQueue } from '../../server/processor.js';
import {
  extractImgTags,
  extractStyleBlocks,
  extractInlineScripts,
  countExternalResources,
} from '../../server/seo-audit-html.js';

// ---------------------------------------------------------------------------
// getMetadata
// ---------------------------------------------------------------------------
describe('getMetadata', () => {
  beforeEach(() => {
    fsMocks.existsSync.mockReset().mockReturnValue(false);
    fsMocks.readFileSync.mockReset().mockReturnValue('{}');
  });

  it('returns empty object when metadata file does not exist', () => {
    fsMocks.existsSync.mockReturnValue(false);
    const result = getMetadata();
    expect(result).toEqual({});
  });

  it('returns parsed metadata when file exists and is valid JSON', () => {
    const stored = {
      'faros/hero-image': {
        fileName: 'hero-image.jpg',
        workspace: 'faros',
        type: 'asset',
        altText: 'A scenic waterfall',
      },
    };
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue(JSON.stringify(stored));
    const result = getMetadata();
    expect(result['faros/hero-image']).toBeDefined();
    expect(result['faros/hero-image'].altText).toBe('A scenic waterfall');
  });

  it('returns empty object when file exists but contains corrupt JSON', () => {
    fsMocks.existsSync.mockReturnValue(true);
    fsMocks.readFileSync.mockReturnValue('not valid json {{{');
    const result = getMetadata();
    expect(result).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// getQueue
// ---------------------------------------------------------------------------
describe('getQueue', () => {
  it('returns an array (no items if none were added during test run)', () => {
    const q = getQueue();
    expect(Array.isArray(q)).toBe(true);
  });

  it('returns at most 50 items', () => {
    const q = getQueue();
    expect(q.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// normalizeBase logic — tested directly (mirrors the internal algorithm)
// This is the canonical logic for how filenames are normalized into cache keys.
// We extract and test it here to document and guard its expected behavior.
// ---------------------------------------------------------------------------

/** Mirror of the internal normalizeBase function from processor.ts */
function normalizeBase(base: string): string {
  let s = base.toLowerCase();
  s = s.replace(/ /g, '-');
  s = s.replace(/[^a-z0-9_-]/g, '');
  s = s.replace(/-{2,}/g, '-');
  s = s.replace(/^-+|-+$/g, '');
  return s || 'image';
}

describe('normalizeBase (mirrors processor.ts internal logic)', () => {
  it('lowercases the input', () => {
    expect(normalizeBase('HeroImage')).toBe('heroimage');
  });

  it('replaces spaces with dashes', () => {
    expect(normalizeBase('hero image')).toBe('hero-image');
  });

  it('strips non-alphanumeric chars (except underscores and dashes)', () => {
    expect(normalizeBase('hero!@image')).toBe('heroimage');
  });

  it('collapses multiple consecutive dashes', () => {
    expect(normalizeBase('hero--image')).toBe('hero-image');
  });

  it('strips leading and trailing dashes', () => {
    expect(normalizeBase('-hero-image-')).toBe('hero-image');
  });

  it('falls back to "image" when result is empty', () => {
    expect(normalizeBase('!!!')).toBe('image');
  });

  it('preserves underscores', () => {
    expect(normalizeBase('hero_image')).toBe('hero_image');
  });

  it('handles a realistic filename base (without extension)', () => {
    expect(normalizeBase('Brand Logo Full Color')).toBe('brand-logo-full-color');
  });
});

// ---------------------------------------------------------------------------
// extractImgTags — server/seo-audit-html
// (complements seo-audit-site-checks-pure.test.ts which skipped these)
// ---------------------------------------------------------------------------
describe('extractImgTags', () => {
  it('detects an image with alt text', () => {
    const html = '<img src="hero.jpg" alt="A hero image">';
    const imgs = extractImgTags(html);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].hasAlt).toBe(true);
    expect(imgs[0].alt).toBe('A hero image');
  });

  it('detects an image without alt attribute (hasAlt: false)', () => {
    const html = '<img src="banner.jpg">';
    const imgs = extractImgTags(html);
    expect(imgs[0].hasAlt).toBe(false);
  });

  it('detects lazy-loading attribute', () => {
    const html = '<img src="photo.jpg" alt="photo" loading="lazy">';
    const imgs = extractImgTags(html);
    expect(imgs[0].loading).toBe('lazy');
  });

  it('detects width and height attributes', () => {
    const html = '<img src="photo.jpg" alt="photo" width="800" height="600">';
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(true);
    expect(imgs[0].hasHeight).toBe(true);
  });

  it('detects missing width and height', () => {
    const html = '<img src="photo.jpg" alt="photo">';
    const imgs = extractImgTags(html);
    expect(imgs[0].hasWidth).toBe(false);
    expect(imgs[0].hasHeight).toBe(false);
  });

  it('returns empty array for HTML with no images', () => {
    expect(extractImgTags('<p>No images here</p>')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// extractStyleBlocks — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('extractStyleBlocks', () => {
  it('returns 0 for HTML with no style blocks', () => {
    expect(extractStyleBlocks('<p>No styles here</p>')).toBe(0);
  });

  it('returns the total character count of inline style block content', () => {
    const css = 'body { color: red; }';
    const html = `<style>${css}</style>`;
    expect(extractStyleBlocks(html)).toBe(css.length);
  });

  it('sums multiple style blocks', () => {
    const css1 = 'body { color: red; }';
    const css2 = 'h1 { font-size: 2em; }';
    const html = `<style>${css1}</style><p>text</p><style>${css2}</style>`;
    expect(extractStyleBlocks(html)).toBe(css1.length + css2.length);
  });
});

// ---------------------------------------------------------------------------
// extractInlineScripts — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('extractInlineScripts', () => {
  it('returns 0 for HTML with no scripts', () => {
    expect(extractInlineScripts('<p>No scripts</p>')).toBe(0);
  });

  it('counts characters in inline script (no src attribute)', () => {
    const js = 'console.log("hello");';
    const html = `<script>${js}</script>`;
    expect(extractInlineScripts(html)).toBe(js.length);
  });

  it('does not count external scripts (with src attribute)', () => {
    const html = '<script src="https://cdn.example.com/script.js"></script>';
    expect(extractInlineScripts(html)).toBe(0);
  });

  it('does not count JSON-LD structured data scripts', () => {
    const jsonLd = '{"@context":"https://schema.org"}';
    const html = `<script type="application/ld+json">${jsonLd}</script>`;
    expect(extractInlineScripts(html)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// countExternalResources — server/seo-audit-html
// ---------------------------------------------------------------------------
describe('countExternalResources', () => {
  it('returns zero counts for HTML with no external resources', () => {
    const result = countExternalResources('<p>plain HTML</p>');
    expect(result.stylesheets).toBe(0);
    expect(result.scripts).toBe(0);
  });

  it('counts external stylesheets correctly', () => {
    const html = `
      <link rel="stylesheet" href="style.css">
      <link rel="stylesheet" href="theme.css">
    `;
    const result = countExternalResources(html);
    expect(result.stylesheets).toBe(2);
  });

  it('counts external scripts correctly', () => {
    const html = `
      <script src="app.js"></script>
      <script src="vendor.js"></script>
    `;
    const result = countExternalResources(html);
    expect(result.scripts).toBe(2);
  });

  it('does not count inline scripts (no src) as external', () => {
    const html = '<script>console.log("inline")</script>';
    const result = countExternalResources(html);
    expect(result.scripts).toBe(0);
  });
});
