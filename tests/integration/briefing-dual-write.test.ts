import { describe, it, expect, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the briefing adapter the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorBriefingToDeliverable } from '../../server/domains/inbox/briefing-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import type { BriefingDraft, BriefingStory } from '../../shared/types/briefing.js';

const ws = createWorkspace('briefing-dualwrite-test', 'site-br-dw');
const WS = ws.id;

function story(over: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: `st_${Math.random().toString(36).slice(2, 8)}`,
    category: 'win',
    isHeadline: false,
    headline: 'Traffic up',
    narrative: 'Organic traffic climbed.',
    metrics: [],
    drillIn: { page: 'performance' },
    sourceRefs: [],
    ...over,
  };
}

function makeDraft(over: Partial<BriefingDraft> = {}): BriefingDraft {
  return {
    id: `br_${Math.random().toString(36).slice(2, 10)}`,
    workspaceId: WS,
    weekOf: '2026-05-25',
    status: 'published',
    stories: [story({ isHeadline: true, headline: 'Hero line' }), story()],
    sourceMetadata: null,
    adminNote: null,
    autoPublished: false,
    createdAt: 1748000000000,
    updatedAt: 1748100000000,
    publishedAt: 1748100000000,
    ...over,
  };
}

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

afterAll(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
  deleteWorkspace(WS);
});

describe('briefing dual-write mirror', () => {
  it('mirrors one briefing deliverable (kind notification, terminal completed)', () => {
    const mirrored = mirrorBriefingToDeliverable(makeDraft({ id: 'br_x' }));
    expect(mirrored).not.toBeNull();
    expect(mirrored!.type).toBe('briefing');
    expect(mirrored!.kind).toBe('notification');
    expect(mirrored!.status).toBe('completed'); // delivered one-way notification
    expect(mirrored!.externalRef).toBe('2026-05-25'); // weekOf
    expect(mirrored!.sourceRef).toBe('briefing:br_x');
    expect(mirrored!.payload.headline).toBe('Hero line');
    expect(mirrored!.payload.storyCount).toBe(2);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('is idempotent (two publishes of the same briefing → one row)', () => {
    const first = mirrorBriefingToDeliverable(makeDraft({ id: 'br_idem' }));
    const second = mirrorBriefingToDeliverable(makeDraft({ id: 'br_idem' }));
    expect(second!.id).toBe(first!.id);
    expect(listDeliverables(WS)).toHaveLength(1);
  });

  it('skips a non-published draft (only published briefings are mirrored)', () => {
    const result = mirrorBriefingToDeliverable(makeDraft({ status: 'approved' }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });

  it('rejects an empty (storyless) briefing via validateSendable (no row, no throw)', () => {
    const result = mirrorBriefingToDeliverable(makeDraft({ stories: [] }));
    expect(result).toBeNull();
    expect(listDeliverables(WS)).toHaveLength(0);
  });
});
