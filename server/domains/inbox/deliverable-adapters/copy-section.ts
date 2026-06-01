/**
 * copy_section deliverable adapter (PR-1d, DARK — the FIRST PROJECTED type).
 *
 * copy_section is the FIRST D-hybrid / PROJECTED deliverable type. Unlike the physically
 * migrated families (PR-1a approval_batch, PR-1b client_action, PR-1c schema_plan, which
 * dual-write into the `client_deliverable` tables), copy_section's rich hierarchy
 * (blueprint → entry → section, + per-section append-only `client_suggestions`, `version`,
 * `steering_history`, `quality_flags`, + the sibling `copy_metadata`) STAYS in its source
 * tables (`copy_sections`, `copy_metadata`). This adapter exposes a copy ENTRY through the
 * unified `ClientDeliverable` interface at READ time via `projectFromSource()` (design §13-D1),
 * consumed by the Phase-2 inbox/rollup. There is NO dual-write, NO backfill, NO send-seam hook,
 * and NO source-file edit for a projected type — projection is read-time only.
 *
 * THE UNIT: one `ClientDeliverable` per copy ENTRY, NOT per section. The entry is what the
 * client reviews (`src/components/client/ClientCopyReview.tsx` groups blueprint → entries →
 * sections; the entry-level "send to client" —
 * `server/routes/copy-pipeline.ts:/:blueprintId/:entryId/send-to-client` — bulk-transitions ALL
 * draft sections of an entry to client_review at once). The per-section detail rides in
 * `payload.sections[]`; nothing from the source is dropped.
 *
 * kind = 'review' (design §4.1): an entry's copy is a single review artifact (its sections are
 * reviewed together), not a per-item approval batch (kind 'batch') and not an inline decision.
 *
 * sourceRef = `copy:<entryId>` — STABLE per-entry. `entryId` is a globally-unique blueprint-entry
 * id (`blueprint_entries.id`), so it is the stable per-entry natural key; a re-projection of the
 * same entry maps onto the same deliverable identity (design §4.5).
 *
 * STATUS MAP (copy → canonical, design §13-D1):
 *   client_review      → awaiting_client     (sent, waiting on the client)
 *   revision_requested → changes_requested   (client asked for edits)
 *   approved           → approved            (client approved — TERMINAL, see below)
 *   draft              → draft               (generated, not yet sent)
 *   pending            → draft               (not yet generated; no copy to review — pre-send)
 * The per-section status is mapped 1:1 in `payload.sections[].status`; the ENTRY-LEVEL
 * deliverable status is the rollup (mirrors `getEntryCopyStatus().overallStatus`), then mapped.
 *
 * State machine: copy_section has a per-type override in `state-machines.ts`
 * (`getDeliverableTransitions('copy_section')`): `approved` is TERMINAL (no →applied — copy's
 * approve side-effect is voice-sample harvest, modeled as a no-op apply) and
 * `changes_requested` routes back to `draft`. Hence `applyDeliverable` is a DISABLED stub.
 *
 * Required-but-not-the-real-path methods (`validateSendable` / `buildPayload` / `sourceRef` /
 * `applyDeliverable`): the `DeliverableAdapter` interface requires them, so we provide coherent
 * implementations. BUT copy is SENT via the bespoke copy-pipeline route (the entry-level
 * send-to-client, grandfathered in pr-check's `unified-send-to-client-bespoke-route`), NOT via
 * the unified `sendToClient()` service — these methods are for interface completeness and the
 * projected read path, not a unified-send dual-write. `buildPayload` reuses the same projection
 * builder as `projectFromSource` so the two never drift.
 *
 * Leaf rule: this module imports ONLY shared types (copy-pipeline, client-deliverable) + the
 * adapter contract. It does NOT import `copy-review.ts` or any source/route module (no cycle,
 * and it stays read-only — the projection input is passed in by the Phase-2 reader).
 */
