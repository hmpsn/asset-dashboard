/**
 * pr-check.ts — Automated pre-PR checklist
 *
 * Default: only checks files changed in the current branch (git diff vs main/staging).
 * Use --all to scan the entire codebase.
 *
 * Run:
 *   npx tsx scripts/pr-check.ts          # diff-only (for CI / per-PR checks)
 *   npx tsx scripts/pr-check.ts --all    # full codebase scan (for audits)
 *
 * Catches the most common issues that slip through TypeScript:
 *   - Purple in client-facing components (violates Three Laws of Color)
 *   - violet- or indigo- in any component (forbidden hues)
 *   - Bare JSON.parse on server (use parseJsonSafe / parseJsonFallback)
 *   - Hard-coded "hmpsn.studio" strings (use STUDIO_NAME constant)
 *   - Local prepared statement caching (use createStmtCache/stmts())
 *   - Raw fetch() in components (use typed API client)
 *   - z.array(z.unknown()) on server (use parseJsonSafeArray + typed schema)
 *   - Bare SUM() in db.prepare() strings (use COALESCE to avoid NULL aggregates)
 *   - Assembled-but-never-rendered slice fields (warns if a slice field is in the type but not the formatter)
 */

import { execSync, execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const ROOT = path.join(import.meta.dirname, '..');
const SCAN_ALL = process.argv.includes('--all');

// ─── Determine changed files ──────────────────────────────────────────────────

function getChangedFiles(): string[] {
  try {
    // In GitHub Actions PR context, GITHUB_BASE_REF is set (e.g., "main")
    const ghBase = process.env.GITHUB_BASE_REF;
    if (ghBase) {
      try {
        const out = execFileSync('git', ['diff', '--name-only', `origin/${ghBase}...HEAD`], {
          cwd: ROOT,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        if (out) return out.split('\n').filter(Boolean);
      } catch {
        // fall through
      }
    }

    // Local dev: diff against staging or main
    for (const base of ['origin/staging', 'origin/main']) {
      try {
        const out = execSync(`git diff --name-only ${base} 2>/dev/null`, {
          cwd: ROOT,
          encoding: 'utf-8',
        }).trim();
        if (out) return out.split('\n').filter(Boolean);
      } catch {
        // try next
      }
    }

    // On a push to main/staging (squash merge): diff against previous commit
    try {
      const out = execSync(`git diff --name-only HEAD~1 2>/dev/null`, {
        cwd: ROOT,
        encoding: 'utf-8',
      }).trim();
      if (out) return out.split('\n').filter(Boolean);
    } catch {
      // no previous commit (initial commit) — fall through to empty
    }
    return [];
  } catch {
    return [];
  }
}

const changedFiles = SCAN_ALL ? [] : getChangedFiles();
const mode = SCAN_ALL ? 'full scan' : changedFiles.length > 0
  ? `${changedFiles.length} changed file(s)`
  : 'full scan (no diff detected)';

// ─── Check definitions ────────────────────────────────────────────────────────

type Check = {
  name: string;
  pattern: string;
  fileGlobs: string[];
  exclude?: string | string[];
  pathFilter?: string;  // only scan files under this path prefix
  excludeLines?: string[];  // grep -v patterns — lines matching any of these are filtered out
  message: string;
  severity: 'error' | 'warn';
};

const CHECKS: Check[] = [
  {
    name: 'Purple in client components',
    pattern: 'purple-',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/components/client/',
    message: 'Purple is admin-only (Three Laws of Color). Use teal for actions, blue for data.',
    severity: 'error',
  },
  {
    name: 'Forbidden hues (violet/indigo) in components',
    pattern: '(violet-|indigo-)',
    fileGlobs: ['*.ts', '*.tsx'],
    message: 'violet- and indigo- are forbidden. Use teal, blue, or purple (admin only).',
    severity: 'error',
  },
  {
    name: 'Bare JSON.parse on server',
    pattern: 'JSON\\.parse\\(',
    fileGlobs: ['*.ts'],
    // json-validation.ts is the implementation; the rest parse AI API response strings (not DB columns)
    exclude: [
      'server/db/json-validation.ts', 'server/content-posts-ai.ts', 'server/routes/keyword-strategy.ts',
      'server/content-brief.ts', 'server/routes/aeo-review.ts', 'server/routes/jobs.ts',
      'server/schema-plan.ts', 'server/schema-suggester.ts', 'server/seo-audit.ts',
      'server/performance-store.ts', 'server/rank-tracking.ts', 'server/aeo-page-review.ts',
      'server/routes/webflow-seo.ts', // AI response text parser, not DB columns
    ],
    message: 'Use parseJsonSafe() or parseJsonFallback() from server/db/json-validation.ts.',
    severity: 'error',
  },
  {
    name: 'Hard-coded studio name',
    pattern: 'hmpsn\\.studio',
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['server/constants.ts', 'src/constants.ts'],
    message: 'Use the STUDIO_NAME / STUDIO_URL constant from src/constants.ts (frontend) or server/constants.ts (backend).',
    severity: 'error',
  },
  {
    name: 'Raw fetch() in components',
    pattern: '(?<![a-zA-Z])fetch\\(',
    fileGlobs: ['*.ts', '*.tsx'],
    message: 'Use typed API client modules from src/api/ — no raw fetch() in components.',
    severity: 'warn',
  },
  {
    name: 'Local prepared statement caching',
    pattern: 'let stmt',
    fileGlobs: ['*.ts'],
    message: 'Use createStmtCache()/stmts() for prepared statements. Local `let stmt` guards are useless.',
    severity: 'warn',
  },
  {
    name: 'z.array(z.unknown()) on server',
    pattern: 'z\\.array\\(z\\.unknown\\(\\)\\)',
    fileGlobs: ['*.ts'],
    exclude: 'server/db/json-validation.ts',
    message: 'Use parseJsonSafeArray(raw, typedItemSchema, context) — z.unknown() bypasses per-item validation and requires unsafe casts.',
    severity: 'error',
  },
  {
    name: 'Bare SUM() without COALESCE in db.prepare',
    // Match SUM( not immediately preceded by ( — excludes COALESCE(SUM( while catching bare SUM(col)
    pattern: '(^|[^(])SUM\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    message: 'Wrap SUM() with COALESCE: COALESCE(SUM(col), 0). SQLite SUM returns NULL (not 0) when no rows match.',
    severity: 'warn',
  },
  {
    name: 'as any on dynamic import results',
    // Catches patterns like: `(h: any)`, `(m: any)`, `as any).`, `as any,`, `as any;`
    // These hide wrong property/function names — the #1 source of silent data bugs.
    pattern: '(\\([a-z]+:\\s*any\\)|as any[);,.])',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/db/json-validation.ts', 'server/middleware/'],
    excludeLines: ['// as-any-ok'],
    message: 'Use `import type { T } from "./module.js"` instead of `as any`. Guessed property names are the #1 bug source. Add `// as-any-ok` comment if truly unavoidable.',
    severity: 'warn',
  },
  {
    name: 'Hardcoded dark hex in inline styles',
    pattern: 'style=\\{[^}]*(#0f1219|#18181b|#27272a|#303036|#52525b)',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/components/',
    exclude: 'Styleguide.tsx',
    // Exclude correct usages: themeColor/chart helpers already handle light mode
    excludeLines: ['themeColor(', 'chartGridColor(', 'chartAxisColor(', 'chartDotStroke(', 'chartDotFill('],
    message: 'Use CSS variables or chartColor helpers from ui/constants.ts. Hardcoded dark hex breaks light mode.',
    severity: 'warn',
  },
  {
    name: 'SVG with hardcoded dark fill/stroke',
    pattern: '(fill|stroke)=\\"(#0f1219|#18181b|#27272a|#303036|#52525b)\\"',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/components/',
    exclude: 'Styleguide.tsx',
    // Exclude correct usages: chart helpers already handle light mode
    excludeLines: ['chartDotStroke(', 'chartDotFill(', 'chartAxisColor(', 'chartGridColor('],
    message: 'Use chartDotStroke()/chartAxisColor() from ui/constants.ts for SVG colors. Dark hex breaks light mode.',
    severity: 'warn',
  },
  {
    name: 'Direct listPages() outside workspace-data',
    pattern: 'listPages\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/workspace-data.ts', 'server/webflow-pages.ts'],
    message: 'Use getWorkspacePages() from workspace-data.ts instead of calling listPages() directly.',
    severity: 'error',
  },
  {
    name: 'Direct buildSeoContext() call',
    pattern: 'buildSeoContext\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/seo-context.ts', 'server/workspace-intelligence.ts'],
    message: 'Use buildWorkspaceIntelligence({ slices: ["seoContext"] }) instead of buildSeoContext().',
    severity: 'error',
  },
  {
    name: 'buildWorkspaceIntelligence() without slices (assembles all 8 slices)',
    // Matches calls that don't specify slices — typically: buildWorkspaceIntelligence(id) or buildWorkspaceIntelligence(id, { pagePath })
    pattern: 'buildWorkspaceIntelligence\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/workspace-intelligence.ts'],
    // Lines with slices: already correct; lines in route/intelligence.ts that dynamically pass slices are also fine
    // 'slices:' catches key:value form; ' slices,' and ' slices }' catch object shorthand (const slices = [...]; { slices, pagePath })
    excludeLines: ['slices:', ' slices,', ' slices }', ' slices)', '// bwi-all-ok'],
    message: 'Always pass { slices: [...] } to buildWorkspaceIntelligence(). Omitting it assembles all 8 slices (expensive). Add `// bwi-all-ok` if intentional.',
    severity: 'warn',
  },
  {
    name: 'formatForPrompt with inline sections literal (use buildIntelPrompt or sections: slices)',
    // Catches formatForPrompt( calls that pass a literal array for sections, e.g. sections: ['seoContext', 'learnings']
    // These are dangerous because the literal can diverge from the slices array.
    pattern: 'formatForPrompt\\(.*sections:\\s*\\[',
    fileGlobs: ['**/*.ts'],
    pathFilter: 'server/',
    exclude: ['server/workspace-intelligence.ts', 'tests/'],
    excludeLines: ['// bip-ok'],
    message: 'Use buildIntelPrompt(id, slices) when only the formatted string is needed. When raw intel is also needed: const slices = [...]; formatForPrompt(intel, { sections: slices }). Add `// bip-ok` for intentional exceptions.',
    severity: 'warn',
  },
  {
    name: 'Unguarded recordAction() call',
    pattern: 'recordAction\\s*\\(\\s*\\{',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/outcome-tracking.ts'],
    excludeLines: ['// recordAction-ok'],
    message: 'recordAction() must be gated by `if (workspaceId)`. Add `// recordAction-ok` if verified safe.',
    severity: 'warn',
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

function isExcluded(file: string, exclude: string | string[] | undefined): boolean {
  if (!exclude) return false;
  const list = Array.isArray(exclude) ? exclude : [exclude];
  return list.some(e => file.includes(e.replace('/', path.sep)));
}

function applyExcludeLines(lines: string[], excludeLines?: string[]): string[] {
  if (!excludeLines || excludeLines.length === 0) return lines;
  return lines.filter(line => !excludeLines.some(ex => line.includes(ex)));
}

function checkFile(file: string, check: Check): string[] {
  if (isExcluded(file, check.exclude)) return [];
  try {
    const out = execSync(
      `grep -n -E "${check.pattern}" "${file}" 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    );
    const lines = out.trim() ? out.trim().split('\n').filter(Boolean).map(l => `${file}:${l}`) : [];
    return applyExcludeLines(lines, check.excludeLines);
  } catch {
    return [];
  }
}

// Directories that should never be scanned (vendor code, test fixtures, build output)
const EXCLUDED_DIRS = ['node_modules', 'dist', '.git', '.claude', 'scripts', 'tests'];
// Root-level files to skip (--exclude-dir doesn't work on files)
const EXCLUDED_FILES = ['test-branding.ts'];

function checkDirectory(dir: string, check: Check): string[] {
  const globs = check.fileGlobs.map(g => `--include="${g}"`).join(' ');
  const excludeDirs = EXCLUDED_DIRS.map(d => `--exclude-dir="${d}"`).join(' ');
  const excludeFiles = EXCLUDED_FILES.map(f => `--exclude="${f}"`).join(' ');
  const excludeList = check.exclude ? (Array.isArray(check.exclude) ? check.exclude : [check.exclude]) : [];
  const excludeFlag = excludeList.map(e => `--exclude="${path.basename(e)}"`).join(' ');
  try {
    const out = execSync(
      `grep -rn ${globs} ${excludeDirs} ${excludeFiles} ${excludeFlag} -E "${check.pattern}" "${dir}" 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    );
    const lines = out.trim() ? out.trim().split('\n').filter(Boolean) : [];
    return applyExcludeLines(lines, check.excludeLines);
  } catch {
    return [];
  }
}

let errors = 0;
let warnings = 0;

console.log(`\n🔍 Running PR checks (${mode})...\n`);

for (const check of CHECKS) {
  let matches: string[] = [];

  if (!SCAN_ALL && changedFiles.length > 0) {
    // Only check changed files that match the glob extensions
    const exts = check.fileGlobs.map(g => g.replace('*.', '.'));
    const relevant = changedFiles.filter(f =>
      exts.some(ext => f.endsWith(ext)) &&
      !isExcluded(f, check.exclude) &&
      (!check.pathFilter || f.startsWith(check.pathFilter)) &&
      !EXCLUDED_DIRS.some(d => f.startsWith(d + '/') || f === d) &&
      !EXCLUDED_FILES.some(ef => f === ef || f.endsWith('/' + ef))
    );
    for (const file of relevant) {
      matches.push(...checkFile(file, check));
    }
  } else {
    // Full scan — scope to pathFilter if set
    matches = checkDirectory(check.pathFilter ?? '.', check);
  }

  if (matches.length === 0) {
    console.log(`  ✓ ${check.name}`);
    continue;
  }

  const icon = check.severity === 'error' ? '✗' : '⚠';
  console.log(`\n  ${icon} ${check.name}`);
  console.log(`    ${check.message}`);
  console.log(`    Matches (${matches.length}):`);
  for (const match of matches.slice(0, 5)) {
    console.log(`      ${match}`);
  }
  if (matches.length > 5) {
    console.log(`      ... and ${matches.length - 5} more`);
  }

  if (check.severity === 'error') errors++;
  else warnings++;
}

// ─── Assembled-but-never-rendered slice field check ───────────────────────────
//
// Warns if a field is present in a *Slice interface in shared/types/intelligence.ts
// but not referenced in the corresponding format*Section function in
// server/workspace-intelligence.ts. These fields are assembled at query time but
// silently dropped at format time — they never reach the AI prompt.
//
// Map of slice interface name → formatter function name
const SLICE_FORMATTER_MAP: Array<{ sliceName: string; formatterName: string }> = [
  { sliceName: 'SeoContextSlice', formatterName: 'formatSeoContextSection' },
  { sliceName: 'InsightsSlice', formatterName: 'formatInsightsSection' },
  { sliceName: 'LearningsSlice', formatterName: 'formatLearningsSection' },
  { sliceName: 'PageProfileSlice', formatterName: 'formatPageProfileSection' },
  { sliceName: 'ContentPipelineSlice', formatterName: 'formatContentPipelineSection' },
  { sliceName: 'SiteHealthSlice', formatterName: 'formatSiteHealthSection' },
  { sliceName: 'ClientSignalsSlice', formatterName: 'formatClientSignalsSection' },
  { sliceName: 'OperationalSlice', formatterName: 'formatOperationalSection' },
];

// Fields intentionally not rendered (complex nested types, metadata, or rendering handled differently)
// Also includes fields that ARE rendered but accessed via destructuring or local variable
// (e.g. `const { bySeverity } = insights`) which the property-access regex won't catch.
const KNOWN_UNRENDERED_FIELDS = new Set([
  // SeoContextSlice
  'backlinkProfile', 'serpFeatures', 'keywordRecommendations',
  // InsightsSlice
  'byType', 'forPage',
  // bySeverity: rendered via `const { bySeverity } = insights` (destructuring, not .bySeverity)
  'bySeverity',
  // LearningsSlice
  'forPage', 'topWins', 'winRateByActionType',
  // ContentPipelineSlice
  'rewritePlaybook', 'suggestedBriefs',
  // SiteHealthSlice
  'aeoReadiness', 'redirectDetails',
  // PageProfileSlice
  // searchIntent: accessed via local pageKw.searchIntent variable, not profile.searchIntent
  'searchIntent',
  // insights: page-level insights array; page-specific insights are shown via the top-level InsightsSlice
  'insights',
  // ClientSignalsSlice — these are rendered but may not appear by field name
  // OperationalSlice
  // none
]);

function extractInterfaceFields(typeFileContent: string, interfaceName: string): string[] {
  // Find the interface declaration — use brace-depth counting to handle nested object types
  const declStart = typeFileContent.search(new RegExp(`interface ${interfaceName}\\s*\\{`));
  if (declStart === -1) return [];

  const braceStart = typeFileContent.indexOf('{', declStart);
  if (braceStart === -1) return [];

  // Walk forward counting braces to find the matching closing brace of the interface itself
  let depth = 0;
  let i = braceStart;
  while (i < typeFileContent.length) {
    if (typeFileContent[i] === '{') depth++;
    else if (typeFileContent[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  const body = typeFileContent.slice(braceStart + 1, i);

  // Extract only top-level field names (depth=0 within the body, lines like `  fieldName:`)
  // Walk the body tracking nested depth so we only extract interface-level keys
  const fields: string[] = [];
  let nestedDepth = 0;
  for (const line of body.split('\n')) {
    for (const ch of line) {
      if (ch === '{') nestedDepth++;
      else if (ch === '}') nestedDepth--;
    }
    if (nestedDepth === 0) {
      const m = line.match(/^\s+(\w+)\??:/);
      if (m) fields.push(m[1]);
    }
  }
  return fields;
}

function extractFormatterBody(formatterFileContent: string, formatterName: string): string {
  // Find the function body start
  const fnStart = formatterFileContent.indexOf(`function ${formatterName}(`);
  if (fnStart === -1) return '';

  // Find the opening brace
  const braceStart = formatterFileContent.indexOf('{', fnStart);
  if (braceStart === -1) return '';

  // Walk forward counting braces to find the closing brace
  let depth = 0;
  let i = braceStart;
  while (i < formatterFileContent.length) {
    if (formatterFileContent[i] === '{') depth++;
    else if (formatterFileContent[i] === '}') {
      depth--;
      if (depth === 0) {
        return formatterFileContent.slice(braceStart, i + 1);
      }
    }
    i++;
  }
  return '';
}

// Only run this check when scanning the whole codebase (--all) or when workspace-intelligence.ts changed
const shouldRunSliceCheck = SCAN_ALL || changedFiles.some(f =>
  f.includes('workspace-intelligence.ts') || f.includes('intelligence.ts'),
);

if (shouldRunSliceCheck) {
  const typesPath = path.join(ROOT, 'shared/types/intelligence.ts');
  const serverPath = path.join(ROOT, 'server/workspace-intelligence.ts');
  let typesContent = '';
  let serverContent = '';
  try {
    typesContent = readFileSync(typesPath, 'utf-8');
    serverContent = readFileSync(serverPath, 'utf-8');
  } catch {
    // Files not found — skip
  }

  if (typesContent && serverContent) {
    const unrenderedFindings: string[] = [];

    for (const { sliceName, formatterName } of SLICE_FORMATTER_MAP) {
      const fields = extractInterfaceFields(typesContent, sliceName);
      const formatterBody = extractFormatterBody(serverContent, formatterName);

      if (!formatterBody) {
        unrenderedFindings.push(`  ${sliceName}: formatter ${formatterName} not found`);
        continue;
      }

      for (const field of fields) {
        if (KNOWN_UNRENDERED_FIELDS.has(field)) continue;
        // Check if the field name appears in the formatter body (as a property access)
        if (!formatterBody.includes(`.${field}`) && !formatterBody.includes(`['${field}']`) && !formatterBody.includes(`["${field}"]`)) {
          unrenderedFindings.push(`  ${sliceName}.${field} → not referenced in ${formatterName}`);
        }
      }
    }

    if (unrenderedFindings.length > 0) {
      console.log(`\n  ⚠ Assembled-but-never-rendered slice fields`);
      console.log(`    These fields are assembled in *Slice types but not referenced in their format*Section formatter.`);
      console.log(`    The data is assembled at query time but never reaches the AI prompt.`);
      console.log(`    Add to KNOWN_UNRENDERED_FIELDS if intentionally omitted.`);
      console.log(`    Fields (${unrenderedFindings.length}):`);
      for (const finding of unrenderedFindings.slice(0, 10)) {
        console.log(`      ${finding}`);
      }
      if (unrenderedFindings.length > 10) {
        console.log(`      ... and ${unrenderedFindings.length - 10} more`);
      }
      warnings++;
    } else {
      console.log(`  ✓ Assembled-but-never-rendered slice fields`);
    }
  }
}

// ─── Constants sync check ─────────────────────────────────────────────────────
// STUDIO_NAME and STUDIO_URL exist in both server/constants.ts and src/constants.ts.
// They can't share a runtime module (different module resolution), so this check
// verifies they declare identical values.

{
  const serverConst = path.join(ROOT, 'server/constants.ts');
  const frontendConst = path.join(ROOT, 'src/constants.ts');
  try {
    const serverSrc = readFileSync(serverConst, 'utf-8');
    const frontendSrc = readFileSync(frontendConst, 'utf-8');
    const extract = (src: string, name: string) => {
      const m = src.match(new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`));
      return m?.[1] ?? null;
    };
    const mismatches: string[] = [];
    for (const name of ['STUDIO_NAME', 'STUDIO_URL']) {
      const sv = extract(serverSrc, name);
      const fv = extract(frontendSrc, name);
      if (sv !== fv) mismatches.push(`${name}: server='${sv}' vs frontend='${fv}'`);
    }
    if (mismatches.length > 0) {
      console.log(`\n  ✗ Constants out of sync (server/constants.ts vs src/constants.ts)`);
      console.log(`    Keep STUDIO_NAME and STUDIO_URL identical in both files.`);
      for (const m of mismatches) console.log(`      ${m}`);
      errors++;
    } else {
      console.log(`  ✓ Constants in sync (STUDIO_NAME, STUDIO_URL)`);
    }
  } catch {
    // If either file is missing, the import checks will catch the real problem
  }
}

// ─── Manual checklist ─────────────────────────────────────────────────────────

console.log('\n  📋 Manual checklist (verify before merging):');
const manualChecks = [
  'FEATURE_AUDIT.md updated for any new features',
  'data/roadmap.json updated (pending → done)',
  'BRAND_DESIGN_LANGUAGE.md updated if UI changed',
  'Feature flag added if this is a multi-phase feature',
  'No route removals without updating Sidebar, Breadcrumbs, CommandPalette, routes.ts',
  'clearSeoContextCache paired with invalidateIntelligenceCache (grep both, compare call sites)',
];
for (const item of manualChecks) {
  console.log(`    [ ] ${item}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(50));
if (errors > 0) {
  console.log(`\n  ✗ ${errors} error(s), ${warnings} warning(s). Fix errors before merging.\n`);
  process.exit(1);
} else if (warnings > 0) {
  console.log(`\n  ⚠ 0 errors, ${warnings} warning(s). Review warnings before merging.\n`);
} else {
  console.log(`\n  ✓ All automated checks passed.\n`);
}
