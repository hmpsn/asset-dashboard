/**
 * opportunity-events — event ledger for event-driven re-ranking (PR7 · Spine B).
 *
 * A detected opportunity event (content decay, competitor overtake, rank decline)
 * is appended here with an initial timing `boost` and a `halfLifeDays`.
 * server/scoring/opportunity-timing.ts reads the ACTIVE events and aggregates the
 * DECAYING boost per page (boost · exp(−ageDays/halfLifeDays)) into
 * OpportunityInput.timingBoost, which lifts the timing multiplier in
 * computeOpportunityValue. The whole pipeline is dark while the
 * `opportunity-value-events` flag is OFF (no rows written, empty boost map).
 *
 * Workspace-scoped. Lockstep (CLAUDE.md DB column + mapper): migration 110 +
 * row interface + rowToOpportunityEvent + insertOpportunityEvent +
 * listActiveOpportunityEvents + Zod schema, all here.
 *
 * IMPORTANT: this module is imported by server/recommendations.ts (via the timing
 * module). It must NOT value-import recommendations.ts back — that would form a
 * circular dependency that perturbs whole-program type inference (the
 * external-fetch.ts BodyInit ripple). Slug normalisation is therefore inlined
 * here rather than importing toPageSlug from recommendations.ts.
 */
import crypto from 'crypto';
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonFallback } from './db/json-validation.js';
import { createLogger } from './logger.js';

const log = createLogger('opportunity-events');

export type OpportunityEventType = 'decay' | 'competitor' | 'rank_drop';

export const OPPORTUNITY_EVENT_TYPES: readonly OpportunityEventType[] = [
  'decay',
  'competitor',
  'rank_drop',
];

export interface OpportunityEvent {
  id: string;
  workspaceId: string;
  type: OpportunityEventType;
  /** Slug-normalised affected page (no leading slash); null for domain-level events. */
  pagePath: string | null;
  keyword: string | null;
  /** Initial (undecayed) timing-boost contribution. */
  boost: number;
  /** Decay half-life in days (exponential). */
  halfLifeDays: number;
  /** ISO timestamp the event was detected/written. */
  detectedAt: string;
  source: string | null;
  /** Detector-specific evidence (schema-free JSON). */
  payload: Record<string, unknown> | null;
}

interface OpportunityEventRow {
  id: string;
  workspace_id: string;
  type: string;
  page_path: string | null;
  keyword: string | null;
  boost: number;
  half_life_days: number;
  detected_at: string;
  source: string | null;
  payload: string | null;
}

/** Zod schema mirroring the in-memory event shape (validation parity per CLAUDE.md). */
export const opportunityEventSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  type: z.enum(['decay', 'competitor', 'rank_drop']),
  pagePath: z.string().nullable(),
  keyword: z.string().nullable(),
  boost: z.number(),
  halfLifeDays: z.number(),
  detectedAt: z.string(),
  source: z.string().nullable(),
  payload: z.record(z.unknown()).nullable(),
});

/**
 * Inline slug normaliser (no leading slash, no trailing slash, lowercased path).
 * Mirrors recommendations.ts:toPageSlug behaviour for the keys we store, but is
 * inlined to avoid a circular value-import back into recommendations.ts.
 */
export function normalizeEventPagePath(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  // Strip protocol + host if a full URL slipped through.
  s = s.replace(/^https?:\/\/[^/]+/i, '');
  s = s.replace(/^\/+/, '').replace(/\/+$/, '');
  return s.toLowerCase();
}

function coerceType(raw: string): OpportunityEventType {
  return (OPPORTUNITY_EVENT_TYPES as readonly string[]).includes(raw)
    ? (raw as OpportunityEventType)
    : 'decay';
}

function rowToOpportunityEvent(r: OpportunityEventRow): OpportunityEvent {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    type: coerceType(r.type),
    // '' sentinel (NOT NULL DEFAULT '' for dedup) maps back to null model semantics.
    pagePath: r.page_path || null,
    keyword: r.keyword || null,
    boost: r.boost,
    halfLifeDays: r.half_life_days,
    detectedAt: r.detected_at,
    source: r.source,
    payload: r.payload != null ? parseJsonFallback<Record<string, unknown> | null>(r.payload, null) : null,
  };
}

