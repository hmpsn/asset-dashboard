/**
 * briefing deliverable adapter (PR-1fg, DARK — net-new NOTIFICATION type, ONE-WAY).
 *
 * Claims the weekly client BRIEFING (`BriefingDraft`, stored in `briefing_drafts`, keyed by `id`)
 * once it has been PUBLISHED (`server/briefing-store.ts:markPublished`, status `published`). A
 * published briefing is a DELIVERED, one-way notification: the client reads it, but there is
 * nothing to approve/decline/request-changes-on. It is sent at the briefing PUBLISH seams (manual
 * publish — `server/routes/briefing.ts`; auto-publish — `server/briefing-cron.ts`), NOT the
 * unified sendToClient service.
 *
 * kind = 'notification' (design §4.1): a briefing is a one-way client-facing notification, not a
 * review/decision/batch/order. `getDeliverableTransitions('briefing')` returns `{}` (no client
 * transitions — `NOTIFICATION_DELIVERABLE_TYPES` in `state-machines.ts`), so the briefing
 * deliverable has NO lifecycle after it is born. To stay consistent with "no transitions", the
 * mirrored row is born in a SENSIBLE TERMINAL canonical status — `completed` — the same terminal
 * the ORDER lifecycle uses for "done": a published briefing IS done (delivered, one-way). It is
 * NOT `applied` (that is the review-family approve→apply terminal, which a notification has no
 * concept of) and NOT `awaiting_client` (a notification is not awaiting anything).
 *
 * sourceRef = `briefing:<id>` — STABLE per-briefing (`briefing_drafts.id` is the globally-unique
 * natural key). A re-publish of the same briefing (idempotent re-mirror) dedupes onto the same
 * deliverable row (design §4.5). One deliverable per published briefing.
 *
 * The briefing detail (weekOf, the hero headline, the story count, the auto-published flag) rides
 * in `client_deliverable.payload` JSON; this adapter emits NO typed child items (a briefing is a
 * single notification artifact — the stories are payload metadata, not per-item review rows).
 *
 * validateSendable: only a PUBLISH-READY briefing is sendable — a briefing with at least one story
 * (a published briefing the client can read). An empty briefing (no stories) is rejected
 * (Guarantee 0). (Interface completeness — briefing is mirrored at the publish seams, not the
 * unified service.)
 *
 * applyDeliverable: DISABLED (opt-out `appliesOnApprove`, throwing stub). A notification has no
 * apply step — there is nothing for a client to approve, and the publish side-effects (client
 * email, broadcast) live in the source publish path, not a unified apply.
 *
 * Leaf rule: this module imports ONLY shared types (briefing, client-deliverable) + the adapter
 * contract. It does NOT import `briefing-store.ts` / `briefing-cron.ts` / any route module (no
 * cycle — the input is passed in by the publish seam).
 */
import type { BriefingDraft } from '../../../../shared/types/briefing.js';
import type { ClientDeliverable } from '../../../../shared/types/client-deliverable.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type SendableResult,
} from './types.js';

/**
 * The full payload carried in `client_deliverable.payload` for a published briefing. Nothing
 * meaningful is dropped: the week the briefing covers, the hero headline, the total story count,
 * and whether it was auto-published. (The full story bodies stay in `briefing_drafts` — the
 * notification carries the read-only summary metadata, not the rich content.)
 */
export interface BriefingDeliverablePayload {
  family: 'briefing';
  /** The week the briefing covers (YYYY-MM-DD, Monday UTC). */
  weekOf: string;
  /** The hero story headline (the briefing's lead), or null when there is no hero. */
  headline: string | null;
  /** A short summary line for the notification (hero headline or story count). */
  summary: string;
  /** Total number of stories in the published briefing. */
  storyCount: number;
  /** Whether the briefing was auto-published by the cron (vs manually published by an admin). */
  autoPublished: boolean;
  [key: string]: unknown;
}

function stableSourceRef(id: string): string | null {
  return id ? `briefing:${id}` : null;
}

/** The hero story headline (the lead), or null when no story is marked isHeadline. */
function heroHeadline(draft: BriefingDraft): string | null {
  return draft.stories.find((s) => s.isHeadline)?.headline ?? null;
}

/** A short summary line: lead with the hero headline; fall back to the story count. */
function briefingSummary(draft: BriefingDraft): string {
  const hero = heroHeadline(draft);
  if (hero) return hero;
  const n = draft.stories.length;
  return `${n} stor${n !== 1 ? 'ies' : 'y'}`;
}

/** Build the typed payload JSON for a published briefing. */
function buildBriefingPayload(draft: BriefingDraft): BriefingDeliverablePayload {
  return {
    family: 'briefing',
    weekOf: draft.weekOf,
    headline: heroHeadline(draft),
    summary: briefingSummary(draft),
    storyCount: draft.stories.length,
    autoPublished: draft.autoPublished,
  };
}

export const briefingAdapter: DeliverableAdapter<BriefingDraft> = {
  type: 'briefing',

  /**
   * Guarantee 0: only a publish-ready briefing (one with at least one story) is sendable — a
   * briefing the client can actually read. An empty briefing (no stories) has nothing to notify
   * on; reject it. (Interface completeness — briefing is mirrored at the publish seams, not the
   * unified service.)
   */
  validateSendable: (draft): SendableResult => {
    if (!Array.isArray(draft.stories) || draft.stories.length === 0) {
      return { ok: false, reason: 'briefing has no stories (nothing to notify the client on)' };
    }
    return { ok: true };
  },

  /**
   * Coherent typed payload (no child items — a briefing is a single one-way NOTIFICATION; the
   * story metadata rides in payload, not per-item review rows). kind = 'notification'.
   */
  buildPayload: (draft): BuiltDeliverablePayload => ({
    title: `Weekly Briefing — ${draft.weekOf}`,
    summary: briefingSummary(draft),
    kind: 'notification',
    payload: buildBriefingPayload(draft),
    externalRef: draft.weekOf,
    // No typed child items: the stories are payload metadata, not per-item approval rows.
  }),

  // Stable per-briefing key: briefing:<id>. id is the globally-unique briefing_drafts.id.
  sourceRef: (draft) => stableSourceRef(draft.id),

  // apply disabled — a notification has NO apply step. There is nothing to approve, and the publish
  // side-effects (client email, broadcast) live in the source publish path, not a unified apply.
  // The adapter opts OUT of `appliesOnApprove`; this stub throws if any future caller wires it on.
  applyDeliverable: briefingApplyDisabledStub,
};

/**
 * The disabled-apply stub for briefing. A notification is one-way — there is nothing for a client
 * to approve, so there is no apply transition. The publish side-effects (client email, broadcast)
 * live in the SOURCE publish path (`server/routes/briefing.ts` / `server/briefing-cron.ts`), NOT a
 * unified apply. The adapter opts OUT of `appliesOnApprove`; this stub throws to make the
 * disabled-apply contract explicit if any future caller wires it on.
 */
export async function briefingApplyDisabledStub(
  _deliverable: ClientDeliverable,
): Promise<{ applied: number }> {
  throw new Error(
    'briefing apply is disabled: a notification is one-way (no client approve); the publish side-effects live in the briefing publish source path, not a unified apply',
  );
}

registerAdapter(briefingAdapter as DeliverableAdapter);
