/**
 * client-deliverables — the store for the unified send-to-client spine (Phase 0, dark).
 *
 * The ONLY writer of the `client_deliverable` / `client_deliverable_item` tables
 * (enforced by the pr-check rule `no-direct-insert-to-client_deliverable-outside-store`).
 * Mirrors the migration-111/112 row shapes exactly (CLAUDE.md DB column + mapper
 * lockstep): row interface + rowToDeliverable + upsertDeliverable + getDeliverable +
 * listDeliverables + Zod payload schema, all here.
 *
 * Template: server/opportunity-events.ts (lazy createStmtCache, rowToX mapper,
 * INSERT ... ON CONFLICT dedup, parseJsonSafe payloads, crypto ids, finite guards).
 *
 * IMPORTANT (audit lesson): this module must NOT value-import route files or
 * recommendations.ts — that risks the circular-import type-inference ripple. It is a
 * leaf store: it imports only db, the stmt cache, json-validation, and the shared types.
 *
 * Dedup-on-resend: rows with a non-null `source_ref` collapse onto one row per
 * (workspace_id, type, source_ref) via the partial unique index `uq_cd_ws_type_sourceref`.
 * Rows with a null `source_ref` are always distinct inserts. See design §4.5.
 */
import crypto from 'crypto';
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import { createLogger } from './logger.js';
import {
  DELIVERABLE_KINDS,
  DELIVERABLE_STATUSES,
  DELIVERABLE_TYPES,
  type ClientDeliverable,
  type ClientDeliverableItem,
  type DeliverableKind,
  type DeliverableStatus,
  type DeliverableType,
} from '../shared/types/client-deliverable.js';

const log = createLogger('client-deliverables');

// ── Row shapes (mirror migrations 111/112 exactly) ──

interface ClientDeliverableRow {
  id: string;
  workspace_id: string;
  external_ref: string | null;
  type: string;
  kind: string;
  status: string;
  title: string;
  summary: string | null;
  payload: string;
  note: string | null;
  client_response_note: string | null;
  parent_deliverable_id: string | null;
  sent_at: string | null;
  decided_at: string | null;
  due_at: string | null;
  applied_at: string | null;
  generated_at: string | null;
  source: string | null;
  source_ref: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientDeliverableItemRow {
  id: string;
  deliverable_id: string;
  status: string;
  target_ref: string | null;
  collection_id: string | null;
  field: string | null;
  current_value: string | null;
  proposed_value: string | null;
  client_value: string | null;
  client_note: string | null;
  applyable: number;
  item_payload: string | null;
  sort_order: number;
  created_at: string;
}

// ── Zod payload schema ──
// Phase 0: the per-type discriminated union is not yet enumerated (each Phase-1
// adapter registers its typed schema). A permissive object schema keeps the
// build→store→parse round-trip assert-no-fallback green (the keywordStrategy.pageMap
// scar) while leaving the discriminator (`type`) to drive a typed union in Phase 1.
export const deliverablePayloadSchema = z.record(z.unknown());

const itemPayloadSchema = z.record(z.unknown());

// ── Enum coercion (defensive — DB stores free TEXT) ──

function coerceType(raw: string): DeliverableType {
  return (DELIVERABLE_TYPES as readonly string[]).includes(raw) ? (raw as DeliverableType) : 'seo_edit';
}
function coerceKind(raw: string): DeliverableKind {
  return (DELIVERABLE_KINDS as readonly string[]).includes(raw) ? (raw as DeliverableKind) : 'decision';
}
function coerceStatus(raw: string): DeliverableStatus {
  return (DELIVERABLE_STATUSES as readonly string[]).includes(raw) ? (raw as DeliverableStatus) : 'draft';
}

// ── Mappers ──

export function rowToDeliverableItem(r: ClientDeliverableItemRow): ClientDeliverableItem {
  return {
    id: r.id,
    deliverableId: r.deliverable_id,
    status: r.status,
    targetRef: r.target_ref,
    collectionId: r.collection_id,
    field: r.field,
    currentValue: r.current_value,
    proposedValue: r.proposed_value,
    clientValue: r.client_value,
    clientNote: r.client_note,
    applyable: r.applyable === 1,
    itemPayload:
      r.item_payload != null
        ? parseJsonSafe<Record<string, unknown>, null>(r.item_payload, itemPayloadSchema, null, {
            field: 'item_payload',
            table: 'client_deliverable_item',
          })
        : null,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  };
}

export function rowToDeliverable(r: ClientDeliverableRow, items?: ClientDeliverableItemRow[]): ClientDeliverable {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    externalRef: r.external_ref,
    type: coerceType(r.type),
    kind: coerceKind(r.kind),
    status: coerceStatus(r.status),
    title: r.title,
    summary: r.summary,
    // Round-trip assert-no-fallback: payload is parsed with the permissive schema and
    // an empty-object fallback. A drifted variant would surface as {} in the round-trip test.
    payload: parseJsonSafe<Record<string, unknown>, Record<string, unknown>>(
      r.payload,
      deliverablePayloadSchema,
      {},
      { workspaceId: r.workspace_id, field: 'payload', table: 'client_deliverable' },
    ),
    note: r.note,
    clientResponseNote: r.client_response_note,
    parentDeliverableId: r.parent_deliverable_id,
    sentAt: r.sent_at,
    decidedAt: r.decided_at,
    dueAt: r.due_at,
    appliedAt: r.applied_at,
    generatedAt: r.generated_at,
    source: r.source,
    sourceRef: r.source_ref,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    ...(items !== undefined ? { items: items.map(rowToDeliverableItem) } : {}),
  };
}

