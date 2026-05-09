// server/briefing-store.ts
import crypto from 'node:crypto';
import { z } from 'zod';
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { createLogger } from './logger.js';
import { validateTransition, BRIEFING_DRAFT_TRANSITIONS } from './state-machines.js';
import type {
  BriefingDraft,
  BriefingStory,
  BriefingSourceMetadata,
  BriefingDraftStatus,
} from '../shared/types/briefing.js';

const log = createLogger('briefing-store');
// suppress unused-var lint: log is used implicitly by parseJsonSafe/parseJsonSafeArray via their own logger
void log;

// ── Zod schemas — used for parsing on read AND for validating AI output (re-exported) ──

const briefingMetricSchema = z.object({
  value: z.string().min(1).max(20),
  label: z.string().min(1).max(40),
});

export const briefingStorySchema: z.ZodType<BriefingStory> = z.object({
  id: z.string().min(1),
  category: z.enum(['win', 'risk', 'opportunity', 'competitive', 'period_change']),
  isHeadline: z.boolean(),
  headline: z.string().min(1).max(120),
  narrative: z.string().min(1).max(800),
  metrics: z.array(briefingMetricSchema).max(2),
  drillIn: z.object({
    page: z.enum(['performance', 'health', 'strategy', 'content-plan', 'roi', 'brand']),
    tab: z.string().optional(),
    queryParams: z.record(z.string()).optional(),
  }),
  sourceRefs: z.array(z.object({
    type: z.enum(['analytics_insight', 'recommendation', 'audit_delta']),
    id: z.string().min(1),
  })),
  // Optional citation line below metric pills in <HeroStoryCard>. Added
  // by Phase 2.5a deterministic templates; older briefings render without
  // it. .max(800) matches the narrative cap so the receipt + narrative
  // together stay readable.
  dataReceipt: z.string().min(1).max(800).optional(),
  // Phase 2.5a: lead-eligibility flag respected by the cron's hero-promotion
  // logic. Templates marked Watch List only set `leadEligible: false` so they
  // never flip to `isHeadline: true` even when their category (e.g. 'risk' or
  // 'opportunity') overlaps with lead-eligible types.
  leadEligible: z.boolean().optional(),
});

const sourceMetadataSchema: z.ZodType<BriefingSourceMetadata> = z.object({
  candidateCount: z.number().int().nonnegative(),
  model: z.string().min(1),
  provider: z.enum(['anthropic', 'openai']),
  generationMs: z.number().int().nonnegative(),
  preflightDeferralCount: z.number().int().nonnegative().optional(),
  // Phase 2.5e — Premium AI polish telemetry. Optional; absent on
  // pre-2.5e drafts and on workspaces where the polish flag is off.
  aiPolish: z.object({
    weeklyOpener: z.string().optional(),
    originalHeroHeadline: z.string().optional(),
    aiMs: z.number().int().nonnegative().optional(),
  }).optional(),
});

// ── Row shape ──

interface BriefingRow {
  id: string;
  workspace_id: string;
  week_of: string;
  status: BriefingDraftStatus;
  stories: string;
  source_metadata: string | null;
  admin_note: string | null;
  auto_published: number;
  created_at: number;
  updated_at: number;
  published_at: number | null;
}

// ── Statement cache ──

const briefingStmts = createStmtCache(() => ({
  insert: db.prepare(`
    INSERT INTO briefing_drafts (id, workspace_id, week_of, status, stories, source_metadata, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, week_of) DO UPDATE SET
      stories = excluded.stories,
      source_metadata = excluded.source_metadata,
      -- Both terminal statuses are protected — published cannot regenerate, skipped
      -- cannot be silently overridden by a cron retry (admin's "do not publish" intent
      -- must survive). approved (intermediate) DOES collapse back to draft on re-upsert,
      -- which is acceptable: the cron only re-upserts after admin un-approval clears
      -- the row OR after a defer cycle, both of which the admin initiated.
      status = CASE WHEN briefing_drafts.status IN ('published', 'skipped') THEN briefing_drafts.status ELSE excluded.status END,
      updated_at = excluded.updated_at
    RETURNING *
  `),
  getByWeek: db.prepare('SELECT * FROM briefing_drafts WHERE workspace_id = ? AND week_of = ?'),
  getById: db.prepare('SELECT * FROM briefing_drafts WHERE id = ?'),
  list: db.prepare('SELECT * FROM briefing_drafts WHERE workspace_id = ? ORDER BY week_of DESC LIMIT ?'),
  latestPublished: db.prepare(`
    SELECT * FROM briefing_drafts
    WHERE workspace_id = ? AND status = 'published'
    ORDER BY published_at DESC, week_of DESC LIMIT 1
  `),
  // Phase 2.5b — counts published briefings for a workspace whose
  // `published_at` is ≤ the given threshold. Drives the "ISSUE N" counter
  // shown in the dateline. Coalesce nulls because skipped drafts share the
  // table but never set `published_at`.
  countPublishedThrough: db.prepare(`
    SELECT COUNT(*) AS n FROM briefing_drafts
    WHERE workspace_id = ? AND status = 'published' AND COALESCE(published_at, 0) <= ?
  `),
  setStories: db.prepare('UPDATE briefing_drafts SET stories = ?, updated_at = ? WHERE id = ? AND workspace_id = ? RETURNING *'),
  setStatus: db.prepare('UPDATE briefing_drafts SET status = ?, updated_at = ?, published_at = ?, auto_published = ?, admin_note = COALESCE(?, admin_note) WHERE id = ? AND workspace_id = ? RETURNING * -- status-ok: guarded by validateTransition() in setStatusScoped()'),
  setNote: db.prepare('UPDATE briefing_drafts SET admin_note = ?, updated_at = ? WHERE id = ? AND workspace_id = ? RETURNING *'),
}));

