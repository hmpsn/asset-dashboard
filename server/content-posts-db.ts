/**
 * Content Posts — Database CRUD operations and version history.
 * Handles all SQLite persistence for generated posts and their version snapshots.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type {
  GeneratedPost,
  PersistedGeneratedPost,
  PostSection,
} from '../shared/types/content.ts';
import type { GenerationProvenance } from '../shared/types/ai-execution.js';
import { JOB_RESOURCE_TYPES } from '../shared/types/background-jobs.js';
import { isDeepStrictEqual } from 'node:util';
import { createLogger } from './logger.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { contentPostGenerationDiagnosticSchema, postSectionSchema, reviewChecklistSchema, storedAiReviewSchema } from './schemas/content-schemas.js';
import { validateTransition, POST_STATUS_TRANSITIONS } from './state-machines.js';
import { resolveContentGenerationStyle } from './page-type-copy-contract.js';
import { getScoredOutcomeReadbacks } from './outcome-tracking.js';
import { normalizePageUrl, pageAddressSlug } from './utils/page-address.js';
import { IncompleteContentPostError, isCompleteGeneratedPost } from './domains/content/generation-integrity.js';
import {
  GenerationRevisionConflictError,
} from './generation-provenance.js';
import {
  canonicalGenerationProvenanceSchema,
  generationProvenanceSchema,
} from './schemas/generation-provenance.js';
import { assertNoUnresolvedContentPublishReconciliation } from './content-publish-reconciliation.js';
import { ActiveJobResourceConflict, getActiveJobForResource } from './jobs.js';

const log = createLogger('content-posts-db');

function nextPostUpdatedAt(previous: string, requested?: string): string {
  const previousMs = Date.parse(previous);
  const requestedMs = requested ? Date.parse(requested) : Number.NaN;
  return new Date(Math.max(
    Date.now(),
    Number.isFinite(previousMs) ? previousMs + 1 : 0,
    Number.isFinite(requestedMs) ? requestedMs : 0,
  )).toISOString();
}

// ── SQLite row shape ──

interface PostRow {
  id: string;
  workspace_id: string;
  brief_id: string;
  target_keyword: string;
  title: string;
  meta_description: string;
  introduction: string;
  sections: string;
  conclusion: string;
  seo_title: string | null;
  seo_meta_description: string | null;
  total_word_count: number;
  target_word_count: number;
  status: string;
  generation_diagnostics: string | null;
  unification_status: string | null;
  unification_note: string | null;
  webflow_item_id: string | null;
  webflow_collection_id: string | null;
  published_at: string | null;
  published_slug: string | null;
  planned_publish_at: string | null;
  review_checklist: string | null;
  ai_review: string | null;
  voice_score: number | null;
  voice_feedback: string | null;
  generation_style: string | null;
  generation_revision: number;
  generation_provenance: string | null;
  created_at: string;
  updated_at: string;
}

interface PublishedMonthCountRow {
  month: string;
  cnt: number;
}

interface PublishedPathRow {
  published_slug: string | null;
}

export interface PublishedMonthCount {
  month: string; // YYYY-MM
  published: number;
}

export interface ContentVelocityTrend {
  monthly: PublishedMonthCount[];
  currentMonthPublished: number;
  trailingThreeMonthAvg: number;
  previousThreeMonthAvg: number;
  trendPct: number | null;
}

// ── Version history types ──

export interface PostVersion {
  id: string;
  postId: string;
  workspaceId: string;
  versionNumber: number;
  trigger: 'regenerate_section' | 'manual_edit' | 'unification' | 'bulk_regenerate';
  triggerDetail?: string;
  title: string;
  metaDescription: string;
  introduction: string;
  sections: PostSection[];
  conclusion: string;
  seoTitle?: string;
  seoMetaDescription?: string;
  totalWordCount: number;
  generationProvenance: GenerationProvenance | null;
  createdAt: string;
}

interface VersionRow {
  id: string;
  post_id: string;
  workspace_id: string;
  version_number: number;
  trigger: string;
  trigger_detail: string | null;
  title: string;
  meta_description: string;
  introduction: string;
  sections: string;
  conclusion: string;
  seo_title: string | null;
  seo_meta_description: string | null;
  total_word_count: number;
  generation_provenance: string | null;
  created_at: string;
}

const vStmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_post_versions
           (id, post_id, workspace_id, version_number, trigger, trigger_detail,
            title, meta_description, introduction, sections, conclusion,
            seo_title, seo_meta_description, total_word_count,
            generation_provenance, created_at)
         VALUES
           (@id, @post_id, @workspace_id, @version_number, @trigger, @trigger_detail,
            @title, @meta_description, @introduction, @sections, @conclusion,
            @seo_title, @seo_meta_description, @total_word_count,
            @generation_provenance, @created_at)`,
  ),
  listByPost: db.prepare(
    `SELECT * FROM content_post_versions WHERE post_id = ? AND workspace_id = ? ORDER BY version_number DESC`,
  ),
  getById: db.prepare(
    `SELECT * FROM content_post_versions WHERE id = ? AND workspace_id = ?`,
  ),
  countByPost: db.prepare(
    `SELECT COUNT(*) as cnt FROM content_post_versions WHERE post_id = ?`,
  ),
  deleteByPost: db.prepare(
    `DELETE FROM content_post_versions WHERE post_id = ? AND workspace_id = ?`,
  ),
  /** Most recent version row for a post — used for snapshot coalescing. */
  mostRecent: db.prepare(
    `SELECT trigger, trigger_detail, created_at FROM content_post_versions WHERE post_id = ? AND workspace_id = ? ORDER BY version_number DESC LIMIT 1`,
  ),
}));

