/**
 * Content Posts — Database CRUD operations and version history.
 * Handles all SQLite persistence for generated posts and their version snapshots.
 */
import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type { PostSection, GeneratedPost } from '../shared/types/content.ts';
import { createLogger } from './logger.js';
import { parseJsonSafe, parseJsonSafeArray } from './db/json-validation.js';
import { postSectionSchema, reviewChecklistSchema } from './schemas/content-schemas.js';
import { validateTransition, POST_STATUS_TRANSITIONS } from './state-machines.js';

const log = createLogger('content-posts-db');

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
  unification_status: string | null;
  unification_note: string | null;
  webflow_item_id: string | null;
  webflow_collection_id: string | null;
  published_at: string | null;
  published_slug: string | null;
  review_checklist: string | null;
  voice_score: number | null;
  voice_feedback: string | null;
  created_at: string;
  updated_at: string;
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
  created_at: string;
}

const vStmts = createStmtCache(() => ({
  insert: db.prepare(
    `INSERT INTO content_post_versions
           (id, post_id, workspace_id, version_number, trigger, trigger_detail,
            title, meta_description, introduction, sections, conclusion,
            seo_title, seo_meta_description, total_word_count, created_at)
         VALUES
           (@id, @post_id, @workspace_id, @version_number, @trigger, @trigger_detail,
            @title, @meta_description, @introduction, @sections, @conclusion,
            @seo_title, @seo_meta_description, @total_word_count, @created_at)`,
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
    createdAt: row.created_at,
  };
}

const stmts = createStmtCache(() => ({
  // Note: INSERT omits webflow_* / published_* columns intentionally.
  // savePost() routes existing rows to UPDATE (which includes them).
  // New posts never have publish data so omitting here is safe.
  insert: db.prepare(
    `INSERT OR REPLACE INTO content_posts
           (id, workspace_id, brief_id, target_keyword, title, meta_description,
            introduction, sections, conclusion, seo_title, seo_meta_description,
            total_word_count, target_word_count, status, unification_status,
            unification_note, review_checklist, voice_score, voice_feedback,
            created_at, updated_at)
         VALUES
           (@id, @workspace_id, @brief_id, @target_keyword, @title, @meta_description,
            @introduction, @sections, @conclusion, @seo_title, @seo_meta_description,
            @total_word_count, @target_word_count, @status, @unification_status,
            @unification_note, @review_checklist, @voice_score, @voice_feedback,
            @created_at, @updated_at)`,
  ),
  selectByWorkspace: db.prepare(
    `SELECT * FROM content_posts WHERE workspace_id = ? ORDER BY created_at DESC`,
  ),
  selectById: db.prepare(
    `SELECT * FROM content_posts WHERE id = ? AND workspace_id = ?`,
  ),
  update: db.prepare(
    `UPDATE content_posts SET
           title = @title, meta_description = @meta_description,
           introduction = @introduction, sections = @sections, conclusion = @conclusion,
           seo_title = @seo_title, seo_meta_description = @seo_meta_description,
           total_word_count = @total_word_count, target_word_count = @target_word_count,
           status = @status, unification_status = @unification_status,
           unification_note = @unification_note, review_checklist = @review_checklist,
           webflow_item_id = @webflow_item_id, webflow_collection_id = @webflow_collection_id,
           published_at = @published_at, published_slug = @published_slug,
           voice_score = @voice_score, voice_feedback = @voice_feedback,
           updated_at = @updated_at
         WHERE id = @id`,
  ),
  deleteById: db.prepare(
    `DELETE FROM content_posts WHERE id = ? AND workspace_id = ?`,
  ),
}));

function rowToPost(row: PostRow): GeneratedPost {
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
    unificationStatus: row.unification_status as GeneratedPost['unificationStatus'] ?? undefined,
    unificationNote: row.unification_note ?? undefined,
    webflowItemId: row.webflow_item_id ?? undefined,
    webflowCollectionId: row.webflow_collection_id ?? undefined,
    publishedAt: row.published_at ?? undefined,
    publishedSlug: row.published_slug ?? undefined,
    reviewChecklist: row.review_checklist
      ? parseJsonSafe(row.review_checklist, reviewChecklistSchema, {
          factual_accuracy: false, brand_voice: false, internal_links: false,
          no_hallucinations: false, meta_optimized: false, word_count_target: false,
        }, { field: 'review_checklist', table: 'content_posts' })
      : undefined,
    voiceScore: row.voice_score ?? undefined,
    voiceFeedback: row.voice_feedback ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function postToParams(post: GeneratedPost): Record<string, unknown> {
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
    unification_status: post.unificationStatus ?? null,
    unification_note: post.unificationNote ?? null,
    webflow_item_id: post.webflowItemId ?? null,
    webflow_collection_id: post.webflowCollectionId ?? null,
    published_at: post.publishedAt ?? null,
    published_slug: post.publishedSlug ?? null,
    review_checklist: post.reviewChecklist ? JSON.stringify(post.reviewChecklist) : null,
    voice_score: post.voiceScore ?? null,
    voice_feedback: post.voiceFeedback ?? null,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
  };
}

export function listPosts(workspaceId: string): GeneratedPost[] {
  const rows = stmts().selectByWorkspace.all(workspaceId) as PostRow[];
  return rows.map(rowToPost);
}

export function getPost(workspaceId: string, postId: string): GeneratedPost | undefined {
  const row = stmts().selectById.get(postId, workspaceId) as PostRow | undefined;
  return row ? rowToPost(row) : undefined;
}

export function savePost(workspaceId: string, post: GeneratedPost): void {
  const existing = stmts().selectById.get(post.id, workspaceId) as PostRow | undefined;
  if (existing) {
    stmts().update.run(postToParams(post));
  } else {
    stmts().insert.run(postToParams(post));
  }
}

export function updatePostField(workspaceId: string, postId: string, updates: Partial<Omit<GeneratedPost, 'id' | 'workspaceId' | 'createdAt'>>): GeneratedPost | null {
  const post = getPost(workspaceId, postId);
  if (!post) return null;

  // Validate status transition if status is being changed
  if (updates.status !== undefined && updates.status !== post.status) {
    validateTransition('post', POST_STATUS_TRANSITIONS, post.status, updates.status);
  }

  Object.assign(post, updates, { updatedAt: new Date().toISOString() });
  stmts().update.run(postToParams(post));
  return post;
}

export function deletePost(workspaceId: string, postId: string): boolean {
  // Also delete version history
  vStmts().deleteByPost.run(postId, workspaceId);
  const info = stmts().deleteById.run(postId, workspaceId);
  return info.changes > 0;
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
    created_at: version.createdAt,
  });
  log.info(`Snapshot v${version.versionNumber} for post ${post.id} (trigger: ${trigger}${triggerDetail ? `, ${triggerDetail}` : ''})`);
  return version;
}

