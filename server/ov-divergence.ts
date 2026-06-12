/**
 * ov-divergence — historical shadow-log store for the Opportunity Value re-architecture (PR4).
 *
 * During the rollout we recorded the divergence between the LEGACY ranked #1 and the
 * OPPORTUNITY-VALUE ranked #1 so the owner could review before the cutover. Runtime
 * recommendation generation no longer writes new rows now that the legacy scorer has
 * been removed; this module remains to read historical rows and for direct tests of the
 * shadow-log shape. Zero client-facing effect — admin/internal read only.
 *
 * NOTE: `sortRecommendations` is injected into `recordOvDivergence` (dependency
 * injection) rather than imported from `./recommendations.js`. recommendations.ts
 * imports THIS module, so a value-import back would form a circular dependency —
 * which perturbs whole-program type inference. Only the Recommendation TYPE is
 * imported (erased at runtime, no cycle).
 */
import crypto from 'crypto';
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import type { Recommendation, RecPriority } from '../shared/types/recommendations.js';

const log = createLogger('ov-divergence');

export interface Top3Entry {
  id: string;
  title: string;
  source: string;
  impactScore: number;
  /** SEO Gen-Quality P4 (G1): the priority TIER this entry carries in the ranked clone.
   *  For the legacy clone it is the legacy tier; for the OV clone it is the OV-derived tier
   *  (deriveOvTier, injected). Makes the shadow log + panel see CROSS-TIER reorders, not just
   *  within-tier impactScore moves. Optional so pre-P4 rows still parse. */
  priority?: RecPriority;
}

export interface PerRecDelta {
  id: string;
  legacy: number;
  ov: number | null;
}

export interface OvDivergence {
  id: string;
  workspaceId: string;
  legacyTopRecId: string | null;
  ovTopRecId: string | null;
  agree: boolean;
  ovTopConfidence: number | null;
  ovTopGroundedSpine: string | null;
  ovTopEmv: number | null;
  invariantHeld: boolean;
  legacyTop3: Top3Entry[];
  ovTop3: Top3Entry[];
  perRecDelta: PerRecDelta[];
  computedAt: string;
}

interface OvDivergenceRow {
  id: string;
  workspace_id: string;
  legacy_top_rec_id: string | null;
  ov_top_rec_id: string | null;
  agree: number;
  ov_top_confidence: number | null;
  ov_top_grounded_spine: string | null;
  ov_top_emv: number | null;
  invariant_held: number;
  legacy_top3: string | null;
  ov_top3: string | null;
  per_rec_delta: string | null;
  computed_at: string;
}

const top3EntrySchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  impactScore: z.number(),
  // P4 (G1): optional so legacy rows (written before the field existed) still parse.
  priority: z.enum(['fix_now', 'fix_soon', 'fix_later', 'ongoing']).optional(),
});

const perRecDeltaSchema = z.object({
  id: z.string(),
  legacy: z.number(),
  ov: z.number().nullable(),
});