function rowToVersion(row: VersionRow): PostVersion {
  return {
    id: row.id,
    postId: row.post_id,
    workspaceId: row.workspace_id,
    versionNumber: row.version_number,
    trigger: row.trigger as PostVersion['trigger'],
    triggerDetail: row.trigger_detail ?? undefined,
    title: row.title,
    metaDescription: row.meta_description,
    introduction: row.introduction,
    sections: parseJsonSafeArray(row.sections, postSectionSchema, { field: 'sections', table: 'content_post_versions' }),
    conclusion: row.conclusion,
    seoTitle: row.seo_title ?? undefined,
    seoMetaDescription: row.seo_meta_description ?? undefined,
    totalWordCount: row.total_word_count,
    generationProvenance: row.generation_provenance
      ? parseJsonSafe(
          row.generation_provenance,
          generationProvenanceSchema,
          null,
          {
            workspaceId: row.workspace_id,
            field: 'generation_provenance',
            table: 'content_post_versions',
          },
        )
      : null,
    createdAt: row.created_at,
  };
}

const stmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_posts
           (id, workspace_id, brief_id, target_keyword, title, meta_description,
            introduction, sections, conclusion, seo_title, seo_meta_description,
            total_word_count, target_word_count, status, unification_status,
            unification_note, generation_diagnostics, review_checklist, ai_review,
            webflow_item_id, webflow_collection_id, published_at, published_slug,
            planned_publish_at,
            voice_score, voice_feedback, generation_style,
            generation_revision, generation_provenance,
            created_at, updated_at)
         VALUES
           (@id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
            @introduction, @sections, @conclusion, @seo_title, @seo_meta_description,
            @total_word_count, @target_word_count, @status, @unification_status,
            @unification_note, @generation_diagnostics, @review_checklist, @ai_review,
            @webflow_item_id, @webflow_collection_id, @published_at, @published_slug,
            @planned_publish_at,
            @voice_score, @voice_feedback, @generation_style,
            @generation_revision, @generation_provenance,
            @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_posts WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_posts WHERE id = ? AND workspace_id = ?`,
  ),
  selectBriefRevision: db.prepare(
    `SELECT generation_revision FROM content_briefs
      WHERE id = ? AND workspace_id = ?`,
  ),
  updateAtRevision: db.prepare(
    `UPDATE content_posts SET
           title = @title, meta_description = @meta_description,
           introduction = @introduction, sections = @sections, conclusion = @conclusion,
           seo_title = @seo_title, seo_meta_description = @seo_meta_description,
           total_word_count = @total_word_count, target_word_count = @target_word_count,
           status = @status, unification_status = @unification_status,
           unification_note = @unification_note, generation_diagnostics = @generation_diagnostics, review_checklist = @review_checklist,
           ai_review = @ai_review,
           webflow_item_id = @webflow_item_id, webflow_collection_id = @webflow_collection_id,
           published_at = @published_at, published_slug = @published_slug,
           planned_publish_at = @planned_publish_at,
           voice_score = @voice_score, voice_feedback = @voice_feedback,
           generation_style = @generation_style,
           generation_revision = generation_revision + 1,
           generation_provenance = @generation_provenance,
           updated_at = @updated_at
         WHERE id = @id AND workspace_id = @workspace_id
           AND generation_revision = @expected_generation_revision`,
  ),
  assertRevision: db.prepare(
    `SELECT generation_revision FROM content_posts
      WHERE id = ? AND workspace_id = ?`,
  ),
  bumpAtRevision: db.prepare(
    `UPDATE content_posts
        SET generation_revision = generation_revision + 1,
            updated_at = @updated_at
      WHERE id = @id AND workspace_id = @workspace_id
        AND generation_revision = @expected_generation_revision`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_posts WHERE id = ? AND workspace_id = ?`,
  ),
  deleteAtRevision: db.prepare(
    `DELETE FROM content_posts
      WHERE id = @id AND workspace_id = @workspace_id
        AND generation_revision = @expected_generation_revision`,
  ),
  selectPublishedByMonth: db.prepare<[workspaceId: string, startMonth: string]>(
    `SELECT substr(published_at, 1, 7) AS month, COUNT(*) AS cnt
       FROM content_posts
      WHERE workspace_id = ?
        AND published_at IS NOT NULL
        AND substr(published_at, 1, 7) >= ?
      GROUP BY substr(published_at, 1, 7)
      ORDER BY month ASC`,
  ),
  selectPublishedPaths: db.prepare(
    `SELECT published_slug
       FROM content_posts
      WHERE workspace_id = ?
        AND (published_at IS NOT NULL OR webflow_item_id IS NOT NULL)`,
  ),
}));

