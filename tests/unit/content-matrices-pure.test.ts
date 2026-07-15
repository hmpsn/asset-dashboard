/**
 * Pure-logic unit tests for server/content-matrices.ts
 *
 * Covers three exported pure functions:
 *   - getSchemaTypesForTemplate — schema type lookup from PAGE_TYPE_SCHEMA_MAP
 *   - computeStats             — stats aggregation with non-obvious status groupings
 *   - generateCells            — cartesian product + URL/keyword substitution
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../../server/schema-queue.js', () => ({
  queueSchemaPreGeneration: vi.fn(),
  markSchemaStale: vi.fn(),
}));
vi.mock('../../server/logger.js', () => ({
  createLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../server/db/index.js', () => ({
  default: { prepare: vi.fn(() => ({ get: vi.fn(), all: vi.fn(() => []), run: vi.fn() })) },
}));
vi.mock('../../server/db/stmt-cache.js', () => ({
  createStmtCache: (factory: () => unknown) => factory,
}));
vi.mock('../../server/db/json-validation.js', () => ({
  parseJsonFallback: vi.fn((_raw: unknown, fallback: unknown) => fallback),
}));

import {
  ContentMatrixPatternRenderError,
  getSchemaTypesForTemplate,
  computeStats,
  generateCells,
} from '../../server/content-matrices.js';
import type { MatrixCell, MatrixCellStatus, MatrixDimension } from '../../shared/types/content.ts';

// ── Test factory ──────────────────────────────────────────────────

function makeCell(status: MatrixCellStatus): MatrixCell {
  return {
    id: `cell-${Math.random()}`,
    variableValues: {},
    targetKeyword: 'test',
    plannedUrl: '/test',
    status,
  } as MatrixCell;
}

function makeDim(variableName: string, values: string[]): MatrixDimension {
  return { variableName, values };
}

function capturePatternError(run: () => unknown): ContentMatrixPatternRenderError {
  let caught: unknown;
  try {
    run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ContentMatrixPatternRenderError);
  return caught as ContentMatrixPatternRenderError;
}

// ═══════════════════════════════════════════════════════════════════
// 1. getSchemaTypesForTemplate
// ═══════════════════════════════════════════════════════════════════

describe('getSchemaTypesForTemplate', () => {
  it('returns [] for an unknown page type', () => {
    expect(getSchemaTypesForTemplate('unknown_xyz')).toEqual([]);
  });

  it('returns [] for an empty string', () => {
    expect(getSchemaTypesForTemplate('')).toEqual([]);
  });

  it('returns [] for numeric-like strings', () => {
    expect(getSchemaTypesForTemplate('123')).toEqual([]);
  });

  it('blog → includes BlogPosting (primary)', () => {
    const types = getSchemaTypesForTemplate('blog');
    expect(types).toContain('BlogPosting');
  });

  it('blog → includes Person and BreadcrumbList (secondary)', () => {
    const types = getSchemaTypesForTemplate('blog');
    expect(types).toContain('Person');
    expect(types).toContain('BreadcrumbList');
  });

  it('blog → includes speakable (secondary)', () => {
    const types = getSchemaTypesForTemplate('blog');
    expect(types).toContain('speakable');
  });

  it('service → includes Service (primary)', () => {
    const types = getSchemaTypesForTemplate('service');
    expect(types).toContain('Service');
  });

  it('service → includes Offer and BreadcrumbList (secondary)', () => {
    const types = getSchemaTypesForTemplate('service');
    expect(types).toContain('Offer');
    expect(types).toContain('BreadcrumbList');
  });

  it('product → includes Product (primary)', () => {
    const types = getSchemaTypesForTemplate('product');
    expect(types).toContain('Product');
  });

  it('product → includes AggregateRating (secondary)', () => {
    const types = getSchemaTypesForTemplate('product');
    expect(types).toContain('AggregateRating');
  });

  it('location → includes LocalBusiness (primary)', () => {
    const types = getSchemaTypesForTemplate('location');
    expect(types).toContain('LocalBusiness');
  });

  it('location → includes GeoCoordinates (secondary)', () => {
    const types = getSchemaTypesForTemplate('location');
    expect(types).toContain('GeoCoordinates');
  });

  it('homepage → includes Organization and WebSite (primary)', () => {
    const types = getSchemaTypesForTemplate('homepage');
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
  });

  it('homepage → has empty secondary (just primary types)', () => {
    const types = getSchemaTypesForTemplate('homepage');
    // homepage secondary is empty; all returned types come from primary
    expect(types).toEqual(['Organization', 'WebSite']);
  });

  it('faq → includes FAQPage (primary)', () => {
    const types = getSchemaTypesForTemplate('faq');
    expect(types).toContain('FAQPage');
  });

  it('howto → includes HowTo (primary) and Article (secondary)', () => {
    const types = getSchemaTypesForTemplate('howto');
    expect(types).toContain('HowTo');
    expect(types).toContain('Article');
  });

  it('auto → returns [] (both primary and secondary are empty)', () => {
    expect(getSchemaTypesForTemplate('auto')).toEqual([]);
  });

  it('returns a new array — modifying result does not affect subsequent calls', () => {
    const first = getSchemaTypesForTemplate('blog');
    first.push('INJECTED');
    const second = getSchemaTypesForTemplate('blog');
    expect(second).not.toContain('INJECTED');
  });

  it('result combines both primary AND secondary types (length check)', () => {
    // blog: primary=['BlogPosting'], secondary=['Person','BreadcrumbList','speakable']
    const types = getSchemaTypesForTemplate('blog');
    expect(types.length).toBe(4);
  });

  it('pillar → has both primary and secondary entries', () => {
    const types = getSchemaTypesForTemplate('pillar');
    expect(types).toContain('Article');
    expect(types).toContain('CollectionPage');
    expect(types).toContain('Person');
    expect(types).toContain('BreadcrumbList');
  });

  it('recipe → includes NutritionInformation (secondary)', () => {
    const types = getSchemaTypesForTemplate('recipe');
    expect(types).toContain('NutritionInformation');
  });

  it('event → includes Event (primary) and Place (secondary)', () => {
    const types = getSchemaTypesForTemplate('event');
    expect(types).toContain('Event');
    expect(types).toContain('Place');
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. computeStats
// ═══════════════════════════════════════════════════════════════════

describe('computeStats', () => {
  it('returns all zeros for empty cell array', () => {
    const stats = computeStats([]);
    expect(stats).toEqual({ total: 0, planned: 0, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 });
  });

  it('total equals cells.length regardless of statuses', () => {
    const cells = [
      makeCell('planned'),
      makeCell('brief_generated'),
      makeCell('published'),
    ];
    expect(computeStats(cells).total).toBe(3);
  });

  it("single 'planned' cell → planned: 1, all others 0", () => {
    const stats = computeStats([makeCell('planned')]);
    expect(stats).toEqual({ total: 1, planned: 1, briefGenerated: 0, drafted: 0, reviewed: 0, published: 0 });
  });

  it("'keyword_validated' counts as planned (non-obvious grouping)", () => {
    const stats = computeStats([makeCell('keyword_validated')]);
    expect(stats.planned).toBe(1);
    expect(stats.briefGenerated).toBe(0);
  });

  it("two cells: 'planned' + 'keyword_validated' both add to planned", () => {
    const stats = computeStats([makeCell('planned'), makeCell('keyword_validated')]);
    expect(stats.planned).toBe(2);
  });

  it("'brief_generated' counts as briefGenerated, not planned", () => {
    const stats = computeStats([makeCell('brief_generated')]);
    expect(stats.briefGenerated).toBe(1);
    expect(stats.planned).toBe(0);
  });

  it("'draft' counts as drafted", () => {
    const stats = computeStats([makeCell('draft')]);
    expect(stats.drafted).toBe(1);
    expect(stats.reviewed).toBe(0);
  });

  it("'review' counts as reviewed (not drafted)", () => {
    const stats = computeStats([makeCell('review')]);
    expect(stats.reviewed).toBe(1);
    expect(stats.drafted).toBe(0);
  });

  it("'flagged' counts as reviewed (non-obvious grouping)", () => {
    const stats = computeStats([makeCell('flagged')]);
    expect(stats.reviewed).toBe(1);
    expect(stats.drafted).toBe(0);
    expect(stats.briefGenerated).toBe(0);
  });

  it("'approved' counts as reviewed (non-obvious — approved IS reviewed)", () => {
    const stats = computeStats([makeCell('approved')]);
    expect(stats.reviewed).toBe(1);
    expect(stats.drafted).toBe(0);
  });

  it("'published' counts as published", () => {
    const stats = computeStats([makeCell('published')]);
    expect(stats.published).toBe(1);
    expect(stats.reviewed).toBe(0);
  });

  it('all three reviewed variants sum to reviewed count', () => {
    const cells = [makeCell('review'), makeCell('flagged'), makeCell('approved')];
    const stats = computeStats(cells);
    expect(stats.reviewed).toBe(3);
    expect(stats.total).toBe(3);
  });

  it('mixed statuses — all 8 status values represented correctly', () => {
    const cells = [
      makeCell('planned'),          // planned
      makeCell('keyword_validated'), // planned
      makeCell('brief_generated'),   // briefGenerated
      makeCell('draft'),             // drafted
      makeCell('review'),            // reviewed
      makeCell('flagged'),           // reviewed
      makeCell('approved'),          // reviewed
      makeCell('published'),         // published
    ];
    const stats = computeStats(cells);
    expect(stats.total).toBe(8);
    expect(stats.planned).toBe(2);
    expect(stats.briefGenerated).toBe(1);
    expect(stats.drafted).toBe(1);
    expect(stats.reviewed).toBe(3);
    expect(stats.published).toBe(1);
  });

  it('counted categories sum to total for a mixed set', () => {
    const cells = [
      makeCell('planned'),
      makeCell('keyword_validated'),
      makeCell('brief_generated'),
      makeCell('draft'),
      makeCell('review'),
      makeCell('flagged'),
      makeCell('approved'),
      makeCell('published'),
    ];
    const { planned, briefGenerated, drafted, reviewed, published } = computeStats(cells);
    expect(planned + briefGenerated + drafted + reviewed + published).toBe(cells.length);
  });

  it('many planned cells accumulate correctly', () => {
    const cells = Array.from({ length: 10 }, () => makeCell('planned'));
    const stats = computeStats(cells);
    expect(stats.planned).toBe(10);
    expect(stats.total).toBe(10);
  });

  it('many published cells accumulate correctly', () => {
    const cells = Array.from({ length: 5 }, () => makeCell('published'));
    const stats = computeStats(cells);
    expect(stats.published).toBe(5);
  });

  it('returns a fresh object with correct shape', () => {
    const stats = computeStats([]);
    expect(Object.keys(stats).sort()).toEqual(
      ['briefGenerated', 'drafted', 'planned', 'published', 'reviewed', 'total'].sort(),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. generateCells
// ═══════════════════════════════════════════════════════════════════

describe('generateCells', () => {
  it('returns [] for empty dimensions array', () => {
    expect(generateCells([], '/{location}', '{location} service')).toEqual([]);
  });

  it('single dimension with 1 value → 1 cell', () => {
    const cells = generateCells([makeDim('location', ['Austin'])], '/{location}', '{location} dentist');
    expect(cells).toHaveLength(1);
  });

  it('single dimension with 3 values → 3 cells', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas', 'Houston'])],
      '/{location}-dentist',
      '{location} dentist',
    );
    expect(cells).toHaveLength(3);
  });

  it('two dimensions with 2 values each → 4 cells (2×2 cartesian product)', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas']), makeDim('service', ['dentist', 'orthodontist'])],
      '/{location}/{service}',
      '{location} {service}',
    );
    expect(cells).toHaveLength(4);
  });

  it('two dimensions 3×2 → 6 cells', () => {
    const cells = generateCells(
      [
        makeDim('location', ['A', 'B', 'C']),
        makeDim('service', ['x', 'y']),
      ],
      '/{location}/{service}',
      '{location} {service}',
    );
    expect(cells).toHaveLength(6);
  });

  it('three dimensions 2×3×2 → 12 cells', () => {
    const cells = generateCells(
      [
        makeDim('city', ['Austin', 'Dallas']),
        makeDim('service', ['dentist', 'orthodontist', 'implants']),
        makeDim('suffix', ['near me', 'office']),
      ],
      '/{city}/{service}/{suffix}',
      '{city} {service} {suffix}',
    );
    expect(cells).toHaveLength(12);
  });

  it('all cells have status "planned"', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas'])],
      '/{location}',
      '{location} dentist',
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(c => c.status === 'planned')).toBe(true); // every-ok: length guarded above
  });

  it('each cell has an id starting with "cell_"', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas'])],
      '/{location}',
      '{location} dentist',
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(c => c.id.startsWith('cell_'))).toBe(true); // every-ok: length guarded above
  });

  it('each cell has a unique id', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas', 'Houston'])],
      '/{location}',
      '{location} dentist',
    );
    const ids = cells.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('URL substitution: spaces become hyphens (slug normalization)', () => {
    const cells = generateCells(
      [makeDim('location', ['New York'])],
      '/{location}-dentist',
      '{location} dentist',
    );
    expect(cells[0].plannedUrl).toBe('/new-york-dentist');
  });

  it('URL substitution: lowercase is applied', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}-dentist',
      '{location} dentist',
    );
    expect(cells[0].plannedUrl).toBe('/austin-dentist');
  });

  it('URL substitution: accents are transliterated (San José → san-jose)', () => {
    const cells = generateCells(
      [makeDim('location', ['San José'])],
      '/{location}-dentist',
      '{location} dentist',
    );
    expect(cells[0].plannedUrl).toBe('/san-jose-dentist');
  });

  it('uses canonical rendering for Unicode service × location cells', () => {
    const cells = generateCells(
      [
        makeDim('location', ['São Paulo']),
        makeDim('service', ['Children’s Dentistry']),
      ],
      '/{location}/{service}',
      '{service} in {location}',
    );
    expect(cells[0]).toMatchObject({
      plannedUrl: '/sao-paulo/children-s-dentistry',
      targetKeyword: 'Children’s Dentistry in São Paulo',
      variableValues: {
        location: 'São Paulo',
        service: 'Children’s Dentistry',
      },
    });
  });

  it('URL substitution: punctuation and symbols stripped', () => {
    const cells = generateCells(
      [makeDim('service', ['top-rated!'])],
      '/{service}',
      '{service}',
    );
    // ! is stripped; hyphen preserved; already lowercase
    expect(cells[0].plannedUrl).toBe('/top-rated');
  });

  it('keyword pattern uses original (non-slugged) values — spaces preserved', () => {
    const cells = generateCells(
      [makeDim('location', ['New York'])],
      '/{location}-dentist',
      '{location} dentist',
    );
    expect(cells[0].targetKeyword).toBe('New York dentist');
  });

  it('keyword preserves original casing', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{location} Dentist',
    );
    expect(cells[0].targetKeyword).toBe('Austin Dentist');
  });

  it('keyword preserves accented chars (not slugged)', () => {
    const cells = generateCells(
      [makeDim('location', ['San José'])],
      '/{location}',
      '{location} dentist',
    );
    expect(cells[0].targetKeyword).toBe('San José dentist');
  });

  it('variableValues on each cell has correct key→value mapping', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{location} dentist',
    );
    expect(cells[0].variableValues).toEqual({ location: 'Austin' });
  });

  it('variableValues for two-dimension cell contains both keys', () => {
    const cells = generateCells(
      [makeDim('city', ['Austin']), makeDim('service', ['dentist'])],
      '/{city}/{service}',
      '{city} {service}',
    );
    expect(cells[0].variableValues).toMatchObject({ city: 'Austin', service: 'dentist' });
  });

  it('all four combinations of a 2×2 grid are produced', () => {
    const cells = generateCells(
      [makeDim('city', ['A', 'B']), makeDim('svc', ['x', 'y'])],
      '/{city}-{svc}',
      '{city} {svc}',
    );
    const urls = cells.map(c => c.plannedUrl).sort();
    expect(urls).toEqual(['/a-x', '/a-y', '/b-x', '/b-y']);
  });

  it('2×2×2 cartesian product produces exactly 8 cells', () => {
    const cells = generateCells(
      [
        makeDim('city', ['A', 'B']),
        makeDim('svc', ['x', 'y']),
        makeDim('suffix', ['p', 'q']),
      ],
      '/{city}/{svc}/{suffix}',
      '{city} {svc} {suffix}',
    );
    expect(cells).toHaveLength(8);
  });

  it('2×2×2 cartesian product: all expected combos present', () => {
    const cells = generateCells(
      [
        makeDim('city', ['A', 'B']),
        makeDim('svc', ['x', 'y']),
        makeDim('suffix', ['p', 'q']),
      ],
      '/{city}/{svc}/{suffix}',
      '{city} {svc} {suffix}',
    );
    const keywords = cells.map(c => c.targetKeyword).sort();
    expect(keywords).toEqual([
      'A x p', 'A x q', 'A y p', 'A y q',
      'B x p', 'B x q', 'B y p', 'B y q',
    ]);
  });

  it('fails closed when the URL references an unknown dimension', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}/{other}',
      '{location} dentist',
    ));
    expect(error).toMatchObject({
      field: 'urlPattern',
      issues: [{ code: 'unknown_variable', variableName: 'other' }],
    });
  });

  it('fails closed when the keyword references an unknown dimension', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{location} {other} dentist',
    ));
    expect(error).toMatchObject({
      field: 'keywordPattern',
      issues: [{ code: 'unknown_variable', variableName: 'other' }],
    });
  });

  it('treats URL placeholder names as exact durable identifiers', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('location', ['Austin'])],
      '/{Location}-dentist',
      '{location} dentist',
    ));
    expect(error.issues).toEqual([{ code: 'unknown_variable', variableName: 'Location' }]);
  });

  it('treats keyword placeholder names as exact durable identifiers', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{LOCATION} dentist',
    ));
    expect(error).toMatchObject({
      field: 'keywordPattern',
      issues: [{ code: 'unknown_variable', variableName: 'LOCATION' }],
    });
  });

  it('expectedSchemaTypes: when provided, each cell carries the types', () => {
    const schemaTypes = ['Service', 'Offer'];
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas'])],
      '/{location}',
      '{location} dentist',
      schemaTypes,
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(c => c.expectedSchemaTypes?.includes('Service'))).toBe(true); // every-ok: length guarded above
    expect(cells.every(c => c.expectedSchemaTypes?.includes('Offer'))).toBe(true); // every-ok: length guarded above
  });

  it('expectedSchemaTypes: when not provided, cells do NOT have the field', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{location} dentist',
    );
    expect('expectedSchemaTypes' in cells[0]).toBe(false);
  });

  it('expectedSchemaTypes: empty array → field NOT set (falsy guard)', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin'])],
      '/{location}',
      '{location} dentist',
      [],
    );
    // expectedSchemaTypes?.length is 0 → falsy → not spread
    expect('expectedSchemaTypes' in cells[0]).toBe(false);
  });

  it('multiple dimensions substitute independently in same URL', () => {
    const cells = generateCells(
      [makeDim('city', ['New York']), makeDim('service', ['Root Canal'])],
      '/{city}/{service}',
      '{city} {service}',
    );
    // new-york, root-canal
    const match = cells.find(
      c => c.plannedUrl === '/new-york/root-canal',
    );
    expect(match).toBeDefined();
  });

  it('keyword for same cell preserves original values including spaces', () => {
    const cells = generateCells(
      [makeDim('city', ['New York']), makeDim('service', ['Root Canal'])],
      '/{city}/{service}',
      '{city} {service}',
    );
    const match = cells.find(c => c.targetKeyword === 'New York Root Canal');
    expect(match).toBeDefined();
  });

  it('multiple consecutive spaces in a value collapse to single hyphen in URL', () => {
    const cells = generateCells(
      [makeDim('location', ['New  York'])],
      '/{location}',
      '{location}',
    );
    expect(cells[0].plannedUrl).toBe('/new-york');
  });

  it('dimensions with 1 value each still compute correct cartesian product (1×1=1)', () => {
    const cells = generateCells(
      [makeDim('a', ['x']), makeDim('b', ['y'])],
      '/{a}/{b}',
      '{a} {b}',
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].variableValues).toEqual({ a: 'x', b: 'y' });
  });

  it('dimension with a single value still generates cells for all other dimension combos', () => {
    const cells = generateCells(
      [
        makeDim('city', ['Austin', 'Dallas']),
        makeDim('fixed', ['dentist']),
      ],
      '/{city}/{fixed}',
      '{city} {fixed}',
    );
    expect(cells).toHaveLength(2);
    const keywords = cells.map(c => c.targetKeyword).sort();
    expect(keywords).toEqual(['Austin dentist', 'Dallas dentist']);
  });

  it('numeric string values in dimensions are handled (slugged correctly)', () => {
    const cells = generateCells(
      [makeDim('year', ['2024', '2025'])],
      '/{year}-report',
      '{year} report',
    );
    expect(cells).toHaveLength(2);
    expect(cells[0].plannedUrl).toMatch(/^\/202[45]-report$/);
  });

  it('fails closed when a non-empty value normalizes to an empty URL slug', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('tag', ['!!!'])],
      '/{tag}',
      '{tag}',
    ));
    expect(error).toMatchObject({
      field: 'urlPattern',
      issues: [{ code: 'empty_slug_value', variableName: 'tag' }],
    });
  });

  it('fails closed when the rendered URL is not a safe absolute path', () => {
    const error = capturePatternError(() => generateCells(
      [makeDim('location', ['Austin'])],
      'https://example.com/{location}',
      '{location}',
    ));
    expect(error).toMatchObject({
      field: 'urlPattern',
      issues: [{ code: 'full_url' }],
    });
  });

  it('large cartesian product (4×4) produces 16 cells', () => {
    const cells = generateCells(
      [
        makeDim('a', ['1', '2', '3', '4']),
        makeDim('b', ['w', 'x', 'y', 'z']),
      ],
      '/{a}/{b}',
      '{a} {b}',
    );
    expect(cells).toHaveLength(16);
  });

  it('all generated cell ids are strings', () => {
    const cells = generateCells(
      [makeDim('location', ['Austin', 'Dallas'])],
      '/{location}',
      '{location} dentist',
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every(c => typeof c.id === 'string')).toBe(true); // every-ok: length guarded above
  });

  it('hyphens in original values are preserved in slug (already valid)', () => {
    const cells = generateCells(
      [makeDim('service', ['root-canal'])],
      '/{service}',
      '{service}',
    );
    expect(cells[0].plannedUrl).toBe('/root-canal');
  });
});
