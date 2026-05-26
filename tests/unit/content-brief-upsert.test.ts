import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { upsertBrief, getBrief, deleteBrief } from '../../server/content-brief.js';
import type { ContentBrief } from '../../shared/types/content.js';
import db from '../../server/db/index.js';

const TEST_WORKSPACE_ID = `test-ws-upsert-brief-${randomUUID().slice(0, 8)}`;

function buildBrief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: randomUUID(),
    workspaceId: TEST_WORKSPACE_ID,
    targetKeyword: 'test keyword',
    secondaryKeywords: ['a', 'b'],
    suggestedTitle: 'A Test Title',
    suggestedMetaDesc: 'A test meta description.',
    outline: [{ heading: 'H1', subheadings: [], notes: '', wordCount: 200, keywords: [] }],
    wordCountTarget: 1000,
    intent: 'informational',
    audience: 'devs',
    competitorInsights: 'none',
    internalLinkSuggestions: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('upsertBrief', () => {
  beforeAll(() => {
    db.prepare('INSERT OR IGNORE INTO workspaces (id, name, created_at) VALUES (?, ?, ?)').run(
      TEST_WORKSPACE_ID,
      'Test WS for upsertBrief',
      new Date().toISOString(),
    );
  });

  afterAll(() => {
    db.prepare('DELETE FROM content_briefs WHERE workspace_id = ?').run(TEST_WORKSPACE_ID);
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(TEST_WORKSPACE_ID);
  });

  it('inserts a brief and is retrievable via getBrief', () => {
    const brief = buildBrief();
    upsertBrief(TEST_WORKSPACE_ID, brief);
    const fetched = getBrief(TEST_WORKSPACE_ID, brief.id);
    expect(fetched).toBeDefined();
    expect(fetched?.targetKeyword).toBe('test keyword');
    expect(fetched?.secondaryKeywords).toEqual(['a', 'b']);
    deleteBrief(TEST_WORKSPACE_ID, brief.id);
  });

  it('preserves optional rich fields (peopleAlsoAsk, eeatGuidance, schemaRecommendations)', () => {
    const brief = buildBrief({
      peopleAlsoAsk: ['Q1?', 'Q2?'],
      eeatGuidance: { experience: 'e', expertise: 'x', authority: 'a', trust: 't' },
      schemaRecommendations: [
        { type: 'Article', notes: 'Primary schema' },
        { type: 'FAQPage', notes: 'FAQ schema' },
      ],
    });
    upsertBrief(TEST_WORKSPACE_ID, brief);
    const fetched = getBrief(TEST_WORKSPACE_ID, brief.id);
    expect(fetched?.peopleAlsoAsk).toEqual(['Q1?', 'Q2?']);
    expect(fetched?.eeatGuidance?.experience).toBe('e');
    expect(fetched?.schemaRecommendations).toEqual([
      { type: 'Article', notes: 'Primary schema' },
      { type: 'FAQPage', notes: 'FAQ schema' },
    ]);
    deleteBrief(TEST_WORKSPACE_ID, brief.id);
  });

  it('throws on duplicate id (no INSERT OR REPLACE - INSERT only by design)', () => {
    const brief = buildBrief();
    upsertBrief(TEST_WORKSPACE_ID, brief);
    expect(() => upsertBrief(TEST_WORKSPACE_ID, brief)).toThrow();
    deleteBrief(TEST_WORKSPACE_ID, brief.id);
  });
});
