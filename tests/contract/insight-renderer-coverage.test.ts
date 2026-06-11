/**
 * G2 contract test: every InsightDataMap key has a non-default rendering path
 * in BOTH the admin feed (useInsightFeed.ts) and the client digest (InsightsDigest.tsx).
 *
 * "Non-default" for admin:  an explicit `case 'type':` branch in transformToFeedInsight.
 * "Non-default" for client: an explicit key in the INSIGHT_TYPE_ICONS object AND an explicit
 *                           key in the INSIGHT_TYPE_ACTIONS object.
 *
 * Why parse the maps individually (not file-wide substring checks): a file-wide
 * `source.includes('${type}:')` is satisfied by the type appearing in ANY object in the file.
 * Removing a type from INSIGHT_TYPE_ACTIONS would still pass while the type is present in
 * INSIGHT_TYPE_ICONS — the check is vacuous. We slice each object body and assert per-map
 * membership so a missing entry in EITHER map fails.
 *
 * The canonical type list is parsed from the InsightDataMap interface SOURCE in
 * shared/types/analytics.ts so a future InsightType is auto-caught without editing this test.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readSource(relativePath: string): string {
  const absolutePath = path.resolve(ROOT, relativePath);
  expect(existsSync(absolutePath), `${relativePath} should exist`).toBe(true);
  return readFileSync(absolutePath, 'utf8');
}

/**
 * Extract the body of a TS/JS brace-delimited block that starts at `startMarker`.
 *
 * `anchor: 'assign'` (default) finds the object/initializer brace AFTER the first `=` — this
 * skips any `{ ... }` that appears inside the TYPE ANNOTATION (e.g.
 * `Partial<Record<InsightType, { label: string }>> = { ... }`). `anchor: 'brace'` takes the
 * first `{` after the marker (use for `interface X {` declarations, which have no `=`).
 */
function extractBlockBody(source: string, startMarker: string, anchor: 'assign' | 'brace' = 'assign'): string {
  const markerIdx = source.indexOf(startMarker);
  expect(markerIdx, `source must contain "${startMarker}"`).toBeGreaterThanOrEqual(0);
  let searchFrom = markerIdx;
  if (anchor === 'assign') {
    const eqIdx = source.indexOf('=', markerIdx);
    expect(eqIdx, `"${startMarker}" must have an "=" initializer`).toBeGreaterThanOrEqual(0);
    searchFrom = eqIdx;
  }
  const openIdx = source.indexOf('{', searchFrom);
  expect(openIdx, `"${startMarker}" must be followed by "{"`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = openIdx; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(openIdx + 1, i);
    }
  }
  throw new Error(`Unbalanced braces after "${startMarker}"`);
}

/** Parse the InsightDataMap interface keys from shared/types/analytics.ts SOURCE. */
function parseInsightDataMapKeys(): string[] {
  const source = readSource('shared/types/analytics.ts');
  const body = extractBlockBody(source, 'export interface InsightDataMap', 'brace');
  // Each line is `  key: SomeData;` — capture the leading identifier of each member.
  const keys = Array.from(body.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gmi)).map(m => m[1]);
  expect(keys.length, 'InsightDataMap must have at least one key').toBeGreaterThan(0);
  return keys;
}

const ALL_INSIGHT_TYPES = parseInsightDataMapKeys();

describe('insight renderer coverage contracts (G2)', () => {
  it('parses a non-trivial InsightDataMap key set from source', () => {
    // Sanity: the source parse must yield the real, sizeable map (guards against a regex that
    // silently matches nothing and makes the per-type loops vacuously pass).
    expect(ALL_INSIGHT_TYPES.length).toBeGreaterThanOrEqual(15);
    expect(ALL_INSIGHT_TYPES).toContain('page_health');
    expect(ALL_INSIGHT_TYPES).toContain('anomaly_digest');
    expect(new Set(ALL_INSIGHT_TYPES).size).toBe(ALL_INSIGHT_TYPES.length); // no dup keys
  });

  it('every InsightDataMap key has a named case in transformToFeedInsight (admin feed)', () => {
    const source = readSource('src/hooks/admin/useInsightFeed.ts');
    for (const type of ALL_INSIGHT_TYPES) {
      expect(
        source.includes(`case '${type}':`),
        `useInsightFeed.ts transformToFeedInsight must have case '${type}': (not just the default branch)`,
      ).toBe(true);
    }
  });

  it('every InsightDataMap key has an explicit INSIGHT_TYPE_ICONS entry in InsightsDigest', () => {
    const source = readSource('src/components/client/InsightsDigest.tsx');
    const iconsBody = extractBlockBody(source, 'const INSIGHT_TYPE_ICONS');
    const iconKeys = new Set(
      Array.from(iconsBody.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gmi)).map(m => m[1]),
    );
    for (const type of ALL_INSIGHT_TYPES) {
      expect(
        iconKeys.has(type),
        `InsightsDigest.tsx INSIGHT_TYPE_ICONS must have an entry for '${type}'`,
      ).toBe(true);
    }
  });

  it('every InsightDataMap key has an explicit INSIGHT_TYPE_ACTIONS entry in InsightsDigest', () => {
    const source = readSource('src/components/client/InsightsDigest.tsx');
    const actionsBody = extractBlockBody(source, 'const INSIGHT_TYPE_ACTIONS');
    const actionKeys = new Set(
      Array.from(actionsBody.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gmi)).map(m => m[1]),
    );
    for (const type of ALL_INSIGHT_TYPES) {
      expect(
        actionKeys.has(type),
        `InsightsDigest.tsx INSIGHT_TYPE_ACTIONS must have an entry for '${type}'`,
      ).toBe(true);
    }
  });
});
