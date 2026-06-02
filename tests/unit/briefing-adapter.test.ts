import { describe, it, expect, afterEach } from 'vitest';
import db from '../../server/db/index.js';
import { getAdapter } from '../../server/domains/inbox/deliverable-adapters/types.js';
// Importing the barrel self-registers the PR-1fg briefing adapter (+ the others).
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { upsertDeliverable, getDeliverable } from '../../server/client-deliverables.js';
import { getDeliverableTransitions } from '../../server/state-machines.js';
import type { BriefingDraft, BriefingStory } from '../../shared/types/briefing.js';

const WS = 'briefing-adapter-test';

afterEach(() => {
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS);
});

function story(over: Partial<BriefingStory> = {}): BriefingStory {
  return {
    id: `st_${Math.random().toString(36).slice(2, 8)}`,
    category: 'win',
    isHeadline: false,
    headline: 'Traffic up 12%',
    narrative: 'Organic traffic climbed this week.',
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
    stories: [
      story({ isHeadline: true, headline: 'Best week since March' }),
      story(),
    ],
    sourceMetadata: null,
    adminNote: null,
    autoPublished: false,
    createdAt: 1748000000000,
    updatedAt: 1748100000000,
    publishedAt: 1748100000000,
    ...over,
  };
}

describe('briefing adapter — registration', () => {
  it('is registered via the barrel as a notification artifact with apply disabled', () => {
    const adapter = getAdapter('briefing');
    expect(adapter.type).toBe('briefing');
    expect(adapter.appliesOnApprove).toBeFalsy();
  });

  it('briefing has NO client transitions (notification kind, one-way)', () => {
    // Consistency check with the chosen terminal status: a notification has no lifecycle.
    expect(getDeliverableTransitions('briefing')).toEqual({});
  });
});

describe('briefing adapter — round-trip (build → store → parse → assert-no-fallback)', () => {
  it('round-trips a published briefing as a notification deliverable, terminal completed', () => {
    const adapter = getAdapter('briefing');
    const draft = makeDraft();

    expect(adapter.validateSendable(draft)).toEqual({ ok: true });

    const built = adapter.buildPayload(draft);
    const sourceRef = adapter.sourceRef(draft);
    expect(built.kind).toBe('notification');
    expect(built.externalRef).toBe('2026-05-25'); // externalRef = weekOf
    expect(built.items).toBeUndefined(); // no per-item rows

    const stored = upsertDeliverable({
      workspaceId: WS,
      type: 'briefing',
      kind: built.kind,
      status: 'completed', // published briefing = delivered one-way notification (terminal)
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null,
      sourceRef,
      sentAt: '2026-05-25T00:00:00.000Z',
    });

    const got = getDeliverable(stored.id)!;
    expect(got.type).toBe('briefing');
    expect(got.kind).toBe('notification');
    expect(got.status).toBe('completed'); // terminal — a published briefing IS done
    expect(got.externalRef).toBe('2026-05-25');
    // assert-no-fallback: the payload round-trips the real content, not {}.
    expect(got.payload).not.toEqual({});
    expect(got.payload.family).toBe('briefing');
    expect(got.payload.weekOf).toBe('2026-05-25');
    expect(got.payload.headline).toBe('Best week since March'); // hero headline carried
    expect(got.payload.storyCount).toBe(2);
    expect(got.payload.autoPublished).toBe(false);
    expect(got.items ?? []).toHaveLength(0);
  });

  it('falls back to a story-count summary when no hero story exists', () => {
    const adapter = getAdapter('briefing');
    const draft = makeDraft({ stories: [story(), story(), story()] });
    const built = adapter.buildPayload(draft);
    expect(built.summary).toBe('3 stories');
    expect((built.payload as { headline: string | null }).headline).toBeNull();
  });
});

describe('briefing adapter — sourceRef (stable per-briefing)', () => {
  it('sourceRef → briefing:<id>', () => {
    const draft = makeDraft({ id: 'br_fixed' });
    expect(getAdapter('briefing').sourceRef(draft)).toBe('briefing:br_fixed');
  });

  it('sourceRef is null when the briefing has no id', () => {
    expect(getAdapter('briefing').sourceRef(makeDraft({ id: '' }))).toBeNull();
  });

  it('sourceRef is STABLE across two re-publishes of the same briefing → dedupes to one row', () => {
    const adapter = getAdapter('briefing');
    const d1 = makeDraft({ id: 'br_same' });
    const d2 = makeDraft({ id: 'br_same' });
    expect(adapter.sourceRef(d1)).toBe(adapter.sourceRef(d2));

    const store = (draft: BriefingDraft) => {
      const built = adapter.buildPayload(draft);
      return upsertDeliverable({
        workspaceId: WS,
        type: 'briefing',
        kind: built.kind,
        status: 'completed',
        title: built.title,
        summary: built.summary ?? null,
        payload: built.payload,
        externalRef: built.externalRef ?? null,
        sourceRef: adapter.sourceRef(draft),
      });
    };
    const first = store(d1);
    const second = store(d2);
    expect(second.id).toBe(first.id);
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM client_deliverable WHERE workspace_id = ? AND type = ?')
      .get(WS, 'briefing') as { n: number };
    expect(rows.n).toBe(1);
  });
});

describe('briefing adapter — validateSendable', () => {
  it('a briefing with stories IS sendable', () => {
    expect(getAdapter('briefing').validateSendable(makeDraft())).toEqual({ ok: true });
  });

  it('rejects an empty (storyless) briefing', () => {
    expect(getAdapter('briefing').validateSendable(makeDraft({ stories: [] }))).toEqual({
      ok: false,
      reason: 'briefing has no stories (nothing to notify the client on)',
    });
  });
});

describe('briefing adapter — apply stays disabled', () => {
  it('apply stub throws (a notification has nothing to approve)', async () => {
    const adapter = getAdapter('briefing');
    await expect(adapter.applyDeliverable!({} as never)).rejects.toThrow(
      /disabled|one-way|no client approve/i,
    );
  });
});
