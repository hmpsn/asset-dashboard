#!/usr/bin/env tsx
/**
 * phase2-guard.ts — Frozen-paths guard for Design System Phase 2.
 *
 * Phase 1 had two agents strip `src/components/ui/index.ts` of other PRs'
 * exports. Phase 2 touches hundreds of consumer files, so a similar mistake
 * would have catastrophic blast radius. This script rejects any diff
 * against `origin/staging` that modifies a frozen path.
 *
 * Usage:
 *   # In a Phase 2 worker agent's commit flow, run before `git push`:
 *   npx tsx scripts/phase2-guard.ts
 *
 *   # Or install as a pre-push hook:
 *   echo '#!/bin/sh\nnpx tsx scripts/phase2-guard.ts' > .git/hooks/pre-push
 *   chmod +x .git/hooks/pre-push
 *
 * Exits 0 on clean, non-zero with explanation on violation.
 *
 * See docs/superpowers/plans/2026-04-24-phase-2-kickoff.md §5.
 */
import { execSync } from 'child_process';

// ─── Frozen paths — Phase 2 agents MUST NOT modify these ────────────────────
//
// Rationale per §5 of the kickoff doc:
// - The barrel: two Phase 1 agents stripped it; any Phase 2 change to it
//   would recreate the same coordination disaster.
// - Phase 1 primitive source: frozen; bug fixes go in dedicated hotfix PRs,
//   not buried inside Phase 2 task commits.
// - Design system docs: section numbering + inventory rows coordinated by
//   the integrator agent, never directly by workers.
// - Infra/config: Phase 1 already finalized these; no Phase 2 reason to touch.

const FROZEN_EXACT = new Set<string>([
  'src/components/ui/index.ts',
  'src/components/ui/Icon.tsx',
  'src/components/ui/Button.tsx',
  'src/components/ui/IconButton.tsx',
  'src/components/ui/ActionPill.tsx',
  'src/components/ui/SegmentedControl.tsx',
  'src/components/ui/TrendBadge.tsx',
  'src/components/ui/ChartCard.tsx',
  'vite.config.ts',
  'src/index.css',
  'src/tokens.css',
  'public/tokens.css',
  'public/styleguide.css',
  'package.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'scripts/pr-check.ts', // Phase 3 owns rule additions
]);

const FROZEN_PREFIXES = [
  'src/components/ui/typography/',
  'src/components/ui/forms/',
  'src/components/ui/layout/',
  'src/components/ui/overlay/',
  'server/', // Phase 2 is UI-only
  'shared/types/', // frozen unless explicitly required
];

// Docs where workers emit suggestions to the integrator, not direct commits.
// Phase 2 PRs that modify these fail the guard; integrator batches updates
// separately on a coordination branch.
const FROZEN_DOCS = new Set<string>([
  'DESIGN_SYSTEM.md',
  'BRAND_DESIGN_LANGUAGE.md',
]);

// ─── Modes ───────────────────────────────────────────────────────────────
//
// Default: --against=origin/staging (the branch-level diff).
// --staged: check just the currently staged index (for a pre-commit hook).
// --integrator: bypass with explicit opt-in; integrator agent may update docs.

const args = process.argv.slice(2);
const STAGED = args.includes('--staged');
const INTEGRATOR = args.includes('--integrator');
const AGAINST = (args.find(a => a.startsWith('--against='))?.split('=')[1]) ?? 'origin/staging';

// ─── Get the list of changed paths ──────────────────────────────────────
function getChangedPaths(): string[] {
  const cmd = STAGED
    ? 'git diff --cached --name-only'
    : `git diff --name-only ${AGAINST}...HEAD`;
  try {
    const out = execSync(cmd, { encoding: 'utf8' });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[phase2-guard] failed to read diff: ${msg}`);
    console.error(`  command: ${cmd}`);
    process.exit(2);
  }
}

// ─── Check a single path against the frozen list ────────────────────────
interface Violation {
  path: string;
  reason: string;
}

function checkPath(path: string): Violation | null {
  if (FROZEN_EXACT.has(path)) {
    return { path, reason: 'Frozen file — Phase 1 primitive/config, not editable in Phase 2' };
  }
  for (const prefix of FROZEN_PREFIXES) {
    if (path.startsWith(prefix)) {
      return { path, reason: `Frozen directory (prefix: ${prefix})` };
    }
  }
  if (FROZEN_DOCS.has(path) && !INTEGRATOR) {
    return {
      path,
      reason:
        'Design system doc — workers emit suggestions to integrator, ' +
        'not direct commits. Use --integrator to bypass (integrator agent only).',
    };
  }
  return null;
}

// ─── Run the check ──────────────────────────────────────────────────────
const paths = getChangedPaths();
if (paths.length === 0) {
  console.log('[phase2-guard] no changes to check.');
  process.exit(0);
}

const violations = paths.map(checkPath).filter((v): v is Violation => v !== null);

if (violations.length === 0) {
  console.log(`[phase2-guard] ✓ ${paths.length} changed path(s), 0 frozen-path violations.`);
  process.exit(0);
}

console.error('');
console.error(`[phase2-guard] ✗ ${violations.length} frozen-path violation(s):`);
console.error('');
for (const v of violations) {
  console.error(`  ${v.path}`);
  console.error(`    → ${v.reason}`);
  console.error('');
}
console.error('Phase 2 workers must not modify these paths.');
console.error('See docs/superpowers/plans/2026-04-24-phase-2-kickoff.md §5.');
console.error('');
console.error('If this is the integrator agent doing a coordinated doc update,');
console.error('re-run with --integrator to bypass the docs check.');
console.error('');
process.exit(1);
