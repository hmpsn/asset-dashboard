import { Buffer } from 'node:buffer';

import type { OperationalSlice } from '../../../shared/types/intelligence.js';
import { MCP_OPERATOR_BRIEF_LIMITS } from '../../../shared/types/mcp-operator-briefs.js';
import db from '../../db/index.js';
import { createStmtCache } from '../../db/stmt-cache.js';

type PendingDecisionSummary = NonNullable<OperationalSlice['pendingDecisions']>;
type PendingDecision = PendingDecisionSummary['items'][number];

interface PendingCountRow {
  workspace_id: string;
  total: number;
  approvals: number;
  requests: number;
  client_actions: number;
}

interface PendingProjectionRow {
  workspace_id: string;
  source_type: PendingDecision['sourceType'];
  source_id: string;
  parent_id: string | null;
  label: string;
  priority: PendingDecision['priority'];
  created_at: string;
}

const safeApprovalItem = `CASE WHEN json_valid(item.value) THEN item.value ELSE '{}' END`;

function pendingCountUnionSql(workspacePredicate: string, activeWorkspaceJoin: string): string {
  return `
    SELECT batch.workspace_id, 'approval_item' AS source_type
    FROM approval_batches AS batch
    ${activeWorkspaceJoin.replaceAll('{source}', 'batch')}
    JOIN json_each(CASE WHEN json_valid(batch.items) THEN batch.items ELSE '[]' END) AS item
    WHERE COALESCE(json_extract(${safeApprovalItem}, '$.status'), 'pending') = 'pending'
      AND json_type(${safeApprovalItem}, '$.id') = 'text'
      ${workspacePredicate.replaceAll('{source}', 'batch')}

    UNION ALL

    SELECT request.workspace_id, 'client_request' AS source_type
    FROM requests AS request
    ${activeWorkspaceJoin.replaceAll('{source}', 'request')}
    WHERE request.status = 'new'
      ${workspacePredicate.replaceAll('{source}', 'request')}

    UNION ALL

    SELECT action.workspace_id, 'client_action' AS source_type
    FROM client_actions AS action
    ${activeWorkspaceJoin.replaceAll('{source}', 'action')}
    WHERE action.status = 'pending'
      ${workspacePredicate.replaceAll('{source}', 'action')}
  `;
}

function pendingItemUnionSql(workspacePredicate: string, activeWorkspaceJoin: string): string {
  return `
    SELECT
      batch.workspace_id,
      'approval_item' AS source_type,
      CAST(json_extract(${safeApprovalItem}, '$.id') AS TEXT) AS source_id,
      batch.id AS parent_id,
      batch.name || ': ' || COALESCE(json_extract(${safeApprovalItem}, '$.pageTitle'), '')
        || ' — ' || COALESCE(json_extract(${safeApprovalItem}, '$.field'), '') AS label,
      'medium' AS priority,
      2 AS priority_rank,
      COALESCE(json_extract(${safeApprovalItem}, '$.createdAt'), batch.created_at) AS created_at
    FROM approval_batches AS batch
    ${activeWorkspaceJoin.replaceAll('{source}', 'batch')}
    JOIN json_each(CASE WHEN json_valid(batch.items) THEN batch.items ELSE '[]' END) AS item
    WHERE COALESCE(json_extract(${safeApprovalItem}, '$.status'), 'pending') = 'pending'
      AND json_type(${safeApprovalItem}, '$.id') = 'text'
      ${workspacePredicate.replaceAll('{source}', 'batch')}

    UNION ALL

    SELECT
      request.workspace_id,
      'client_request' AS source_type,
      request.id AS source_id,
      NULL AS parent_id,
      request.title AS label,
      CASE request.priority
        WHEN 'urgent' THEN 'urgent'
        WHEN 'high' THEN 'high'
        WHEN 'low' THEN 'low'
        ELSE 'medium'
      END AS priority,
      CASE request.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END
        AS priority_rank,
      request.created_at
    FROM requests AS request
    ${activeWorkspaceJoin.replaceAll('{source}', 'request')}
    WHERE request.status = 'new'
      ${workspacePredicate.replaceAll('{source}', 'request')}

    UNION ALL

    SELECT
      action.workspace_id,
      'client_action' AS source_type,
      action.id AS source_id,
      NULL AS parent_id,
      action.title AS label,
      CASE action.priority
        WHEN 'urgent' THEN 'urgent'
        WHEN 'high' THEN 'high'
        WHEN 'low' THEN 'low'
        ELSE 'medium'
      END AS priority,
      CASE action.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 3 ELSE 2 END
        AS priority_rank,
      action.created_at
    FROM client_actions AS action
    ${activeWorkspaceJoin.replaceAll('{source}', 'action')}
    WHERE action.status = 'pending'
      ${workspacePredicate.replaceAll('{source}', 'action')}
  `;
}