function rowToPost(row: PostRow): PersistedGeneratedPost {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    briefId: row.brief_id,
    targetKeyword: row.target_keyword,
    title: row.title,
    metaDescription: row.meta_description,
    introduction: row.introduction,
    sections: parseJsonSafeArray(row.sections, postSectionSchema, { field: 'sections', table: 'content_posts' }),
    conclusion: row.conclusion,
    seoTitle: row.seo_title ?? undefined,
    seoMetaDescription: row.seo_meta_description ?? undefined,
    totalWordCount: row.total_word_count,
    targetWordCount: row.target_word_count,
    status: row.status as GeneratedPost['status'],
    generationDiagnostics: row.generation_diagnostics
      ? parseJsonSafeArray(row.generation_diagnostics, contentPostGenerationDiagnosticSchema, {
          workspaceId: row.workspace_id,
          field: 'generation_diagnostics',
          table: 'content_posts',
        })
      : undefined,
    unificationStatus: row.unification_status as GeneratedPost['unificationStatus'] ?? undefined,
    unificationNote: row.unification_note ?? undefined,
    webflowItemId: row.webflow_item_id ?? undefined,
    webflowCollectionId: row.webflow_collection_id ?? undefined,
    publishedAt: row.published_at ?? undefined,
    publishedSlug: row.published_slug ?? undefined,
    plannedPublishAt: row.planned_publish_at ?? undefined,
    reviewChecklist: row.review_checklist
      ? parseJsonSafe(row.review_checklist, reviewChecklistSchema, {
          factual_accuracy: false, brand_voice: false, internal_links: false,
          no_hallucinations: false, meta_optimized: false, word_count_target: false,
        }, { field: 'review_checklist', table: 'content_posts' })
      : undefined,
    aiReview: row.ai_review
      ? parseJsonSafe(row.ai_review, storedAiReviewSchema, null, { workspaceId: row.workspace_id, field: 'ai_review', table: 'content_posts' }) ?? undefined
      : undefined,
    voiceScore: row.voice_score ?? undefined,
    voiceFeedback: row.voice_feedback ?? undefined,
    generationStyle: resolveContentGenerationStyle(row.generation_style),
    generationRevision: row.generation_revision,
    generationProvenance: row.generation_provenance
      ? parseJsonSafe(
          row.generation_provenance,
          generationProvenanceSchema,
          null,
          {
            workspaceId: row.workspace_id,
            field: 'generation_provenance',
            table: 'content_posts',
          },
        )
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function postToParams(
  post: GeneratedPost,
  options: {
    generationRevision?: number;
    generationProvenance?: GenerationProvenance | null;
    expectedGenerationRevision?: number;
  } = {},
): Record<string, unknown> {
  const generationProvenance = options.generationProvenance !== undefined
    ? options.generationProvenance
    : post.generationProvenance ?? null;
  return {
    id: post.id,
    workspace_id: post.workspaceId,
    brief_id: post.briefId,
    target_keyword: post.targetKeyword,
    title: post.title,
    meta_description: post.metaDescription,
    introduction: post.introduction,
    sections: JSON.stringify(post.sections),
    conclusion: post.conclusion,
    seo_title: post.seoTitle ?? null,
    seo_meta_description: post.seoMetaDescription ?? null,
    total_word_count: post.totalWordCount,
    target_word_count: post.targetWordCount,
    status: post.status,
    generation_diagnostics: post.generationDiagnostics ? JSON.stringify(post.generationDiagnostics) : null,
    unification_status: post.unificationStatus ?? null,
    unification_note: post.unificationNote ?? null,
    webflow_item_id: post.webflowItemId ?? null,
    webflow_collection_id: post.webflowCollectionId ?? null,
    published_at: post.publishedAt ?? null,
    published_slug: post.publishedSlug ?? null,
    planned_publish_at: post.plannedPublishAt ?? null,
    review_checklist: post.reviewChecklist ? JSON.stringify(post.reviewChecklist) : null,
    ai_review: post.aiReview ? JSON.stringify(post.aiReview) : null,
    voice_score: post.voiceScore ?? null,
    voice_feedback: post.voiceFeedback ?? null,
    generation_style: resolveContentGenerationStyle(post.generationStyle),
    generation_revision: options.generationRevision ?? post.generationRevision ?? 0,
    generation_provenance: generationProvenance
      ? JSON.stringify(generationProvenanceSchema.parse(generationProvenance))
      : null,
    expected_generation_revision: options.expectedGenerationRevision
      ?? post.generationRevision
      ?? 0,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  };
}

export function listPosts(workspaceId: string): PersistedGeneratedPost[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as PostRow[];
  return rows.map(rowToPost);
}

export interface PublishedPostPagePathCensus {
  paths: Set<string>;
  unresolvedSlugs: Set<string>;
  totalCount: number;
  validCount: number;
  complete: boolean;
}

function publishedPageIdentity(raw: string | null): { path?: string; slug?: string } | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return parsed.username || parsed.password
        ? null
        : { path: normalizePageUrl(parsed.pathname) };
    } catch { // catch-ok: malformed durable page identity makes the census incomplete.
      return null;
    }
  }
  if (value.startsWith('/') || value.includes('/')) {
    return { path: normalizePageUrl(value.startsWith('/') ? value : `/${value}`) };
  }
  const slug = pageAddressSlug(value);
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(slug) ? { slug } : null;
}

