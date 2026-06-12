import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import db from '../../server/db/index.js';
// The barrel self-registers the briefing adapter the backfill resolves.
import '../../server/domains/inbox/deliverable-adapters/index.js';
import { backfillBriefingDeliverables } from '../../scripts/backfill-deliverables-briefing.js';
import { upsertBriefingDraft, markPublished } from '../../server/briefing-store.js';
import { listDeliverables } from '../../server/client-deliverables.js';
import { createWorkspace, deleteWorkspace } from '../../server/workspaces.js';
import { mirrorBriefingToDeliverable } from '../../server/domains/inbox/briefing-dual-write.js';
import type { BriefingStory } from '../../shared/types/briefing.js';

const wsA = createWorkspace('backfill-briefing-A', 'site-bbr-a');
const WS_A = wsA.id;

function stories(): BriefingStory[] {
  return [
    {
      id: 'st_1',
      category: 'win',
      isHeadline: true,
      headline: 'Hero line',
      narrative: 'Organic traffic climbed this week.',
      metrics: [],
      drillIn: { page: 'performance' },
      sourceRefs: [],
    },
  ];
}

/** Seed a PUBLISHED briefing for a given week. Returns the published draft id. */
function seedPublished(weekOf: string): string {
  const draft = upsertBriefingDraft({ workspaceId: WS_A, weekOf, stories: stories(), sourceMetadata: null });
  const published = markPublished(WS_A, draft.id, { autoPublished: false });
  return published!.id;
}

beforeEach(() => {
  db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(WS_A);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
});

afterEach(() => {
  db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(WS_A);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
});

afterAll(() => {
  db.prepare('DELETE FROM briefing_drafts WHERE workspace_id = ?').run(WS_A);
  db.prepare('DELETE FROM client_deliverable WHERE workspace_id = ?').run(WS_A);
  deleteWorkspace(WS_A);
});

describe('backfill-deliverables-briefing', () => {
  it('backfills a published briefing into a briefing deliverable with the stable sourceRef', () => {
    const id = seedPublished('2026-05-25');
    expect(listDeliverables(WS_A)).toHaveLength(0); // flag off → no mirror at publish

    const result = backfillBriefingDeliverables();
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1);

    const rows = listDeliverables(WS_A).filter((r) => r.type === 'briefing');
    expect(rows).toHaveLength(1);
    expect(rows[0].sourceRef).toBe(`briefing:${id}`);
    expect(rows[0].kind).toBe('notification');
    expect(rows[0].status).toBe('completed');
    expect(rows[0].externalRef).toBe('2026-05-25'); // weekOf
  });

  it('skips a draft/approved briefing (never published → nothing to mirror)', () => {
    // A non-published draft is not even returned by the published-id query.
    upsertBriefingDraft({ workspaceId: WS_A, weekOf: '2026-05-25', stories: stories(), sourceMetadata: null });
    const result = backfillBriefingDeliverables();
    expect(result.total).toBe(0); // only PUBLISHED rows are scanned
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS_A)).toHaveLength(0);
  });

  it('is idempotent — re-running the backfill inserts nothing new', () => {
    seedPublished('2026-05-25');
    const first = backfillBriefingDeliverables();
    expect(first.inserted).toBe(1);

    const second = backfillBriefingDeliverables();
    expect(second.inserted).toBe(0);
    expect(second.skipped).toBe(1);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'briefing')).toHaveLength(1);
  });

  it('--dry-run counts but writes nothing', () => {
    seedPublished('2026-05-25');
    const result = backfillBriefingDeliverables({ dryRun: true });
    expect(result.total).toBe(1);
    expect(result.inserted).toBe(1); // would-insert count
    expect(listDeliverables(WS_A)).toHaveLength(0); // but nothing written
  });

  it('CROSS-PATH: a dual-written deliverable + a backfill of the same briefing collapse to ONE', () => {
    const draft = upsertBriefingDraft({ workspaceId: WS_A, weekOf: '2026-05-25', stories: stories(), sourceMetadata: null });
    const published = markPublished(WS_A, draft.id, { autoPublished: false })!;
    // Mirror via dual-write → one briefing:<id> deliverable.
    const mirrored = mirrorBriefingToDeliverable(published);
    expect(mirrored!.sourceRef).toBe(`briefing:${published.id}`);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'briefing')).toHaveLength(1);

    // The backfill normalizes to briefing:<id>, which already exists → no new row.
    const result = backfillBriefingDeliverables();
    expect(result.inserted).toBe(0);
    expect(listDeliverables(WS_A).filter((r) => r.type === 'briefing')).toHaveLength(1);
  });
});
