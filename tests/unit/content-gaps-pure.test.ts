/**
 * Unit tests for server/content-gaps.ts — CRUD, deduplication, ordering, migration.
 *
 * Covers:
 *   - listContentGaps: returns [] for unknown workspace (never null/undefined)
 *   - upsertContentGap: stores and retrieves a single gap with correct shape
 *   - getContentGap: returns undefined for missing keyword
 *   - getContentGap: returns exact model for existing keyword
 *   - upsertContentGap (update): ON CONFLICT path updates all mutable fields
 *   - upsertContentGapsBatch: batch insert, all rows visible via listContentGaps
 *   - replaceAllContentGaps: deletes old rows, inserts new set atomically
 *   - replaceAllContentGaps deduplication: last occurrence wins on duplicate targetKeyword
 *   - deleteContentGap: removes exactly one row, leaves others intact
 *   - deleteAllContentGaps: removes all rows for workspace, not for others
 *   - countContentGaps: matches array length
 *   - Sorting: rows ordered by opportunityScore DESC (NULLS LAST), then targetKeyword ASC
 *   - Optional fields: null/undefined optional fields are absent from returned model
 *   - JSON array fields: serpFeatures / questionKeywords / serpTargeting round-trip
 *   - Invalid enum values fall back to defaults (intent → 'informational', priority → 'medium')
 *   - Special characters in targetKeyword/topic do not corrupt the data
 *   - migrateFromJsonBlob: skips workspaces that already have rows (idempotent)
 *   - migrateFromJsonBlob: migrates contentGaps from keyword_strategy JSON blob
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { seedWorkspace } from '../fixtures/workspace-seed.js';
import type { SeededFullWorkspace } from '../fixtures/workspace-seed.js';
import db from '../../server/db/index.js';
import type { ContentGap } from '../../shared/types/workspace.js';
import {
  listContentGaps,
  getContentGap,
  upsertContentGap,
  upsertContentGapsBatch,
  replaceAllContentGaps,
  deleteContentGap,
  deleteAllContentGaps,
  countContentGaps,
  migrateFromJsonBlob,
} from '../../server/content-gaps.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const GAP_MINIMAL: ContentGap = {
  topic: 'Best SEO tools',
  targetKeyword: 'seo tools comparison',
  intent: 'commercial',
  priority: 'high',
  rationale: 'High-volume commercial keyword competitors dominate.',
};

const GAP_FULL: ContentGap = {
  topic: 'How to build backlinks',
  targetKeyword: 'link building guide',
  intent: 'informational',
  priority: 'medium',
  rationale: 'Evergreen topic with rising trend.',
  suggestedPageType: 'pillar',
  volume: 8500,
  difficulty: 42,
  trendDirection: 'rising',
  serpFeatures: ['featured_snippet', 'people_also_ask'],
  impressions: 120,
  competitorProof: 'ahrefs.com ranks #2',
  questionKeywords: ['what is link building?', 'how do I get backlinks?'],
  serpTargeting: ['include FAQ block', 'target featured snippet'],
  opportunityScore: 87,
};

// ─── listContentGaps — unknown workspace ──────────────────────────────────────

describe('listContentGaps — empty workspace', () => {
  it('returns an array (not null/undefined) for a workspace with no gaps', () => {
    const result = listContentGaps('non-existent-ws-' + Date.now());
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });
});

// ─── upsertContentGap / getContentGap ─────────────────────────────────────────

describe('upsertContentGap + getContentGap', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('stores a minimal gap and retrieves it with correct required fields', () => {
    upsertContentGap(ws.workspaceId, GAP_MINIMAL);
    const gap = getContentGap(ws.workspaceId, GAP_MINIMAL.targetKeyword);

    expect(gap).toBeDefined();
    expect(gap!.topic).toBe(GAP_MINIMAL.topic);
    expect(gap!.targetKeyword).toBe(GAP_MINIMAL.targetKeyword);
    expect(gap!.intent).toBe('commercial');
    expect(gap!.priority).toBe('high');
    expect(gap!.rationale).toBe(GAP_MINIMAL.rationale);
  });

  it('optional fields are absent (not null/undefined) when not set', () => {
    upsertContentGap(ws.workspaceId, GAP_MINIMAL);
    const gap = getContentGap(ws.workspaceId, GAP_MINIMAL.targetKeyword)!;

    expect('suggestedPageType' in gap).toBe(false);
    expect('volume' in gap).toBe(false);
    expect('difficulty' in gap).toBe(false);
    expect('trendDirection' in gap).toBe(false);
    expect('serpFeatures' in gap).toBe(false);
    expect('impressions' in gap).toBe(false);
    expect('competitorProof' in gap).toBe(false);
    expect('questionKeywords' in gap).toBe(false);
    expect('serpTargeting' in gap).toBe(false);
    expect('opportunityScore' in gap).toBe(false);
  });

  it('stores a fully enriched gap and retrieves all optional fields', () => {
    upsertContentGap(ws.workspaceId, GAP_FULL);
    const gap = getContentGap(ws.workspaceId, GAP_FULL.targetKeyword)!;

    expect(gap).toBeDefined();
    expect(gap.suggestedPageType).toBe('pillar');
    expect(gap.volume).toBe(8500);
    expect(gap.difficulty).toBe(42);
    expect(gap.trendDirection).toBe('rising');
    expect(gap.serpFeatures).toEqual(['featured_snippet', 'people_also_ask']);
    expect(gap.impressions).toBe(120);
    expect(gap.competitorProof).toBe('ahrefs.com ranks #2');
    expect(gap.questionKeywords).toEqual(['what is link building?', 'how do I get backlinks?']);
    expect(gap.serpTargeting).toEqual(['include FAQ block', 'target featured snippet']);
    expect(gap.opportunityScore).toBe(87);
  });

  it('returns undefined for a targetKeyword that does not exist', () => {
    const result = getContentGap(ws.workspaceId, 'definitely-not-a-real-keyword-xyzzy');
    expect(result).toBeUndefined();
  });

  it('does not return gaps from a different workspace', () => {
    upsertContentGap(ws.workspaceId, GAP_MINIMAL);
    const result = getContentGap('other-workspace-' + Date.now(), GAP_MINIMAL.targetKeyword);
    expect(result).toBeUndefined();
  });
});

// ─── upsertContentGap — ON CONFLICT update path ───────────────────────────────

describe('upsertContentGap — update on conflict', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('updates all mutable fields when the same targetKeyword is upserted again', () => {
    const initial: ContentGap = {
      topic: 'Original topic',
      targetKeyword: 'update-me-keyword',
      intent: 'informational',
      priority: 'low',
      rationale: 'First insert.',
      opportunityScore: 10,
    };
    upsertContentGap(ws.workspaceId, initial);

    const updated: ContentGap = {
      topic: 'Updated topic',
      targetKeyword: 'update-me-keyword',
      intent: 'transactional',
      priority: 'high',
      rationale: 'Updated rationale.',
      suggestedPageType: 'landing',
      volume: 3000,
      difficulty: 55,
      opportunityScore: 92,
    };
    upsertContentGap(ws.workspaceId, updated);

    const gap = getContentGap(ws.workspaceId, 'update-me-keyword')!;
    expect(gap.topic).toBe('Updated topic');
    expect(gap.intent).toBe('transactional');
    expect(gap.priority).toBe('high');
    expect(gap.rationale).toBe('Updated rationale.');
    expect(gap.suggestedPageType).toBe('landing');
    expect(gap.volume).toBe(3000);
    expect(gap.difficulty).toBe(55);
    expect(gap.opportunityScore).toBe(92);
  });
});

// ─── upsertContentGapsBatch ───────────────────────────────────────────────────

describe('upsertContentGapsBatch', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('inserts multiple gaps and all are visible via listContentGaps', () => {
    const gaps: ContentGap[] = [
      { topic: 'Topic A', targetKeyword: 'batch-kw-a', intent: 'informational', priority: 'low', rationale: 'A' },
      { topic: 'Topic B', targetKeyword: 'batch-kw-b', intent: 'commercial', priority: 'medium', rationale: 'B' },
      { topic: 'Topic C', targetKeyword: 'batch-kw-c', intent: 'navigational', priority: 'high', rationale: 'C' },
    ];

    upsertContentGapsBatch(ws.workspaceId, gaps);

    const stored = listContentGaps(ws.workspaceId);
    const keywords = stored.map(g => g.targetKeyword);
    expect(keywords).toContain('batch-kw-a');
    expect(keywords).toContain('batch-kw-b');
    expect(keywords).toContain('batch-kw-c');
  });

  it('handles an empty array without throwing', () => {
    expect(() => upsertContentGapsBatch(ws.workspaceId, [])).not.toThrow();
  });
});

// ─── replaceAllContentGaps ────────────────────────────────────────────────────

describe('replaceAllContentGaps', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('replaces existing gaps atomically — old rows gone, new rows present', () => {
    const initial: ContentGap[] = [
      { topic: 'Old A', targetKeyword: 'replace-old-a', intent: 'informational', priority: 'low', rationale: 'Old' },
      { topic: 'Old B', targetKeyword: 'replace-old-b', intent: 'commercial', priority: 'medium', rationale: 'Old' },
    ];
    replaceAllContentGaps(ws.workspaceId, initial);

    const newGaps: ContentGap[] = [
      { topic: 'New X', targetKeyword: 'replace-new-x', intent: 'transactional', priority: 'high', rationale: 'New' },
    ];
    replaceAllContentGaps(ws.workspaceId, newGaps);

    const stored = listContentGaps(ws.workspaceId);
    const keywords = stored.map(g => g.targetKeyword);
    expect(keywords).not.toContain('replace-old-a');
    expect(keywords).not.toContain('replace-old-b');
    expect(keywords).toContain('replace-new-x');
    expect(stored).toHaveLength(1);
  });

  it('replaceAllContentGaps with empty array clears all rows', () => {
    replaceAllContentGaps(ws.workspaceId, [
      { topic: 'To clear', targetKeyword: 'clear-this', intent: 'informational', priority: 'low', rationale: 'x' },
    ]);
    replaceAllContentGaps(ws.workspaceId, []);
    expect(listContentGaps(ws.workspaceId)).toHaveLength(0);
  });

  it('deduplicates by targetKeyword — last occurrence wins', () => {
    const dupes: ContentGap[] = [
      { topic: 'First', targetKeyword: 'dupe-kw', intent: 'informational', priority: 'low', rationale: 'First' },
      { topic: 'Second', targetKeyword: 'dupe-kw', intent: 'commercial', priority: 'high', rationale: 'Second' },
    ];
    replaceAllContentGaps(ws.workspaceId, dupes);

    const stored = listContentGaps(ws.workspaceId);
    // ON CONFLICT DO UPDATE — the second upsert wins
    expect(stored).toHaveLength(1);
    expect(stored[0].topic).toBe('Second');
    expect(stored[0].priority).toBe('high');
  });
});

// ─── deleteContentGap / deleteAllContentGaps ──────────────────────────────────

describe('deleteContentGap', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('removes exactly the targeted row and leaves others intact', () => {
    replaceAllContentGaps(ws.workspaceId, [
      { topic: 'Keep', targetKeyword: 'del-keep', intent: 'informational', priority: 'low', rationale: 'Keep' },
      { topic: 'Delete', targetKeyword: 'del-delete', intent: 'commercial', priority: 'medium', rationale: 'Gone' },
    ]);

    deleteContentGap(ws.workspaceId, 'del-delete');

    const stored = listContentGaps(ws.workspaceId);
    expect(stored.map(g => g.targetKeyword)).not.toContain('del-delete');
    expect(stored.map(g => g.targetKeyword)).toContain('del-keep');
  });

  it('does not throw when deleting a non-existent row', () => {
    expect(() => deleteContentGap(ws.workspaceId, 'definitely-missing-keyword')).not.toThrow();
  });
});

describe('deleteAllContentGaps', () => {
  let ws1: SeededFullWorkspace;
  let ws2: SeededFullWorkspace;

  beforeAll(() => {
    ws1 = seedWorkspace();
    ws2 = seedWorkspace();
  });
  afterAll(() => {
    ws1.cleanup();
    ws2.cleanup();
  });

  it('removes all gaps for the target workspace and does not affect others', () => {
    const shared: ContentGap = {
      topic: 'Shared', targetKeyword: 'shared-kw', intent: 'informational', priority: 'low', rationale: 'x',
    };
    upsertContentGap(ws1.workspaceId, shared);
    upsertContentGap(ws2.workspaceId, shared);

    deleteAllContentGaps(ws1.workspaceId);

    expect(listContentGaps(ws1.workspaceId)).toHaveLength(0);
    expect(listContentGaps(ws2.workspaceId)).toHaveLength(1);
  });
});

// ─── countContentGaps ─────────────────────────────────────────────────────────

describe('countContentGaps', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('returns 0 for a workspace with no gaps', () => {
    expect(countContentGaps(ws.workspaceId)).toBe(0);
  });

  it('matches the length of listContentGaps after inserts', () => {
    const gaps: ContentGap[] = [
      { topic: 'Count A', targetKeyword: 'count-a', intent: 'informational', priority: 'low', rationale: 'a' },
      { topic: 'Count B', targetKeyword: 'count-b', intent: 'commercial', priority: 'high', rationale: 'b' },
    ];
    replaceAllContentGaps(ws.workspaceId, gaps);

    const listed = listContentGaps(ws.workspaceId);
    expect(countContentGaps(ws.workspaceId)).toBe(listed.length);
    expect(countContentGaps(ws.workspaceId)).toBe(2);
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe('listContentGaps — sort order', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('returns rows ordered by opportunityScore DESC (NULLS LAST), then targetKeyword ASC', () => {
    const gaps: ContentGap[] = [
      { topic: 'B no score', targetKeyword: 'zz-no-score', intent: 'informational', priority: 'low', rationale: 'x' },
      { topic: 'Score 50', targetKeyword: 'bb-medium', intent: 'informational', priority: 'medium', rationale: 'x', opportunityScore: 50 },
      { topic: 'Score 90', targetKeyword: 'aa-high', intent: 'commercial', priority: 'high', rationale: 'x', opportunityScore: 90 },
      { topic: 'A no score', targetKeyword: 'aa-no-score', intent: 'informational', priority: 'low', rationale: 'x' },
    ];
    replaceAllContentGaps(ws.workspaceId, gaps);

    const stored = listContentGaps(ws.workspaceId);
    expect(stored[0].targetKeyword).toBe('aa-high');       // score 90
    expect(stored[1].targetKeyword).toBe('bb-medium');     // score 50
    // The two null-score rows come last, sorted alpha by keyword
    expect(stored[2].targetKeyword).toBe('aa-no-score');
    expect(stored[3].targetKeyword).toBe('zz-no-score');
  });
});

// ─── Invalid enum values → defaults ───────────────────────────────────────────

describe('rowToModel — invalid enum fallback', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('falls back to "informational" for an unknown intent value', () => {
    // Write directly to DB bypassing the model layer to inject an invalid enum
    db.prepare(`
      INSERT OR REPLACE INTO content_gaps
        (workspace_id, target_keyword, topic, intent, priority, rationale)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ws.workspaceId, 'bad-intent-kw', 'Bad intent topic', 'INVALID_INTENT', 'high', 'test');

    const gap = getContentGap(ws.workspaceId, 'bad-intent-kw')!;
    expect(gap.intent).toBe('informational');
  });

  it('falls back to "medium" for an unknown priority value', () => {
    db.prepare(`
      INSERT OR REPLACE INTO content_gaps
        (workspace_id, target_keyword, topic, intent, priority, rationale)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ws.workspaceId, 'bad-priority-kw', 'Bad priority topic', 'commercial', 'INVALID_PRIORITY', 'test');

    const gap = getContentGap(ws.workspaceId, 'bad-priority-kw')!;
    expect(gap.priority).toBe('medium');
  });

  it('omits suggestedPageType when value is not a valid enum member', () => {
    db.prepare(`
      INSERT OR REPLACE INTO content_gaps
        (workspace_id, target_keyword, topic, intent, priority, rationale, suggested_page_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ws.workspaceId, 'bad-pagetype-kw', 'Bad page type', 'informational', 'low', 'test', 'INVALID_TYPE');

    const gap = getContentGap(ws.workspaceId, 'bad-pagetype-kw')!;
    expect('suggestedPageType' in gap).toBe(false);
  });

  it('omits trendDirection when value is not a valid enum member', () => {
    db.prepare(`
      INSERT OR REPLACE INTO content_gaps
        (workspace_id, target_keyword, topic, intent, priority, rationale, trend_direction)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ws.workspaceId, 'bad-trend-kw', 'Bad trend', 'informational', 'low', 'test', 'sideways');

    const gap = getContentGap(ws.workspaceId, 'bad-trend-kw')!;
    expect('trendDirection' in gap).toBe(false);
  });
});

// ─── Special characters ───────────────────────────────────────────────────────

describe('special characters in keyword / topic', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('round-trips special characters in targetKeyword and topic without corruption', () => {
    const gap: ContentGap = {
      topic: "SEO tips & tricks: \"quotes\", <angle>, 'apostrophes'",
      targetKeyword: "seo-tips-&-tricks",
      intent: 'informational',
      priority: 'low',
      rationale: 'Special chars test.',
    };
    upsertContentGap(ws.workspaceId, gap);
    const stored = getContentGap(ws.workspaceId, gap.targetKeyword)!;
    expect(stored.topic).toBe(gap.topic);
    expect(stored.rationale).toBe(gap.rationale);
  });

  it('stores unicode characters correctly', () => {
    const gap: ContentGap = {
      topic: 'café au lait ☕',
      targetKeyword: 'café-keyword-🔑',
      intent: 'navigational',
      priority: 'low',
      rationale: 'Unicode test.',
    };
    upsertContentGap(ws.workspaceId, gap);
    const stored = getContentGap(ws.workspaceId, gap.targetKeyword)!;
    expect(stored.topic).toBe('café au lait ☕');
    expect(stored.targetKeyword).toBe('café-keyword-🔑');
  });
});

// ─── JSON array field round-trips ─────────────────────────────────────────────

describe('JSON array fields', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('round-trips serpFeatures as a string array', () => {
    const gap: ContentGap = {
      topic: 'JSON arrays test',
      targetKeyword: 'json-arr-kw',
      intent: 'informational',
      priority: 'low',
      rationale: 'test',
      serpFeatures: ['featured_snippet', 'people_also_ask', 'image_pack'],
    };
    upsertContentGap(ws.workspaceId, gap);
    const stored = getContentGap(ws.workspaceId, 'json-arr-kw')!;
    expect(stored.serpFeatures).toEqual(['featured_snippet', 'people_also_ask', 'image_pack']);
  });

  it('round-trips questionKeywords as a string array', () => {
    const gap: ContentGap = {
      topic: 'Question keywords test',
      targetKeyword: 'qk-arr-kw',
      intent: 'informational',
      priority: 'medium',
      rationale: 'test',
      questionKeywords: ['how does SEO work?', 'what is a backlink?'],
    };
    upsertContentGap(ws.workspaceId, gap);
    const stored = getContentGap(ws.workspaceId, 'qk-arr-kw')!;
    expect(stored.questionKeywords).toEqual(['how does SEO work?', 'what is a backlink?']);
  });

  it('round-trips serpTargeting as a string array', () => {
    const gap: ContentGap = {
      topic: 'SERP targeting test',
      targetKeyword: 'st-arr-kw',
      intent: 'commercial',
      priority: 'high',
      rationale: 'test',
      serpTargeting: ['target featured snippet', 'include FAQ schema'],
    };
    upsertContentGap(ws.workspaceId, gap);
    const stored = getContentGap(ws.workspaceId, 'st-arr-kw')!;
    expect(stored.serpTargeting).toEqual(['target featured snippet', 'include FAQ schema']);
  });

  it('handles malformed JSON in serp_features gracefully (returns empty array)', () => {
    db.prepare(`
      INSERT OR REPLACE INTO content_gaps
        (workspace_id, target_keyword, topic, intent, priority, rationale, serp_features)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(ws.workspaceId, 'bad-json-kw', 'Bad JSON', 'informational', 'low', 'test', '{not-valid-json}}');

    const stored = getContentGap(ws.workspaceId, 'bad-json-kw')!;
    // parseJsonSafeArray falls back to [] on parse failure
    expect(Array.isArray(stored.serpFeatures)).toBe(true);
  });
});

// ─── migrateFromJsonBlob ──────────────────────────────────────────────────────

describe('migrateFromJsonBlob', () => {
  let ws: SeededFullWorkspace;

  beforeAll(() => { ws = seedWorkspace(); });
  afterAll(() => { ws.cleanup(); });

  it('migrates contentGaps from keyword_strategy JSON blob into the table', () => {
    const strategy = {
      siteKeywords: ['seo'],
      opportunities: [],
      contentGaps: [
        {
          topic: 'Migration topic',
          targetKeyword: 'migrate-kw',
          intent: 'commercial',
          priority: 'high',
          rationale: 'From blob migration.',
        },
      ],
    };
    db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?')
      .run(JSON.stringify(strategy), ws.workspaceId);

    migrateFromJsonBlob();

    const gaps = listContentGaps(ws.workspaceId);
    expect(gaps.some(g => g.targetKeyword === 'migrate-kw')).toBe(true);
    const gap = gaps.find(g => g.targetKeyword === 'migrate-kw')!;
    expect(gap.topic).toBe('Migration topic');
    expect(gap.priority).toBe('high');
  });

  it('strips contentGaps from the workspace keyword_strategy JSON blob after migration', () => {
    // The previous test already migrated; verify blob is cleaned up
    const row = db.prepare('SELECT keyword_strategy FROM workspaces WHERE id = ?')
      .get(ws.workspaceId) as { keyword_strategy: string };
    const strategy = JSON.parse(row.keyword_strategy);
    expect('contentGaps' in strategy).toBe(false);
  });

  it('is idempotent — skips workspaces that already have rows', () => {
    // Run migration again; the workspace already has rows from previous test
    migrateFromJsonBlob();

    // Still exactly 1 row (the migrated one) — no duplicates introduced
    expect(countContentGaps(ws.workspaceId)).toBe(1);
  });

  it('handles a workspace with null keyword_strategy without throwing', () => {
    const emptyWs = seedWorkspace();
    try {
      expect(() => migrateFromJsonBlob()).not.toThrow();
    } finally {
      emptyWs.cleanup();
    }
  });

  it('handles a workspace with empty contentGaps array in strategy without inserting rows', () => {
    const emptyGapsWs = seedWorkspace();
    try {
      db.prepare('UPDATE workspaces SET keyword_strategy = ? WHERE id = ?')
        .run(JSON.stringify({ siteKeywords: [], opportunities: [], contentGaps: [] }), emptyGapsWs.workspaceId);

      migrateFromJsonBlob();

      expect(countContentGaps(emptyGapsWs.workspaceId)).toBe(0);
    } finally {
      emptyGapsWs.cleanup();
    }
  });
});