// ── Prepared statements (lazy — created after migrations run) ──

const stmts = createStmtCache(() => ({
  // Dedup-on-resend: a second send with the same (workspace_id, type, source_ref)
  // UPDATEs the existing row in place (the partial unique index drives the conflict
  // target). Rows with source_ref NULL never conflict → always a fresh insert.
  insert: db.prepare(`
    INSERT INTO client_deliverable (
      id, workspace_id, external_ref, type, kind, status, title, summary, payload,
      note, client_response_note, parent_deliverable_id, sent_at, decided_at, due_at,
      applied_at, generated_at, source, source_ref, created_at, updated_at
    ) VALUES (
      @id, @workspace_id, @external_ref, @type, @kind, @status, @title, @summary, @payload,
      @note, @client_response_note, @parent_deliverable_id, @sent_at, @decided_at, @due_at,
      @applied_at, @generated_at, @source, @source_ref, @created_at, @updated_at
    )
    ON CONFLICT(workspace_id, type, source_ref) WHERE source_ref IS NOT NULL DO UPDATE SET
      external_ref = excluded.external_ref,
      kind = excluded.kind,
      status = excluded.status,
      title = excluded.title,
      summary = excluded.summary,
      payload = excluded.payload,
      note = excluded.note,
      client_response_note = excluded.client_response_note,
      parent_deliverable_id = excluded.parent_deliverable_id,
      sent_at = excluded.sent_at,
      decided_at = excluded.decided_at,
      due_at = excluded.due_at,
      applied_at = excluded.applied_at,
      generated_at = excluded.generated_at,
      source = excluded.source,
      updated_at = excluded.updated_at
  `),
  // Resolve the canonical row id for a (workspace_id, type, source_ref) so the caller
  // can read back the deduped row after an UPDATE-on-conflict (excluded.id is not kept).
  findBySourceRef: db.prepare(
    'SELECT id FROM client_deliverable WHERE workspace_id = ? AND type = ? AND source_ref = ?',
  ),
  insertItem: db.prepare(`
    INSERT INTO client_deliverable_item (
      id, deliverable_id, status, target_ref, collection_id, field, current_value,
      proposed_value, client_value, client_note, applyable, item_payload, sort_order, created_at
    ) VALUES (
      @id, @deliverable_id, @status, @target_ref, @collection_id, @field, @current_value,
      @proposed_value, @client_value, @client_note, @applyable, @item_payload, @sort_order, @created_at
    )
  `),
  deleteItems: db.prepare('DELETE FROM client_deliverable_item WHERE deliverable_id = ?'),
  getById: db.prepare('SELECT * FROM client_deliverable WHERE id = ?'),
  getItems: db.prepare(
    'SELECT * FROM client_deliverable_item WHERE deliverable_id = ? ORDER BY sort_order ASC, created_at ASC, id ASC',
  ),
  // Batched item read for listDeliverables: every item for the whole workspace in one query
  // (joined back to its parent via the indexed deliverable_id), avoiding an N+1 per-row fetch.
  // Ordered so the in-memory group-by preserves the same per-deliverable order as getItems.
  getItemsByWs: db.prepare(`
    SELECT i.* FROM client_deliverable_item i
    JOIN client_deliverable d ON d.id = i.deliverable_id
    WHERE d.workspace_id = ?
    ORDER BY i.deliverable_id ASC, i.sort_order ASC, i.created_at ASC, i.id ASC
  `),
  listByWs: db.prepare(
    'SELECT * FROM client_deliverable WHERE workspace_id = ? ORDER BY COALESCE(sent_at, created_at) DESC, id DESC',
  ),
}));