import type {
  CopySection,
  CopyMetadata,
  CopySectionStatus,
} from '../../../../shared/types/copy-pipeline.js';
import type {
  ClientDeliverable,
  DeliverableStatus,
} from '../../../../shared/types/client-deliverable.js';
import {
  registerAdapter,
  type BuiltDeliverablePayload,
  type DeliverableAdapter,
  type SendableResult,
} from './types.js';

/**
 * The projection input for copy_section: one copy ENTRY with all of its sections (+ the sibling
 * metadata row). The Phase-2 reader assembles this from `getSectionsForEntry()` +
 * `getMetadata()` (server/copy-review.ts) and passes it in — keeping this adapter a leaf that
 * never reads the source tables itself. `entryName` is optional (used only for the title);
 * `generatedAt` is the entry's most-recent section update timestamp, carried through.
 */
export interface CopyEntryProjectionInput {
  workspaceId: string;
  blueprintId: string;
  entryId: string;
  /** Human-friendly entry name (blueprint_entries.name) for the deliverable title. */
  entryName?: string | null;
  /** All sections of this entry (copy_sections rows for entry_id), as mapped CopySection. */
  sections: CopySection[];
  /** The sibling copy_metadata row for this entry (one per entry), or null if none. */
  metadata: CopyMetadata | null;
}

/**
 * copy status → canonical DeliverableStatus (design §13-D1). `pending` (section not yet
 * generated — there is no copy) folds to `draft`: it is pre-send and not a distinct unified
 * state. All five source statuses are covered so a drifted value can never silently fall through.
 */
export function mapCopyStatusToDeliverableStatus(status: CopySectionStatus): DeliverableStatus {
  switch (status) {
    case 'client_review':
      return 'awaiting_client';
    case 'revision_requested':
      return 'changes_requested';
    case 'approved':
      return 'approved';
    case 'draft':
      return 'draft';
    case 'pending':
      return 'draft';
    default: {
      // Exhaustiveness guard: a new CopySectionStatus must extend this map explicitly.
      const _exhaustive: never = status;
      void _exhaustive;
      return 'draft';
    }
  }
}

/**
 * Derive the ENTRY-LEVEL overall copy status from its sections — mirrors the rollup logic in
 * `server/copy-review.ts:getEntryCopyStatus()` (kept in lockstep so the projected deliverable
 * status matches what the operator/client UI shows). Then `mapCopyStatusToDeliverableStatus`
 * maps it to canonical. No sections → 'draft' (nothing to review yet).
 */
export function deriveEntryOverallStatus(sections: CopySection[]): CopySectionStatus {
  const total = sections.length;
  if (total === 0) return 'pending';
  const approved = sections.filter((s) => s.status === 'approved').length;
  const revision = sections.filter((s) => s.status === 'revision_requested').length;
  const clientReview = sections.filter((s) => s.status === 'client_review').length;
  const pending = sections.filter((s) => s.status === 'pending').length;
  const draft = sections.filter((s) => s.status === 'draft').length;

  if (approved === total) return 'approved';
  if (revision > 0) return 'revision_requested';
  if (clientReview > 0 && pending === 0 && draft === 0) return 'client_review';
  if (draft > 0 || approved > 0 || clientReview > 0) return 'draft';
  return 'pending';
}

/**
 * The faithful per-section shape carried in `payload.sections[]`. Every field of the source
 * `copy_sections` row is preserved (id, sectionPlanItemId, version, generatedCopy, the two AI
 * annotation fields, the append-only `clientSuggestions[]` / `qualityFlags[]` / `steeringHistory[]`,
 * and timestamps). `status` is the RAW copy status; `deliverableStatus` is the canonical mapping
 * alongside it, so a reader gets both without re-deriving. Nothing from the source is dropped.
 */
export interface ProjectedCopySectionPayload {
  id: string;
  sectionPlanItemId: string;
  version: number;
  /** Raw copy_sections.status (one of CopySectionStatus). */
  status: CopySectionStatus;
  /** Canonical mapping of `status` (design §13-D1) carried alongside the raw value. */
  deliverableStatus: DeliverableStatus;
  generatedCopy: string | null;
  aiAnnotation: string | null;
  aiReasoning: string | null;
  clientSuggestions: CopySection['clientSuggestions'];
  qualityFlags: CopySection['qualityFlags'];
  steeringHistory: CopySection['steeringHistory'];
  createdAt: string;
  updatedAt: string;
}

