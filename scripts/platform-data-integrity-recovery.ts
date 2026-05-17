#!/usr/bin/env tsx

import fs from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import { DATA_BASE } from '../server/data-dir.js';

export type WorkspaceOrphanEntry = {
  table: string;
  hasWorkspaceForeignKey: boolean;
  missingWorkspaceRefs: number;
  sample: Array<{ rowid: number; workspaceId: string }>;
};

export type ForeignKeyViolation = {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
};

export type CrossTableConsistencyIssue = {
  childTable: string;
  parentTable: string;
  childColumns: string[];
  parentColumns: string[];
  missingParentCount: number;
  sample: Array<Record<string, string | number | null>>;
};

export type ArtifactRecoveryClassification = 'preserve' | 'rebuildable' | 'partial';

export type ArtifactRecoveryMapEntry = {
  artifact: string;
  storageSurface: string;
  classification: ArtifactRecoveryClassification;
  rebuildSource: string;
  notes: string;
};

export type DataIntegrityRecoveryReport = {
  generatedBy: 'scripts/platform-data-integrity-recovery.ts';
  generatedAt: string;
  dbPath: string;
  checks: {
    quickCheck: string;
    integrityCheck: string;
    foreignKeyViolations: number;
    workspaceOrphanTables: number;
    workspaceOrphanRows: number;
    crossTableIssues: number;
  };
  foreignKeyViolations: ForeignKeyViolation[];
  workspaceOrphans: WorkspaceOrphanEntry[];
  crossTableConsistencyIssues: CrossTableConsistencyIssue[];
  artifactRecoveryMap: ArtifactRecoveryMapEntry[];
};

type TableInfoRow = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

type ForeignKeyListRow = {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string | null;
  on_update: string;
  on_delete: string;
  match: string;
};

type ForeignKeyGroup = {
  childTable: string;
  parentTable: string;
  childColumns: string[];
  parentColumns: string[];
};

type ReportOptions = {
  includeFullIntegrityCheck?: boolean;
};

const ESCAPE_DOUBLE_QUOTES = /"/g;
const ESCAPE_SINGLE_QUOTES = /'/g;

export const ARTIFACT_RECOVERY_MAP: ArtifactRecoveryMapEntry[] = [
  {
    artifact: 'Content briefs, posts, and post versions',
    storageSurface: 'content_briefs, content_posts, content_post_versions',
    classification: 'preserve',
    rebuildSource: 'Human-authored editorial data (no deterministic regeneration)',
    notes: 'Treat as source-of-truth content. Restore from backup if lost.',
  },
  {
    artifact: 'Client actions, approvals, and conversations',
    storageSurface: 'client_actions, approval_batches, content_topic_requests, requests',
    classification: 'preserve',
    rebuildSource: 'Client/admin decision history',
    notes: 'These are legally/operationally important audit trails.',
  },
  {
    artifact: 'Brand voice and identity state',
    storageSurface: 'voice_profiles, voice_samples, brandscripts, brand_identity_versions',
    classification: 'preserve',
    rebuildSource: 'Calibrated business context and reviewed assets',
    notes: 'Re-creation requires manual re-calibration and loses historical intent.',
  },
  {
    artifact: 'Workspace and billing state',
    storageSurface: 'workspaces, users, client_users, payments, usage_tracking, content_subscriptions',
    classification: 'preserve',
    rebuildSource: 'Operational configuration + billing lifecycle',
    notes: 'Must be preserved for entitlement and accounting correctness.',
  },
  {
    artifact: 'Schema drafts and snapshots',
    storageSurface: 'schema_site_plans, schema_snapshots, schema_validations',
    classification: 'partial',
    rebuildSource: 'Can be regenerated from current site + templates + AI runs',
    notes: 'Rebuild is possible, but approved/reviewed history should still be preserved.',
  },
  {
    artifact: 'SEO recommendations and strategy derivatives',
    storageSurface: 'seo_suggestions, quick_wins, keyword_gaps, topic_clusters, cannibalization_issues',
    classification: 'rebuildable',
    rebuildSource: 'Provider/API refresh + recomputation pipelines',
    notes: 'Safe to recompute; restore only if you need historical continuity.',
  },
  {
    artifact: 'Analytics insights and anomaly feed',
    storageSurface: 'analytics_insights, anomalies, workspace_learnings',
    classification: 'partial',
    rebuildSource: 'Can be regenerated from analytics inputs and insight engines',
    notes: 'Regeneration loses prior resolution rationale and learning chronology.',
  },
  {
    artifact: 'Operational job records',
    storageSurface: 'jobs, copy_batch_jobs, seo_bulk_operations, seo_bulk_operation_pages',
    classification: 'rebuildable',
    rebuildSource: 'Ephemeral execution state',
    notes: 'Can be rebuilt by rerunning jobs; restore primarily for incident forensics.',
  },
  {
    artifact: 'Activity log and compliance narrative',
    storageSurface: 'activity_log, email_sends, sent_reminders',
    classification: 'preserve',
    rebuildSource: 'Human and system event history',
    notes: 'Needed for support, audits, and root-cause investigations.',
  },
];

