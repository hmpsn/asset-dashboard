import type { ClientDeliverable } from '../../../shared/types/client-deliverable.js';
import { broadcastToWorkspace } from '../../broadcast.js';
import { getDeliverable, upsertDeliverable, type UpsertDeliverableInput } from '../../client-deliverables.js';
import { invalidateIntelligenceCache } from '../../intelligence/cache-invalidation.js';
import { createLogger } from '../../logger.js';
import { getDeliverableTransitions, validateTransition } from '../../state-machines.js';
import { WS_EVENTS } from '../../ws-events.js';

const log = createLogger('deliverable-apply-state');

function toUpsert(
  d: ClientDeliverable,
  patch: Partial<UpsertDeliverableInput>,
): UpsertDeliverableInput {
  return {
    id: d.id,
    workspaceId: d.workspaceId,
    type: d.type,
    kind: d.kind,
    status: d.status,
    title: d.title,
    summary: d.summary,
    payload: d.payload,
    note: d.note,
    clientResponseNote: d.clientResponseNote,
    parentDeliverableId: d.parentDeliverableId,
    externalRef: d.externalRef,
    sentAt: d.sentAt,
    decidedAt: d.decidedAt,
    dueAt: d.dueAt,
    appliedAt: d.appliedAt,
    generatedAt: d.generatedAt,
    source: d.source,
    sourceRef: d.sourceRef,
    ...patch,
  };
}

/**
 * R3b mirror-flip: move a unified deliverable to `applied` after the source artifact has
 * already performed the external/provider write. This intentionally avoids importing
 * send-to-client or the adapter registry so provider jobs can mark mirrors applied
 * without creating adapter cycles.
 */
export function markDeliverableApplied(
  workspaceId: string,
  deliverableId: string,
): ClientDeliverable | null {
  const current = getDeliverable(deliverableId);
  if (!current || current.workspaceId !== workspaceId) return null;
  if (current.status === 'applied') return current;
  validateTransition(
    'deliverable',
    getDeliverableTransitions(current.type),
    current.status,
    'applied',
  );
  const applied = upsertDeliverable(
    toUpsert(current, { status: 'applied', appliedAt: new Date().toISOString() }),
  );
  broadcastToWorkspace(workspaceId, WS_EVENTS.DELIVERABLE_UPDATED, {
    deliverableId: applied.id,
    type: applied.type,
    status: applied.status,
  });
  invalidateIntelligenceCache(workspaceId);
  log.debug({ workspaceId, deliverableId: applied.id }, 'deliverable mirror-flipped to applied');
  return applied;
}