/** The full payload carried in `client_deliverable.payload` for a projected copy entry. */
export interface ProjectedCopyEntryPayload {
  family: 'copy_section';
  blueprintId: string;
  entryId: string;
  /** Every section, faithfully — nothing dropped (design §13-D1). */
  sections: ProjectedCopySectionPayload[];
  /** The sibling copy_metadata row (SEO/OG fields + its own steering history), or null. */
  copyMetadata: CopyMetadata | null;
  [key: string]: unknown;
}

function stableSourceRef(entryId: string): string | null {
  return entryId ? `copy:${entryId}` : null;
}

/** Map one source CopySection → its faithful projected payload shape (no data loss). */
function projectSection(section: CopySection): ProjectedCopySectionPayload {
  return {
    id: section.id,
    sectionPlanItemId: section.sectionPlanItemId,
    version: section.version,
    status: section.status,
    deliverableStatus: mapCopyStatusToDeliverableStatus(section.status),
    generatedCopy: section.generatedCopy,
    aiAnnotation: section.aiAnnotation,
    aiReasoning: section.aiReasoning,
    // Append-only review artifacts — carried through verbatim (no fallback substitution).
    clientSuggestions: section.clientSuggestions,
    qualityFlags: section.qualityFlags,
    steeringHistory: section.steeringHistory,
    createdAt: section.createdAt,
    updatedAt: section.updatedAt,
  };
}

/** Build the typed payload JSON for a copy entry projection (shared by build + project). */
function buildEntryPayload(input: CopyEntryProjectionInput): ProjectedCopyEntryPayload {
  return {
    family: 'copy_section',
    blueprintId: input.blueprintId,
    entryId: input.entryId,
    sections: input.sections.map(projectSection),
    copyMetadata: input.metadata,
  };
}

/** Title + summary for the entry (a single human-readable review artifact). */
function entryTitle(input: CopyEntryProjectionInput): string {
  return input.entryName ? `Copy Review: ${input.entryName}` : 'Copy Review';
}
function entrySummary(input: CopyEntryProjectionInput): string {
  const n = input.sections.length;
  const sendable = input.sections.filter((s) => s.status === 'client_review' || s.status === 'draft').length;
  return `${n} section${n !== 1 ? 's' : ''}${sendable ? `, ${sendable} in review` : ''}`;
}

/**
 * The most-recent section update across the entry — used as `generatedAt` (the copy's own
 * timestamp, carried through, not "now"). Null when the entry has no sections.
 */
function entryGeneratedAt(input: CopyEntryProjectionInput): string | null {
  let latest: string | null = null;
  for (const s of input.sections) {
    if (latest === null || s.updatedAt > latest) latest = s.updatedAt;
  }
  return latest;
}

