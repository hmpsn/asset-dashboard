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

function getFiles(dir: string, pattern: string): string[] {
  try {
    return execSync(`find "${dir}" -name "${pattern}" -type f 2>/dev/null`, {
      cwd: ROOT, encoding: 'utf-8',
    }).trim().split('\n').filter(Boolean);
  } catch { return []; }
}

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

type CustomCheckMatch = { file: string; line: number; text: string };

type Check = {
  name: string;
  /**
   * Ripgrep/grep pattern for the single-line scan path. Optional when
   * `customCheck` is present — custom checks implement their own detection.
   * A missing/empty pattern with no customCheck is a misconfiguration and
   * the runner aborts to avoid `grep -E ""` matching every line.
   */
  pattern?: string;
  fileGlobs: string[];
  exclude?: string | string[];
  pathFilter?: string;  // only scan files under this path prefix
  excludeLines?: string[];  // grep -v patterns — lines matching any of these are filtered out
  message: string;
  severity: 'error' | 'warn';
  // Metadata consumed by rule-metadata generator (PR C of the pr-check audit)
  rationale?: string;     // 1-sentence explanation of the bug class this prevents
  claudeMdRef?: string;   // anchor/heading in CLAUDE.md, e.g. '#code-conventions'
  // Optional custom detection function. When present, runCheck uses this
  // instead of the ripgrep path. It receives the resolved file list (absolute
  // or repo-relative paths — matching what the ripgrep path would scan) and
  // returns an array of { file, line, text } matches. The runner formats
  // these into the same `file:line:text` string shape the ripgrep path emits.
  customCheck?: (files: string[]) => CustomCheckMatch[];
};

// ─── Helpers used by customCheck rules ────────────────────────────────────────

// Dynamically build the set of workspace-scoped tables by scanning migration
// SQL files. A table is considered workspace-scoped if its CREATE TABLE block
// contains a `workspace_id` column (i.e. the column appears inside the DDL
// parentheses, not just in an index or a later DML statement).
// This is more accurate than a hard-coded list and auto-updates as new tables
// are added via migrations.
function buildWorkspaceScopedTables(): Set<string> {
  const migrationsDir = path.join(ROOT, 'server/db/migrations');
  const files = getFiles(migrationsDir, '*.sql');
  const tables = new Set<string>();
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/i;

  for (const file of files) {
    const content = readFileOrEmpty(file);
    if (!content) continue;
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
      const m = lines[i].match(tableRe);
      if (!m) { i++; continue; }
      const tableName = m[1];
      // Walk the block using paren depth to find the closing );
      let depth = 0;
      let hasWorkspaceId = false;
      let nextI = lines.length; // guarantee forward progress even if the block never closes
      let sawOpen = false;
      for (let j = i; j < lines.length; j++) {
        const line = lines[j];
        const opens = (line.match(/\(/g) ?? []).length;
        const closes = (line.match(/\)/g) ?? []).length;
        depth += opens - closes;
        if (opens > 0) sawOpen = true;
        if (/\bworkspace_id\b/i.test(line)) hasWorkspaceId = true;
        if (sawOpen && depth <= 0) { nextI = j + 1; break; }
      }
      i = nextI;
      if (hasWorkspaceId) tables.add(tableName);
    }
  }
  return tables;
}

const WORKSPACE_SCOPED_TABLES = buildWorkspaceScopedTables();

function readFileOrEmpty(file: string): string {
  try { return readFileSync(file, 'utf-8'); } catch { return ''; }
}

/**
 * Check whether a `// <hatch>-ok` comment exists on `lines[i]` or on the
 * immediately preceding line. Every customCheck rule that flags the opening
 * line of a potentially multi-line statement (template-literal db.prepare
 * calls, multi-line callOpenAI arguments, router.post callbacks, useEffect
 * openers, etc.) MUST call this before pushing a hit.
 *
 * The global `excludeLines` post-filter in `formatCustomMatches` only matches
 * the flagged line's text; for multi-line constructs the hatch can't be
 * placed inline without breaking syntax, so developers place it on the line
 * above. Without this lookbehind, those hatches are silently ignored.
 *
 * See docs/rules/pr-check-rule-authoring.md → "Common mistakes" for the
 * explanation and the funcBoundaryRe / ws-scope-ok / ai-race-ok precedents.
 */