/**
 * Read the current draft strictly within a workspace.
 * Returns null if the row doesn't exist OR belongs to a different workspace —
 * never leaks "exists in another workspace" as a 404 vs 403 oracle.
 */
function getDraftScoped(workspaceId: string, id: string): BriefingRow | null {
  const row = briefingStmts().getById.get(id) as BriefingRow | undefined;
  if (!row || row.workspace_id !== workspaceId) return null;
  return row;
}

// ── Mapper ──

function rowToDraft(row: BriefingRow): BriefingDraft {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    weekOf: row.week_of,
    status: row.status,
    stories: parseJsonSafeArray(
      // Migrate legacy 'schema-review' drillIn.page values before Zod validates.
      // 'schema-review' was a valid ExplorePage until feat/client-inbox-redesign Phase 2 retired
      // the standalone tab. Replace in the raw JSON string so historical briefings are not
      // silently dropped by parseJsonSafeArray. JSON.stringify never adds spaces after colons,
      // so the pattern "page":"schema-review" is safe and precise.
      row.stories ? row.stories.replace(/"page":"schema-review"/g, '"page":"health"') : row.stories,
      briefingStorySchema,
      { workspaceId: row.workspace_id, field: 'stories', table: 'briefing_drafts' },
    ),
    sourceMetadata: row.source_metadata
      ? parseJsonSafe(row.source_metadata, sourceMetadataSchema, null, {
          workspaceId: row.workspace_id,
          field: 'source_metadata',
          table: 'briefing_drafts',
        })
      : null,
    adminNote: row.admin_note,
    autoPublished: !!row.auto_published,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
  };
}

// ── Public API ──

export interface UpsertBriefingDraftInput {
  workspaceId: string;
  weekOf: string;
  stories: BriefingStory[];
  sourceMetadata: BriefingSourceMetadata | null;
}

export function upsertBriefingDraft(input: UpsertBriefingDraftInput): BriefingDraft {
  const id = crypto.randomUUID();
  const now = Date.now();
  const row = briefingStmts().insert.get(
    id,
    input.workspaceId,
    input.weekOf,
    'draft',
    JSON.stringify(input.stories),
    input.sourceMetadata ? JSON.stringify(input.sourceMetadata) : null,
    now,
    now,
  ) as BriefingRow;
  return rowToDraft(row);
}

export function getBriefingByWeek(workspaceId: string, weekOf: string): BriefingDraft | null {
  const row = briefingStmts().getByWeek.get(workspaceId, weekOf) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function getBriefingById(id: string): BriefingDraft | null {
  const row = briefingStmts().getById.get(id) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function listBriefingDrafts(workspaceId: string, limit = 12): BriefingDraft[] {
  const rows = briefingStmts().list.all(workspaceId, limit) as BriefingRow[];
  return rows.map(rowToDraft);
}

export function getLatestPublishedBriefing(workspaceId: string): BriefingDraft | null {
  const row = briefingStmts().latestPublished.get(workspaceId) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

/**
 * Count of published briefings for a workspace whose `published_at` is ≤
 * the given threshold. Drives the `ISSUE N` counter rendered in the
 * client-side dateline (Phase 2.5b). 1-indexed when the latest briefing's
 * own `publishedAt` is passed as the threshold.
 */
export function countPublishedBriefingsThrough(
  workspaceId: string,
  publishedAtMs: number,
): number {
  const row = briefingStmts().countPublishedThrough.get(workspaceId, publishedAtMs) as
    | { n: number }
    | undefined;
  return row?.n ?? 0;
}

export function updateBriefingStories(workspaceId: string, id: string, stories: BriefingStory[]): BriefingDraft | null {
  const current = getDraftScoped(workspaceId, id);
  if (!current) return null;
  // Both terminal statuses block edits — published can't be rewritten and skipped is a
  // committed admin decision that should not be reanimated via a stories patch.
  if (current.status === 'published' || current.status === 'skipped') return null;
  const row = briefingStmts().setStories.get(JSON.stringify(stories), Date.now(), id, workspaceId) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export interface MarkPublishedOptions {
  autoPublished: boolean;
  adminNote?: string;
}

function setStatusScoped(
  workspaceId: string,
  id: string,
  next: BriefingDraftStatus,
  publishedAt: number | null,
  autoPublished: boolean,
  adminNote: string | null,
): BriefingDraft | null {
  const current = getDraftScoped(workspaceId, id);
  if (!current) return null;
  validateTransition<BriefingDraftStatus>('briefing_draft', BRIEFING_DRAFT_TRANSITIONS, current.status, next);
  const row = briefingStmts().setStatus.get(
    next,
    Date.now(),
    publishedAt,
    autoPublished ? 1 : 0,
    adminNote,
    id,
    workspaceId,
  ) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}

export function markPublished(workspaceId: string, id: string, opts: MarkPublishedOptions): BriefingDraft | null {
  return setStatusScoped(workspaceId, id, 'published', Date.now(), opts.autoPublished, opts.adminNote ?? null);
}

export function markApproved(workspaceId: string, id: string, adminNote?: string): BriefingDraft | null {
  return setStatusScoped(workspaceId, id, 'approved', null, false, adminNote ?? null);
}

export function markSkipped(workspaceId: string, id: string, adminNote: string): BriefingDraft | null {
  return setStatusScoped(workspaceId, id, 'skipped', null, false, adminNote);
}

export function setBriefingAdminNote(workspaceId: string, id: string, adminNote: string | null): BriefingDraft | null {
  if (!getDraftScoped(workspaceId, id)) return null;
  const row = briefingStmts().setNote.get(adminNote, Date.now(), id, workspaceId) as BriefingRow | undefined;
  return row ? rowToDraft(row) : null;
}
