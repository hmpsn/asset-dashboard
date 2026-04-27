#!/usr/bin/env tsx
/**
 * scripts/verify-styleguide-parity.ts
 *
 * Verifies that src/tokens.css is the single source of truth for CSS custom
 * properties. Specifically:
 *   1. src/tokens.css must exist and contain at least one --* declaration.
 *   2. public/styleguide.css (if it exists) must NOT re-declare any --* token
 *      (all tokens must come via @import url('/tokens.css')).
 *   3. src/index.css must NOT re-declare --* tokens that are already in
 *      src/tokens.css (it should only @import './tokens.css').
 *
 * Exit code 0 = pass. Exit code 1 = violations found (warn severity in Phase 0).
 *
 * Wired into scripts/pr-check.ts as a customCheck (warn severity).
 * Promoted to error in Phase 3.
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

function readFile(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

/** Extract all --* property names declared in a CSS file (top-level :root or .class blocks). */
function extractTokenDeclarations(css: string): string[] {
  // Match lines like: `  --brand-mint: #2dd4bf;`
  const matches = css.matchAll(/^\s*(--[\w-]+)\s*:/gm);
  return [...matches].map(m => m[1]);
}

let hasError = false;
const violations: string[] = [];

// ─── 1. src/tokens.css must exist ────────────────────────────────────────────
const tokensPath = resolve(root, 'src/tokens.css');
const tokensCss = readFile(tokensPath);

if (!tokensCss) {
  violations.push('MISSING: src/tokens.css does not exist. Create it with all --* token declarations.');
  hasError = true;
} else {
  const tokensInFile = extractTokenDeclarations(tokensCss);
  if (tokensInFile.length === 0) {
    violations.push('EMPTY: src/tokens.css has no --* declarations. It must contain the full token set.');
    hasError = true;
  } else {
    console.log(`✓  src/tokens.css — ${tokensInFile.length} token(s) declared`);
  }
}

// ─── 2. public/styleguide.css must NOT redeclare tokens ──────────────────────
const styleguidePath = resolve(root, 'public/styleguide.css');
const styleguideCss = readFile(styleguidePath);

if (styleguideCss) {
  const redeclared = extractTokenDeclarations(styleguideCss);
  if (redeclared.length > 0) {
    violations.push(
      `PARITY VIOLATION: public/styleguide.css re-declares ${redeclared.length} token(s). ` +
      `Remove them — tokens must come via \`@import url('/tokens.css')\` only.\n` +
      `  First violators: ${redeclared.slice(0, 5).join(', ')}${redeclared.length > 5 ? ', ...' : ''}`
    );
    hasError = true;
  } else {
    console.log(`✓  public/styleguide.css — 0 token re-declarations (imports only)`);
  }
} else {
  console.log(`ℹ  public/styleguide.css not found — skipping styleguide parity check`);
}

// ─── 3. src/index.css must NOT redeclare tokens that are in src/tokens.css ──
const indexPath = resolve(root, 'src/index.css');
const indexCss = readFile(indexPath);

if (indexCss && tokensCss) {
  const tokensInTokensFile = new Set(extractTokenDeclarations(tokensCss));
  const tokensInIndex = extractTokenDeclarations(indexCss);
  const duplicates = tokensInIndex.filter(t => tokensInTokensFile.has(t));

  if (duplicates.length > 0) {
    violations.push(
      `DUPLICATION: src/index.css re-declares ${duplicates.length} token(s) already in src/tokens.css. ` +
      `Remove them from index.css.\n` +
      `  Duplicates: ${duplicates.slice(0, 5).join(', ')}${duplicates.length > 5 ? ', ...' : ''}`
    );
    hasError = true;
  } else {
    console.log(`✓  src/index.css — 0 token duplicates (all tokens in src/tokens.css)`);
  }
}

// ─── 4. public/tokens.css must be an exact mirror of src/tokens.css ──────────
const publicTokensPath = resolve(root, 'public/tokens.css');
const publicTokensCss = readFile(publicTokensPath);

if (publicTokensCss && tokensCss) {
  if (publicTokensCss !== tokensCss) {
    violations.push(
      `DRIFT: public/tokens.css differs from src/tokens.css. ` +
      `public/tokens.css is the build-copied mirror — only edit src/tokens.css, ` +
      `then run \`npx vite build\` (or copy manually) to sync.`
    );
    hasError = true;
  } else {
    console.log(`✓  public/tokens.css — exact mirror of src/tokens.css`);
  }
} else if (!publicTokensCss) {
  console.log(`ℹ  public/tokens.css not found — will be generated at next build`);
}

// ─── Report ───────────────────────────────────────────────────────────────────
if (hasError) {
  console.error('\n✗  Styleguide token parity check FAILED:');
  for (const v of violations) {
    console.error(`   ${v}`);
  }
  console.error('\n  Fix: ensure src/tokens.css is the single token source of truth.\n');
  process.exit(1);
} else {
  console.log('\n✓  Styleguide token parity check passed\n');
  process.exit(0);
}