export function getPublishedPostPagePathCensus(
  workspaceId: string,
): PublishedPostPagePathCensus {
  const rows = stmts().selectPublishedPaths.all(workspaceId) as PublishedPathRow[];
  const normalized = rows.map(row => publishedPageIdentity(row.published_slug));
  const valid = normalized.filter((identity): identity is { path?: string; slug?: string } => (
    identity !== null
  ));
  const paths = valid.flatMap(identity => identity.path ? [identity.path] : []);
  const unresolvedSlugs = valid.flatMap(identity => identity.slug ? [identity.slug] : []);
  return {
    paths: new Set(paths),
    unresolvedSlugs: new Set(unresolvedSlugs),
    totalCount: rows.length,
    validCount: valid.length,
    complete: valid.length === rows.length && unresolvedSlugs.length === 0,
  };
}

export function listPublishedPostPagePaths(workspaceId: string): Set<string> {
  const census = getPublishedPostPagePathCensus(workspaceId);
  return new Set([
    ...[...census.paths].map(pageAddressSlug).filter(Boolean),
    ...census.unresolvedSlugs,
  ]);
}

/**
 * W5.1: badge PUBLISHED posts with their read-back outcome verdict (90-day
 * clicks/position delta + verdict). Read-side decoration only — NOT persisted on
 * the row, so it lives at the list-route boundary rather than in listPosts (which
 * many non-list consumers call). Joins each published post's tracked action
 * (recorded under sourceType='post', sourceId=postId, targetKeyword) back to its
 * scored outcome via the shared read-back indexes. Source-id exact match first
 * ('post::<postId>'), keyword fallback second. ONE indexed batch read per call.
 * Only posts with a publishedAt (or a Webflow item) are eligible — a draft has no
 * measurable outcome. Returns NEW post objects for badged posts; never mutates
 * the input array.
 */
export function enrichPostsWithOutcomes(workspaceId: string, posts: GeneratedPost[]): GeneratedPost[] {
  const publishedCount = posts.filter(p => p.publishedAt || p.webflowItemId).length;
  if (publishedCount === 0) return posts;
  let readbacks: ReturnType<typeof getScoredOutcomeReadbacks>;
  try {
    readbacks = getScoredOutcomeReadbacks(workspaceId);
  } catch (err) {
    // catch-ok: outcome badge is informational; degrade to no badge on read failure.
    log.debug({ err, workspaceId }, 'Outcome read-back unavailable for posts list');
    return posts;
  }
  if (readbacks.bySource.size === 0 && readbacks.byKeyword.size === 0) return posts;
  return posts.map(post => {
    if (!(post.publishedAt || post.webflowItemId)) return post;
    const outcome = readbacks.bySource.get(`post::${post.id}`)
      ?? (post.targetKeyword ? readbacks.byKeyword.get(post.targetKeyword.trim().toLowerCase()) : undefined);
    return outcome ? { ...post, outcome } : post;
  });
}