function rowToOvDivergence(r: OvDivergenceRow): OvDivergence {
  const ctx = { table: 'ov_divergence', workspaceId: r.workspace_id };
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    legacyTopRecId: r.legacy_top_rec_id,
    ovTopRecId: r.ov_top_rec_id,
    agree: r.agree === 1,
    ovTopConfidence: r.ov_top_confidence,
    ovTopGroundedSpine: r.ov_top_grounded_spine,
    ovTopEmv: r.ov_top_emv,
    invariantHeld: r.invariant_held === 1,
    legacyTop3: parseJsonSafeArray(r.legacy_top3, top3EntrySchema, { ...ctx, field: 'legacy_top3' }) as Top3Entry[],
    ovTop3: parseJsonSafeArray(r.ov_top3, top3EntrySchema, { ...ctx, field: 'ov_top3' }) as Top3Entry[],
    perRecDelta: parseJsonSafeArray(r.per_rec_delta, perRecDeltaSchema, { ...ctx, field: 'per_rec_delta' }) as PerRecDelta[],
    computedAt: r.computed_at,
  };
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO ov_divergence (
      id, workspace_id, legacy_top_rec_id, ov_top_rec_id, agree,
      ov_top_confidence, ov_top_grounded_spine, ov_top_emv, invariant_held,
      legacy_top3, ov_top3, per_rec_delta, computed_at
    ) VALUES (
      @id, @workspace_id, @legacy_top_rec_id, @ov_top_rec_id, @agree,
      @ov_top_confidence, @ov_top_grounded_spine, @ov_top_emv, @invariant_held,
      @legacy_top3, @ov_top3, @per_rec_delta, @computed_at
    )
  `),
  listByWs: db.prepare<[workspaceId: string, limit: number]>(
    'SELECT * FROM ov_divergence WHERE workspace_id = ? ORDER BY computed_at DESC, id DESC LIMIT ?',
  ),
}));

export function insertOvDivergence(record: OvDivergence): void {
  stmts().insert.run({
    id: record.id,
    workspace_id: record.workspaceId,
    legacy_top_rec_id: record.legacyTopRecId,
    ov_top_rec_id: record.ovTopRecId,
    agree: record.agree ? 1 : 0,
    ov_top_confidence: record.ovTopConfidence,
    ov_top_grounded_spine: record.ovTopGroundedSpine,
    ov_top_emv: record.ovTopEmv,
    invariant_held: record.invariantHeld ? 1 : 0,
    legacy_top3: JSON.stringify(record.legacyTop3),
    ov_top3: JSON.stringify(record.ovTop3),
    per_rec_delta: JSON.stringify(record.perRecDelta),
    computed_at: record.computedAt,
  });
}

/** Most-recent divergence rows for a workspace (workspace-scoped). */
export function listOvDivergence(workspaceId: string, limit = 20): OvDivergence[] {
  const rows = stmts().listByWs.all(workspaceId, Math.min(Math.max(1, limit), 100)) as OvDivergenceRow[];
  return rows.map(rowToOvDivergence);
}

const GROUNDED_CONFIDENCE = 0.95;
function isActive(r: Recommendation): boolean {
  return r.status === 'pending' || r.status === 'in_progress';
}
function top3(recs: Recommendation[]): Top3Entry[] {
  return recs.filter(isActive).slice(0, 3).map(r => ({ id: r.id, title: r.title, source: r.source, impactScore: r.impactScore, priority: r.priority }));
}

/**
 * Compute and persist a legacy-vs-OV divergence row for a supplied rec set.
 * Historical/runtime callers had to invoke this before canonical OV sync overwrote
 * `rec.impactScore` / `rec.priority`; direct tests may still exercise it with explicit
 * pre-sync fixtures. `sortRecs` is the canonical ranker (sortRecommendations), injected
 * to avoid a cycle.
 */
export function recordOvDivergence(
  workspaceId: string,
  recs: Recommendation[],
  priorities: string[],
  sortRecs: (recs: Recommendation[], effectiveBusinessPriorities: string[]) => void,
  /** SEO Gen-Quality P4 (G1): the OV-derived tier function (deriveOvTier), injected to
   *  avoid a circular import back into recommendations.ts. ALWAYS-ON (dark): the shadow
   *  log applies it to the OV clone so the divergence + panel see CROSS-TIER reorders, not
   *  just within-tier impactScore moves. Never served to clients. */
  deriveTier: (rec: Pick<Recommendation, 'priority' | 'source' | 'opportunity'>) => RecPriority,
): void {
  // Two shallow clones sorted through the SAME canonical ranker, one on the legacy
  // impactScore + legacy tier, and one on the OV value + OV-derived tier — so "the #1"
  // is computed identically to a production OV cutover (which re-tiers before sorting).
  const legacyClone = recs.map(r => ({ ...r }));
  const ovClone = recs.map(r => {
    const score = r.opportunity?.value ?? r.impactScore;
    // Mirror the production chokepoint: re-tier on the OV value BEFORE sorting (sortRecs
    // sorts by priority first), so the shadow #1 reflects a real OV cutover, not the legacy tier.
    return { ...r, impactScore: score, priority: deriveTier(r) };
  });
  sortRecs(legacyClone, priorities);
  sortRecs(ovClone, priorities);

  const legacyTop = legacyClone.find(isActive) ?? null;
  const ovTop = ovClone.find(isActive) ?? null;
  const agree = (legacyTop?.id ?? null) === (ovTop?.id ?? null);

  // Scope the invariant to the ACTIVE ranked set (matching ovTop / top3 / perRecDelta).
  // generateRecommendations pushes auto-resolved status:'completed' recs into the same
  // `recs` array; scanning them would record spurious invariantHeld=false rows and
  // corrupt the pass/fail count the owner uses to gate the production flip.
  const activeRecs = recs.filter(isActive);
  const anyGrounded = activeRecs.some(r => (r.opportunity?.confidence ?? 0) >= GROUNDED_CONFIDENCE);
  const ovTopGrounded = (ovTop?.opportunity?.confidence ?? 0) >= GROUNDED_CONFIDENCE;

  insertOvDivergence({
    id: crypto.randomBytes(8).toString('hex'),
    workspaceId,
    legacyTopRecId: legacyTop?.id ?? null,
    ovTopRecId: ovTop?.id ?? null,
    agree,
    ovTopConfidence: ovTop?.opportunity?.confidence ?? null,
    ovTopGroundedSpine: ovTop?.opportunity?.groundedSpine ?? null,
    ovTopEmv: ovTop?.opportunity?.emvPerWeek ?? null,
    // Grounded-beats-ungrounded: either nothing is grounded, or the OV #1 is grounded.
    invariantHeld: !anyGrounded || ovTopGrounded,
    legacyTop3: top3(legacyClone),
    ovTop3: top3(ovClone),
    perRecDelta: activeRecs.map(r => ({ id: r.id, legacy: r.impactScore, ov: r.opportunity?.value ?? null })),
    computedAt: new Date().toISOString(),
  });
  log.debug({ workspaceId, agree }, 'recorded OV divergence');
}
