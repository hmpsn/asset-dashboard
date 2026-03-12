/**
 * Unit tests for server/content-brief.ts — brief CRUD operations.
 *
 * Note: generateBrief() requires OPENAI_API_KEY and is not tested here.
 * This file tests the synchronous CRUD operations.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../../server/data-dir.js';
import {
  listBriefs,
  getBrief,
  updateBrief,
  deleteBrief,
  type ContentBrief,
} from '../../server/content-brief.js';

const BRIEFS_DIR = getDataDir('content-briefs');

// Helper to create a brief directly via file I/O (since createBrief requires OpenAI)
function seedBrief(workspaceId: string, brief: ContentBrief): void {
  const fp = path.join(BRIEFS_DIR, `${workspaceId}.json`);
  let briefs: ContentBrief[] = [];
  try {
    if (fs.existsSync(fp)) briefs = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  } catch { /* fresh */ }
  briefs.push(brief);
  fs.writeFileSync(fp, JSON.stringify(briefs, null, 2));
}

function cleanupWorkspace(workspaceId: string): void {
  const fp = path.join(BRIEFS_DIR, `${workspaceId}.json`);
  try { fs.unlinkSync(fp); } catch { /* skip */ }
}

function makeBrief(id: string, workspaceId: string, overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id,
    workspaceId,
    targetKeyword: 'test keyword',
    secondaryKeywords: ['secondary1', 'secondary2'],
    suggestedTitle: 'Test Brief Title',
    suggestedMetaDesc: 'Test meta description',
    outline: [
      { heading: 'Introduction', notes: 'Intro notes', wordCount: 200, keywords: ['test'] },
      { heading: 'Main Section', subheadings: ['Sub 1', 'Sub 2'], notes: 'Main notes', wordCount: 500, keywords: ['test', 'keyword'] },
    ],
    wordCountTarget: 1800,
    intent: 'informational',
    audience: 'general',
    competitorInsights: 'Competitors focus on...',
    internalLinkSuggestions: ['/about', '/services'],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

// ── listBriefs ──

describe('listBriefs', () => {
  const wsId = 'ws_brief_list_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('returns empty array for workspace with no briefs', () => {
    expect(listBriefs('ws_nonexistent_briefs')).toEqual([]);
  });

  it('returns seeded briefs sorted by createdAt (newest first)', () => {
    const older = makeBrief('brief_old', wsId, { createdAt: '2024-01-01T00:00:00Z' });
    const newer = makeBrief('brief_new', wsId, { createdAt: '2024-06-01T00:00:00Z' });
    seedBrief(wsId, older);
    seedBrief(wsId, newer);

    const briefs = listBriefs(wsId);
    expect(briefs).toHaveLength(2);
    expect(briefs[0].id).toBe('brief_new');
    expect(briefs[1].id).toBe('brief_old');
  });
});

// ── getBrief ──

describe('getBrief', () => {
  const wsId = 'ws_brief_get_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('returns a specific brief by id', () => {
    seedBrief(wsId, makeBrief('brief_find', wsId, { targetKeyword: 'findable keyword' }));

    const brief = getBrief(wsId, 'brief_find');
    expect(brief).toBeDefined();
    expect(brief!.id).toBe('brief_find');
    expect(brief!.targetKeyword).toBe('findable keyword');
  });

  it('returns undefined for non-existent brief', () => {
    expect(getBrief(wsId, 'brief_nonexistent')).toBeUndefined();
  });
});

// ── updateBrief ──

describe('updateBrief', () => {
  const wsId = 'ws_brief_update_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('updates brief fields', () => {
    seedBrief(wsId, makeBrief('brief_upd', wsId));

    const updated = updateBrief(wsId, 'brief_upd', {
      suggestedTitle: 'Updated Title',
      wordCountTarget: 2500,
    });

    expect(updated).not.toBeNull();
    expect(updated!.suggestedTitle).toBe('Updated Title');
    expect(updated!.wordCountTarget).toBe(2500);
    // Original fields preserved
    expect(updated!.targetKeyword).toBe('test keyword');
  });

  it('returns null for non-existent brief', () => {
    expect(updateBrief(wsId, 'brief_nonexistent', { suggestedTitle: 'X' })).toBeNull();
  });

  it('preserves outline structure on update', () => {
    seedBrief(wsId, makeBrief('brief_outline', wsId));

    const updated = updateBrief(wsId, 'brief_outline', {
      outline: [
        { heading: 'New Section', notes: 'New notes', wordCount: 300 },
      ],
    });

    expect(updated!.outline).toHaveLength(1);
    expect(updated!.outline[0].heading).toBe('New Section');
  });
});

// ── deleteBrief ──

describe('deleteBrief', () => {
  const wsId = 'ws_brief_delete_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('removes a brief', () => {
    seedBrief(wsId, makeBrief('brief_del', wsId));
    expect(deleteBrief(wsId, 'brief_del')).toBe(true);
    expect(getBrief(wsId, 'brief_del')).toBeUndefined();
  });

  it('returns false for non-existent brief', () => {
    expect(deleteBrief(wsId, 'brief_nonexistent')).toBe(false);
  });
});

// ── ContentBrief interface shape ──

describe('ContentBrief shape', () => {
  const wsId = 'ws_brief_shape_' + Date.now();

  afterAll(() => cleanupWorkspace(wsId));

  it('supports v2 enhanced fields', () => {
    const brief = makeBrief('brief_v2', wsId, {
      executiveSummary: 'This content matters because...',
      contentFormat: 'guide',
      toneAndStyle: 'authoritative but approachable',
      peopleAlsoAsk: ['What is X?', 'How does X work?'],
      topicalEntities: ['entity1', 'entity2'],
      serpAnalysis: { contentType: 'guide', avgWordCount: 2000, commonElements: ['tables'], gaps: ['video'] },
      difficultyScore: 45,
      trafficPotential: 'high',
      ctaRecommendations: ['Download guide', 'Contact us'],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v2');
    expect(fetched!.executiveSummary).toBe('This content matters because...');
    expect(fetched!.serpAnalysis!.avgWordCount).toBe(2000);
  });

  it('supports v3 EEAT fields', () => {
    const brief = makeBrief('brief_v3', wsId, {
      eeatGuidance: { experience: 'Show real examples', expertise: 'Cite credentials', authority: 'Link authoritative sources', trust: 'Include testimonials' },
      contentChecklist: ['Include data', 'Add examples'],
      schemaRecommendations: [{ type: 'Article', notes: 'Use BlogPosting' }],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v3');
    expect(fetched!.eeatGuidance!.experience).toBe('Show real examples');
    expect(fetched!.contentChecklist).toHaveLength(2);
  });

  it('supports v4 pageType field', () => {
    const brief = makeBrief('brief_v4', wsId, { pageType: 'landing' });
    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v4');
    expect(fetched!.pageType).toBe('landing');
  });

  it('supports v5 reference URLs and real SERP data', () => {
    const brief = makeBrief('brief_v5', wsId, {
      referenceUrls: ['https://competitor.com/guide'],
      realPeopleAlsoAsk: ['How much does X cost?'],
      realTopResults: [{ position: 1, title: 'Top Result', url: 'https://example.com' }],
    });

    seedBrief(wsId, brief);
    const fetched = getBrief(wsId, 'brief_v5');
    expect(fetched!.referenceUrls).toHaveLength(1);
    expect(fetched!.realTopResults![0].position).toBe(1);
  });
});