export function monthKeys(now: Date, months: number): string[] {
  const keys: string[] = [];
  const current = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - i, 1));
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    keys.push(`${y}-${m}`);
  }
  return keys;
}

export function getPublishedPostCountsByMonth(
  workspaceId: string,
  months = 6,
  now = new Date(),
): PublishedMonthCount[] {
  const span = Math.max(1, months);
  const keys = monthKeys(now, span);
  const startMonth = keys[0];
  const rows = stmts().selectPublishedByMonth.all(workspaceId, startMonth) as PublishedMonthCountRow[];
  const byMonth = new Map(rows.map(r => [r.month, r.cnt]));
  return keys.map(month => ({ month, published: byMonth.get(month) ?? 0 }));
}

export function getContentVelocityTrend(
  workspaceId: string,
  months = 6,
  now = new Date(),
): ContentVelocityTrend {
  const monthly = getPublishedPostCountsByMonth(workspaceId, months, now);
  const trailing = monthly.slice(-3);
  const previous = monthly.length >= 6 ? monthly.slice(-6, -3) : [];
  const trailingThreeMonthAvg = trailing.reduce((sum, m) => sum + m.published, 0) / Math.max(1, trailing.length);
  const previousThreeMonthAvg = previous.reduce((sum, m) => sum + m.published, 0) / Math.max(1, previous.length);
  const trendPct = previousThreeMonthAvg > 0
    ? Math.round(((trailingThreeMonthAvg - previousThreeMonthAvg) / previousThreeMonthAvg) * 100)
    : null;

  return {
    monthly,
    currentMonthPublished: monthly.length > 0 ? monthly[monthly.length - 1].published : 0,
    trailingThreeMonthAvg: Number(trailingThreeMonthAvg.toFixed(1)),
    previousThreeMonthAvg: Number(previousThreeMonthAvg.toFixed(1)),
    trendPct,
  };
}

export function getPost(workspaceId: string, postId: string): PersistedGeneratedPost | undefined {
  const row = stmts().selectById.get(postId, workspaceId) as PostRow | undefined;
  return row ? rowToPost(row) : undefined;
}

/** Insert-only persistence for a new post or generation skeleton. */
export function createPost(
  workspaceId: string,
  post: GeneratedPost,
): PersistedGeneratedPost {
  if (post.workspaceId !== workspaceId) {
    throw new Error('Content post workspace does not match the persistence scope');
  }
  const created: PersistedGeneratedPost = {
    ...post,
    generationRevision: post.generationRevision ?? 0,
    generationProvenance: post.generationProvenance ?? null,
  };
  stmts().insert.run(postToParams(created));
  return created;
}

/** Persist a complete generated candidate exactly once at revision 1. */
export function persistGeneratedPost(
  workspaceId: string,
  post: GeneratedPost,
): PersistedGeneratedPost {
  if (!post.generationProvenance) {
    throw new Error('Generated content post persistence requires provenance');
  }
  if (post.status !== 'draft' || !isCompleteGeneratedPost(post, post.sections.length)) {
    throw new IncompleteContentPostError();
  }
  return createPost(workspaceId, {
    ...post,
    generationRevision: 1,
    generationProvenance: canonicalGenerationProvenanceSchema.parse(post.generationProvenance),
  });
}

/**
 * Backward-compatible manual/import save. New generation code must use
 * `commitPostGeneration`; existing rows are updated with a revision CAS and the
 * prior provenance is retained when the caller does not supply it.
 */
export function savePost(
  workspaceId: string,
  post: GeneratedPost,
): PersistedGeneratedPost {
  const existing = stmts().selectById.get(post.id, workspaceId) as PostRow | undefined;
  if (existing) {
    const persisted = rowToPost(existing);
    const expectedRevision = post.generationRevision ?? persisted.generationRevision;
    const next: GeneratedPost = {
      ...persisted,
      ...post,
      generationProvenance: post.generationProvenance === undefined
        ? persisted.generationProvenance
        : post.generationProvenance,
    };
    return updatePostAtRevision(
      workspaceId,
      next,
      expectedRevision,
      next.generationProvenance ?? null,
    );
  }
  return createPost(workspaceId, post);
}

