import db from './db/index.js';
import { createStmtCache } from './db/stmt-cache.js';
import { parseJsonSafeArray } from './db/json-validation.js';
import type { PageEditStatus, PageEditState } from '../shared/types/workspace.ts';
import { z } from 'zod';

// INTERNAL — not exported
interface PageEditRow {
  workspace_id: string;
  page_id: string;
  slug: string | null;
  status: string;
  audit_issues: string | null;
  fields: string | null;
  source: string | null;
  approval_batch_id: string | null;
  content_request_id: string | null;
  work_order_id: string | null;
  recommendation_id: string | null;
  rejection_note: string | null;
  updated_at: string;
  updated_by: string | null;
}

// INTERNAL — not exported
const STATUS_PRIORITY: Record<PageEditStatus, number> = {
  clean: 0, 'issue-detected': 1, 'fix-proposed': 2, 'in-review': 3, approved: 4, rejected: 4, live: 5,
};

// NEW cache — only the stmt keys used by these 5 page-edit-state functions
const stmts = createStmtCache(() => ({
  getById: db.prepare<[id: string]>(`SELECT id FROM workspaces WHERE id = ?`),
  getPageEditState: db.prepare<[workspaceId: string, pageId: string]>(
    `SELECT * FROM page_edit_states WHERE workspace_id = ? AND page_id = ?`,
  ),
  upsertPageEditState: db.prepare(`
    INSERT OR REPLACE INTO page_edit_states
      (workspace_id, page_id, slug, status, audit_issues, fields, source,
       approval_batch_id, content_request_id, work_order_id, recommendation_id,
       rejection_note, updated_at, updated_by)
    VALUES
      (@workspace_id, @page_id, @slug, @status, @audit_issues, @fields, @source,
       @approval_batch_id, @content_request_id, @work_order_id, @recommendation_id,
       @rejection_note, @updated_at, @updated_by)
  `),
  listPageEditStates: db.prepare<[workspaceId: string]>(
    `SELECT * FROM page_edit_states WHERE workspace_id = ?`,
  ),
  deletePageEditState: db.prepare<[workspaceId: string, pageId: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ? AND page_id = ?`,
  ),
  clearAllPageEditStates: db.prepare<[workspaceId: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ?`,
  ),
  deletePageEditStatesByStatus: db.prepare<[workspaceId: string, status: string]>(
    `DELETE FROM page_edit_states WHERE workspace_id = ? AND status = ?`,
  ),
}));

