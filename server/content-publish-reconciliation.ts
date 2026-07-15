import { randomUUID } from 'node:crypto';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';

export const CONTENT_PUBLISH_EXTERNAL_STATES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
} as const;

export type ContentPublishExternalState =
  typeof CONTENT_PUBLISH_EXTERNAL_STATES[keyof typeof CONTENT_PUBLISH_EXTERNAL_STATES];

export interface ContentPublishReconciliation {
  id: string;
  workspaceId: string;
  postId: string;
  collectionId: string;
  itemId: string;
  externalState: ContentPublishExternalState;
  sourceGenerationRevision: number;
  firstSeenAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export class UnresolvedContentPublishReconciliationError extends Error {
  readonly code = 'CONTENT_PUBLISH_RECONCILIATION_REQUIRED' as const;
  readonly workspaceId: string;
  readonly postId: string;

  constructor(workspaceId: string, postId: string) {
    super(
      'This post cannot be deleted because its external publish state is unresolved. '
      + 'Retry the publish reconciliation or resolve the external item, then try deleting again.',
    );
    this.name = 'UnresolvedContentPublishReconciliationError';
    this.workspaceId = workspaceId;
    this.postId = postId;
  }
}

interface ContentPublishReconciliationRow {
  id: string;
  workspace_id: string;
  post_id: string;
  collection_id: string;
  item_id: string;
  external_state: ContentPublishExternalState;
  source_generation_revision: number;
  first_seen_at: string;
  updated_at: string;
  resolved_at: string | null;
}

const stmts = createStmtCache(() => ({
  getUnresolved: db.prepare(`
    SELECT *
    FROM content_publish_reconciliations
    WHERE workspace_id = ? AND post_id = ? AND collection_id = ? AND resolved_at IS NULL
    LIMIT 1
  `),
  getUnresolvedForPost: db.prepare(`
    SELECT *
    FROM content_publish_reconciliations
    WHERE workspace_id = ? AND post_id = ? AND resolved_at IS NULL
    ORDER BY first_seen_at ASC
    LIMIT 1
  `),
  getUnresolvedForOtherCollection: db.prepare(`
    SELECT *
    FROM content_publish_reconciliations
    WHERE workspace_id = ? AND post_id = ? AND collection_id <> ?
      AND resolved_at IS NULL
    ORDER BY first_seen_at ASC
    LIMIT 1
  `),
  insert: db.prepare(`
    INSERT INTO content_publish_reconciliations (
      id, workspace_id, post_id, collection_id, item_id, external_state,
      source_generation_revision, first_seen_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `),
  updateUnresolved: db.prepare(`
    UPDATE content_publish_reconciliations
    SET item_id = ?,
      external_state = CASE
        WHEN external_state = 'published' OR ? = 'published' THEN 'published'
        ELSE 'draft'
      END,
      source_generation_revision = ?,
      updated_at = ?
    WHERE id = ? AND workspace_id = ? AND post_id = ? AND resolved_at IS NULL
  `),
  resolve: db.prepare(`
    UPDATE content_publish_reconciliations
    SET resolved_at = ?, updated_at = ?
    WHERE workspace_id = ? AND post_id = ? AND collection_id = ?
      AND item_id = ? AND resolved_at IS NULL
  `),
}));

function rowToReconciliation(row: ContentPublishReconciliationRow): ContentPublishReconciliation {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    postId: row.post_id,
    collectionId: row.collection_id,
    itemId: row.item_id,
    externalState: row.external_state,
    sourceGenerationRevision: row.source_generation_revision,
    firstSeenAt: row.first_seen_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at ?? undefined,
  };
}

export function getUnresolvedContentPublishReconciliation(
  workspaceId: string,
  postId: string,
  collectionId: string,
): ContentPublishReconciliation | null {
  const row = stmts().getUnresolved.get(
    workspaceId,
    postId,
    collectionId,
  ) as ContentPublishReconciliationRow | undefined;
  return row ? rowToReconciliation(row) : null;
}

export function getUnresolvedContentPublishReconciliationForPost(
  workspaceId: string,
  postId: string,
): ContentPublishReconciliation | null {
  const row = stmts().getUnresolvedForPost.get(
    workspaceId,
    postId,
  ) as ContentPublishReconciliationRow | undefined;
  return row ? rowToReconciliation(row) : null;
}

export function getUnresolvedContentPublishReconciliationForOtherCollection(
  workspaceId: string,
  postId: string,
  collectionId: string,
): ContentPublishReconciliation | null {
  const row = stmts().getUnresolvedForOtherCollection.get(
    workspaceId,
    postId,
    collectionId,
  ) as ContentPublishReconciliationRow | undefined;
  return row ? rowToReconciliation(row) : null;
}

/**
 * Protect external-publish evidence from the content_posts cascade. Call this
 * from the same immediate transaction as a post delete so a reconciliation
 * writer cannot race between the check and the destructive write.
 */
export function assertNoUnresolvedContentPublishReconciliation(
  workspaceId: string,
  postId: string,
): void {
  if (getUnresolvedContentPublishReconciliationForPost(workspaceId, postId)) {
    throw new UnresolvedContentPublishReconciliationError(workspaceId, postId);
  }
}

export function recordContentPublishReconciliation(input: {
  workspaceId: string;
  postId: string;
  collectionId: string;
  itemId: string;
  externalState: ContentPublishExternalState;
  sourceGenerationRevision: number;
}): ContentPublishReconciliation {
  return db.transaction(() => {
    const existing = getUnresolvedContentPublishReconciliation(
      input.workspaceId,
      input.postId,
      input.collectionId,
    );
    const now = new Date().toISOString();
    if (existing) {
      stmts().updateUnresolved.run(
        input.itemId,
        input.externalState,
        input.sourceGenerationRevision,
        now,
        existing.id,
        input.workspaceId,
        input.postId,
      );
    } else {
      stmts().insert.run(
        randomUUID(),
        input.workspaceId,
        input.postId,
        input.collectionId,
        input.itemId,
        input.externalState,
        input.sourceGenerationRevision,
        now,
        now,
      );
    }
    const recorded = getUnresolvedContentPublishReconciliation(
      input.workspaceId,
      input.postId,
      input.collectionId,
    );
    if (!recorded) throw new Error('Content publish reconciliation disappeared during write');
    return recorded;
  }).immediate();
}

export function resolveContentPublishReconciliation(input: {
  workspaceId: string;
  postId: string;
  collectionId: string;
  itemId: string;
}): boolean {
  const now = new Date().toISOString();
  return stmts().resolve.run(
    now,
    now,
    input.workspaceId,
    input.postId,
    input.collectionId,
    input.itemId,
  ).changes > 0;
}
