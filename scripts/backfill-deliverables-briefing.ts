/**
 * Backfill: mirror legacy PUBLISHED `briefing_drafts` rows into the unified `client_deliverable`
 * model (PR-1fg cutover tooling — NOT run automatically).
 *
 * Run during the briefing cutover, AFTER the dual-write seam is live (so freshly-published
 * briefings already mirror):
 *
 *   npx tsx scripts/backfill-deliverables-briefing.ts            # backfill
 *   npx tsx scripts/backfill-deliverables-briefing.ts --dry-run  # report only, no writes
 *
 * Idempotent + sourceRef normalization (design §4.5): every briefing routes through the adapter's
 * own `sourceRef()` — the stable `briefing:<id>` key — so a backfill collapses onto the SAME row a
 * fresh dual-write produces. It then SKIPS any briefing whose deliverable already exists
 * (DO-NOTHING). Re-running is a no-op.
 *
 * ONLY published briefings carry a client-facing notification: a draft/approved/skipped briefing
 * was never delivered to the client, so it is skipped (there is nothing to mirror). Empty
 * (storyless) published briefings are also skipped (adapter Guarantee 0).
 *
 * A published briefing is a DELIVERED one-way NOTIFICATION — the mirrored row is born terminal
 * (`completed`), consistent with `getDeliverableTransitions('briefing') === {}` (no transitions).
 * Apply is disabled (a notification has nothing to approve).
 *
 * The briefing's own `rowToDraft` mapper is reused via `getBriefingById` so the legacy
 * 'schema-review' drillIn migration + Zod story parsing are applied exactly as in production
 * (no re-implemented parsing that could drift).
 */
import db from '../server/db/index.js';
import { getBriefingById } from '../server/briefing-store.js';
import { findBySourceRef, upsertDeliverable } from '../server/client-deliverables.js';
import { getAdapter } from '../server/domains/inbox/deliverable-adapters/index.js';
import { createLogger } from '../server/logger.js';

const log = createLogger('backfill-deliverables-briefing');
void log;

interface PublishedBriefingIdRow {
  id: string;
}

/** The ids of every PUBLISHED briefing (the only ones that carry a client-facing notification). */
function readPublishedBriefingIds(): string[] {
  const rows = db
    .prepare("SELECT id FROM briefing_drafts WHERE status = 'published'")
    .all() as PublishedBriefingIdRow[];
  return rows.map((r) => r.id);
}

interface BackfillResult {
  total: number;
  inserted: number;
  skipped: number;
}

/**
 * Backfill all legacy PUBLISHED briefings. Idempotent: routes every briefing through the adapter's
 * stable `sourceRef()` (`briefing:<id>`) and skips briefings whose deliverable already exists
 * (DO-NOTHING). Skips not-ready (storyless) briefings (adapter Guarantee 0). When `dryRun` is true,
 * classifies + counts but writes nothing.
 */
export function backfillBriefingDeliverables(opts: { dryRun?: boolean } = {}): BackfillResult {
  const ids = readPublishedBriefingIds();
  const adapter = getAdapter('briefing');

  let inserted = 0;
  let skipped = 0;

  for (const id of ids) {
    // Reuse the production mapper (applies the legacy schema-review migration + Zod story parse).
    const draft = getBriefingById(id);
    if (!draft || draft.status !== 'published') {
      skipped += 1;
      continue;
    }

    // Guarantee 0: skip a not-ready (storyless) briefing.
    const sendable = adapter.validateSendable(draft);
    if (!sendable.ok) {
      skipped += 1;
      continue;
    }

    const sourceRef = adapter.sourceRef(draft);

    // DO-NOTHING: a deliverable for this (ws, briefing, sourceRef) already exists → skip.
    if (sourceRef != null && findBySourceRef(draft.workspaceId, 'briefing', sourceRef) != null) {
      skipped += 1;
      continue;
    }

    if (opts.dryRun) {
      inserted += 1; // would-insert count
      continue;
    }

    const built = adapter.buildPayload(draft);
    const publishedIso = draft.publishedAt != null
      ? new Date(draft.publishedAt).toISOString()
      : new Date(draft.updatedAt).toISOString();
    upsertDeliverable({
      workspaceId: draft.workspaceId,
      type: 'briefing',
      kind: built.kind, // 'notification'
      status: 'completed', // published briefing = delivered one-way notification (terminal)
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null, // = weekOf
      sentAt: publishedIso,
      decidedAt: publishedIso,
      appliedAt: publishedIso,
      generatedAt: new Date(draft.createdAt).toISOString(),
      source: 'backfill-briefing',
      sourceRef,
    });
    inserted += 1;
  }

  return { total: ids.length, inserted, skipped };
}

// ── CLI entry (only when invoked directly, not when imported by tests) ─────────
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const dryRun = process.argv.includes('--dry-run');
  const result = backfillBriefingDeliverables({ dryRun });
  console.log(dryRun ? 'DRY RUN (no writes):' : 'Backfill complete:');
  console.log(`  total published briefings: ${result.total}`);
  console.log(`  inserted: ${result.inserted}`);
  console.log(`  skipped (already mirrored / not sendable): ${result.skipped}`);
}