function hasHatch(lines: string[], i: number, hatch: string): boolean {
  if (lines[i]?.includes(hatch)) return true;
  if (i > 0 && lines[i - 1]?.includes(hatch)) return true;
  return false;
}

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
    // This rule's INTENT is "server-side DB column parses must use parseJsonSafe".
    // Narrowed to `server/` so it can't accidentally fire on frontend code
    // (sessionStorage reads, WebSocket message handlers, etc.) which is a
    // different class of parse. Adding a new server/ exclusion means the file
    // parses non-DB data (AI response strings, file contents, WS messages).
    pathFilter: 'server/',
    exclude: [
      'server/db/json-validation.ts', 'server/content-posts-ai.ts', 'server/routes/keyword-strategy.ts',
      'server/content-brief.ts', 'server/routes/aeo-review.ts', 'server/routes/jobs.ts',
      'server/schema-plan.ts', 'server/schema-suggester.ts', 'server/seo-audit.ts',
      'server/performance-store.ts', 'server/rank-tracking.ts', 'server/aeo-page-review.ts',
      'server/routes/webflow-seo.ts', // AI response text parser, not DB columns
      'server/processor.ts', // file-based metadata JSON, not DB columns
      'server/websocket.ts', // WebSocket message parsing, not DB columns
      'server/meeting-brief-generator.ts', // AI response text parser, not DB columns
      'server/openai-helpers.ts', // disk-based usage log files + AI response text parser, not DB columns
      'server/__tests__/openai-helpers-format.test.ts', // parsing mock fetch request body in tests, not DB columns
    ],
    message: 'Use parseJsonSafe() or parseJsonFallback() from server/db/json-validation.ts.',
    severity: 'error',
  },
  {
    name: 'Hard-coded studio name',
    pattern: 'hmpsn[ .]studio',
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
    fileGlobs: ['*.ts'],
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
  {
    name: 'Raw string literal in broadcastToWorkspace() event arg',
    // Matches: broadcastToWorkspace(anything, 'some:event', ...) or broadcastToWorkspace(anything, "some:event", ...)
    // Does NOT match: broadcastToWorkspace(wsId, WS_EVENTS.FOO, data) — no quote after the second comma
    pattern: 'broadcastToWorkspace\\([^,]+,\\s*[\'"]',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/broadcast.ts'],
    excludeLines: ['// ws-event-ok'],
    message: 'Use WS_EVENTS.* constants from server/ws-events.ts instead of string literals. Literals cause silent drift between broadcast and frontend handler. Add `// ws-event-ok` if intentional.',
    // warn not error: ~50 pre-existing violations in unchanged files; new code is blocked
    // by the changed-files scan. Upgrade to error once the codebase-wide cleanup is done.
    severity: 'warn',
  },
  {
    name: 'Raw string literal in broadcast() event arg',
    // Matches standalone broadcast('event') but NOT _broadcast('event') or _broadcastToWorkspace('event').
    // Uses (^|[^a-zA-Z_]) to require broadcast() is not preceded by a letter/underscore,
    // excluding private wrappers like websocket.ts's _broadcast() which use string literals.
    // Note: grep -E does not support lookbehind, so we use a character class exclusion instead.
    pattern: '(^|[^a-zA-Z_])broadcast\\(\\s*[\'"]',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/broadcast.ts'],
    excludeLines: ['// ws-event-ok'],
    message: 'Use ADMIN_EVENTS.* constants from server/ws-events.ts instead of string literals. Literals cause silent drift between broadcast and frontend handler. Add `// ws-event-ok` if intentional.',
    // warn not error: ~50 pre-existing violations in unchanged files; new code is blocked
    // by the changed-files scan. Upgrade to error once the codebase-wide cleanup is done.
    severity: 'warn',
  },
  {
    // Catches always-true placeholder test assertions committed as real tests.
    // These pass regardless of whether the contract they claim to test is actually correct,
    // providing false confidence. Root cause from G2 PR3: seo-editor-unified.test.ts.
    name: 'Placeholder test assertion — expect(true).toBe(true)',
    pattern: 'expect\\(true\\)\\.toBe\\(true\\)',
    fileGlobs: ['*.ts'],
    pathFilter: 'tests/',
    message: 'expect(true).toBe(true) always passes and documents nothing. Replace with a real assertion that can actually fail.',
    severity: 'error',
  },
  {
    // Catches tests that read source files as strings to assert string patterns (source-sniffing).
    // These break on refactors that preserve semantics (variable renames, helper extraction),
    // producing false-positive failures and masking real regressions.
    // Root cause from G2 PR3: useSeoEditor.test.ts used fs.readFileSync to assert
    // template literal fragments — fragile against any syntax-preserving refactor.
    // Add // readFile-ok on the readFileSync line for intentional migration guards
    // (e.g. asserting a deprecated endpoint is no longer referenced in the file).
    name: 'Source-sniffing in tests (readFileSync on .ts/.tsx source)',
    pattern: 'readFileSync\\(.*\\.(ts|tsx)',
    fileGlobs: ['*.ts'],
    pathFilter: 'tests/',
    excludeLines: ['// readFile-ok'],
    message: 'Test behavior via imports and mocks, not source-file string matching. Add // readFile-ok on the line if this is an intentional endpoint migration guard.',
    severity: 'warn',
  },
  {
    // FM-7: Vacuous .every() assertions on potentially empty arrays.
    // [].every(fn) returns true for any fn — the test proves nothing.
    name: 'Vacuous .every() in tests (no length guard)',
    pattern: '\\.every\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'tests/',
    excludeLines: ['// every-ok', '.length', 'toBeGreaterThan', 'toHaveLength'],
    message: 'Assert array.length > 0 before .every(). [].every(fn) always returns true. Add // every-ok if intentional.',
    severity: 'warn',
  },
  {
    // FM-6: Bare JSON.parse on DB row columns — must use parseJsonSafe/parseJsonFallback.
    // More specific than the existing "Bare JSON.parse" check — this targets the row.* pattern
    // that indicates a DB column read.
    name: 'Bare JSON.parse on DB row column',
    pattern: 'JSON\\.parse\\(row\\.',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/db/json-validation.ts', 'server/db/json-column.ts', 'server/db/migrate-json.ts'],
    message: 'Use parseJsonSafe(row.column, schema, fallback) or parseJsonFallback(row.column, fallback). Bare JSON.parse on DB columns crashes on malformed data.',
    severity: 'error',
  },
  {
    // FM-5: Direct SET status without a validation function.
    // State machine transitions should use validateTransition() to reject invalid transitions.
    name: 'Unguarded SET status = ? (state machine transition)',
    pattern: "SET\\s+(status|batch_status)\\s*=\\s*[?@]",
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['status-ok', 'validateTransition'],
    message: 'State machine transitions must use validateTransition(from, to). Direct SET status = ? skips guard. Add // status-ok if this is a non-state-machine column.',
    severity: 'warn',
  },
  {
    // FM-4: Untyped dynamic import results — as any suppresses field name checks.
    name: 'Untyped dynamic import (missing import type)',
    pattern: 'await import\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/db/', 'tests/', 'server/workspace-intelligence.ts'],
    excludeLines: ['// dynamic-import-ok'],
    message: 'Add `import type { T } from "./module.js"` at file top to type dynamic import results. `as any` on dynamic imports hides wrong property names. Add // dynamic-import-ok if unavoidable.',
    severity: 'warn',
  },
  {
    name: 'Raw bulk_lookup string outside keywords type file',
    pattern: "'bulk_lookup'",
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['shared/types/keywords.ts', 'shared/types/workspace.ts'],
    message: "Use the 'bulk_lookup' literal only from shared/types/workspace.ts (PageKeywordMap.metricsSource). Raw string references in other files create undiscoverable magic values.",
    severity: 'warn',
  },
  {
    // Scope to server/ only — frontend type annotations (e.g. metricsSource?: 'ai_estimate')
    // are legitimate mirrors of the shared type and don't create runtime magic strings
    name: 'Raw ai_estimate string in server files',
    pattern: "'ai_estimate'",
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['shared/types/workspace.ts', 'shared/types/keywords.ts'],
    message: "The 'ai_estimate' metricsSource value must only be referenced from shared/types/workspace.ts. Use the shared type, not a raw string literal.",
    severity: 'warn',
  },
  {
    name: 'replaceAllPageKeywords called outside keyword-strategy route',
    pattern: 'replaceAllPageKeywords\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/routes/keyword-strategy.ts', 'server/page-keywords.ts'],
    message: 'replaceAllPageKeywords() is a destructive bulk operation. Only call it from server/routes/keyword-strategy.ts. For incremental updates use upsertPageKeyword().',
    severity: 'error',
  },
  {
    // Excludes: function/method definitions, interface declarations, and existing pre-PR callers
    // that go via the provider abstraction (routes/backlinks.ts, routes/semrush.ts)
    name: 'getBacklinksOverview called outside workspace-intelligence',
    pattern: 'getBacklinksOverview\\s*\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: [
      'server/workspace-intelligence.ts',
      'server/semrush.ts',                      // function definition
      'server/seo-data-provider.ts',             // interface definition
      'server/providers/semrush-provider.ts',    // provider implementation
      'server/providers/dataforseo-provider.ts', // provider implementation
      'server/routes/backlinks.ts',              // pre-existing caller via provider abstraction
      'server/routes/semrush.ts',                // pre-existing caller via provider abstraction
    ],
    message: 'getBacklinksOverview() is an expensive external API call. Only call it from server/workspace-intelligence.ts where caching and rate-limiting are enforced.',
    severity: 'error',
  },
  {
    name: 'Silent bare catch in workspace-intelligence assemblers',
    // Matches lines that open a bare catch block with no error variable — the most
    // dangerous pattern: no err reference means isProgrammingError() can never be called.
    // Scoped to workspace-intelligence.ts only to avoid flagging the 200+ legitimate
    // silent catches in other server files.
    // Suppression: append `// catch-ok` to the same line. Because the pattern is anchored
    // with `$`, adding any suffix prevents the regex from matching — so excludeLines is not
    // needed here but left as documentation of the convention.
    pattern: '\\} catch \\{$',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/workspace-intelligence.ts',
    message: 'Bare `catch {` in workspace-intelligence.ts hides TypeError/ReferenceError as silent degradation. Use `catch (err)` and call isProgrammingError(err) for dynamic-import blocks, or log.debug at minimum.',
    severity: 'error',
  },

  // ─── New rules (2026-04-10 audit) ───
  {
    name: 'useGlobalAdminEvents import restriction',
    // Note: only match single-quoted imports. A character class ['"] would
    // break the double-quoted shell invocation in checkDirectory.
    pattern: "from '[^']*useGlobalAdminEvents",
    fileGlobs: ['*.ts', '*.tsx'],
    // Allowlist of audited global-fanout sites. Any new importer must be
    // reviewed and added here explicitly.
    exclude: [
      'src/hooks/useGlobalAdminEvents.ts',
      'src/components/WorkspaceOverview.tsx',
      'src/App.tsx',
    ],
    excludeLines: ['// global-events-ok'],
    message: 'useGlobalAdminEvents does not subscribe — workspace-scoped events will be silently filtered. Use useWorkspaceEvents(workspaceId, ...) instead. Only audited global-fanout sites may import it. Add // global-events-ok if this file is a legitimate global-fanout site.',
    severity: 'error',
    rationale: 'useGlobalAdminEvents does not subscribe — workspace-scoped events will be silently filtered. Only audited global-fanout sites may import it.',
    claudeMdRef: '#data-flow-rules-mandatory',
  },
  {
    name: 'Global keydown missing isContentEditable guard',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    exclude: ['src/App.tsx'],
    excludeLines: ['// keydown-ok'],
    message: 'Global keydown handlers must early-return if e.target is an input/textarea/contenteditable. Use the pattern from src/App.tsx (check HTMLInputElement/HTMLTextAreaElement/HTMLSelectElement and isContentEditable). Add // keydown-ok if intentional.',
    severity: 'warn',
    rationale: 'Global keydown handlers must early-return if e.target is an input/textarea/contenteditable — otherwise Escape/Enter/arrows hijack typing.',
    claudeMdRef: '#uiux-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Matches both single- and double-quoted 'keydown'.
      const listenerRe = /addEventListener\s*\(\s*['"]keydown['"]/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!listenerRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// keydown-ok')) continue;
          // Locate the handler body and scan it for an isContentEditable guard.
          // Common shapes:
          //   addEventListener('keydown', (e) => { ... })       ← inline arrow
          //   addEventListener('keydown', handleKey)            ← referenced
          // For the referenced form we fall back to a whole-file scan for
          // isContentEditable (low false-negative risk — the guard either
          // exists in the file or it doesn't).
          const lookahead = lines.slice(i, Math.min(lines.length, i + 60)).join('\n');
          const hasInlineBody = /=>\s*\{/.test(lookahead);
          let body: string;
          if (hasInlineBody) {
            // Walk forward to the opening brace of the arrow body and
            // brace-match to the close.
            const joined = lines.slice(i).join('\n');
            const arrowIdx = joined.search(/=>\s*\{/);
            if (arrowIdx === -1) { body = lookahead; }
            else {
              const bodyOpen = joined.indexOf('{', arrowIdx);
              let depth = 0;
              let j = bodyOpen;
              while (j < joined.length) {
                if (joined[j] === '{') depth++;
                else if (joined[j] === '}') { depth--; if (depth === 0) break; }
                j++;
              }
              body = joined.slice(bodyOpen, Math.min(j + 1, joined.length));
            }
          } else {
            // Referenced-handler form: scan the entire file for the guard.
            body = content;
          }
          if (/\bisContentEditable\b/.test(body)) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'Multi-step DB writes outside db.transaction()',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    // Tests run single-writer by definition; multi-write setup in a test is
    // never a concurrency concern. Migrations are their own txn model.
    exclude: ['server/db/migrations', '__tests__'],
    excludeLines: ['// txn-ok'],
    message: 'Multiple sequential db.prepare().run() calls must be wrapped in db.transaction() to prevent partial-failure state corruption. Add // txn-ok on the first prepare line if the pair is intentionally non-atomic.',
    severity: 'warn',
    rationale: 'Multiple sequential db.prepare().run() calls must be wrapped in db.transaction() to prevent partial-failure state corruption.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // A "write" is a prepare immediately chained with .run(...) on the same
      // or next few lines. Module-level `stmts = createStmtCache({ foo:
      // db.prepare(...) })` blocks prepare statements as reusable handles, not
      // as executed writes, and must not trigger this rule. We detect an
      // executed write by looking for `.run(` within 8 lines after prepare(
      // (handles SQL strings that span multiple lines) but not on a line that
      // is clearly a cache definition (contains `: db.prepare`).
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (file.includes('/server/db/migrations/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        const writeIdx: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (!/\bdb\.prepare\s*\(/.test(lines[i])) continue;
          // Skip cache-style definitions: `  foo: db.prepare(...)` or
          // `const foo = db.prepare(...)` without an executing `.run(`.
          const window = lines.slice(i, Math.min(lines.length, i + 8)).join('\n');
          if (!/\.run\s*\(/.test(window)) continue;
          // Skip stmts() cache definitions — these are always part of a
          // createStmtCache object literal where every value is a prepare.
          if (/:\s*db\.prepare/.test(lines[i])) continue;
          if (hasHatch(lines, i, '// txn-ok')) continue;
          writeIdx.push(i);
        }
        if (writeIdx.length < 2) continue;
        // A function boundary between two writes means they are in separate
        // functions and are NOT a multi-step mutation. Detect by looking for
        // a new function *opener* between the two write lines — any two writes
        // separated by a boundary will also be separated by the opener of the
        // second function. Do NOT match closing braces: `}`, `};`, `})` also
        // close if/for/try blocks and would produce false-negative results on
        // legitimate violations (e.g. a write, a try/catch, then another write
        // inside the same function).
        const funcBoundaryRe =
          /^(\s*(export\s+)?(async\s+)?function\s+\w+|\s*(export\s+)?const\s+\w+\s*[:=].*=>)/;
        const reported = new Set<number>();
        for (let k = 0; k < writeIdx.length - 1; k++) {
          const a = writeIdx[k];
          const b = writeIdx[k + 1];
          if (b - a > 10) continue;
          // Skip if a function boundary sits between the two writes — they
          // live in different scopes and a shared transaction is nonsensical.
          let boundaryBetween = false;
          for (let m = a + 1; m < b; m++) {
            if (funcBoundaryRe.test(lines[m])) { boundaryBetween = true; break; }
          }
          if (boundaryBetween) continue;
          const winStart = Math.max(0, a - 20);
          const window = lines.slice(winStart, a + 1).join('\n');
          if (/\bdb\.transaction\s*\(/.test(window)) continue;
          if (reported.has(a)) continue;
          reported.add(a);
          hits.push({ file, line: a + 1, text: lines[a].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'AI call before db.prepare without transaction guard',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: [
      'server/openai-helpers.ts',
      'server/anthropic-helpers.ts',
      'server/prompt-assembly.ts',
    ],
    excludeLines: ['// ai-race-ok'],
    message: 'AI calls take ~5s; concurrent requests race existence checks before the write. Put the existence check + INSERT inside db.transaction() and catch SQLITE_CONSTRAINT_UNIQUE. Add // ai-race-ok if the handler is provably single-writer.',
    severity: 'warn',
    rationale: 'AI calls take ~5s; concurrent requests race existence checks before the write. Put existence check + INSERT inside db.transaction() and catch SQLITE_CONSTRAINT_UNIQUE.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (/\/(openai-helpers|anthropic-helpers|prompt-assembly)\.ts$/.test(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        const aiRe = /\b(callOpenAI|callAnthropic|callCreativeAI)\s*\(/;
        for (let i = 0; i < lines.length; i++) {
          if (!aiRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// ai-race-ok')) continue;
          const window = lines.slice(i + 1, i + 31);
          const hasWrite = window.some(l => /\bdb\.prepare\s*\(/.test(l) || /\bstmts\s*\(\s*\)\./.test(l));
          if (!hasWrite) continue;
          const hasTxn = window.some(l => /\bdb\.transaction\s*\(/.test(l));
          if (hasTxn) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'UPDATE/DELETE missing workspace_id scope',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/db/migrations'],
    excludeLines: ['// ws-scope-ok'],
    message: 'Workspace-scoped tables must include workspace_id in every UPDATE and DELETE. Defence-in-depth against compromised auth or mis-routed requests. Add // ws-scope-ok if the row key is already workspace-unique.',
    severity: 'warn',
    rationale: 'Workspace-scoped tables must include workspace_id in every UPDATE and DELETE. Defence-in-depth against compromised auth or mis-routed requests.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (file.includes('/server/db/migrations/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!/\bdb\.prepare\s*\(/.test(lines[i])) continue;
          if (hasHatch(lines, i, '// ws-scope-ok')) continue;
          // Grab the next ~25 lines to reconstruct the SQL string; stop at the
          // first line that closes the call with ).
          const chunk = lines.slice(i, Math.min(lines.length, i + 25)).join('\n');
          const closeIdx = chunk.indexOf(');');
          const sqlBlob = closeIdx >= 0 ? chunk.slice(0, closeIdx) : chunk;
          // Normalise whitespace so regex patterns can match across newlines
          const sql = sqlBlob.replace(/\s+/g, ' ');
          // Extract the SQL statement inside the template/quote — find the
          // first backtick/quote after db.prepare( and read up to its match.
          // Capture the opening delimiter and use \1 backreference so embedded
          // single quotes inside a backtick string don't truncate the match.
          const m = sql.match(/db\.prepare\s*\(\s*([`'"])([\s\S]*?)\1/);
          const stmt = (m?.[2] ?? '').trim();
          if (!stmt) continue;
          const upper = stmt.toUpperCase();
          let tableName: string | null = null;
          if (upper.startsWith('UPDATE')) {
            const tm = stmt.match(/UPDATE\s+(\w+)/i);
            tableName = tm?.[1] ?? null;
          } else if (upper.startsWith('DELETE FROM')) {
            const tm = stmt.match(/DELETE\s+FROM\s+(\w+)/i);
            tableName = tm?.[1] ?? null;
          }
          if (!tableName) continue;
          if (!WORKSPACE_SCOPED_TABLES.has(tableName)) continue;
          if (/workspace_id/i.test(stmt)) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'getOrCreate* function returns nullable',
    // Extended in 2026-04-10 review: also catch arrow-form exports and class
    // methods, and tolerate object-type parameters that contain `{`. The
    // customCheck walks from `getOrCreate…(` past the matching `)` and then
    // checks the return-type annotation for `| null`.
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['// getorcreate-nullable-ok'],
    message: 'getOrCreate* always returns an entity (creates one if missing). Its TypeScript return type must not include | null — callers would write dead guard branches. If it can genuinely fail, throw instead. Add // getorcreate-nullable-ok only if you have renamed the function and the "getOrCreate" name is misleading.',
    severity: 'error',
    rationale: 'getOrCreate* always returns an entity (creates one if missing). Its TypeScript return type must not include | null or callers write dead guard branches.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Matches two declaration shapes:
      //   function getOrCreateFoo(             ← function declaration
      //   const getOrCreateFoo = (): T         ← arrow / const export
      // Class methods are excluded intentionally — no getOrCreate* methods
      // exist in the codebase and a bare `getOrCreateFoo(` without modifier
      // would also match call sites.
      const declRe =
        /^\s*(?:(?:export\s+)?(?:async\s+)?function\s+getOrCreate\w+\s*\(|(?:export\s+)?(?:const|let)\s+getOrCreate\w+\s*=\s*(?:async\s+)?\()/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('getOrCreate')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(declRe);
          if (!m) continue;
          if (hasHatch(lines, i, '// getorcreate-nullable-ok')) continue;
          // Heuristic: skip lines that look like plain call sites (no `:` or
          // `{` ahead). A declaration always has a return-type annotation or
          // an opening brace within ~10 lines.
          const joined = lines.slice(i, Math.min(lines.length, i + 15)).join('\n');
          // Walk forward past the matching `)` that closes the parameter list
          // so object-typed params containing `{` don't fool us. Find the
          // first `(` on the line, then brace-walk.
          const openIdx = joined.indexOf('(');
          if (openIdx === -1) continue;
          let depth = 0;
          let j = openIdx;
          while (j < joined.length) {
            if (joined[j] === '(') depth++;
            else if (joined[j] === ')') { depth--; if (depth === 0) break; }
            j++;
          }
          if (j >= joined.length) continue;
          // After the closing `)`, read until the next `{` (function body) or
          // `=>` (arrow body) or end-of-window. That slice is the return-type
          // annotation region.
          const tail = joined.slice(j + 1);
          const bodyIdx = tail.search(/[{=]/);
          const returnRegion = bodyIdx === -1 ? tail : tail.slice(0, bodyIdx);
          if (!/:\s*[^,;]*\|\s*null\b/.test(returnRegion) &&
              !/:\s*Promise<[^>]*\|\s*null\s*>/.test(returnRegion)) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'Record<string, unknown> in shared/types',
    pattern: 'Record<string,\\s*unknown>',
    fileGlobs: ['*.ts'],
    pathFilter: 'shared/types/',
    // Grandfather exception: AnalyticsInsight.data is the discriminated-union
    // container (InsightDataMap narrows it at the read boundary). This is the
    // one legitimate escape hatch and is documented in the insight rules.
    exclude: ['shared/types/analytics.ts'],
    excludeLines: ['// record-unknown-ok'],
    message: 'Define typed interfaces at layer boundaries, not Record<string, unknown>. Untyped contracts are the #1 recurring bug pattern. See InsightDataMap for the discriminated-union pattern. Add // record-unknown-ok only for grandfathered escape-hatch fields (e.g. AnalyticsInsight.data).',
    severity: 'error',
    rationale: 'Define typed interfaces at layer boundaries, not Record<string, unknown>. Untyped contracts are the #1 recurring bug pattern.',
    claudeMdRef: '#data-flow-rules-mandatory',
  },
  {
    name: 'PATCH spread without nested merge',
    // Require req.body to end at `}`, `)`, `,`, or EOL — NOT at `.field`.
    // The documented deep-merge fix writes `...req.body.address` inside a
    // nested spread, which must NOT trigger the rule against the enclosing
    // `...existing, ...req.body.address` prefix. The `[^.\w]` end boundary
    // ensures we only match a top-level `req.body` spread, not `req.body.X`.
    pattern: '\\.\\.\\.(existing|current),\\s*\\.\\.\\.req\\.body([^.\\w]|$)',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    excludeLines: ['// patch-spread-ok'],
    message: 'PATCH endpoints on JSON columns with nested sub-objects must deep-merge. Top-level spread silently replaces nested objects. Add // patch-spread-ok if no nested objects exist.',
    severity: 'warn',
    rationale: 'PATCH endpoints on JSON columns with nested sub-objects must deep-merge. Top-level spread silently replaces nested objects.',
    claudeMdRef: '#code-conventions',
  },
  {
    name: 'Public-portal mutation without addActivity',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/public-portal.ts',
    excludeLines: ['// activity-ok'],
    message: 'Every public-portal POST/PUT/PATCH/DELETE must call addActivity() so admins have visibility into client portal engagement in the activity feed. Add // activity-ok on the router line if this endpoint is intentionally silent (e.g. read-only health probe).',
    severity: 'warn',
    rationale: 'Every public-portal POST/PUT/PATCH/DELETE must call addActivity() so admins have visibility into client portal engagement.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Only scan the one target file (if present).
      // In diff-only mode, files is scoped to changed files — if public-portal.ts
      // wasn't changed, return early so we don't warn on every unrelated PR.
      const target = files.find(f => f.endsWith('server/routes/public-portal.ts'));
      if (!target) return hits;
      const content = readFileOrEmpty(target);
      if (!content) return hits;
      const lines = content.split('\n');
      // Find all router.<method>( lines.
      const routeIdx: number[] = [];
      const routeRe = /\brouter\.(post|put|patch|delete)\s*\(/i;
      lines.forEach((l, i) => { if (routeRe.test(l)) routeIdx.push(i); });
      for (let k = 0; k < routeIdx.length; k++) {
        const start = routeIdx[k];
        if (hasHatch(lines, start, '// activity-ok')) continue;
        const nextStart = k + 1 < routeIdx.length ? routeIdx[k + 1] : lines.length;
        const windowEnd = Math.min(nextStart, start + 60);
        const window = lines.slice(start, windowEnd).join('\n');
        if (/\baddActivity\s*\(/.test(window)) continue;
        hits.push({ file: target, line: start + 1, text: lines[start].trim() });
      }
      return hits;
    },
  },
  {
    name: 'broadcastToWorkspace inside bridge callback',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    // Canonical broadcast site + the bridge infrastructure itself.
    exclude: [
      'server/broadcast.ts',
      'server/websocket.ts',
      'server/ws-events.ts',
      'server/bridge-infrastructure.ts',
    ],
    excludeLines: ['// bridge-broadcast-ok'],
    message: 'Bridge callbacks must return { modified: N } and let executeBridge dispatch the broadcast. Inline broadcastToWorkspace double-fires. Add // bridge-broadcast-ok if the broadcast is genuinely separate from the bridge result.',
    severity: 'warn',
    rationale: 'Bridge callbacks must return { modified: N } and let executeBridge dispatch the broadcast. Inline broadcastToWorkspace double-fires.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Also matches debounceBridge — wrapper functions that accept bridge
      // callbacks and apply rate limiting. A broadcast inside the callback
      // body still double-fires once the debounced bridge runs.
      const bridgeRe = /\b(executeBridge|fireBridge|debounceBridge)\s*\(/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (/\/(broadcast|websocket|ws-events|bridge-infrastructure)\.ts$/.test(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content || !bridgeRe.test(content) || !content.includes('broadcastToWorkspace')) continue;
        // Walk every bridge call, locate the arrow function body, and scan the
        // body for broadcastToWorkspace( calls. We find the `async () =>` or
        // `() =>` opening brace by walking forward from the bridge call site,
        // then brace-match to find the matching close brace.
        let cursor = 0;
        while (cursor < content.length) {
          const match = bridgeRe.exec(content.slice(cursor));
          if (!match) break;
          const absStart = cursor + match.index;
          cursor = absStart + match[0].length;
          // Find the start of the callback body within the next ~300 chars.
          // Pattern: ... , async () => { ... }  or  , () => { ... }
          const lookAhead = content.slice(cursor, cursor + 400);
          const arrowMatch = lookAhead.match(/=>\s*\{/);
          if (!arrowMatch || arrowMatch.index === undefined) continue;
          const bodyOpen = cursor + arrowMatch.index + arrowMatch[0].length - 1; // position of '{'
          let depth = 0;
          let i = bodyOpen;
          while (i < content.length) {
            const ch = content[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
              depth--;
              if (depth === 0) break;
            }
            i++;
          }
          if (i >= content.length) continue;
          const body = content.slice(bodyOpen, i + 1);
          if (!body.includes('broadcastToWorkspace(')) continue;
          // Report each broadcastToWorkspace line inside this body.
          const fileLines = content.split('\n');
          const bodyStartLine = content.slice(0, bodyOpen).split('\n').length;
          const bodyLines = body.split('\n');
          bodyLines.forEach((bl, idx) => {
            if (!bl.includes('broadcastToWorkspace(')) return;
            const absLine = bodyStartLine + idx; // 1-indexed file line number
            // hasHatch takes 0-indexed; fileLines[absLine - 1] is the match line.
            if (hasHatch(fileLines, absLine - 1, '// bridge-broadcast-ok')) return;
            hits.push({
              file,
              line: absLine,
              text: bl.trim(),
            });
          });
        }
      }
      return hits;
    },
  },
  {
    name: 'Layout-driving state set in useEffect',
    pattern: '',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/',
    excludeLines: ['// effect-layout-ok'],
    message: 'Layout-driving state must be derived synchronously in the render body (const effective = state && syncCondition). useEffect runs after paint, causing a one-frame layout flash. Add // effect-layout-ok if the state is genuinely post-paint.',
    severity: 'warn',
    rationale: 'Layout-driving state must be derived synchronously in the render body. useEffect runs after paint, causing a one-frame layout flash.',
    claudeMdRef: '#uiux-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // CLAUDE.md rule: "if a boolean state variable drives layout (padding,
      // width, sidebar visibility), derive it as `const effective = state &&
      // syncCondition` and use `effective` in JSX. The effect CAN still run
      // to clean up backing state, but JSX must read the derived value."
      //
      // Two-stage detection:
      //   1. Layout-setter allowlist: only flag setters whose name implies
      //      layout (not data, not URL sync, not fetch callbacks).
      //   2. Derivation escape: if the same file declares a
      //      `const effective<Name> = ...` that references the layout state,
      //      the pattern is the DOCUMENTED correct one (effect is the
      //      cleanup half). Skip it.
      const layoutSetterRe =
        /\bset(FocusMode|Collapsed|Expanded|SidebarOpen|SidebarCollapsed|Drawer|DrawerOpen|Modal|ModalOpen|Menu|MenuOpen|Panel|PanelOpen|Visible|Hidden|Show|Width|Height|Padding|Margin|Offset|Top|Left|Right|Bottom|Size)\w*\s*\(/;
      for (const file of files) {
        if (!file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('useEffect')) continue;
        // Escape: file derives an `effective*` from state synchronously.
        // This is the canonical correct pattern (see src/App.tsx
        // effectiveFocusMode). Don't flag any useEffect in a file that
        // already does this — it's the documented cleanup-effect half.
        if (/\bconst\s+effective\w*\s*=/.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!/\buseEffect\s*\(/.test(lines[i])) continue;
          if (hasHatch(lines, i, '// effect-layout-ok')) continue;
          const window = lines.slice(i + 1, Math.min(lines.length, i + 21));
          const hasLayoutSet = window.some(l => layoutSetterRe.test(l));
          if (!hasLayoutSet) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
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
  try {
    const out = execSync(
      `grep -rn ${globs} ${excludeDirs} ${excludeFiles} -E "${check.pattern}" "${dir}" 2>/dev/null || true`,
      { cwd: ROOT, encoding: 'utf-8' }
    );
    let lines = out.trim() ? out.trim().split('\n').filter(Boolean) : [];
    // Post-filter by check.exclude using full path matching (grep --exclude only matches basenames)
    if (check.exclude) {
      lines = lines.filter(line => !isExcluded(line, check.exclude));
    }
    return applyExcludeLines(lines, check.excludeLines);
  } catch {
    return [];
  }
}

let errors = 0;
let warnings = 0;

console.log(`\n🔍 Running PR checks (${mode})...\n`);

// Resolve the file list a check would scan (either the diff slice or a full
// directory walk). Used by customCheck-based rules so they can operate on the
// same file set the ripgrep path would have scanned.
function resolveCheckFileList(check: Check): string[] {
  if (!SCAN_ALL && changedFiles.length > 0) {
    const exts = check.fileGlobs.map(g => g.replace('*.', '.').replace('**/', ''));
    return changedFiles.filter(f =>
      exts.some(ext => f.endsWith(ext)) &&
      !isExcluded(f, check.exclude) &&
      (!check.pathFilter || f.startsWith(check.pathFilter)) &&
      (!EXCLUDED_DIRS.some(d => f.startsWith(d + '/') || f === d) ||
       (!!check.pathFilter && f.startsWith(check.pathFilter))) &&
      !EXCLUDED_FILES.some(ef => f === ef || f.endsWith('/' + ef))
    ).map(f => path.join(ROOT, f));
  }
  // Full scan: walk the pathFilter dir (or project root) for each fileGlob.
  const baseDir = path.join(ROOT, check.pathFilter ?? '.');
  const all = new Set<string>();
  for (const glob of check.fileGlobs) {
    const pattern = glob.replace('**/', '');
    for (const f of getFiles(baseDir, pattern)) {
      if (isExcluded(f, check.exclude)) continue;
      if (EXCLUDED_DIRS.some(d => f.includes(`/${d}/`))) continue;
      if (EXCLUDED_FILES.some(ef => f.endsWith('/' + ef))) continue;
      all.add(f);
    }
  }
  return Array.from(all);
}

function formatCustomMatches(check: Check, matches: CustomCheckMatch[]): string[] {
  const lines = matches.map(m => {
    const rel = path.isAbsolute(m.file) ? path.relative(ROOT, m.file) : m.file;
    return `${rel}:${m.line}:${m.text}`;
  });
  return applyExcludeLines(lines, check.excludeLines);
}

for (const check of CHECKS) {
  let matches: string[] = [];

  if (check.customCheck) {
    const files = resolveCheckFileList(check);
    const raw = check.customCheck(files);
    matches = formatCustomMatches(check, raw);
  } else if (!check.pattern) {
    // Defensive: a check with neither a customCheck nor a pattern is
    // misconfigured. Falling through to grep -E "" would match every line
    // in every file and produce a catastrophic false-positive flood.
    console.error(`\n  ✗ ${check.name}`);
    console.error(`    MISCONFIGURED: rule has no customCheck and no pattern.`);
    errors++;
    process.exitCode = 1;
    continue;
  } else if (!SCAN_ALL && changedFiles.length > 0) {
    // Only check changed files that match the glob extensions
    const exts = check.fileGlobs.map(g => g.replace('*.', '.'));
    const relevant = changedFiles.filter(f =>
      exts.some(ext => f.endsWith(ext)) &&
      !isExcluded(f, check.exclude) &&
      (!check.pathFilter || f.startsWith(check.pathFilter)) &&
      // When a check declares an explicit pathFilter, allow files from otherwise-excluded dirs
      // that match it (e.g. pathFilter:'tests/' targets the excluded 'tests' dir intentionally).
      (!EXCLUDED_DIRS.some(d => f.startsWith(d + '/') || f === d) ||
       (!!check.pathFilter && f.startsWith(check.pathFilter))) &&
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

// ─── callCreativeAI json-mode consistency ────────────────────────────────────
{
  const findings: string[] = [];
  const serverFiles = SCAN_ALL
    ? getFiles(path.join(ROOT, 'server'), '*.ts')
    : changedFiles
        .filter(f => f.startsWith('server/') && f.endsWith('.ts'))
        .map(f => path.join(ROOT, f));

  // Files excluded from this check and why:
  //   content-posts-ai.ts — definition file; callCreativeAI lives here, not a consumer
  //   brand-identity.ts   — uses parseJsonFallback for DB column parsing, not AI output;
  //                         its callCreativeAI calls correctly return prose (no json: needed)
  const JSON_MODE_EXCLUSIONS = new Set([
    path.join(ROOT, 'server/content-posts-ai.ts'),
    path.join(ROOT, 'server/brand-identity.ts'),
  ]);

  for (const file of serverFiles) {
    if (JSON_MODE_EXCLUSIONS.has(file)) continue;
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    // Only flag files that call both callCreativeAI and parseJsonFallback
    if (!content.includes('callCreativeAI') || !content.includes('parseJsonFallback')) continue;
    // If every callCreativeAI invocation in the file includes json: true, we're fine.
    // Flag if there are any callCreativeAI blocks that lack json: true or json: false.
    const calls = content.split('callCreativeAI(').slice(1); // one entry per call
    const unsafeCalls = calls.filter(block => {
      const closeParen = block.indexOf(')');
      const callBlock = closeParen > 0 ? block.slice(0, closeParen) : block.slice(0, 300);
      return !callBlock.includes('json:');
    });
    if (unsafeCalls.length > 0) {
      findings.push(`  ${path.relative(ROOT, file)} — ${unsafeCalls.length} callCreativeAI block(s) missing json: flag`);
    }
  }
  if (findings.length > 0) {
    console.log(`\n  ⚠ callCreativeAI without json: flag in files that use parseJsonFallback`);
    console.log(`    Add json: true when the result is parsed as JSON, json: false when prose.`);
    for (const f of findings) console.log(f);
    warnings++;
  } else {
    console.log(`  ✓ callCreativeAI json-mode consistency`);
  }
}

// ─── Brand-engine routes: requireWorkspaceAccess not requireAuth ──────────────
{
  const brandEngineRoutes = [
    'server/routes/voice-calibration.ts',
    'server/routes/discovery-ingestion.ts',
    'server/routes/brand-identity.ts',
    'server/routes/brandscript.ts',
    'server/routes/page-strategy.ts',
    'server/routes/copy-pipeline.ts',
  ];
  const findings: string[] = [];
  for (const rel of brandEngineRoutes) {
    const file = path.join(ROOT, rel);
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    // requireAuth in brand-engine routes is wrong — admin panel uses HMAC token (global gate)
    // and client access uses requireWorkspaceAccess. requireAuth (JWT-only) would 401 both.
    if (content.includes('requireAuth(') && !content.includes('// auth-ok')) {
      findings.push(`  ${rel}`);
    }
  }
  if (findings.length > 0) {
    console.log(`\n  ✗ requireAuth in brand-engine route files (should be requireWorkspaceAccess)`);
    console.log(`    Admin panel uses HMAC token; requireAuth only accepts JWTs.`);
    console.log(`    See Auth Conventions in CLAUDE.md.`);
    for (const f of findings) console.log(f);
    errors++;
  } else {
    console.log(`  ✓ Brand-engine routes: requireWorkspaceAccess (not requireAuth)`);
  }
}

// ─── useEffect external-sync dirty guard against the live prop ───────────────
//
// Catches the BrandscriptTab SectionEditorCard pattern:
//
//   const [content, setContent] = useState(section.content ?? '');
//   const isDirty = content !== (section.content ?? '');     // ← live prop
//   useEffect(() => {
//     if (!isDirty) setContent(section.content ?? '');       // ← never fires
//   }, [section.content]);
//
// `isDirty` is recomputed against the *new* prop on every render. The moment
// an external update arrives (e.g. via a WS-driven React Query refetch), the
// new prop differs from the old local state, so `isDirty` is `true` and the
// sync skips — leaving stale content in the textarea.
//
// Correct pattern: track the last-synced prop in a `useRef`, gate the sync on
// `content !== lastSyncedRef.current`, and update the ref after each sync.
// See `src/components/brand/BrandscriptTab.tsx`.
//
// Suppression: append `// sync-ok` to the `if (!isDirty)` line.
{
  const findings: string[] = [];
  // We only need to look at .tsx files (the pattern requires React state).
  const tsxFiles: string[] = SCAN_ALL
    ? getFiles(path.join(ROOT, 'src'), '*.tsx')
    : changedFiles
        .filter(f => f.endsWith('.tsx') && !EXCLUDED_DIRS.some(d => f.startsWith(d + '/')))
        .map(f => path.join(ROOT, f));

  for (const file of tsxFiles) {
    let content: string;
    try { content = readFileSync(file, 'utf-8'); } catch { continue; }
    if (!content.includes('useEffect') || !content.includes('isDirty')) continue;

    // Walk every useEffect block and check whether its body contains `if (!isDirty)`
    // (or a near-synonym) followed by a setState call. If so, also confirm the
    // file defines `isDirty` as a comparison against a prop / state field — i.e.
    // a recomputed-each-render value, not a ref.
    const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = effectRegex.exec(content)) !== null) {
      const start = match.index + match[0].length - 1; // position of '{'
      // Walk braces to find the closing brace of the effect callback
      let depth = 0;
      let i = start;
      while (i < content.length) {
        const ch = content[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      if (i >= content.length) break;
      const body = content.slice(start, i + 1);
      // Look for `if (!isDirty) set...` or split-line variant. Allow alternate
      // dirty-flag names (isDirty | isEdited | hasChanges | hasEdits | hasUnsavedChanges).
      const guardRegex = /if\s*\(\s*!\s*(isDirty|isEdited|hasChanges|hasEdits|hasUnsavedChanges)\s*\)\s*\{?\s*set[A-Z]\w*\s*\(/;
      const guardMatch = body.match(guardRegex);
      if (!guardMatch) continue;

      // Check the matched line for the suppression marker.
      const lineStartInBody = body.lastIndexOf('\n', body.indexOf(guardMatch[0])) + 1;
      const lineEndInBody = body.indexOf('\n', lineStartInBody);
      const guardLine = body.slice(lineStartInBody, lineEndInBody === -1 ? body.length : lineEndInBody);
      if (guardLine.includes('// sync-ok')) continue;

      // Confirm the file defines the dirty flag as a recomputed expression
      // against another state/prop (vs reading a ref). We look for
      // `const isDirty = ` followed by a comparison and no `.current`.
      const flagName = guardMatch[1];
      const dirtyDefRegex = new RegExp(`const\\s+${flagName}\\s*=\\s*([^;\\n]+)`);
      const dirtyDef = content.match(dirtyDefRegex);
      if (!dirtyDef) continue;
      if (dirtyDef[1].includes('.current')) continue; // already ref-based

      // Compute file-relative line number for the guard line.
      const absoluteIndex = start + lineStartInBody;
      const lineNumber = content.slice(0, absoluteIndex).split('\n').length;
      findings.push(`  ${path.relative(ROOT, file)}:${lineNumber}  → ${guardLine.trim()}`);
    }
  }

  if (findings.length > 0) {
    console.log(`\n  ✗ useEffect external-sync dirty guard against the live prop`);
    console.log(`    The dirty check is recomputed against the new prop on every render,`);
    console.log(`    so it always reads "dirty" the moment an external update arrives —`);
    console.log(`    the sync skips and the user sees stale content.`);
    console.log(`    Track the last-synced prop in a useRef and compare against ref.current.`);
    console.log(`    See src/components/brand/BrandscriptTab.tsx for the canonical fix.`);
    console.log(`    Suppress with // sync-ok on the guard line if intentional.`);
    console.log(`    Matches (${findings.length}):`);
    for (const f of findings.slice(0, 5)) console.log(f);
    if (findings.length > 5) console.log(`      ... and ${findings.length - 5} more`);
    errors++;
  } else {
    console.log(`  ✓ useEffect external-sync dirty guard against the live prop`);
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
  'Any new optional field on a shared type (PageMeta, *Slice, etc.) — verify the server endpoint actually sets it, or add JSDoc: "Always undefined until [endpoint] populates it"',
  'Cross-cutting constraint (e.g. "never send X to API Y") — grep for ALL call sites before writing fix #1, guard them all in one commit. Never patch one site at a time as they are discovered.',
  'AI-generating endpoints (callCreativeAI/callOpenAI → db write): existence check + INSERT/UPDATE inside db.transaction() — not just the write, the check too',
  'New 1:1-per-workspace tables (e.g. one row per workspace+type): UNIQUE index on (workspace_id, natural_key) in migration; app code catches SQLITE_CONSTRAINT_UNIQUE and retries as update',
  'Batch save endpoints (delete-all + reinsert): Map<id, preserved> built before delete to restore created_at, sort_order, and approval state',
  'Field semantics changed (not just renamed): grep every reader of `result.X` / `slice.X` / `intel.X`, every Zod schema, every test, and every JSDoc comment for the field. Update them in the same commit. The compiler will not catch a meaning change when the type stays `string` (see seo-context.brandVoiceBlock as the canonical example).',
  'useEffect external-sync: when copying a prop into local state on update, the dirty check must compare local state to a `useRef` of the last-synced prop, never to the live prop. Comparing against the live prop guarantees the sync never fires after an external update (see BrandscriptTab.SectionEditorCard).',
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
