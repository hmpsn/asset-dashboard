/**
 * Unit tests for pure logic in the webflow-audit domain.
 *
 * The asset-audit route (server/routes/webflow-audit.ts) contains inline pure logic
 * for issue classification. Since those functions are not exported, we test the logic
 * by re-implementing the same pure rules as helper functions and verifying them here.
 * This documents and protects the classification contract.
 *
 * Additionally tests:
 * - server/performance-store.ts: savePageWeight / getPageWeight pure DB round-trip
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import { savePageWeight, getPageWeight } from '../../server/performance-store.js';

// ---------------------------------------------------------------------------
// Re-implemented pure helpers from the audit route for unit-testing
// These mirror the logic in server/routes/webflow-audit.ts exactly.
// ---------------------------------------------------------------------------

function normalizeAssetName(n: string): string {
  return (n || '').replace(/\.[^.]+$/, '').replace(/[-_\s]+/g, '').toLowerCase();
}

interface MockAsset {
  id: string;
  displayName?: string;
  originalFileName?: string;
  altText?: string;
  size: number;
  contentType?: string;
  hostedUrl?: string;
  url?: string;
}

/**
 * Classify alt-text issues for a single asset given the global altTextCounts map.
 * Returns an array of issue strings — mirrors the logic in the route handler.
 */
function classifyAltIssues(
  asset: MockAsset,
  altTextCounts: Map<string, number>,
): string[] {
  const issues: string[] = [];
  const name = asset.displayName || asset.originalFileName || '';
  const alt = (asset.altText || '').trim();

  if (!alt) {
    issues.push('missing-alt');
  } else {
    const altLower = alt.toLowerCase();
    const nameBase = name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').toLowerCase();
    if (alt.length < 10) {
      issues.push('low-quality-alt');
    } else if (
      altLower.startsWith('image of') ||
      altLower.startsWith('an image of') ||
      altLower.startsWith('photo of')
    ) {
      issues.push('low-quality-alt');
    } else if (
      altLower === nameBase ||
      altLower.replace(/\s+/g, '') === nameBase.replace(/\s+/g, '')
    ) {
      issues.push('low-quality-alt');
    } else if ((altTextCounts.get(altLower) || 0) > 1) {
      issues.push('duplicate-alt');
    }
  }
  return issues;
}

/**
 * Classify file-level issues (size, format) for a single asset.
 * Mirrors the logic in the route handler.
 */
function classifyFileIssues(asset: MockAsset): string[] {
  const issues: string[] = [];
  const name = asset.displayName || asset.originalFileName || '';
  const ext = name.split('.').pop()?.toLowerCase();

  if (asset.size > 500 * 1024) {
    issues.push('oversized');
  }
  if (ext === 'png' && asset.size > 100 * 1024) {
    issues.push('unoptimized-png');
  }
  if (ext === 'bmp' || ext === 'tiff' || ext === 'tif') {
    issues.push('legacy-format');
  }
  return issues;
}

/**
 * Detect duplicate assets by size + name similarity.
 * Returns the set of IDs that are duplicates — mirrors the route handler logic.
 */
function detectDuplicates(assets: MockAsset[]): Set<string> {
  const sizeGroups = new Map<number, typeof assets>();
  for (const asset of assets) {
    if (asset.size > 0) {
      const group = sizeGroups.get(asset.size) || [];
      group.push(asset);
      sizeGroups.set(asset.size, group);
    }
  }
  const duplicateIds = new Set<string>();
  for (const group of sizeGroups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = normalizeAssetName(group[i].displayName || group[i].originalFileName || '');
        const b = normalizeAssetName(group[j].displayName || group[j].originalFileName || '');
        if (a === b || group[i].size === group[j].size) {
          duplicateIds.add(group[i].id);
          duplicateIds.add(group[j].id);
        }
      }
    }
  }
  return duplicateIds;
}

// ---------------------------------------------------------------------------
// Alt-text classification tests
// ---------------------------------------------------------------------------