// ── Input + write path ──

export interface UpsertDeliverableItemInput {
  id?: string;
  status: string;
  targetRef?: string | null;
  collectionId?: string | null;
  field?: string | null;
  currentValue?: string | null;
  proposedValue?: string | null;
  clientValue?: string | null;
  clientNote?: string | null;
  applyable?: boolean;
  itemPayload?: Record<string, unknown> | null;
  sortOrder?: number;
}

export interface UpsertDeliverableInput {
  id?: string;
  workspaceId: string;
  externalRef?: string | null;
  type: DeliverableType;
  kind: DeliverableKind;
  status: DeliverableStatus;
  title: string;
  summary?: string | null;
  payload: Record<string, unknown>;
  note?: string | null;
  clientResponseNote?: string | null;
  parentDeliverableId?: string | null;
  sentAt?: string | null;
  decidedAt?: string | null;
  dueAt?: string | null;
  appliedAt?: string | null;
  generatedAt?: string | null;
  source?: string | null;
  /** Stable dedup key. When set, a resend collapses onto the existing (ws,type,sourceRef) row. */
  sourceRef?: string | null;
  /** Child items (kind='batch'). When provided, they fully replace the existing item set. */
  items?: UpsertDeliverableItemInput[];
}

function deliverableId(): string {
  return `cd_${crypto.randomBytes(12).toString('hex')}`;
}
function itemId(): string {
  return `cdi_${crypto.randomBytes(12).toString('hex')}`;
}

/**
 * Insert or dedup-update a deliverable (+ its items). Returns the persisted row read
 * back through the mapper. The whole write runs inside a single transaction so a row
 * and its items can never be partially written. The Webflow apply call (Phase 1) is a
 * separate transaction outside this one (CLAUDE.md external-call guard).
 */