function updatePostAtRevision(
  workspaceId: string,
  post: GeneratedPost,
  expectedRevision: number,
  provenance: GenerationProvenance | null,
): PersistedGeneratedPost {
  const current = getPost(workspaceId, post.id);
  if (!current || current.generationRevision !== expectedRevision) {
    throw new GenerationRevisionConflictError('content_post', post.id, expectedRevision);
  }
  const next = {
    ...post,
    updatedAt: nextPostUpdatedAt(current.updatedAt, post.updatedAt),
  };
  const info = stmts().updateAtRevision.run(postToParams(next, {
    expectedGenerationRevision: expectedRevision,
    generationProvenance: provenance,
  }));
  if (info.changes !== 1) {
    throw new GenerationRevisionConflictError('content_post', post.id, expectedRevision);
  }
  const updated = getPost(workspaceId, post.id);
  if (!updated) {
    throw new GenerationRevisionConflictError('content_post', post.id, expectedRevision);
  }
  return updated;
}

export type ContentPostFieldUpdates = Partial<Omit<
  GeneratedPost,
  'id' | 'workspaceId' | 'createdAt' | 'generationRevision' | 'generationProvenance'
>>;

function applyPostFieldUpdates(
  post: PersistedGeneratedPost,
  updates: ContentPostFieldUpdates,
): PersistedGeneratedPost | null {
  if (updates.status !== undefined && updates.status !== post.status) {
    validateTransition('post', POST_STATUS_TRANSITIONS, post.status, updates.status);
  }

  const suppliedUpdates = Object.entries(updates) as Array<
    [keyof ContentPostFieldUpdates, ContentPostFieldUpdates[keyof ContentPostFieldUpdates]]
  >;
  const hasChanges = suppliedUpdates.some(([key, value]) => (
    !isDeepStrictEqual(post[key], value)
  ));
  if (!hasChanges) return null;

  const updated: PersistedGeneratedPost = {
    ...post,
    ...updates,
    updatedAt: nextPostUpdatedAt(post.updatedAt),
  };
  if (['draft', 'review', 'approved'].includes(updated.status)
    && !isCompleteGeneratedPost(updated, updated.sections.length)) {
    throw new IncompleteContentPostError();
  }
  return updated;
}

/** Operator/lifecycle mutation: preserve provenance and increment revision once. */
export function updatePostField(
  workspaceId: string,
  postId: string,
  updates: ContentPostFieldUpdates,
  expectedRevision?: number,
): PersistedGeneratedPost | null {
  const post = getPost(workspaceId, postId);
  if (!post) return null;
  const revision = expectedRevision ?? post.generationRevision;
  if (post.generationRevision !== revision) {
    throw new GenerationRevisionConflictError('content_post', postId, revision);
  }
  const updated = applyPostFieldUpdates(post, updates);
  if (!updated) return post;
  return updatePostAtRevision(workspaceId, updated, revision, post.generationProvenance);
}

export interface ContentPostSnapshotOptions {
  trigger: PostVersion['trigger'];
  triggerDetail?: string;
}

/**
 * Operator/client edit that snapshots and conditionally writes in one immediate
 * transaction. Invalid and semantic no-op edits create neither a revision nor a
 * version row.
 */
export function updatePostFieldWithSnapshot(
  workspaceId: string,
  postId: string,
  updates: ContentPostFieldUpdates,
  expectedRevision: number,
  snapshot: ContentPostSnapshotOptions,
): PersistedGeneratedPost | null {
  return db.transaction(() => {
    const post = getPost(workspaceId, postId);
    if (!post) return null;
    if (post.generationRevision !== expectedRevision) {
      throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
    }
    const updated = applyPostFieldUpdates(post, updates);
    if (!updated) return post;
    snapshotPostVersion(post, snapshot.trigger, snapshot.triggerDetail);
    return updatePostAtRevision(
      workspaceId,
      updated,
      expectedRevision,
      post.generationProvenance,
    );
  }).immediate();
}

/** Fail fast before another paid generation stage when the source revision moved. */
export function assertPostGenerationRevision(
  workspaceId: string,
  postId: string,
  expectedRevision: number,
): void {
  const row = stmts().assertRevision.get(postId, workspaceId) as { generation_revision: number } | undefined;
  if (!row || row.generation_revision !== expectedRevision) {
    throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
  }
}

export interface ContentPostSourceBriefAuthority {
  briefId: string;
  expectedRevision: number;
}