export const copySectionAdapter: DeliverableAdapter<CopyEntryProjectionInput, CopyEntryProjectionInput> = {
  type: 'copy_section',

  /**
   * Guarantee 0: an entry with no SENDABLE section (no draft/client_review section) is not a
   * reviewable entry — there is nothing to put in front of the client. The entry-level
   * copy-pipeline send only transitions DRAFT sections (route: send-to-client), so an entry of
   * only pending/approved/revision sections has nothing fresh to send. (This is interface
   * completeness — copy actually sends via the bespoke route, not the unified service.)
   */
  validateSendable: (input): SendableResult => {
    const sendable = input.sections.some((s) => s.status === 'draft' || s.status === 'client_review');
    if (!sendable) {
      return { ok: false, reason: 'copy entry has no sendable sections (no draft or client_review section to review)' };
    }
    return { ok: true };
  },

  /**
   * Coherent typed payload (+ NO child items — the per-section detail rides in payload.sections[],
   * not as kind='batch' deliverable_items, because copy is a single review artifact per entry).
   * Reuses the same projection builder as projectFromSource so build and project never drift.
   * NOTE: copy is SENT via the copy-pipeline route, not the unified service — this exists for
   * interface completeness + the projected read path (design §13-D1), not a dual-write.
   */
  buildPayload: (input): BuiltDeliverablePayload => ({
    title: entryTitle(input),
    summary: entrySummary(input),
    kind: 'review',
    payload: buildEntryPayload(input),
    externalRef: input.entryId,
    // No typed child items: the per-section detail is in payload.sections[] (review artifact).
  }),

  // Stable per-entry key: copy:<entryId>. entryId is a globally-unique blueprint-entry id.
  sourceRef: (input) => stableSourceRef(input.entryId),

  // apply disabled — copy approve is TERMINAL (state-machines.ts copy_section override: approved
  // has NO outbound transition). The approve side-effect is voice-sample harvest, handled in the
  // source path (copy-review.ts), NOT a unified apply. Stub throws if ever wired on.
  applyDeliverable: copySectionApplyDisabledStub,

  /**
   * THE method for a projected type. Expose a copy ENTRY through the unified ClientDeliverable
   * interface at read time (design §13-D1). The deliverable id + workspace/timestamps come from
   * the source entry; the per-section detail (version, clientSuggestions[], qualityFlags[],
   * steeringHistory[]) and the sibling copy_metadata ride in `payload`. The entry-level status is
   * the rollup of its section statuses, mapped to canonical. This is a PURE read projection: it
   * writes nothing and is normally consumed only by the Phase-2 inbox/rollup.
   */
  projectFromSource: (input): ClientDeliverable => {
    const overall = deriveEntryOverallStatus(input.sections);
    const status = mapCopyStatusToDeliverableStatus(overall);
    const generatedAt = entryGeneratedAt(input);
    return {
      // The deliverable identity for a projected entry is the entry itself — there is no
      // physical client_deliverable row (D-hybrid). Use the stable copy:<entryId> as the id so a
      // reader can key on it consistently; sourceRef carries the same natural key.
      id: `copy:${input.entryId}`,
      workspaceId: input.workspaceId,
      externalRef: input.entryId,
      type: 'copy_section',
      kind: 'review',
      status,
      title: entryTitle(input),
      summary: entrySummary(input),
      payload: buildEntryPayload(input),
      note: null,
      clientResponseNote: null,
      parentDeliverableId: null,
      // Projected at read time — no physical send/decide/apply lifecycle on a client_deliverable
      // row. The real lifecycle lives in copy_sections.status (carried per-section in payload).
      sentAt: overall === 'client_review' || overall === 'revision_requested' || overall === 'approved' ? generatedAt : null,
      decidedAt: null,
      dueAt: null,
      appliedAt: null,
      generatedAt,
      source: 'copy_pipeline',
      sourceRef: stableSourceRef(input.entryId),
      createdAt: generatedAt ?? new Date(0).toISOString(),
      updatedAt: generatedAt ?? new Date(0).toISOString(),
    };
  },
};

/**
 * The disabled-apply stub for copy_section. copy approve is TERMINAL (state-machines.ts
 * copy_section override: `approved: []`). The approve side-effect — harvesting the approved copy
 * as a voice sample — happens in the SOURCE path (`server/copy-review.ts:updateSectionStatus`),
 * NOT via a unified apply. The adapter opts OUT of `appliesOnApprove`; this stub throws to make
 * the disabled-apply contract explicit if any future caller wires it on.
 */
export async function copySectionApplyDisabledStub(_deliverable: ClientDeliverable): Promise<{ applied: number }> {
  throw new Error(
    'copy_section apply is disabled (D-apply): copy approve is TERMINAL with no apply step; the approve side-effect (voice-sample harvest) lives in the copy-review source path, not a unified apply',
  );
}

registerAdapter(copySectionAdapter as DeliverableAdapter);
