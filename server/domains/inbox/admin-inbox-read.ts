/**
 * admin-inbox-read — the admin "Client Deliverables" pane read assembly (PR-2b, DARK).
 *
 * Backs the admin `GET /api/deliverables/:workspaceId` route (server/routes/deliverables.ts). Takes
 * the FULL unified deliverable list (listAllWorkspaceDeliverables — every status, physical +
 * projected) and annotates each row with the OPERATOR STATUS AXIS + a derived staleness signal so
 * the operator gets one pane spanning all five "send to client" types (audit §E1/E2/E6/E7; §6).
 *
 * Status axis (design §6) collapses the full status vocabulary into four operator buckets:
 *   • awaiting_client    — sent, no response (the nudge queue)
 *   • changes_requested  — client asked for changes (incl. `partial`)
 *   • approved           — client approved, ready to apply (the "to apply" bucket)
 *   • other              — declined / draft / terminal / order-production internals (E2 completeness)
 *
 * `stale` is derived: an `awaiting_client` item whose `sentAt` is older than STALE_AWAITING_DAYS.
 * `ageDays` is the whole-day age from `sentAt`. This is a PURE read — writes nothing, no flag dep.
 */
import { listAllWorkspaceDeliverables } from './unified-inbox-read.js';
import {
  STALE_AWAITING_DAYS,
  type AdminDeliverableView,
  type DeliverableStatusAxis,
} from '../../../shared/types/admin-deliverable-view.js';
import type { ClientDeliverable, DeliverableStatus } from '../../../shared/types/client-deliverable.js';
import { createLogger } from '../../logger.js';

const log = createLogger('admin-inbox-read');

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Map a deliverable status onto the operator axis bucket (design §6). */
export function statusAxisFor(status: DeliverableStatus): DeliverableStatusAxis {
  switch (status) {
    case 'awaiting_client':
      return 'awaiting_client';
    case 'changes_requested':
    case 'partial':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    default:
      // declined / draft / applied / expired / cancelled / ordered / in_progress / completed
      return 'other';
  }
}

/** Whole-day age from `sentAt` (null when never sent or unparseable). */
export function ageDaysFrom(sentAt: string | null, now: number = Date.now()): number | null {
  if (!sentAt) return null;
  const sent = new Date(sentAt).getTime();
  if (Number.isNaN(sent)) return null;
  return Math.max(0, Math.floor((now - sent) / MS_PER_DAY));
}

/** Annotate one deliverable with the operator axis + staleness. */
export function annotateForAdmin(d: ClientDeliverable, now: number = Date.now()): AdminDeliverableView {
  const statusAxis = statusAxisFor(d.status);
  const ageDays = ageDaysFrom(d.sentAt, now);
  // Stale = awaiting a client response for longer than the threshold (the nudge candidates).
  const stale = statusAxis === 'awaiting_client' && ageDays != null && ageDays >= STALE_AWAITING_DAYS;
  return { ...d, statusAxis, ageDays, stale };
}

/**
 * The admin "Client Deliverables" view: every deliverable in the workspace (all statuses, physical
 * + projected), each annotated with the status axis + stale flag, newest-sent first (the order is
 * inherited from the underlying assembly). Pure read — exercised with seeded rows in tests.
 */
export function listAdminDeliverables(workspaceId: string): AdminDeliverableView[] {
  const now = Date.now();
  const annotated = listAllWorkspaceDeliverables(workspaceId).map((d) => annotateForAdmin(d, now));
  log.debug(
    {
      workspaceId,
      total: annotated.length,
      stale: annotated.filter((d) => d.stale).length,
    },
    'assembled admin client-deliverables view',
  );
  return annotated;
}