describe('asset audit: alt-text issue classification', () => {
  it('flags missing alt text', () => {
    const asset: MockAsset = { id: '1', displayName: 'hero.jpg', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('missing-alt');
  });

  it('flags empty string alt text as missing', () => {
    const asset: MockAsset = { id: '1', displayName: 'hero.jpg', altText: '', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('missing-alt');
  });

  it('flags alt text shorter than 10 chars as low-quality', () => {
    const asset: MockAsset = { id: '1', displayName: 'photo.jpg', altText: 'cat', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('low-quality-alt');
  });

  it('flags "image of …" prefix as low-quality alt', () => {
    const asset: MockAsset = { id: '1', displayName: 'photo.jpg', altText: 'image of a happy dog', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('low-quality-alt');
  });

  it('flags "an image of …" prefix as low-quality alt', () => {
    const asset: MockAsset = { id: '1', displayName: 'photo.jpg', altText: 'an image of sunny field', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('low-quality-alt');
  });

  it('flags "photo of …" prefix as low-quality alt', () => {
    const asset: MockAsset = { id: '1', displayName: 'photo.jpg', altText: 'photo of a mountain view', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('low-quality-alt');
  });

  it('flags alt text that matches file name as low-quality', () => {
    const asset: MockAsset = { id: '1', displayName: 'my-hero-image.jpg', altText: 'my hero image', size: 50000 };
    const issues = classifyAltIssues(asset, new Map());
    expect(issues).toContain('low-quality-alt');
  });

  it('flags duplicate alt text across multiple assets', () => {
    const altText = 'a professional team photo for company website';
    const counts = new Map([['a professional team photo for company website', 2]]);
    const asset: MockAsset = { id: '1', displayName: 'team.jpg', altText, size: 50000 };
    const issues = classifyAltIssues(asset, counts);
    expect(issues).toContain('duplicate-alt');
  });

  it('does not flag a good, unique, descriptive alt text', () => {
    const asset: MockAsset = {
      id: '1',
      displayName: 'hero.jpg',
      altText: 'A modern dental office with comfortable chairs and bright lighting',
      size: 50000,
    };
    const counts = new Map([['a modern dental office with comfortable chairs and bright lighting', 1]]);
    const issues = classifyAltIssues(asset, counts);
    expect(issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// File-level issue classification tests
// ---------------------------------------------------------------------------

describe('asset audit: file-level issue classification', () => {
  it('flags files over 500KB as oversized', () => {
    const asset: MockAsset = { id: '1', displayName: 'large.jpg', size: 600 * 1024 };
    expect(classifyFileIssues(asset)).toContain('oversized');
  });

  it('does not flag files under 500KB as oversized', () => {
    const asset: MockAsset = { id: '1', displayName: 'small.jpg', size: 400 * 1024 };
    expect(classifyFileIssues(asset)).not.toContain('oversized');
  });

  it('flags PNG files over 100KB as unoptimized-png', () => {
    const asset: MockAsset = { id: '1', displayName: 'graphic.png', size: 150 * 1024 };
    const issues = classifyFileIssues(asset);
    expect(issues).toContain('unoptimized-png');
  });

  it('does not flag PNG files under 100KB as unoptimized-png', () => {
    const asset: MockAsset = { id: '1', displayName: 'icon.png', size: 50 * 1024 };
    expect(classifyFileIssues(asset)).not.toContain('unoptimized-png');
  });

  it('flags .bmp files as legacy-format', () => {
    const asset: MockAsset = { id: '1', displayName: 'old.bmp', size: 10000 };
    expect(classifyFileIssues(asset)).toContain('legacy-format');
  });

  it('flags .tiff files as legacy-format', () => {
    const asset: MockAsset = { id: '1', displayName: 'scan.tiff', size: 10000 };
    expect(classifyFileIssues(asset)).toContain('legacy-format');
  });

  it('flags .tif files as legacy-format', () => {
    const asset: MockAsset = { id: '1', displayName: 'scan.tif', size: 10000 };
    expect(classifyFileIssues(asset)).toContain('legacy-format');
  });

  it('does not flag modern formats as legacy', () => {
    for (const name of ['photo.jpg', 'image.webp', 'graphic.svg', 'icon.png']) {
      const asset: MockAsset = { id: '1', displayName: name, size: 10000 };
      expect(classifyFileIssues(asset)).not.toContain('legacy-format');
    }
  });

  it('can flag both oversized AND unoptimized-png for a large PNG', () => {
    const asset: MockAsset = { id: '1', displayName: 'huge.png', size: 600 * 1024 };
    const issues = classifyFileIssues(asset);
    expect(issues).toContain('oversized');
    expect(issues).toContain('unoptimized-png');
  });
});

// ---------------------------------------------------------------------------
// Duplicate detection tests
// ---------------------------------------------------------------------------

describe('asset audit: duplicate detection', () => {
  it('detects two assets with identical size as duplicates', () => {
    const assets: MockAsset[] = [
      { id: 'a1', displayName: 'photo-v1.jpg', size: 100000 },
      { id: 'a2', displayName: 'photo-v2.jpg', size: 100000 },
    ];
    const duplicates = detectDuplicates(assets);
    expect(duplicates.has('a1')).toBe(true);
    expect(duplicates.has('a2')).toBe(true);
  });

  it('does not flag assets with different sizes as duplicates', () => {
    const assets: MockAsset[] = [
      { id: 'a1', displayName: 'photo-a.jpg', size: 100000 },
      { id: 'a2', displayName: 'photo-b.jpg', size: 200000 },
    ];
    const duplicates = detectDuplicates(assets);
    expect(duplicates.size).toBe(0);
  });

  it('detects assets with same name (different variant suffixes) at same size', () => {
    const assets: MockAsset[] = [
      { id: 'a1', displayName: 'hero-image.jpg', size: 80000 },
      { id: 'a2', displayName: 'hero_image.jpg', size: 80000 },
    ];
    const duplicates = detectDuplicates(assets);
    // Normalized names: 'heroimage' and 'heroimage' → equal → duplicates
    expect(duplicates.has('a1')).toBe(true);
    expect(duplicates.has('a2')).toBe(true);
  });

  it('ignores assets with size 0 in duplicate detection', () => {
    const assets: MockAsset[] = [
      { id: 'a1', displayName: 'empty1.jpg', size: 0 },
      { id: 'a2', displayName: 'empty2.jpg', size: 0 },
    ];
    const duplicates = detectDuplicates(assets);
    expect(duplicates.size).toBe(0);
  });

  it('does not flag a unique asset as duplicate', () => {
    const assets: MockAsset[] = [
      { id: 'a1', displayName: 'unique.jpg', size: 12345 },
    ];
    const duplicates = detectDuplicates(assets);
    expect(duplicates.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// normalizeAssetName helper tests
// ---------------------------------------------------------------------------

describe('normalizeAssetName (internal helper)', () => {
  it('strips file extension', () => {
    expect(normalizeAssetName('photo.jpg')).toBe('photo');
  });

  it('lowercases the result', () => {
    expect(normalizeAssetName('MyHeroImage.PNG')).toBe('myheroimage');
  });

  it('removes hyphens and underscores and spaces', () => {
    expect(normalizeAssetName('my-hero_image file.jpg')).toBe('myheroimagefile');
  });

  it('handles empty string', () => {
    expect(normalizeAssetName('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// performance-store: savePageWeight / getPageWeight round-trip
// ---------------------------------------------------------------------------

const STORE_SITE_ID = 'perf-store-audit-test-13455-unit';

function cleanupPerfStore() {
  db.prepare("DELETE FROM performance_snapshots WHERE site_id = ?").run(STORE_SITE_ID);
}

describe('performance-store: savePageWeight / getPageWeight', () => {
  beforeEach(cleanupPerfStore);

  it('returns null for an unknown siteId', () => {
    const result = getPageWeight('nonexistent-site-xyz-unit-test');
    expect(result).toBeNull();
  });

  it('stores and retrieves a page weight snapshot', () => {
    const data = {
      totalPages: 3,
      totalAssetSize: 1024000,
      pages: [
        { page: '/home', totalSize: 512000, assetCount: 5, assets: [] },
        { page: '/about', totalSize: 256000, assetCount: 3, assets: [] },
        { page: '/services', totalSize: 256000, assetCount: 2, assets: [] },
      ],
    };
    savePageWeight(STORE_SITE_ID, data);
    const retrieved = getPageWeight(STORE_SITE_ID);
    expect(retrieved).not.toBeNull();
    // getPageWeight returns Snapshot<T> with a .result field
    const result = retrieved!.result as typeof data;
    expect(result.totalPages).toBe(3);
    expect(result.totalAssetSize).toBe(1024000);
    expect(result.pages).toHaveLength(3);
  });

  it('overwrites previous snapshot on second save', () => {
    savePageWeight(STORE_SITE_ID, { totalPages: 1, totalAssetSize: 100, pages: [] });
    savePageWeight(STORE_SITE_ID, { totalPages: 5, totalAssetSize: 500, pages: [] });
    const retrieved = getPageWeight(STORE_SITE_ID);
    expect(retrieved).not.toBeNull();
    const result = retrieved!.result as { totalPages: number; totalAssetSize: number };
    expect(result.totalPages).toBe(5);
    expect(result.totalAssetSize).toBe(500);
  });

  it('stores page asset details correctly', () => {
    const data = {
      totalPages: 1,
      totalAssetSize: 200000,
      pages: [
        {
          page: '/blog',
          totalSize: 200000,
          assetCount: 2,
          assets: [
            { id: 'asset-1', name: 'header.jpg', size: 120000, contentType: 'image/jpeg' },
            { id: 'asset-2', name: 'footer.jpg', size: 80000, contentType: 'image/jpeg' },
          ],
        },
      ],
    };
    savePageWeight(STORE_SITE_ID, data);
    const retrieved = getPageWeight(STORE_SITE_ID);
    expect(retrieved).not.toBeNull();
    const result = retrieved!.result as typeof data;
    expect(result.pages[0].assets).toHaveLength(2);
    expect(result.pages[0].assets[0].name).toBe('header.jpg');
  });
});
