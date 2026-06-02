/**
 * briefing dual-write mirror (PR-1fg, DARK behind the flag).
 *
 * At the briefing PUBLISH seams (manual publish — `server/routes/briefing.ts`; auto-publish —
 * `server/briefing-cron.ts`, both call `markPublished` then run the publish side-effects), when
 * the `unified-deliverables-rest` flag is ON we ALSO mirror the just-published `BriefingDraft`
 * into the unified `client_deliverable` model via the registered `briefing` adapter +
 * `upsertDeliverable`. Default off → this is a no-op (NO production behavior change).
 *
 * A published briefing is a DELIVERED one-way NOTIFICATION (kind='notification'): the client reads
 * it but cannot approve/decline it. The mirrored row is born in a TERMINAL canonical status
 * (`completed`) consistent with `getDeliverableTransitions('briefing') === {}` (no transitions) —
 * a published briefing IS done.
 *
 * Scope (kept tight): this is the publish-time mirror only. We do NOT mirror drafts (only PUBLISHED
 * briefings carry a client-facing deliverable), and we do NOT change any reads. Apply stays
 * disabled (notification — nothing to approve; the publish side-effects live in the source path).
 *
 * The mirror is best-effort and MUST NEVER break the live publish: any failure is logged and
 * swallowed (the briefing is already published + the client already notified by the seam). The
 * flag being off makes this unreachable, so a dark bug can never reach prod.
 *
 * Leaf rule: imports the registry + the store + the flag reader; not imported back by them. The
 * `BriefingDraft` carries its own `workspaceId`, so the seam passes it straight through.
 */
import type { BriefingDraft } from '../../../shared/types/briefing.js';
import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { isFeatureEnabled } from '../../feature-flags.js';
import { upsertDeliverable } from '../../client-deliverables.js';
import { getAdapter } from './deliverable-adapters/index.js';
import { createLogger } from '../../logger.js';

const log = createLogger('briefing-dual-write');

/** The flag that gates the entire briefing dual-write. GLOBAL flag, default false (dark). */
export const BRIEFING_FLAG = 'unified-deliverables-rest' as const;

/**
 * Mirror a just-published briefing into `client_deliverable` IFF the flag is on. Called at the
 * publish seams (manual + auto) right after `markPublished` succeeds. Returns the mirrored
 * deliverable, or null when the flag is off (no-op), the briefing is not published, or the mirror
 * was skipped/failed. Never throws — the live publish must not be affected.
 *
 * @param draft the just-published BriefingDraft (status `published`).
 */
export function mirrorBriefingToDeliverable(draft: BriefingDraft): ClientDeliverable | null {
  // Flag default false → dark no-op. The single gate for the whole machinery.
  if (!isFeatureEnabled(BRIEFING_FLAG)) return null;

  // Only a PUBLISHED briefing carries a client-facing notification. A non-published draft slipping
  // through the seam is not mirrored (defensive — the seams only call this after markPublished).
  if (draft.status !== 'published') {
    log.warn(
      { workspaceId: draft.workspaceId, briefingId: draft.id, status: draft.status },
      'briefing mirror skipped: draft is not published',
    );
    return null;
  }

  try {
    const adapter = getAdapter('briefing');

    // Guarantee 0: the adapter rejects an empty (storyless) briefing.
    const sendable = adapter.validateSendable(draft);
    if (!sendable.ok) {
      log.warn(
        { workspaceId: draft.workspaceId, briefingId: draft.id, reason: sendable.reason },
        'briefing mirror skipped: adapter rejected the briefing',
      );
      return null;
    }

    const built = adapter.buildPayload(draft);
    const sourceRef = adapter.sourceRef(draft);
    // publishedAt is epoch ms on the draft; carry it as ISO for the deliverable timestamps. A
    // just-published draft always has publishedAt set, but fall back to now defensively.
    const publishedIso = draft.publishedAt != null
      ? new Date(draft.publishedAt).toISOString()
      : new Date().toISOString();

    const deliverable = upsertDeliverable({
      // OWNING workspace — read off the draft itself (briefing_drafts stores workspace_id per row).
      workspaceId: draft.workspaceId,
      type: 'briefing',
      kind: built.kind, // 'notification'
      // A published briefing is a DELIVERED one-way notification → terminal `completed`
      // (consistent with `getDeliverableTransitions('briefing') === {}` — no transitions).
      status: 'completed',
      title: built.title,
      summary: built.summary ?? null,
      payload: built.payload,
      externalRef: built.externalRef ?? null, // = weekOf
      // A notification is delivered the moment it is published — sent + decided + applied all at
      // publish time (it is born terminal; there is no later lifecycle).
      sentAt: publishedIso,
      decidedAt: publishedIso,
      appliedAt: publishedIso,
      // The briefing was generated when the draft was created (epoch ms → ISO).
      generatedAt: new Date(draft.createdAt).toISOString(),
      source: 'briefing-mirror',
      sourceRef,
      // No child items — a briefing is a single notification (the stories ride in payload metadata).
    });

    log.debug(
      { workspaceId: draft.workspaceId, briefingId: draft.id, deliverableId: deliverable.id },
      'briefing mirrored into client_deliverable (dual-write)',
    );
    return deliverable;
  } catch (err) {
    // Best-effort: the briefing is already published + the client notified. A mirror failure must
    // not surface to the operator or roll back the live publish.
    log.error({ err, workspaceId: draft.workspaceId, briefingId: draft.id }, 'briefing mirror failed (swallowed)');
    return null;
  }
}