/** Read window: events older than this contribute negligibly (boost·exp decays
 *  below the NEGLIGIBLE_BOOST cutoff well before this) — beyond it they are dead
 *  rows, so we don't even SELECT them. Decay alone makes them inert; this bounds cost. */
const MAX_EVENT_WINDOW_DAYS = 180;

const stmts = createStmtCache(() => ({
  // Dedup-on-write: re-detecting the same logical event REFRESHES the row
  // (detected_at/boost) instead of appending — bounds growth + prevents a chronic
  // page from stacking N daily rows into a saturated per-page boost.
  insert: db.prepare(`
    INSERT INTO opportunity_events (
      id, workspace_id, type, page_path, keyword,
      boost, half_life_days, detected_at, source, payload
    ) VALUES (
      @id, @workspace_id, @type, @page_path, @keyword,
      @boost, @half_life_days, @detected_at, @source, @payload
    )
    ON CONFLICT(workspace_id, type, page_path, keyword) DO UPDATE SET
      id = excluded.id,
      boost = excluded.boost,
      half_life_days = excluded.half_life_days,
      detected_at = excluded.detected_at,
      source = excluded.source,
      payload = excluded.payload
  `),
  listByWs: db.prepare<[workspaceId: string, sinceIso: string]>(
    'SELECT * FROM opportunity_events WHERE workspace_id = ? AND detected_at >= ? ORDER BY detected_at DESC, id DESC LIMIT 500',
  ),
}));

export interface InsertOpportunityEventInput {
  workspaceId: string;
  type: OpportunityEventType;
  pagePath?: string | null;
  keyword?: string | null;
  boost: number;
  halfLifeDays: number;
  source?: string | null;
  payload?: Record<string, unknown> | null;
  /** Optional explicit timestamp (defaults to now). */
  detectedAt?: string;
}

/**
 * Append an opportunity event. Returns the persisted event. Boost/half-life are
 * stored verbatim; the decay is applied at read time in opportunity-timing.ts.
 * The pagePath is slug-normalised so it matches Recommendation.affectedPages keys.
 */
export function insertOpportunityEvent(input: InsertOpportunityEventInput): OpportunityEvent {
  const record: OpportunityEvent = {
    id: crypto.randomBytes(8).toString('hex'),
    workspaceId: input.workspaceId,
    type: input.type,
    pagePath: normalizeEventPagePath(input.pagePath ?? null),
    keyword: input.keyword ?? null,
    boost: Number.isFinite(input.boost) ? input.boost : 0,
    halfLifeDays: Number.isFinite(input.halfLifeDays) && input.halfLifeDays > 0 ? input.halfLifeDays : 1,
    detectedAt: input.detectedAt ?? new Date().toISOString(),
    source: input.source ?? null,
    payload: input.payload ?? null,
  };
  stmts().insert.run({
    id: record.id,
    workspace_id: record.workspaceId,
    type: record.type,
    // Store '' (not null) so the dedup UNIQUE(workspace_id,type,page_path,keyword) matches.
    page_path: record.pagePath ?? '',
    keyword: record.keyword ?? '',
    boost: record.boost,
    half_life_days: record.halfLifeDays,
    detected_at: record.detectedAt,
    source: record.source,
    payload: record.payload != null ? JSON.stringify(record.payload) : null,
  });
  log.debug({ workspaceId: record.workspaceId, type: record.type, pagePath: record.pagePath }, 'opportunity event written');
  return record;
}

/**
 * Active events for a workspace (workspace-scoped, most-recent-first). "Active"
 * here is every persisted event — the DECAY (not a hard expiry) is what makes an
 * event's contribution fade in opportunity-timing.ts, so we return them all and
 * let the reader drop negligible (decayed-to-near-zero) contributions. Callers
 * that want a hard cutoff can filter on `detectedAt`.
 */
export function listActiveOpportunityEvents(workspaceId: string): OpportunityEvent[] {
  // Skip rows older than the relevance window — decay already makes them inert
  // (contribution < NEGLIGIBLE_BOOST), this just avoids reading dead rows.
  const sinceIso = new Date(Date.now() - MAX_EVENT_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = stmts().listByWs.all(workspaceId, sinceIso) as OpportunityEventRow[];
  return rows.map(rowToOpportunityEvent);
}
