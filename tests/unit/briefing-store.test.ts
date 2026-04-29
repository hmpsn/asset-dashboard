import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
import {
  upsertBriefingDraft,
  getBriefingByWeek,
  getLatestPublishedBriefing,
  listBriefingDrafts,
  markPublished,
  markSkipped,
} from '../../server/briefing-store.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const wsId = 'ws-test-briefing-store';

function makeStory(overrides: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: 'st-1',
    category: 'win',
    isHeadline: true,
    headline: 'Traffic is up',
    narrative: 'Three new posts drove +12% in traffic this week.',
    metrics: [{ value: '+12%', label: 'traffic' }],
    drillIn: { page: 'performance' },
    sourceRefs: [{ type: 'analytics_insight', id: 'ins-1' }],
    ...overrides,
  };
}

describe('briefing-store', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(wsId);
  });

  it('round-trips a draft with stories array', () => {
    const draft = upsertBriefingDraft({
      workspaceId: wsId,
      weekOf: '2026-04-27',
      stories: [makeStory(), makeStory({ id: 'st-2', isHeadline: false, category: 'risk' })],
      sourceMetadata: { candidateCount: 8, model: 'claude-sonnet-4', provider: 'anthropic', generationMs: 4200 },
    });
    expect(draft.id).toBeTruthy();
    expect(draft.stories).toHaveLength(2);
    expect(draft.stories[0].headline).toBe('Traffic is up');
    expect(draft.status).toBe('draft');

    const fetched = getBriefingByWeek(wsId, '2026-04-27');
    expect(fetched?.id).toBe(draft.id);
    expect(fetched?.stories).toHaveLength(2);
  });

  it('upsert is idempotent on (workspace_id, week_of)', () => {
    upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-27', stories: [makeStory()], sourceMetadata: null });
    upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-27', stories: [makeStory({ id: 'st-9' })], sourceMetadata: null });
    const list = listBriefingDrafts(wsId);
    expect(list.filter(d => d.weekOf === '2026-04-27')).toHaveLength(1);
    expect(list[0].stories[0].id).toBe('st-9');
  });

  it('heals malformed JSON stories to empty array (no throw)', () => {
    const inserted = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-20', stories: [makeStory()], sourceMetadata: null });
    db.prepare('UPDATE briefing_drafts SET stories = ? WHERE id = ?').run('not json at all', inserted.id);
    const fetched = getBriefingByWeek(wsId, '2026-04-20');
    expect(fetched?.stories).toEqual([]);
  });

  it('markPublished sets status, publishedAt, and autoPublished flag', () => {
    const d = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-13', stories: [makeStory()], sourceMetadata: null });
    const updated = markPublished(d.id, { autoPublished: true });
    expect(updated?.status).toBe('published');
    expect(updated?.autoPublished).toBe(true);
    expect(updated?.publishedAt).toBeGreaterThan(0);
  });

  it('getLatestPublishedBriefing returns most recent published row', () => {
    const a = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-13', stories: [makeStory()], sourceMetadata: null });
    const b = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-20', stories: [makeStory()], sourceMetadata: null });
    markPublished(a.id, { autoPublished: false });
    markPublished(b.id, { autoPublished: false });
    const latest = getLatestPublishedBriefing(wsId);
    expect(latest?.weekOf).toBe('2026-04-20');
  });

  it('markSkipped transitions to skipped and preserves stories', () => {
    const d = upsertBriefingDraft({ workspaceId: wsId, weekOf: '2026-04-06', stories: [makeStory()], sourceMetadata: null });
    const skipped = markSkipped(d.id, 'No material activity this week');
    expect(skipped?.status).toBe('skipped');
    expect(skipped?.adminNote).toBe('No material activity this week');
    expect(skipped?.stories).toHaveLength(1);
  });
});