function quoteIdent(identifier: string): string {
  return `"${identifier.replace(ESCAPE_DOUBLE_QUOTES, '""')}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replace(ESCAPE_SINGLE_QUOTES, "''")}'`;
}

function resolveDbPath(overridePath?: string): string {
  if (overridePath && overridePath.trim().length > 0) {
    return path.resolve(overridePath);
  }
  const dbDir = DATA_BASE || path.join(process.env.HOME || '', '.asset-dashboard');
  return path.join(dbDir, 'dashboard.db');
}

function readUserTables(db: Database.Database): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name",
    )
    .all() as Array<{ name: string }>;

  return rows.map(row => row.name);
}

function readTableInfo(db: Database.Database, table: string): TableInfoRow[] {
  return db.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as TableInfoRow[];
}

function readForeignKeyRows(db: Database.Database, table: string): ForeignKeyListRow[] {
  return db.prepare(`PRAGMA foreign_key_list(${quoteIdent(table)})`).all() as ForeignKeyListRow[];
}

function readForeignKeyGroups(db: Database.Database, table: string): ForeignKeyGroup[] {
  const rows = readForeignKeyRows(db, table);
  const groupsById = new Map<number, ForeignKeyListRow[]>();
  for (const row of rows) {
    const current = groupsById.get(row.id) ?? [];
    current.push(row);
    groupsById.set(row.id, current);
  }

  const groups: ForeignKeyGroup[] = [];
  for (const groupedRows of groupsById.values()) {
    const sorted = [...groupedRows].sort((a, b) => a.seq - b.seq);
    const parentTable = sorted[0]?.table;
    if (!parentTable) continue;

    const parentPrimaryKeyColumns = readTableInfo(db, parentTable)
      .filter(col => col.pk > 0)
      .sort((a, b) => a.pk - b.pk)
      .map(col => col.name);

    const childColumns: string[] = [];
    const parentColumns: string[] = [];

    for (let index = 0; index < sorted.length; index += 1) {
      const row = sorted[index];
      childColumns.push(row.from);
      const resolvedParentColumn = row.to ?? parentPrimaryKeyColumns[index] ?? parentPrimaryKeyColumns[0];
      if (!resolvedParentColumn) continue;
      parentColumns.push(resolvedParentColumn);
    }

    if (childColumns.length === 0 || parentColumns.length === 0) continue;
    groups.push({
      childTable: table,
      parentTable,
      childColumns,
      parentColumns,
    });
  }

  return groups;
}

function evaluateWorkspaceOrphans(db: Database.Database, tables: string[]): WorkspaceOrphanEntry[] {
  const orphanEntries: WorkspaceOrphanEntry[] = [];

  for (const table of tables) {
    const columns = readTableInfo(db, table);
    const hasWorkspaceIdColumn = columns.some(column => column.name === 'workspace_id');
    if (!hasWorkspaceIdColumn) continue;

    const fkRows = readForeignKeyRows(db, table);
    const hasWorkspaceForeignKey = fkRows.some(row => row.from === 'workspace_id' && row.table === 'workspaces');

    const countRow = db.prepare(
      `SELECT COUNT(*) AS count
       FROM ${quoteIdent(table)} AS t
       LEFT JOIN workspaces AS w ON w.id = t.workspace_id
       WHERE t.workspace_id IS NOT NULL AND w.id IS NULL`,
    ).get() as { count: number };

    const sampleRows = db.prepare(
      `SELECT t.rowid AS rowid, t.workspace_id AS workspace_id
       FROM ${quoteIdent(table)} AS t
       LEFT JOIN workspaces AS w ON w.id = t.workspace_id
       WHERE t.workspace_id IS NOT NULL AND w.id IS NULL
       LIMIT 5`,
    ).all() as Array<{ rowid: number; workspace_id: string }>;

    orphanEntries.push({
      table,
      hasWorkspaceForeignKey,
      missingWorkspaceRefs: countRow.count,
      sample: sampleRows.map(row => ({ rowid: row.rowid, workspaceId: row.workspace_id })),
    });
  }

  return orphanEntries.filter(entry => entry.missingWorkspaceRefs > 0);
}