/** List all versions for a post (newest first). */
export function listPostVersions(workspaceId: string, postId: string): PostVersion[] {
  const rows = vStmts().listByPost.all(postId, workspaceId) as VersionRow[];
  return rows.map(rowToVersion);
}

/** Get a specific version by ID. */
export function getPostVersion(workspaceId: string, versionId: string): PostVersion | undefined {
  const row = vStmts().getById.get(versionId, workspaceId) as VersionRow | undefined;
  return row ? rowToVersion(row) : undefined;
}

/** Revert a post to a previous version (snapshots current state first). */
export function revertToVersion(workspaceId: string, postId: string, versionId: string): GeneratedPost | null {
  const post = getPost(workspaceId, postId);
  if (!post) return null;
  const version = getPostVersion(workspaceId, versionId);
  if (!version || version.postId !== postId) return null;

  // Snapshot current state before reverting
  snapshotPostVersion(post, 'manual_edit', `revert_to_v${version.versionNumber}`);

  // Apply version data
  post.title = version.title;
  post.metaDescription = version.metaDescription;
  post.introduction = version.introduction;
  post.sections = version.sections;
  post.conclusion = version.conclusion;
  post.seoTitle = version.seoTitle;
  post.seoMetaDescription = version.seoMetaDescription;
  post.totalWordCount = version.totalWordCount;
  post.updatedAt = new Date().toISOString();
  stmts().update.run(postToParams(post));
  log.info(`Reverted post ${postId} to version ${version.versionNumber}`);
  return post;
}
