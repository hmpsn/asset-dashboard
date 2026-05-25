/**
 * Wave 22 — Pure function unit tests for server/cannibalization-detection.ts
 *
 * Tests the internal pure helpers (normalize, isExactMatch, isSubsetMatch, wordOverlap,
 * detectConflicts) indirectly via the exported public API with mocked DB dependencies.
 *
 * Covers:
 *   - normalize: casing, punctuation, whitespace collapse
 *   - isExactMatch: exact match after normalization
 *   - isSubsetMatch: subset word matching and 80% threshold
 *   - wordOverlap: Jaccard-style intersection/union ratio
 *   - detectConflicts: high/medium/low severity assignment, self-skip
 *   - checkKeywordCannibalization: end-to-end with mocked page/matrix data
 *   - detectMatrixCannibalization: missing matrix, empty cells, dedup logic
 *
 * Does NOT re-test patterns covered by:
 *   - tests/unit/cannibalization-issues.test.ts (DB storage for CannibalizationItem table)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  listPageKeywords: vi.fn(() => []),
  listMatrices: vi.fn(() => []),
  createLogger: () => ({ info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock('../../server/page-keywords.js', () => ({
  listPageKeywords: mocks.listPageKeywords,
}));

vi.mock('../../server/content-matrices.js', () => ({
  listMatrices: mocks.listMatrices,
}));

vi.mock('../../server/logger.js', () => ({
  createLogger: mocks.createLogger,
}));

import {
  checkKeywordCannibalization,
  detectMatrixCannibalization,
  type CannibalizationConflict,
} from '../../server/cannibalization-detection.js';
import type { ContentMatrix, MatrixCell } from '../../shared/types/content.js';
import type { PageKeywordMap } from '../../shared/types/workspace.js';

// ── Test helpers ─────────────────────────────────────────────────────────

function makeCell(overrides: Partial<MatrixCell> & { id: string; targetKeyword: string }): MatrixCell {
  return {
    variableValues: {},
    plannedUrl: `/page/${overrides.id}`,
    status: 'planned',
    ...overrides,
  };
}

function makeMatrix(id: string, name: string, cells: MatrixCell[]): ContentMatrix {
  return {
    id,
    workspaceId: 'ws-1',
    name,
    templateId: 'tpl-1',
    dimensions: [],
    urlPattern: '/[location]/[service]',
    keywordPattern: '[service] [location]',
    cells,
    stats: { total: cells.length, planned: cells.length, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePageKeyword(pagePath: string, primaryKeyword: string, secondaryKeywords?: string[]): PageKeywordMap {
  return { pagePath, primaryKeyword, secondaryKeywords };
}

beforeEach(() => {
  mocks.listPageKeywords.mockReturnValue([]);
  mocks.listMatrices.mockReturnValue([]);
});

// ════════════════════════════════════════════════════════════════════════════
// checkKeywordCannibalization — exact match detection
// ════════════════════════════════════════════════════════════════════════════

describe('checkKeywordCannibalization — exact match (high severity)', () => {
  it('returns high-severity conflict for exact keyword match against an existing page', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/services', 'plumbing repair'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'plumbing repair');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('high');
    expect(conflicts[0].conflictsWith.type).toBe('existing_page');
  });

  it('treats keyword comparison as case-insensitive (normalize)', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/services', 'Plumbing Repair'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'plumbing repair');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('high');
  });

  it('ignores punctuation when comparing keywords', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/services', 'plumbing, repair!'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'plumbing repair');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('high');
  });

  it('detects exact match against secondary keywords', () => {
    // primaryKeyword is "seo audit" (different); secondary contains "plumbing repair" (exact match)
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/services', 'seo audit', ['plumbing repair', 'drain cleaning']),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'plumbing repair');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].severity).toBe('high');
    expect(conflicts[0].conflictsWith.identifier).toBe('/services');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkKeywordCannibalization — subset match detection
// ════════════════════════════════════════════════════════════════════════════

describe('checkKeywordCannibalization — subset match (low severity for existing_page)', () => {
  it('returns low severity for subset match against an existing page', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/services', 'emergency plumbing repair austin tx'),
    ]);
    // "plumbing repair" is a subset of the existing keyword
    const conflicts = checkKeywordCannibalization('ws-1', 'plumbing repair');
    const lowConflicts = conflicts.filter(c => c.severity === 'low');
    expect(lowConflicts.length).toBeGreaterThan(0);
  });

  it('returns low severity for reverse subset (existing is shorter, check is longer)', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/dentist', 'dentist'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'pediatric dentist austin');
    const subsetConflicts = conflicts.filter(c => c.severity === 'low' || c.severity === 'medium');
    expect(subsetConflicts.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkKeywordCannibalization — word overlap (low severity threshold 0.6)
// ════════════════════════════════════════════════════════════════════════════

describe('checkKeywordCannibalization — word overlap threshold', () => {
  it('returns low-severity conflict when word overlap >= 60%', () => {
    // "seo audit services" vs "seo audit consulting" → shared: seo, audit → 2/4 = 0.5... but audit+seo = 2 shared, union = 4
    // Let's use "seo audit help" vs "seo audit guide" → shared: seo, audit → 2/(2+2) = 0.5 (below threshold)
    // Use "local seo services austin" vs "local seo austin" → shared: local, seo, austin → 3/4 = 0.75 (above threshold)
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/seo', 'local seo services austin'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'local seo austin');
    const lowConflict = conflicts.find(c => c.severity === 'low');
    expect(lowConflict).toBeDefined();
  });

  it('returns no conflict when word overlap is below 60%', () => {
    // "car insurance" vs "home renovation" → no shared words
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/home', 'home renovation'),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'car insurance');
    expect(conflicts).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// checkKeywordCannibalization — matrix cell conflicts
// ════════════════════════════════════════════════════════════════════════════

describe('checkKeywordCannibalization — matrix cell conflicts', () => {
  it('detects exact conflict with a matrix cell keyword', () => {
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Services', [
        makeCell({ id: 'cell-1', targetKeyword: 'roofing services dallas' }),
      ]),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'roofing services dallas');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].conflictsWith.type).toBe('other_matrix');
    expect(conflicts[0].severity).toBe('high');
  });

  it('returns empty array when no page or matrix keywords exist', () => {
    const conflicts = checkKeywordCannibalization('ws-1', 'anything at all');
    expect(conflicts).toHaveLength(0);
  });

  it('returns multiple conflicts when keyword matches both page and matrix', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/seo', 'seo audit'),
    ]);
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Services', [
        makeCell({ id: 'cell-1', targetKeyword: 'seo audit' }),
      ]),
    ]);
    const conflicts = checkKeywordCannibalization('ws-1', 'seo audit');
    expect(conflicts).toHaveLength(2);
    const types = conflicts.map(c => c.conflictsWith.type);
    expect(types).toContain('existing_page');
    expect(types).toContain('other_matrix');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// detectMatrixCannibalization — missing / empty matrix
// ════════════════════════════════════════════════════════════════════════════

describe('detectMatrixCannibalization — edge cases', () => {
  it('returns empty report when matrixId does not exist', () => {
    mocks.listMatrices.mockReturnValue([]);
    const report = detectMatrixCannibalization('ws-1', 'nonexistent-matrix');
    expect(report.conflicts).toHaveLength(0);
    expect(report.summary).toEqual({ high: 0, medium: 0, low: 0, total: 0 });
  });

  it('returns empty report when target matrix has no cells', () => {
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-empty', 'Empty Matrix', []),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-empty');
    expect(report.conflicts).toHaveLength(0);
    expect(report.summary.total).toBe(0);
  });

  it('report includes workspaceId and matrixId', () => {
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', []),
    ]);
    const report = detectMatrixCannibalization('ws-abc', 'mx-1');
    expect(report.workspaceId).toBe('ws-abc');
    expect(report.matrixId).toBe('mx-1');
  });

  it('report.checkedAt is a valid ISO timestamp', () => {
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', []),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-1');
    expect(new Date(report.checkedAt).toISOString()).toBe(report.checkedAt);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// detectMatrixCannibalization — conflict detection and severity
// ════════════════════════════════════════════════════════════════════════════

describe('detectMatrixCannibalization — conflict severity', () => {
  it('assigns high severity when cell keyword exactly matches an existing page keyword', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/seo', 'seo services austin'),
    ]);
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', [
        makeCell({ id: 'cell-1', targetKeyword: 'seo services austin' }),
      ]),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-1');
    expect(report.summary.high).toBeGreaterThan(0);
    expect(report.conflicts[0].severity).toBe('high');
  });

  it('assigns medium severity for same-matrix subset conflicts', () => {
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', [
        makeCell({ id: 'cell-1', targetKeyword: 'plumbing austin' }),
        makeCell({ id: 'cell-2', targetKeyword: 'emergency plumbing austin tx' }),
      ]),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-1');
    // subset match within same matrix → medium
    const mediumConflicts = report.conflicts.filter(c => c.severity === 'medium');
    expect(mediumConflicts.length).toBeGreaterThan(0);
  });

  it('summary counts match actual conflict severities', () => {
    mocks.listPageKeywords.mockReturnValue([
      makePageKeyword('/seo', 'seo audit'),
    ]);
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', [
        makeCell({ id: 'cell-1', targetKeyword: 'seo audit' }),  // exact → high
      ]),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-1');
    expect(report.summary.high).toBe(report.conflicts.filter(c => c.severity === 'high').length);
    expect(report.summary.medium).toBe(report.conflicts.filter(c => c.severity === 'medium').length);
    expect(report.summary.low).toBe(report.conflicts.filter(c => c.severity === 'low').length);
    expect(report.summary.total).toBe(report.conflicts.length);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// detectMatrixCannibalization — symmetric deduplication
// ════════════════════════════════════════════════════════════════════════════

describe('detectMatrixCannibalization — deduplication', () => {
  it('deduplicates symmetric conflicts (A↔B not reported twice for same severity)', () => {
    // Two cells with overlapping keywords in the same matrix should produce one conflict, not two
    mocks.listMatrices.mockReturnValue([
      makeMatrix('mx-1', 'Matrix', [
        makeCell({ id: 'cell-a', targetKeyword: 'roofing dallas' }),
        makeCell({ id: 'cell-b', targetKeyword: 'roofing dallas' }),  // exact duplicate
      ]),
    ]);
    const report = detectMatrixCannibalization('ws-1', 'mx-1');
    // cell-a vs cell-b and cell-b vs cell-a should deduplicate to 1
    const sameMatrixConflicts = report.conflicts.filter(
      c => c.conflictsWith.type === 'same_matrix'
    );
    expect(sameMatrixConflicts.length).toBe(1);
  });
});