const byWorkspaceCountSql = pendingCountUnionSql(
  'AND {source}.workspace_id = @workspace_id',
  '',
);
const byWorkspaceItemSql = pendingItemUnionSql(
  'AND {source}.workspace_id = @workspace_id',
  '',
);
const allActiveCountSql = pendingCountUnionSql(
  '',
  'JOIN workspaces AS active_workspace ON active_workspace.id = {source}.workspace_id AND active_workspace.archived_at IS NULL',
);
const allActiveItemSql = pendingItemUnionSql(
  '',
  'JOIN workspaces AS active_workspace ON active_workspace.id = {source}.workspace_id AND active_workspace.archived_at IS NULL',
);

const aggregateColumnsSql = `
  COUNT(source_type) AS total,
  COALESCE(SUM(CASE WHEN source_type = 'approval_item' THEN 1 ELSE 0 END), 0) AS approvals,
  COALESCE(SUM(CASE WHEN source_type = 'client_request' THEN 1 ELSE 0 END), 0) AS requests,
  COALESCE(SUM(CASE WHEN source_type = 'client_action' THEN 1 ELSE 0 END), 0) AS client_actions
`;

const deterministicOrderSql = 'priority_rank, created_at, source_type, source_id';

const stmts = createStmtCache(() => ({
  countsByWorkspace: db.prepare(`
    WITH pending AS (${byWorkspaceCountSql})
    SELECT @workspace_id AS workspace_id, ${aggregateColumnsSql}
    FROM pending
  `),
  itemsByWorkspace: db.prepare(`
    WITH pending AS (${byWorkspaceItemSql})
    SELECT workspace_id, source_type, source_id, parent_id, label, priority, created_at
    FROM pending
    ORDER BY ${deterministicOrderSql}
    LIMIT @limit
  `),
  countsForAllActiveWorkspaces: db.prepare(`
    WITH pending AS (${allActiveCountSql})
    SELECT active_workspace.id AS workspace_id, ${aggregateColumnsSql}
    FROM workspaces AS active_workspace
    LEFT JOIN pending ON pending.workspace_id = active_workspace.id
    WHERE active_workspace.archived_at IS NULL
    GROUP BY active_workspace.id
  `),
  itemsForAllActiveWorkspaces: db.prepare(`
    WITH pending AS (${allActiveItemSql}),
    ranked AS (
      SELECT pending.*,
        ROW_NUMBER() OVER (
          PARTITION BY workspace_id
          ORDER BY ${deterministicOrderSql}
        ) AS workspace_rank
      FROM pending
    )
    SELECT workspace_id, source_type, source_id, parent_id, label, priority, created_at
    FROM ranked
    WHERE workspace_rank <= @limit
    ORDER BY workspace_id, workspace_rank
  `),
}));

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

function projectRows(rows: readonly PendingProjectionRow[]): PendingDecision[] {
  return rows.map((row) => ({
    sourceType: row.source_type,
    sourceId: row.source_id,
    parentId: row.parent_id,
    label: boundedLabel(row.label, row.source_type === 'approval_item'
      ? 'Pending approval'
      : row.source_type === 'client_request'
        ? 'New client request'
        : 'Pending client action'),
    priority: row.priority,
    createdAt: row.created_at,
  }));
}

function buildSummary(
  counts: PendingCountRow,
  rows: readonly PendingProjectionRow[],
): PendingDecisionSummary {
  return {
    availability: 'available',
    total: counts.total,
    counts: {
      approvals: counts.approvals,
      requests: counts.requests,
      clientActions: counts.client_actions,
    },
    items: projectRows(rows),
  };
}

/** Read exact counts plus at most 25 deterministically ordered decision rows for one workspace. */
export function readOperatorPendingDecisions(workspaceId: string): PendingDecisionSummary {
  const parameters = {
    workspace_id: workspaceId,
    limit: MCP_OPERATOR_BRIEF_LIMITS.maxListLimit,
  };
  const counts = stmts().countsByWorkspace.get(parameters) as PendingCountRow;
  const rows = stmts().itemsByWorkspace.all(parameters) as PendingProjectionRow[];
  return buildSummary(counts, rows);
}

/** Read exact active-workspace counts plus a SQL-capped decision projection for portfolio assembly. */
export function readAllOperatorPendingDecisions(): ReadonlyMap<string, PendingDecisionSummary> {
  const countRows = stmts().countsForAllActiveWorkspaces.all() as PendingCountRow[];
  const itemRows = stmts().itemsForAllActiveWorkspaces.all({
    limit: MCP_OPERATOR_BRIEF_LIMITS.maxDrillDownIdsPerWorkspace,
  }) as PendingProjectionRow[];
  const itemsByWorkspace = new Map<string, PendingProjectionRow[]>();
  for (const row of itemRows) {
    const workspaceRows = itemsByWorkspace.get(row.workspace_id) ?? [];
    workspaceRows.push(row);
    itemsByWorkspace.set(row.workspace_id, workspaceRows);
  }

  return new Map(countRows.map((counts) => [
    counts.workspace_id,
    buildSummary(counts, itemsByWorkspace.get(counts.workspace_id) ?? []),
  ]));
}