export function upsertDeliverable(input: UpsertDeliverableInput): ClientDeliverable {
  const now = new Date().toISOString();
  const id = input.id ?? deliverableId();
  const sourceRef = input.sourceRef ?? null;

  const persist = db.transaction((): string => {
    stmts().insert.run({
      id,
      workspace_id: input.workspaceId,
      external_ref: input.externalRef ?? null,
      type: input.type,
      kind: input.kind,
      status: input.status,
      title: input.title,
      summary: input.summary ?? null,
      payload: JSON.stringify(input.payload ?? {}),
      note: input.note ?? null,
      client_response_note: input.clientResponseNote ?? null,
      parent_deliverable_id: input.parentDeliverableId ?? null,
      sent_at: input.sentAt ?? null,
      decided_at: input.decidedAt ?? null,
      due_at: input.dueAt ?? null,
      applied_at: input.appliedAt ?? null,
      generated_at: input.generatedAt ?? null,
      source: input.source ?? null,
      source_ref: sourceRef,
      created_at: now,
      updated_at: now,
    });

    // Resolve the canonical id: on a dedup UPDATE the row keeps its original id, not @id.
    let resolvedId = id;
    if (sourceRef != null) {
      const row = stmts().findBySourceRef.get(input.workspaceId, input.type, sourceRef) as
        | { id: string }
        | undefined;
      if (row) resolvedId = row.id;
    }

    if (input.items !== undefined) {
      // Items fully replace the existing set (delete-then-reinsert). The parent row's
      // sort order is honored from the input; created_at is stamped fresh.
      stmts().deleteItems.run(resolvedId);
      input.items.forEach((item, index) => {
        stmts().insertItem.run({
          id: item.id ?? itemId(),
          deliverable_id: resolvedId,
          status: item.status,
          target_ref: item.targetRef ?? null,
          collection_id: item.collectionId ?? null,
          field: item.field ?? null,
          current_value: item.currentValue ?? null,
          proposed_value: item.proposedValue ?? null,
          client_value: item.clientValue ?? null,
          client_note: item.clientNote ?? null,
          applyable: item.applyable ? 1 : 0,
          item_payload: item.itemPayload != null ? JSON.stringify(item.itemPayload) : null,
          sort_order: Number.isFinite(item.sortOrder) ? (item.sortOrder as number) : index,
          created_at: now,
        });
      });
    }
    return resolvedId;
  });

  const resolvedId = persist();
  log.debug(
    { workspaceId: input.workspaceId, type: input.type, sourceRef, id: resolvedId },
    'client deliverable upserted',
  );
  const result = getDeliverable(resolvedId);
  if (!result) {
    // Should be impossible (we just wrote it inside a txn) — fail loud rather than
    // returning a fabricated shape.
    throw new Error(`client_deliverable ${resolvedId} vanished immediately after upsert`);
  }
  return result;
}

// ── Reads ──

export function getDeliverable(id: string): ClientDeliverable | null {
  const row = stmts().getById.get(id) as ClientDeliverableRow | undefined;
  if (!row) return null;
  const items = stmts().getItems.all(id) as ClientDeliverableItemRow[];
  return rowToDeliverable(row, items);
}

/**
 * Resolve the existing deduped row (if any) for a (workspaceId, type, sourceRef) natural
 * key, fully mapped (+ items). Used by the send-path guard to read the CURRENT status
 * before a resend so a re-send onto a terminal row throws instead of silently reverting
 * via the ON CONFLICT DO UPDATE (design §4.5). Returns null when no row exists yet.
 */
export function findBySourceRef(
  workspaceId: string,
  type: DeliverableType,
  sourceRef: string,
): ClientDeliverable | null {
  const row = stmts().findBySourceRef.get(workspaceId, type, sourceRef) as { id: string } | undefined;
  if (!row) return null;
  return getDeliverable(row.id);
}

export function listDeliverables(workspaceId: string): ClientDeliverable[] {
  const rows = stmts().listByWs.all(workspaceId) as ClientDeliverableRow[];
  // Attach each physical deliverable's child items[] (mirrors getDeliverable). Batched: one
  // workspace-wide item read grouped by deliverable_id in memory rather than an N+1 per-row
  // fetch (R1, design §13-D1). Approval/SEO/schema substance lives in these typed _item rows;
  // the client_action family (redirect/internal_link/aeo_change) carries its sub-items in
  // payload.items instead, so those deliverables get an empty items[] here — that is correct.
  const itemRows = stmts().getItemsByWs.all(workspaceId) as ClientDeliverableItemRow[];
  const itemsByDeliverable = new Map<string, ClientDeliverableItemRow[]>();
  for (const ir of itemRows) {
    const bucket = itemsByDeliverable.get(ir.deliverable_id);
    if (bucket) bucket.push(ir);
    else itemsByDeliverable.set(ir.deliverable_id, [ir]);
  }
  return rows.map((r) => rowToDeliverable(r, itemsByDeliverable.get(r.id) ?? []));
}