function evaluateCrossTableConsistency(db: Database.Database, tables: string[]): CrossTableConsistencyIssue[] {
  const issues: CrossTableConsistencyIssue[] = [];
  const knownTables = new Set(tables);

  for (const table of tables) {
    const groups = readForeignKeyGroups(db, table);

    for (const group of groups) {
      if (!knownTables.has(group.parentTable)) {
        const nonNullClause = group.childColumns
          .map(childColumn => `c.${quoteIdent(childColumn)} IS NOT NULL`)
          .join(' AND ');

        const missingParentRowCount = db.prepare(
          `SELECT COUNT(*) AS count
           FROM ${quoteIdent(group.childTable)} AS c
           WHERE ${nonNullClause}`,
        ).get() as { count: number };

        if (missingParentRowCount.count > 0) {
          const sampleSelectColumns = [
            'c.rowid AS rowid',
            ...group.childColumns.map(column => `c.${quoteIdent(column)} AS child_${column}`),
          ].join(', ');

          const sampleRows = db.prepare(
            `SELECT ${sampleSelectColumns}
             FROM ${quoteIdent(group.childTable)} AS c
             WHERE ${nonNullClause}
             LIMIT 5`,
          ).all() as Array<Record<string, string | number | null>>;

          issues.push({
            childTable: group.childTable,
            parentTable: group.parentTable,
            childColumns: group.childColumns,
            parentColumns: group.parentColumns,
            missingParentCount: missingParentRowCount.count,
            sample: sampleRows,
          });
        }

        continue;
      }

      const joinClause = group.childColumns
        .map((childColumn, index) => `p.${quoteIdent(group.parentColumns[index])} = c.${quoteIdent(childColumn)}`)
        .join(' AND ');

      const nonNullClause = group.childColumns
        .map(childColumn => `c.${quoteIdent(childColumn)} IS NOT NULL`)
        .join(' AND ');

      const missingCountRow = db.prepare(
        `SELECT COUNT(*) AS count
         FROM ${quoteIdent(group.childTable)} AS c
         LEFT JOIN ${quoteIdent(group.parentTable)} AS p ON ${joinClause}
         WHERE ${nonNullClause}
           AND p.${quoteIdent(group.parentColumns[0])} IS NULL`,
      ).get() as { count: number };

      if (missingCountRow.count === 0) continue;

      const sampleSelectColumns = [
        'c.rowid AS rowid',
        ...group.childColumns.map(column => `c.${quoteIdent(column)} AS child_${column}`),
      ].join(', ');

      const sampleRows = db.prepare(
        `SELECT ${sampleSelectColumns}
         FROM ${quoteIdent(group.childTable)} AS c
         LEFT JOIN ${quoteIdent(group.parentTable)} AS p ON ${joinClause}
         WHERE ${nonNullClause}
           AND p.${quoteIdent(group.parentColumns[0])} IS NULL
         LIMIT 5`,
      ).all() as Array<Record<string, string | number | null>>;

      issues.push({
        childTable: group.childTable,
        parentTable: group.parentTable,
        childColumns: group.childColumns,
        parentColumns: group.parentColumns,
        missingParentCount: missingCountRow.count,
        sample: sampleRows,
      });
    }
  }

  return issues;
}

function evaluateForeignKeyViolations(db: Database.Database): ForeignKeyViolation[] {
  const rows = db.prepare('PRAGMA foreign_key_check').all() as Array<{
    table: string;
    rowid: number;
    parent: string;
    fkid: number;
  }>;

  return rows.map(row => ({
    table: row.table,
    rowid: row.rowid,
    parent: row.parent,
    fkid: row.fkid,
  }));
}

function evaluateQuickCheck(db: Database.Database): string {
  const row = db.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined;
  if (!row) return 'unknown';
  const firstValue = Object.values(row)[0];
  return typeof firstValue === 'string' ? firstValue : String(firstValue);
}

function evaluateIntegrityCheck(db: Database.Database): string {
  const row = db.prepare('PRAGMA integrity_check').get() as Record<string, string> | undefined;
  if (!row) return 'unknown';
  const firstValue = Object.values(row)[0];
  return typeof firstValue === 'string' ? firstValue : String(firstValue);
}

export function buildDataIntegrityRecoveryReport(
  database: Database.Database,
  dbPathLabel: string,
  options: ReportOptions = {},
): DataIntegrityRecoveryReport {
  const includeFullIntegrityCheck = options.includeFullIntegrityCheck ?? true;
  const tables = readUserTables(database);
  const quickCheck = evaluateQuickCheck(database);
  const integrityCheck = includeFullIntegrityCheck ? evaluateIntegrityCheck(database) : 'skipped';
  const foreignKeyViolations = evaluateForeignKeyViolations(database);
  const workspaceOrphans = evaluateWorkspaceOrphans(database, tables);
  const crossTableConsistencyIssues = evaluateCrossTableConsistency(database, tables);

  const workspaceOrphanRows = workspaceOrphans.reduce((sum, entry) => sum + entry.missingWorkspaceRefs, 0);

  return {
    generatedBy: 'scripts/platform-data-integrity-recovery.ts',
    generatedAt: new Date().toISOString(),
    dbPath: dbPathLabel,
    checks: {
      quickCheck,
      integrityCheck,
      foreignKeyViolations: foreignKeyViolations.length,
      workspaceOrphanTables: workspaceOrphans.length,
      workspaceOrphanRows,
      crossTableIssues: crossTableConsistencyIssues.length,
    },
    foreignKeyViolations,
    workspaceOrphans,
    crossTableConsistencyIssues,
    artifactRecoveryMap: ARTIFACT_RECOVERY_MAP,
  };
}