export function updatePageState(
  workspaceId: string,
  pageId: string,
  updates: Partial<Omit<PageEditState, 'pageId' | 'updatedAt'>>,
): PageEditState | null {
  const row = stmts().getById.get(workspaceId) as { id: string } | undefined;
  if (!row) return null;

  const existingRow = stmts().getPageEditState.get(workspaceId, pageId) as PageEditRow | undefined;
  let existing: PageEditState | undefined;
  if (existingRow) {
    existing = {
      pageId: existingRow.page_id,
      slug: existingRow.slug ?? undefined,
      status: existingRow.status as PageEditStatus,
      auditIssues: existingRow.audit_issues ? parseJsonSafeArray(existingRow.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
      fields: existingRow.fields ? parseJsonSafeArray(existingRow.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
      source: existingRow.source as PageEditState['source'] ?? undefined,
      approvalBatchId: existingRow.approval_batch_id ?? undefined,
      contentRequestId: existingRow.content_request_id ?? undefined,
      workOrderId: existingRow.work_order_id ?? undefined,
      recommendationId: existingRow.recommendation_id ?? undefined,
      rejectionNote: existingRow.rejection_note ?? undefined,
      updatedAt: existingRow.updated_at,
      updatedBy: existingRow.updated_by as PageEditState['updatedBy'] ?? undefined,
    };
  }

  // Don't downgrade status unless explicitly setting to clean or rejected
  if (existing && updates.status && updates.status !== 'clean' && updates.status !== 'rejected') {
    if (STATUS_PRIORITY[existing.status] > STATUS_PRIORITY[updates.status]) {
      // Still merge non-status fields
      const { status: _s, ...rest } = updates; // eslint-disable-line @typescript-eslint/no-unused-vars
      if (Object.keys(rest).length === 0) return existing;
      updates = rest;
    }
  }

  const now = new Date().toISOString();
  const base: PageEditState = existing
    ? { ...existing }
    : { pageId, status: 'clean', updatedAt: now };
  const merged: PageEditState = Object.assign(base, updates, { pageId, updatedAt: now });

  stmts().upsertPageEditState.run({
    workspace_id: workspaceId,
    page_id: pageId,
    slug: merged.slug ?? null,
    status: merged.status,
    audit_issues: merged.auditIssues ? JSON.stringify(merged.auditIssues) : null,
    fields: merged.fields ? JSON.stringify(merged.fields) : null,
    source: merged.source ?? null,
    approval_batch_id: merged.approvalBatchId ?? null,
    content_request_id: merged.contentRequestId ?? null,
    work_order_id: merged.workOrderId ?? null,
    recommendation_id: merged.recommendationId ?? null,
    rejection_note: merged.rejectionNote ?? null,
    updated_at: merged.updatedAt,
    updated_by: merged.updatedBy ?? null,
  });

  return merged;
}

export function getPageState(workspaceId: string, pageId: string): PageEditState | undefined {
  const row = stmts().getPageEditState.get(workspaceId, pageId) as PageEditRow | undefined;
  if (!row) return undefined;
  return {
    pageId: row.page_id,
    slug: row.slug ?? undefined,
    status: row.status as PageEditStatus,
    auditIssues: row.audit_issues ? parseJsonSafeArray(row.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
    fields: row.fields ? parseJsonSafeArray(row.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
    source: row.source as PageEditState['source'] ?? undefined,
    approvalBatchId: row.approval_batch_id ?? undefined,
    contentRequestId: row.content_request_id ?? undefined,
    workOrderId: row.work_order_id ?? undefined,
    recommendationId: row.recommendation_id ?? undefined,
    rejectionNote: row.rejection_note ?? undefined,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by as PageEditState['updatedBy'] ?? undefined,
  };
}

export function getAllPageStates(workspaceId: string): Record<string, PageEditState> {
  const rows = stmts().listPageEditStates.all(workspaceId) as PageEditRow[];
  const states: Record<string, PageEditState> = {};
  for (const row of rows) {
    states[row.page_id] = {
      pageId: row.page_id,
      slug: row.slug ?? undefined,
      status: row.status as PageEditStatus,
      auditIssues: row.audit_issues ? parseJsonSafeArray(row.audit_issues, z.string(), { workspaceId, field: 'audit_issues', table: 'page_edit_states' }) : undefined,
      fields: row.fields ? parseJsonSafeArray(row.fields, z.string(), { workspaceId, field: 'fields', table: 'page_edit_states' }) : undefined,
      source: row.source as PageEditState['source'] ?? undefined,
      approvalBatchId: row.approval_batch_id ?? undefined,
      contentRequestId: row.content_request_id ?? undefined,
      workOrderId: row.work_order_id ?? undefined,
      recommendationId: row.recommendation_id ?? undefined,
      rejectionNote: row.rejection_note ?? undefined,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by as PageEditState['updatedBy'] ?? undefined,
    };
  }
  return states;
}

export function clearPageStatesByStatus(workspaceId: string, status: string): number {
  const row = stmts().getById.get(workspaceId) as { id: string } | undefined;
  if (!row) return 0;
  if (status === 'all') {
    // Clear ALL page states for this workspace
    const info = stmts().clearAllPageEditStates.run(workspaceId);
    return info.changes;
  }
  const info = stmts().deletePageEditStatesByStatus.run(workspaceId, status);
  return info.changes;
}

export function clearPageState(workspaceId: string, pageId: string): boolean {
  const row = stmts().getById.get(workspaceId) as { id: string } | undefined;
  if (!row) return false;
  stmts().deletePageEditState.run(workspaceId, pageId);
  return true;
}