/** Fail fast when the exact brief snapshot that authorized generation moved. */
export function assertBriefGenerationRevision(
  workspaceId: string,
  briefId: string,
  expectedRevision: number,
): void {
  const row = stmts().selectBriefRevision.get(briefId, workspaceId) as
    | { generation_revision: number }
    | undefined;
  if (!row || row.generation_revision !== expectedRevision) {
    throw new GenerationRevisionConflictError('content_brief', briefId, expectedRevision);
  }
}

/** Revision-only authority invalidation for linked request/client decisions. */
export function bumpPostGenerationRevision(
  workspaceId: string,
  postId: string,
  expectedRevision: number,
): PersistedGeneratedPost {
  const current = getPost(workspaceId, postId);
  if (!current || current.generationRevision !== expectedRevision) {
    throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
  }
  const info = stmts().bumpAtRevision.run({
    id: postId,
    workspace_id: workspaceId,
    expected_generation_revision: expectedRevision,
    updated_at: nextPostUpdatedAt(current.updatedAt),
  });
  if (info.changes !== 1) {
    throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
  }
  const updated = getPost(workspaceId, postId);
  if (!updated) throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
  return updated;
}

/**
 * Conditional whole-artifact generation commit. The accepted provenance and
 * content/status update are one atomic row write.
 */
export function commitPostGeneration(
  workspaceId: string,
  post: GeneratedPost,
  expectedRevision: number,
  provenance: GenerationProvenance | null,
  sourceBriefAuthority?: ContentPostSourceBriefAuthority,
): PersistedGeneratedPost {
  const canonicalProvenance = provenance
    ? canonicalGenerationProvenanceSchema.parse(provenance) as GenerationProvenance
    : null;
  const commit = () => {
    if (sourceBriefAuthority) {
      assertBriefGenerationRevision(
        workspaceId,
        sourceBriefAuthority.briefId,
        sourceBriefAuthority.expectedRevision,
      );
    }
    return updatePostAtRevision(workspaceId, post, expectedRevision, canonicalProvenance);
  };
  return sourceBriefAuthority ? db.transaction(commit).immediate() : commit();
}

export function deletePostAtRevision(
  workspaceId: string,
  postId: string,
  expectedRevision: number,
): boolean {
  return db.transaction(() => {
    const current = getPost(workspaceId, postId);
    if (!current) return false;
    if (current.generationRevision !== expectedRevision) {
      throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
    }
    const postResource = {
      resourceType: JOB_RESOURCE_TYPES.CONTENT_POST,
      resourceId: postId,
    } as const;
    const activeOwner = getActiveJobForResource(workspaceId, postResource);
    if (activeOwner) {
      throw new ActiveJobResourceConflict([{
        jobId: activeOwner.id,
        resource: postResource,
      }]);
    }
    assertNoUnresolvedContentPublishReconciliation(workspaceId, postId);

    // Delete version history and the source row together. If the conditional
    // source delete loses a race, the transaction rolls the version delete back.
    vStmts().deleteByPost.run(postId, workspaceId);
    const info = stmts().deleteAtRevision.run({
      id: postId,
      workspace_id: workspaceId,
      expected_generation_revision: expectedRevision,
    });
    if (info.changes !== 1) {
      throw new GenerationRevisionConflictError('content_post', postId, expectedRevision);
    }
    return true;
  }).immediate();
}

/** Backward-compatible delete; revision-aware callers should use deletePostAtRevision. */
export function deletePost(workspaceId: string, postId: string): boolean {
  const current = getPost(workspaceId, postId);
  if (!current) return false;
  return deletePostAtRevision(workspaceId, postId, current.generationRevision);
}

// ── Version history API ──