export function formatDataIntegrityRecoveryReportAsMarkdown(report: DataIntegrityRecoveryReport): string {
  const lines: string[] = [
    '# Data Integrity & Recovery Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Database: \`${report.dbPath}\``,
    '',
    '## Summary',
    '',
    `- quick_check: \`${report.checks.quickCheck}\``,
    `- integrity_check: \`${report.checks.integrityCheck}\``,
    `- foreign-key violations: ${report.checks.foreignKeyViolations}`,
    `- workspace orphan tables: ${report.checks.workspaceOrphanTables}`,
    `- workspace orphan rows: ${report.checks.workspaceOrphanRows}`,
    `- cross-table consistency issues: ${report.checks.crossTableIssues}`,
    '',
  ];

  if (report.foreignKeyViolations.length > 0) {
    lines.push('## Foreign Key Violations', '');
    for (const violation of report.foreignKeyViolations.slice(0, 20)) {
      lines.push(
        `- table=\`${violation.table}\`, rowid=\`${violation.rowid}\`, parent=\`${violation.parent}\`, fkid=\`${violation.fkid}\``,
      );
    }
    if (report.foreignKeyViolations.length > 20) {
      lines.push(`- ...and ${report.foreignKeyViolations.length - 20} more`);
    }
    lines.push('');
  }

  if (report.workspaceOrphans.length > 0) {
    lines.push('## Workspace Orphan Tables', '');
    for (const orphan of report.workspaceOrphans) {
      lines.push(
        `- \`${orphan.table}\`: ${orphan.missingWorkspaceRefs} missing workspace reference(s)${orphan.hasWorkspaceForeignKey ? ' (has FK declared)' : ' (no workspace FK declared)'}`,
      );
    }
    lines.push('');
  }

  if (report.crossTableConsistencyIssues.length > 0) {
    lines.push('## Cross-table Consistency Issues', '');
    for (const issue of report.crossTableConsistencyIssues.slice(0, 20)) {
      lines.push(
        `- \`${issue.childTable}\` → \`${issue.parentTable}\` on (${issue.childColumns.join(', ')}) has ${issue.missingParentCount} missing parent row(s)`,
      );
    }
    if (report.crossTableConsistencyIssues.length > 20) {
      lines.push(`- ...and ${report.crossTableConsistencyIssues.length - 20} more`);
    }
    lines.push('');
  }

  lines.push(
    '## Artifact Recovery Map',
    '',
    '| Artifact | Storage | Classification | Rebuild source | Notes |',
    '| --- | --- | --- | --- | --- |',
  );

  for (const entry of report.artifactRecoveryMap) {
    lines.push(
      `| ${entry.artifact} | \`${entry.storageSurface}\` | ${entry.classification} | ${entry.rebuildSource} | ${entry.notes} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export function runDataIntegrityRecoveryReport(args: string[]): number {
  const jsonOutput = args.includes('--json');
  const quickOnly = args.includes('--quick');

  const dbFlagIndex = args.indexOf('--db');
  const dbOverride = dbFlagIndex >= 0 ? args[dbFlagIndex + 1] : undefined;
  if (dbFlagIndex >= 0 && (!dbOverride || dbOverride.startsWith('--'))) {
    console.error('Missing value for --db');
    return 1;
  }

  const dbPath = resolveDbPath(dbOverride);
  if (!fs.existsSync(dbPath)) {
    console.error(`Database not found at ${dbPath}`);
    return 1;
  }

  const database = new Database(dbPath, { readonly: true });
  try {
    try {
      const report = buildDataIntegrityRecoveryReport(database, dbPath, {
        includeFullIntegrityCheck: !quickOnly,
      });
      if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatDataIntegrityRecoveryReportAsMarkdown(report));
      }
      return 0;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (jsonOutput) {
        console.log(JSON.stringify({ error: `Failed integrity report: ${message}` }, null, 2));
      } else {
        console.error(`Failed integrity report for ${dbPath}: ${message}`);
      }
      return 1;
    }
  } finally {
    database.close();
  }
}
