import { Buffer } from 'node:buffer';

import type { OperationalSlice } from '../../../shared/types/intelligence.js';
import { MCP_OPERATOR_BRIEF_LIMITS } from '../../../shared/types/mcp-operator-briefs.js';
import db from '../../db/index.js';
import { createStmtCache } from '../../db/stmt-cache.js';

type PendingDecisionSummary = NonNullable<OperationalSlice['pendingDecisions']>;
type PendingDecision = PendingDecisionSummary['items'][number];

interface PendingProjectionRow {
  workspace_id: string;
  source_id: string;
  parent_id: string | null;
  label: string;
  priority: string | null;
  created_at: string;
}

const approvalProjectionSql = `
  SELECT
    batch.workspace_id,
    CAST(json_extract(item.value, '$.id') AS TEXT) AS source_id,
    batch.id AS parent_id,
    batch.name || ': ' || COALESCE(json_extract(item.value, '$.pageTitle'), '')
      || ' — ' || COALESCE(json_extract(item.value, '$.field'), '') AS label,
    'medium' AS priority,
    COALESCE(json_extract(item.value, '$.createdAt'), batch.created_at) AS created_at
  FROM approval_batches AS batch
  JOIN json_each(CASE WHEN json_valid(batch.items) THEN batch.items ELSE '[]' END) AS item
  WHERE COALESCE(json_extract(item.value, '$.status'), 'pending') = 'pending'
    AND json_type(item.value, '$.id') = 'text'
`;

const requestProjectionSql = `
  SELECT workspace_id, id AS source_id, NULL AS parent_id, title AS label,
    priority, created_at
  FROM requests
  WHERE status = 'new'
`;

const clientActionProjectionSql = `
  SELECT workspace_id, id AS source_id, NULL AS parent_id, title AS label,
    priority, created_at
  FROM client_actions
  WHERE status = 'pending'
`;

const stmts = createStmtCache(() => ({
  approvalsByWorkspace: db.prepare(`${approvalProjectionSql} AND batch.workspace_id = ?`),
  requestsByWorkspace: db.prepare(`${requestProjectionSql} AND workspace_id = ?`),
  clientActionsByWorkspace: db.prepare(`${clientActionProjectionSql} AND workspace_id = ?`),
  allActiveApprovals: db.prepare(`${approvalProjectionSql}
    AND EXISTS (SELECT 1 FROM workspaces WHERE id = batch.workspace_id AND archived_at IS NULL)`),
  allActiveRequests: db.prepare(`${requestProjectionSql}
    AND EXISTS (SELECT 1 FROM workspaces WHERE id = requests.workspace_id AND archived_at IS NULL)`),
  allActiveClientActions: db.prepare(`${clientActionProjectionSql}
    AND EXISTS (SELECT 1 FROM workspaces WHERE id = client_actions.workspace_id AND archived_at IS NULL)`),
}));

const PRIORITY_RANK: Record<PendingDecision['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function normalizedPriority(value: string | null): PendingDecision['priority'] {
  return value === 'urgent' || value === 'high' || value === 'low' ? value : 'medium';
}

function boundedLabel(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim() || fallback;
  if (Buffer.byteLength(normalized, 'utf8') <= MCP_OPERATOR_BRIEF_LIMITS.maxDecisionLabelBytes) {
    return normalized;
  }

  let bounded = '';
  let byteLength = 0;
  for (const character of normalized) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > MCP_OPERATOR_BRIEF_LIMITS.maxDecisionLabelBytes) break;
    bounded += character;
    byteLength += characterBytes;
  }
  return bounded.trimEnd();
}

function comparePendingDecisions(left: PendingDecision, right: PendingDecision): number {
  return PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority]
    || left.createdAt.localeCompare(right.createdAt)
    || left.sourceType.localeCompare(right.sourceType)
    || left.sourceId.localeCompare(right.sourceId);
}

function projectRows(
  rows: readonly PendingProjectionRow[],
  sourceType: PendingDecision['sourceType'],
): PendingDecision[] {
  return rows.map((row) => ({
    sourceType,
    sourceId: row.source_id,
    parentId: row.parent_id,
    label: boundedLabel(row.label, sourceType === 'approval_item'
      ? 'Pending approval'
      : sourceType === 'client_request'
        ? 'New client request'
        : 'Pending client action'),
    priority: normalizedPriority(row.priority),
    createdAt: row.created_at,
  }));
}

function buildSummary(
  approvalRows: readonly PendingProjectionRow[],
  requestRows: readonly PendingProjectionRow[],
  clientActionRows: readonly PendingProjectionRow[],
): PendingDecisionSummary {
  const approvals = projectRows(approvalRows, 'approval_item');
  const requests = projectRows(requestRows, 'client_request');
  const clientActions = projectRows(clientActionRows, 'client_action');
  const pending = [...approvals, ...requests, ...clientActions].sort(comparePendingDecisions);

  return {
    availability: 'available',
    total: pending.length,
    counts: {
      approvals: approvals.length,
      requests: requests.length,
      clientActions: clientActions.length,
    },
    items: pending.slice(0, MCP_OPERATOR_BRIEF_LIMITS.maxListLimit),
  };
}

/** Read one workspace's bounded decision metadata using SELECT-only projections. */
export function readOperatorPendingDecisions(workspaceId: string): PendingDecisionSummary {
  return buildSummary(
    stmts().approvalsByWorkspace.all(workspaceId) as PendingProjectionRow[],
    stmts().requestsByWorkspace.all(workspaceId) as PendingProjectionRow[],
    stmts().clientActionsByWorkspace.all(workspaceId) as PendingProjectionRow[],
  );
}

/** Read all active workspaces in three bounded-column queries for portfolio assembly. */
export function readAllOperatorPendingDecisions(): ReadonlyMap<string, PendingDecisionSummary> {
  const approvals = stmts().allActiveApprovals.all() as PendingProjectionRow[];
  const requests = stmts().allActiveRequests.all() as PendingProjectionRow[];
  const clientActions = stmts().allActiveClientActions.all() as PendingProjectionRow[];
  const groupByWorkspace = (rows: readonly PendingProjectionRow[]) => {
    const grouped = new Map<string, PendingProjectionRow[]>();
    for (const row of rows) {
      const workspaceRows = grouped.get(row.workspace_id) ?? [];
      workspaceRows.push(row);
      grouped.set(row.workspace_id, workspaceRows);
    }
    return grouped;
  };
  const approvalGroups = groupByWorkspace(approvals);
  const requestGroups = groupByWorkspace(requests);
  const clientActionGroups = groupByWorkspace(clientActions);
  const workspaceIds = new Set([
    ...approvalGroups.keys(),
    ...requestGroups.keys(),
    ...clientActionGroups.keys(),
  ]);
  const summaries = new Map<string, PendingDecisionSummary>();

  for (const workspaceId of workspaceIds) {
    summaries.set(workspaceId, buildSummary(
      approvalGroups.get(workspaceId) ?? [],
      requestGroups.get(workspaceId) ?? [],
      clientActionGroups.get(workspaceId) ?? [],
    ));
  }
  return summaries;
}