/** Snapshot the current state of a post before a destructive change. */
export function snapshotPostVersion(
  post: GeneratedPost,
  trigger: PostVersion['trigger'],
  triggerDetail?: string,
): PostVersion {
  const count = (vStmts().countByPost.get(post.id) as { cnt: number }).cnt;
  const version: PostVersion = {
    id: `pv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    postId: post.id,
    workspaceId: post.workspaceId,
    versionNumber: count + 1,
    trigger,
    triggerDetail,
    title: post.title,
    metaDescription: post.metaDescription,
    introduction: post.introduction,
    sections: post.sections,
    conclusion: post.conclusion,
    seoTitle: post.seoTitle,
    seoMetaDescription: post.seoMetaDescription,
    totalWordCount: post.totalWordCount,
    generationProvenance: post.generationProvenance ?? null,
    createdAt: new Date().toISOString(),
  };
  vStmts().insert.run({
    id: version.id,
    post_id: version.postId,
    workspace_id: version.workspaceId,
    version_number: version.versionNumber,
    trigger: version.trigger,
    trigger_detail: version.triggerDetail ?? null,
    title: version.title,
    meta_description: version.metaDescription,
    introduction: version.introduction,
    sections: JSON.stringify(version.sections),
    conclusion: version.conclusion,
    seo_title: version.seoTitle ?? null,
    seo_meta_description: version.seoMetaDescription ?? null,
    total_word_count: version.totalWordCount,
    generation_provenance: version.generationProvenance
      ? JSON.stringify(generationProvenanceSchema.parse(version.generationProvenance))
      : null,
    created_at: version.createdAt,
  });
  log.info(`Snapshot v${version.versionNumber} for post ${post.id} (trigger: ${trigger}${triggerDetail ? `, ${triggerDetail}` : ''})`);
  return version;
}

/**
 * Snapshot the winning source row and replace it only when its generation
 * revision is unchanged. A stale replacement rolls the snapshot back too.
 */
export function replacePostWithSnapshot(
  workspaceId: string,
  replacement: GeneratedPost,
  expectedRevision: number,
  trigger: PostVersion['trigger'],
  triggerDetail?: string,
  provenance?: GenerationProvenance | null,
  sourceBriefAuthority?: ContentPostSourceBriefAuthority,
): PersistedGeneratedPost {
  return db.transaction(() => {
    const current = getPost(workspaceId, replacement.id);
    if (!current || current.generationRevision !== expectedRevision) {
      throw new GenerationRevisionConflictError('content_post', replacement.id, expectedRevision);
    }
    if (sourceBriefAuthority) {
      assertBriefGenerationRevision(
        workspaceId,
        sourceBriefAuthority.briefId,
        sourceBriefAuthority.expectedRevision,
      );
    }
    snapshotPostVersion(current, trigger, triggerDetail);
    return updatePostAtRevision(
      workspaceId,
      replacement,
      expectedRevision,
      provenance === undefined ? current.generationProvenance : provenance,
    );
  }).immediate();
}

/** List all versions for a post (newest first). */
export function listPostVersions(workspaceId: string, postId: string): PostVersion[] {
  const rows = vStmts().listByPost.all(postId, workspaceId) as VersionRow[];
  return rows.map(rowToVersion);
}

/**
 * Return the most recent version's trigger metadata for a post.
 * Used by the client-edit route to coalesce rapid edits into one snapshot per minute:
 * if the newest version is already a client_edit from <60 s ago, skip snapshotting.
 */
export function getMostRecentPostVersion(
  workspaceId: string,
  postId: string,
): { trigger: string; triggerDetail: string | null; createdAt: string } | undefined {
  const row = vStmts().mostRecent.get(postId, workspaceId) as
    | { trigger: string; trigger_detail: string | null; created_at: string }
    | undefined;
  if (!row) return undefined;
  return { trigger: row.trigger, triggerDetail: row.trigger_detail, createdAt: row.created_at };
}

/** Get a specific version by ID. */
export function getPostVersion(workspaceId: string, versionId: string): PostVersion | undefined {
  const row = vStmts().getById.get(versionId, workspaceId) as VersionRow | undefined;
  return row ? rowToVersion(row) : undefined;
}

/** Revert a post to a previous version (snapshots current state first). */
export function revertToVersion(
  workspaceId: string,
  postId: string,
  versionId: string,
  expectedRevision?: number,
): PersistedGeneratedPost | null {
  return db.transaction(() => {
    const post = getPost(workspaceId, postId);
    if (!post) return null;
    const revision = expectedRevision ?? post.generationRevision;
    if (post.generationRevision !== revision) {
      throw new GenerationRevisionConflictError('content_post', postId, revision);
    }
    const version = getPostVersion(workspaceId, versionId);
    if (!version || version.postId !== postId) return null;

    snapshotPostVersion(post, 'manual_edit', `revert_to_v${version.versionNumber}`);

    const reverted: GeneratedPost = {
      ...post,
      title: version.title,
      metaDescription: version.metaDescription,
      introduction: version.introduction,
      sections: version.sections,
      conclusion: version.conclusion,
      seoTitle: version.seoTitle,
      seoMetaDescription: version.seoMetaDescription,
      totalWordCount: version.totalWordCount,
      updatedAt: new Date().toISOString(),
    };
    const updated = updatePostAtRevision(
      workspaceId,
      reverted,
      revision,
      version.generationProvenance,
    );
    log.info(`Reverted post ${postId} to version ${version.versionNumber}`);
    return updated;
  }).immediate();
}
