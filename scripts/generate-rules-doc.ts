#!/usr/bin/env tsx
/**
 * generate-rules-doc.ts — Generates docs/rules/automated-rules.md from
 * the CHECKS array exported by scripts/pr-check.ts. Run on every PR via
 * CI; the CI step fails if the committed file is out of sync.
 *
 * This is the source-of-truth bridge between scripts/pr-check.ts (which
 * defines the rules) and CLAUDE.md (which should only reference them by
 * pointer, never duplicate them). See PR C of the 2026-04-10 pr-check
 * audit plan for the rationale.
 */

import { writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { CHECKS, type Check } from './pr-check.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(ROOT, 'docs/rules/automated-rules.md');

/**
 * Escape a value for insertion into a GitHub-flavored Markdown table cell.
 * Pipes must be escaped to `\|` and newlines collapsed to single-space to
 * keep every row on one line.
 */
function mdCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Describe the escape hatch (if any) for a rule by finding the `-ok` or
 * `ok-` marker in its `excludeLines` list. Rules without an escape hatch
 * are rendered as `—` (em-dash).
 */
function describeHatch(check: Check): string {
  const hatches = check.excludeLines?.filter((l) => /-ok\b|\bok-/.test(l)) ?? [];
  if (hatches.length === 0) return '—';
  return hatches.map((h) => `\`${h}\``).join(' / ');
}

/**
 * Describe the scope a rule runs against: the pathFilter when present,
 * otherwise the fileGlobs list.
 */
function describeScope(check: Check): string {
  if (check.pathFilter) return check.pathFilter;
  return check.fileGlobs.join(', ');
}

/**
 * Detection method: `pattern` for ripgrep-based rules, `custom` for
 * customCheck rules. Some rules mix both (customCheck with a fallback
 * pattern) — in that case we prefer `custom` because the customCheck
 * is what actually runs.
 */
function describeMethod(check: Check): string {
  if (check.customCheck) return 'custom';
  if (check.pattern) return 'pattern';
  return '—';
}

function renderTable(checks: readonly Check[]): string {
  const header =
    '| # | Rule | Severity | Method | Scope | Escape hatch | Rationale |\n' +
    '|---|------|----------|--------|-------|--------------|-----------|';
  const rows = checks.map((c, i) => {
    const rationale = c.rationale ?? c.message;
    return [
      i + 1,
      mdCell(c.name),
      c.severity,
      describeMethod(c),
      `\`${mdCell(describeScope(c))}\``,
      describeHatch(c),
      mdCell(rationale),
    ]
      .map(String)
      .join(' | ');
  });
  return `${header}\n| ${rows.join(' |\n| ')} |`;
}

function renderBySeverity(
  checks: readonly Check[],
  severity: Check['severity'],
): { heading: string; count: number; table: string } {
  const subset = checks.filter((c) => c.severity === severity);
  return {
    heading: severity === 'error' ? 'Errors (block merge)' : 'Warnings (advisory)',
    count: subset.length,
    table: subset.length === 0 ? '_(none)_' : renderTable(subset),
  };
}

function main(): void {
  const errors = renderBySeverity(CHECKS, 'error');
  const warnings = renderBySeverity(CHECKS, 'warn');

  const content = `# Automated Rules (generated)

> **DO NOT EDIT.** This file is regenerated from \`scripts/pr-check.ts\` on every PR.
> Run \`npm run rules:generate\` to update. CI fails if the committed file drifts
> from the generator output.

Total rules: **${CHECKS.length}** — ${errors.count} error, ${warnings.count} warn.

Every rule below is enforced automatically by \`npx tsx scripts/pr-check.ts\`.
Rules in the **error** tier block merges; rules in the **warn** tier are
advisory but tracked.

---

## ${errors.heading}

${errors.table}

---

## ${warnings.heading}

${warnings.table}

---

## How to add a new rule

See [docs/rules/pr-check-rule-authoring.md](./pr-check-rule-authoring.md).

## How to regenerate this file

\`\`\`bash
npm run rules:generate
\`\`\`

CI runs the same command and fails the build if the working tree differs
from the committed file.
`;

  writeFileSync(OUTPUT_PATH, content);
  console.log(
    `Wrote ${CHECKS.length} rules (${errors.count} error, ${warnings.count} warn) to ${path.relative(ROOT, OUTPUT_PATH)}`,
  );
}

main();
