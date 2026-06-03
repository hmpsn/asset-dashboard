#!/usr/bin/env npx tsx
/**
 * seo-genquality-canary.ts — per-workspace canary control for the SEO
 * generation-quality umbrella flag (`seo-generation-quality`).
 *
 * The flag ships DARK (global default OFF). P0 added the per-workspace override
 * layer (`feature_flag_workspace_overrides` + `setWorkspaceFlagOverride`) but no
 * admin endpoint/UI — this CLI is the turnkey way to canary one workspace at a
 * time. Runs against whatever DB `DATA_BASE` points at (staging or prod), so
 * canary on staging FIRST. Setting/removing the override invalidates that
 * workspace's in-memory flag cache immediately.
 *
 * IMPORTANT: flipping the flag only changes FUTURE generation. After flipping,
 * RE-RUN keyword strategy generation for the workspace (platform UI button or the
 * `start_keyword_strategy_generation` MCP tool) — stored strategy/recs are
 * unchanged until regen. See docs/workflows/seo-genquality-canary-rollout.md.
 *
 * Usage:
 *   npx tsx scripts/seo-genquality-canary.ts status <workspaceId>
 *   npx tsx scripts/seo-genquality-canary.ts on     <workspaceId>
 *   npx tsx scripts/seo-genquality-canary.ts off    <workspaceId>   # removes the override → reverts to global/default
 *   npx tsx scripts/seo-genquality-canary.ts list                   # all per-workspace overrides for this flag
 */
import db from '../server/db/index.js';
import { isFeatureEnabled, setWorkspaceFlagOverride } from '../server/feature-flags.js';
import { getWorkspace } from '../server/workspaces.js';

const FLAG = 'seo-generation-quality' as const;

function assertTablePresent(): void {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='feature_flag_workspace_overrides'")
    .get() as { name: string } | undefined;
  if (!row) {
    console.error(
      "✗ table 'feature_flag_workspace_overrides' not found in this DB.\n" +
        '  Migration 114 (shipped with P0, PR #1042) is not applied here — point DATA_BASE at a\n' +
        '  staging/prod DB that has it, or run `npm run db:migrate` against this DB first.',
    );
    process.exit(1);
  }
}

function usage(): never {
  console.error(
    'Usage:\n' +
      '  npx tsx scripts/seo-genquality-canary.ts status <workspaceId>\n' +
      '  npx tsx scripts/seo-genquality-canary.ts on     <workspaceId>\n' +
      '  npx tsx scripts/seo-genquality-canary.ts off    <workspaceId>\n' +
      '  npx tsx scripts/seo-genquality-canary.ts list',
  );
  process.exit(2);
}

function overrideRow(workspaceId: string): { enabled: number } | undefined {
  return db
    .prepare('SELECT enabled FROM feature_flag_workspace_overrides WHERE key = ? AND workspace_id = ?')
    .get(FLAG, workspaceId) as { enabled: number } | undefined;
}

function requireWorkspace(workspaceId: string): void {
  const ws = getWorkspace(workspaceId);
  if (!ws) {
    console.error(`✗ workspace not found: ${workspaceId}`);
    process.exit(1);
  }
  console.log(`  workspace: ${ws.name} (${workspaceId})`);
}

function printStatus(workspaceId: string): void {
  const ov = overrideRow(workspaceId);
  const resolved = isFeatureEnabled(FLAG, workspaceId);
  const ovText = ov === undefined ? 'none (falls back to global → env → default)' : ov.enabled === 1 ? 'ON' : 'OFF';
  console.log(`  per-workspace override: ${ovText}`);
  console.log(`  resolved isFeatureEnabled('${FLAG}', ws): ${resolved ? 'ON' : 'OFF'}`);
  if (resolved) console.log('  → next strategy generation for this workspace uses the new pipeline. Re-run generation to apply.');
}

const [cmd, workspaceId] = process.argv.slice(2);

assertTablePresent();

if (cmd === 'list') {
  const rows = db
    .prepare('SELECT workspace_id, enabled, updated_at FROM feature_flag_workspace_overrides WHERE key = ? ORDER BY updated_at DESC')
    .all(FLAG) as Array<{ workspace_id: string; enabled: number; updated_at: string }>;
  if (rows.length === 0) {
    console.log(`No per-workspace overrides for '${FLAG}'.`);
  } else {
    console.log(`Per-workspace overrides for '${FLAG}':`);
    for (const r of rows) {
      const ws = getWorkspace(r.workspace_id);
      console.log(`  ${r.enabled === 1 ? 'ON ' : 'OFF'}  ${r.workspace_id}  ${ws?.name ?? '(unknown)'}  (updated ${r.updated_at})`);
    }
  }
  process.exit(0);
}

if (!workspaceId || !['status', 'on', 'off'].includes(cmd ?? '')) usage();

requireWorkspace(workspaceId);

if (cmd === 'status') {
  printStatus(workspaceId);
} else if (cmd === 'on') {
  setWorkspaceFlagOverride(FLAG, workspaceId, true);
  console.log(`✓ enabled '${FLAG}' for this workspace (cache invalidated immediately).`);
  printStatus(workspaceId);
} else if (cmd === 'off') {
  setWorkspaceFlagOverride(FLAG, workspaceId, null);
  console.log(`✓ removed the per-workspace override for '${FLAG}' (reverts to global → env → default).`);
  printStatus(workspaceId);
}
process.exit(0);
