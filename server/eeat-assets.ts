import { randomUUID } from 'crypto';

import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafe } from './db/json-validation.js';
import {
  eeatAssetMetadataSchema,
  type CreateEeatAssetInput,
  type UpdateEeatAssetInput,
} from './schemas/eeat-assets.js';
import type { EeatAsset, EeatAssetType } from '../shared/types/eeat-assets.js';

interface EeatAssetRow {
  id: string;
  workspace_id: string;
  asset_type: string;
  title: string;
  url: string | null;
  content: string | null;
  metadata_json: string | null;
  created_at: string;
  updated_at: string;
}

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare<[workspaceId: string]>(`
    SELECT * FROM eeat_assets
    WHERE workspace_id = ?
    ORDER BY updated_at DESC, created_at DESC
  `),
  getById: db.prepare<[workspaceId: string, id: string]>(`
    SELECT * FROM eeat_assets
    WHERE workspace_id = ? AND id = ?
  `),
  insert: db.prepare(`
    INSERT INTO eeat_assets (
      id,
      workspace_id,
      asset_type,
      title,
      url,
      content,
      metadata_json,
      created_at,
      updated_at
    ) VALUES (
      @id,
      @workspace_id,
      @asset_type,
      @title,
      @url,
      @content,
      @metadata_json,
      @created_at,
      @updated_at
    )
  `),
  update: db.prepare(`
    UPDATE eeat_assets
    SET
      asset_type = @asset_type,
      title = @title,
      url = @url,
      content = @content,
      metadata_json = @metadata_json,
      updated_at = @updated_at
    WHERE workspace_id = @workspace_id AND id = @id
  `),
  deleteById: db.prepare<[workspaceId: string, id: string]>(`
    DELETE FROM eeat_assets
    WHERE workspace_id = ? AND id = ?
  `),
}));

function rowToEeatAsset(row: EeatAssetRow): EeatAsset {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    type: row.asset_type as EeatAssetType,
    title: row.title,
    url: row.url ?? undefined,
    content: row.content ?? undefined,
    metadata: row.metadata_json
      ? parseJsonSafe(row.metadata_json, eeatAssetMetadataSchema, null, {
          workspaceId: row.workspace_id,
          table: 'eeat_assets',
          field: 'metadata_json',
        }) ?? undefined
      : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nullableText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function listEeatAssets(workspaceId: string): EeatAsset[] {
  const rows = stmts().listByWorkspace.all(workspaceId) as EeatAssetRow[];
  return rows.map(rowToEeatAsset);
}

export function getEeatAsset(workspaceId: string, id: string): EeatAsset | undefined {
  const row = stmts().getById.get(workspaceId, id) as EeatAssetRow | undefined;
  return row ? rowToEeatAsset(row) : undefined;
}

export function createEeatAsset(workspaceId: string, input: CreateEeatAssetInput): EeatAsset {
  const now = new Date().toISOString();
  const id = randomUUID();
  stmts().insert.run({
    id,
    workspace_id: workspaceId,
    asset_type: input.type,
    title: input.title.trim(),
    url: nullableText(input.url),
    content: nullableText(input.content),
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null,
    created_at: now,
    updated_at: now,
  });
  const created = getEeatAsset(workspaceId, id);
  if (!created) throw new Error('Failed to create E-E-A-T asset');
  return created;
}

export function updateEeatAsset(
  workspaceId: string,
  id: string,
  patch: UpdateEeatAssetInput,
): EeatAsset | null {
  const existing = getEeatAsset(workspaceId, id);
  if (!existing) return null;

  const type = patch.type ?? existing.type;
  const title = patch.title?.trim() ?? existing.title;
  const url = patch.url !== undefined ? nullableText(patch.url) : existing.url ?? null;
  const content = patch.content !== undefined ? nullableText(patch.content) : existing.content ?? null;
  const metadata = patch.metadata !== undefined ? patch.metadata : existing.metadata;

  stmts().update.run({
    id,
    workspace_id: workspaceId,
    asset_type: type,
    title,
    url,
    content,
    metadata_json: metadata ? JSON.stringify(metadata) : null,
    updated_at: new Date().toISOString(),
  });

  return getEeatAsset(workspaceId, id) ?? null;
}

export function deleteEeatAsset(workspaceId: string, id: string): boolean {
  const info = stmts().deleteById.run(workspaceId, id);
  return info.changes > 0;
}
