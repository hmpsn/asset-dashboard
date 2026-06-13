import { describe, it, expect, afterEach, afterAll, beforeEach } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the briefing adapter the mirror resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { mirrorBriefingToDeliverable } from '../../server/domains/inbox/briefing-dual-write.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { setBroadcast } from '../../server/broadcast.js';
import { WS_EVENTS } from '../../server/ws-events.js';
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

describe('briefing deliverable broadcasts', () => {
  let events: Array<{ workspaceId: string; event: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    events = [];
    setBroadcast(
      () => {},
      (workspaceId, event, data) => events.push({ workspaceId, event, data: data as Record<string, unknown> }),
    );
  });

  afterEach(() => {
    setBroadcast(() => {}, () => {});
  });

  it('broadcasts DELIVERABLE_SENT on first mirror and DELIVERABLE_UPDATED on repeat publish', () => {
    const first = mirrorBriefingToDeliverable(makeDraft({ id: 'br_broadcast' }));
    const second = mirrorBriefingToDeliverable(makeDraft({ id: 'br_broadcast' }));

    expect(second?.id).toBe(first?.id);
    expect(events.map(e => e.event)).toEqual([
      WS_EVENTS.DELIVERABLE_SENT,
      WS_EVENTS.DELIVERABLE_UPDATED,
    ]);
    expect(events[0].workspaceId).toBe(WS);
    expect(events[0].data).toEqual(expect.objectContaining({
      deliverableId: first?.id,
      type: 'briefing',
      status: 'completed',
    }));
    expect(events[1].data).toEqual(expect.objectContaining({
      deliverableId: first?.id,
      type: 'briefing',
      status: 'completed',
    }));
  });

  it('does not broadcast when the briefing is not publishable', () => {
    const notPublished = mirrorBriefingToDeliverable(makeDraft({ status: 'approved' }));
    const empty = mirrorBriefingToDeliverable(makeDraft({ id: 'br_empty_broadcast', stories: [] }));

    expect(notPublished).toBeNull();
    expect(empty).toBeNull();
    expect(events).toHaveLength(0);
  });
});
