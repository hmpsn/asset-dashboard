import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import type {
  BrandDeliverable, DeliverableVersion, BrandDeliverableType, DeliverableTier, BrandDeliverableStatus,
} from '../shared/types/brand-engine.js';

export interface DeliverableRow {
  id: string; workspace_id: string; deliverable_type: string;
  content: string; status: string; version: number; tier: string;
  created_at: string; updated_at: string;
}
export interface VersionRow {
  id: string; deliverable_id: string; content: string;
  steering_notes: string | null; version: number; created_at: string;
}

const stmts = createStmtCache(() => ({
  listByWorkspace: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? ORDER BY tier, deliverable_type`),
  listByTier: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE workspace_id = ? AND tier = ? ORDER BY deliverable_type`),
  getById: db.prepare(`SELECT * FROM brand_identity_deliverables WHERE id = ? AND workspace_id = ?`),
  // Defense in depth: scope by workspace via a join on the parent deliverable
  // even though `deliverable_id` is already a scoped FK. A bug in getDeliverable
  // (or a future caller) that leaks a cross-workspace id shouldn't yield version
  // rows. `brand_identity_versions` has no `workspace_id` column of its own.
  listVersions: db.prepare(`SELECT v.* FROM brand_identity_versions v INNER JOIN brand_identity_deliverables d ON v.deliverable_id = d.id WHERE v.deliverable_id = ? AND d.workspace_id = ? ORDER BY v.version DESC`),
}));

export function rowToDeliverable(row: DeliverableRow): BrandDeliverable {
  return {
    id: row.id, workspaceId: row.workspace_id,
    deliverableType: row.deliverable_type as BrandDeliverableType,
    content: row.content,
    status: row.status as BrandDeliverableStatus,
    version: row.version,
    tier: row.tier as DeliverableTier,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function rowToVersion(row: VersionRow): DeliverableVersion {
  return {
    id: row.id, deliverableId: row.deliverable_id,
    content: row.content, steeringNotes: row.steering_notes ?? undefined,
    version: row.version, createdAt: row.created_at,
  };
}

export function listDeliverables(workspaceId: string, tier?: DeliverableTier): BrandDeliverable[] {
  const rows = tier
    ? stmts().listByTier.all(workspaceId, tier) as DeliverableRow[]
    : stmts().listByWorkspace.all(workspaceId) as DeliverableRow[];
  return rows.map(rowToDeliverable);
}

export function getDeliverable(workspaceId: string, id: string): (BrandDeliverable & { versions: DeliverableVersion[] }) | null {
  const row = stmts().getById.get(id, workspaceId) as DeliverableRow | undefined;
  if (!row) return null;
  const deliverable = rowToDeliverable(row);
  const versions = (stmts().listVersions.all(id, workspaceId) as VersionRow[]).map(rowToVersion);
  return { ...deliverable, versions };
}
