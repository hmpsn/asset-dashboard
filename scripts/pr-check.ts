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
import { readFileSync, realpathSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(import.meta.dirname, '..');
const SCAN_ALL = process.argv.includes('--all');

function getFiles(dir: string, pattern: string): string[] {
  try {
    // maxBuffer: 50MB. The default 1MB is not enough for `find <repo-root>
    // -name '*.ts'` which on this codebase returns ~11k absolute paths
    // totalling ~900KB+ — right at the boundary where ENOBUFS would silently
    // throw and the catch would return []. That is itself a Category A
    // silent-failure mode (rule reports ✓ because it received zero files).
    // 50MB is comfortably above any plausible repo-walk output.
    return execSync(`find "${dir}" -name "${pattern}" -type f 2>/dev/null`, {
      cwd: ROOT,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    }).trim().split('\n').filter(Boolean);
  } catch (err) {
    // Surface the error to stderr so silent file-list collapses are visible.
    // The previous bare `return []` made every getFiles failure look identical
    // to "directory exists but contains no matches" — the exact silent-failure
    // class the 2026-04-10 audit was built to catch.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[pr-check] getFiles("${dir}", "${pattern}") failed: ${msg}`);
    return [];
  }
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

// Lazy-memoised so that `import { CHECKS }` from the test harness does NOT
// spawn a `git diff` subprocess at module-load time. Only `runCli()` (and any
// future runner) reads `cachedChangedFiles()`; customCheck closures inside the
// CHECKS array never reference changedFiles directly.
let _changedFilesCache: string[] | null = null;
function cachedChangedFiles(): string[] {
  if (_changedFilesCache !== null) return _changedFilesCache;
  _changedFilesCache = SCAN_ALL ? [] : getChangedFiles();
  return _changedFilesCache;
}

// ─── Shared regexes ───────────────────────────────────────────────────────────

/**
 * Matches the *opener* of a function declaration or arrow function. Used by
 * customCheck rules that need to determine whether two lines live inside the
 * same function body. Must NOT be used for closing braces (`}`, `};`, `})`):
 * those are ambiguous (they also close if/for/try/switch blocks) and produce
 * false-negatives on legitimate violations. Any two statements separated by a
 * real function boundary are also separated by the opener of the next
 * function; the opener alone is always sufficient.
 *
 * The arrow-function alternative anchors `=>` at end-of-line (optionally
 * followed by `{`) so we only match function *declarations* whose body starts
 * on the same or the next line. Inline arrow *expressions* like
 * `const ids = items.map(item => item.id)` are deliberately excluded — they
 * are not function boundaries for multi-step write detection (Rule 3). A
 * single-line arrow body (`const add = (a, b) => a + b;`) cannot contain
 * multi-step writes, so ignoring it is safe.
 */
const FUNC_BOUNDARY_RE =
  /^(\s*(export\s+)?(async\s+)?function\s+\w+|\s*(export\s+)?const\s+\w+\s*[:=].*=>\s*\{?\s*$)/;

// ─── Rule window sizes ────────────────────────────────────────────────────────
//
// Every customCheck rule that scans a sliding window over file lines picks a
// window size that balances false-negatives (too small, legitimate bugs
// outside the window are missed) against false-positives + cost (too large,
// unrelated code bleeds in and the scan gets slow). Collecting these as
// named constants makes the tradeoffs reviewable in one place and lets the
// rule bodies read as intent, not magic numbers. Changes to these values
// directly affect rule sensitivity and MUST be re-tested via
// `tests/pr-check.test.ts` before merging.

/** Max lines to walk forward from a `window.addEventListener('keydown', ...)`
 *  call looking for the end of the handler body. Enough for long inline
 *  arrow bodies; small enough to stop at the next top-level declaration. */
const KEYDOWN_BODY_LOOKAHEAD = 60;

/** Max distance (in lines) between two `db.prepare().run()` calls for them
 *  to be considered a *pair* in the multi-step txn rule. Function-opener
 *  walkback already prevents cross-function pairing — this is a
 *  belt-and-suspenders upper bound. */
const TXN_PAIR_MAX_DISTANCE = 25;

/** Max lines to scan on a single `db.prepare(` call line to accumulate its
 *  full multi-line SQL body. Prepared statements rarely exceed 8 lines;
 *  anything bigger is almost certainly a different construct. */
const DB_PREPARE_MULTILINE_LOOKAHEAD = 8;

/** How far *back* from a flagged write we search for an already-open
 *  `db.transaction(` wrapper (multi-step txn rule). */
const TXN_WRAPPER_LOOKBEHIND = 20;

/** How far *forward* from a `callOpenAI`/`callClaude` call we scan for a
 *  following `db.prepare()` write (AI-race rule). 30 lines covers the
 *  typical "await AI → transform → write" pattern. */
const AI_RACE_FORWARD_LOOKAHEAD = 30;

/** How far *back* from an AI call we scan for a hoisted `db.transaction(`
 *  declaration. The canonical correct pattern in
 *  `docs/rules/ai-dispatch-patterns.md` hoists the txn above the await
 *  because SQLite doesn't support async transactions. */
const AI_RACE_BACKWARD_LOOKBEHIND = 20;

/** Max lines to scan on a single `db.prepare(` call line to collect its
 *  full SQL body for the ws-scope workspace_id check. Chosen higher than
 *  `DB_PREPARE_MULTILINE_LOOKAHEAD` because some long UPDATEs span ~25
 *  lines (multi-column updates with CASE expressions). */
const WS_SCOPE_SQL_LOOKAHEAD = 25;

/** Max lines to scan on a `function getOrCreate*` declaration to collect
 *  its return-type annotation. Long generics + multi-line param lists
 *  rarely push past 15. */
const GETORCREATE_RETURN_TYPE_LOOKAHEAD = 15;

/** Max lines to scan after a `router.post/put/patch/delete` call looking
 *  for an `addActivity(` call before we flag the mutation as silent
 *  (public-portal activity rule). Bounded to the next route declaration
 *  so route bodies don't bleed into each other. The 250-line cap is a
 *  defensive limit for unusually long handlers — public-portal route
 *  bodies in the wild range from 5 to ~110 lines, with the onboarding
 *  handler topping out at 101 lines from `router.post(...)` to its
 *  `addActivity(...)`. The previous 60-line cap silently false-flagged
 *  it (reported a "silent mutation" even though the call was right
 *  there, just past the window). 250 leaves comfortable headroom for
 *  any reasonable future handler. */
const PUBLIC_PORTAL_ROUTE_BODY_LOOKAHEAD = 250;

/** Max lines to scan after a `useEffect(` call to brace-balance its body
 *  for the layout-driving-state rule. Acts as a safety net if the brace
 *  balancer never reaches zero (e.g. malformed input). */
const USE_EFFECT_BODY_LOOKAHEAD = 60;

// ─── Check definitions ────────────────────────────────────────────────────────

export type CustomCheckMatch = { file: string; line: number; text: string };

export type Check = {
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
  // Optional override for the scope column in docs/rules/automated-rules.md.
  // Set this when a customCheck self-narrows to a more specific path than
  // `pathFilter`/`fileGlobs` implies (e.g. public-portal.ts only), so the
  // generated docs show the actual scan scope instead of the broader
  // file-resolution scope. Does NOT affect runtime file resolution.
  displayScope?: string;
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
// parentheses, not just in an index or a later DML statement) OR if a later
// `ALTER TABLE <name> ADD COLUMN workspace_id ...` adds the column after the
// fact. This is more accurate than a hard-coded list and auto-updates as new
// tables are added via migrations.
// Exported so tests can drive it against a fixture migrations dir without
// polluting the real `server/db/migrations` tree. Production callers go
// through the cached `workspaceScopedTables()` wrapper which always uses
// the default `server/db/migrations` location.
export function buildWorkspaceScopedTables(migrationsDirOverride?: string): Set<string> {
  const migrationsDir = migrationsDirOverride ?? path.join(ROOT, 'server/db/migrations');
  const files = getFiles(migrationsDir, '*.sql');
  const tables = new Set<string>();
  const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/i;
  // Detects `ALTER TABLE <name> ADD COLUMN ... workspace_id ...`. The
  // `[^;]*` is bounded by the statement terminator so we don't bleed into
  // a following statement on the same line. `\bworkspace_id\b` ensures
  // `workspace_id_idx` and similar do not falsely match.
  const alterRe = /ALTER\s+TABLE\s+(\w+)\s+ADD\s+COLUMN[^;]*\bworkspace_id\b/i;

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

  // Second-pass: union tables that gain a workspace_id column via
  // `ALTER TABLE ... ADD COLUMN workspace_id`. A table created without the
  // column and altered later is otherwise invisible to the ws-scope rule.
  // No existing migration uses this shape today (verified via prelude grep
  // in 2026-04-10 audit B9), but the scan is defence-in-depth against
  // future migrations.
  for (const file of files) {
    const content = readFileOrEmpty(file);
    if (!content) continue;
    for (const line of content.split('\n')) {
      const am = line.match(alterRe);
      if (am) tables.add(am[1]);
    }
  }

  return tables;
}

// Lazy-memoised so that `import { CHECKS }` from the test harness doesn't
// read every migration SQL file at module-load time. Consumers (the ws-scope
// customCheck, runCli's diagnostic print) call workspaceScopedTables() which
// builds the set on first access and caches it for the process lifetime.
let _workspaceScopedTablesCache: Set<string> | null = null;
function workspaceScopedTables(): Set<string> {
  if (_workspaceScopedTablesCache !== null) return _workspaceScopedTablesCache;
  _workspaceScopedTablesCache = buildWorkspaceScopedTables();
  return _workspaceScopedTablesCache;
}

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

/**
 * Find the end of a function's return-type annotation region given `tail`
 * — the substring starting immediately after the closing `)` of the
 * parameter list. Returns the index of the function-body opener (a `{`
 * followed only by whitespace to end-of-line) or the arrow marker (`=>`),
 * whichever comes first at outer depth.
 *
 * Tracks brace, angle, paren, and bracket depth so structural characters
 * that appear *inside* the return type itself — object-literal types like
 * `{ id: string }`, generic arguments like `Promise<{ x } | null>`, tuple
 * types like `[number, string]` — are not mistaken for body markers.
 * Skips over string literals so string-literal unions (`'a' | 'b'`) and
 * template literals cannot introduce stray structural characters.
 *
 * Replaces the original `tail.search(/[{=]/)` which truncated the return
 * region at the first `{` or `=` it saw, silently bypassing the
 * getOrCreate* nullable-return rule for every declaration whose return
 * type contained an object-literal or generic argument — the exact
 * silent-false-negative class documented as Category C in the 2026-04-10
 * audit Round 2 plan.
 */
function findReturnRegionEnd(tail: string): number {
  let angle = 0;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  let k = 0;
  while (k < tail.length) {
    const c = tail[k];
    // Skip over string literals — return types can carry string-literal
    // unions like `'a' | 'b'` whose contents must not be counted.
    if (c === "'" || c === '"' || c === '`') {
      const q = c;
      k++;
      while (k < tail.length && tail[k] !== q) {
        if (tail[k] === '\\') k += 2;
        else k++;
      }
      k++;
      continue;
    }
    // Skip `// line comments` (rare in signatures but possible).
    if (c === '/' && tail[k + 1] === '/') {
      while (k < tail.length && tail[k] !== '\n') k++;
      continue;
    }

    // Arrow body marker — the first `=>` at outer depth wins.
    if (c === '=' && tail[k + 1] === '>' && angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
      return k;
    }

    if (c === '<') { angle++; k++; continue; }
    if (c === '>') {
      if (angle > 0) angle--;
      k++;
      continue;
    }
    if (c === '(') { paren++; k++; continue; }
    if (c === ')') { if (paren > 0) paren--; k++; continue; }
    if (c === '[') { bracket++; k++; continue; }
    if (c === ']') { if (bracket > 0) bracket--; k++; continue; }
    if (c === '{') {
      if (angle === 0 && paren === 0 && brace === 0 && bracket === 0) {
        // Body-opener heuristic: the signature's body `{` is followed by
        // only whitespace until the next newline (or end-of-tail). An
        // object-literal type `{` always carries members immediately
        // after, so it fails this test and falls through to brace++.
        let j = k + 1;
        while (j < tail.length && (tail[j] === ' ' || tail[j] === '\t')) j++;
        if (j >= tail.length || tail[j] === '\n') return k;
      }
      brace++;
      k++;
      continue;
    }
    if (c === '}') { if (brace > 0) brace--; k++; continue; }
    k++;
  }
  return tail.length;
}

/**
 * Extract the argument substring of the first `db.prepare(...)` call inside
 * `chunk`. Walks character-by-character starting after the opening `(`,
 * tracks paren depth, and respects string-literal delimiters (backtick,
 * single quote, double quote) so a `)` appearing *inside* a SQL string
 * literal does not prematurely close the call.
 *
 * Returns the substring between the opening `(` and the matching `)`. If
 * no `db.prepare(` is found, returns the original chunk unchanged. If the
 * call is never closed inside `chunk` (e.g. because the lookahead window
 * was too short), returns from `(` to end-of-chunk so the downstream regex
 * still has something to match.
 *
 * Replaces the prior `chunk.indexOf(');')` truncation, which silently
 * dropped half of any SQL containing an inline `);` inside a string
 * literal — a CHECK constraint, an inline SQL comment, or any string
 * fragment with `');` would all skip the workspace_id scan and produce
 * a silent false-negative. The exact failure class documented as
 * Category C in the 2026-04-10 audit plan.
 */
export function extractDbPrepareArg(chunk: string): string {
  const startIdx = chunk.search(/db\.prepare\s*\(/);
  if (startIdx === -1) return chunk;
  let i = chunk.indexOf('(', startIdx);
  if (i === -1) return chunk;
  i++; // step past the opening (
  const argStart = i;
  let depth = 1;
  let quote: string | null = null;
  while (i < chunk.length) {
    const ch = chunk[i];
    if (quote) {
      // Inside a string literal: handle backslash-escapes (\' \" \\ etc.)
      // and the closing delimiter. We don't parse template-literal
      // ${...} interpolation — the SQL we care about is plain text and
      // any embedded JS is irrelevant to paren depth.
      if (ch === '\\' && i + 1 < chunk.length) { i += 2; continue; }
      if (ch === quote) quote = null;
    } else {
      if (ch === '`' || ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') {
        depth--;
        if (depth === 0) return chunk.slice(argStart, i);
      }
    }
    i++;
  }
  return chunk.slice(argStart); // never closed within chunk — fall through
}

// ─── Slice field rendering helpers ────────────────────────────────────────────
//
// Used by the 'Assembled-but-never-rendered slice fields' rule to detect fields
// declared in *Slice interfaces (shared/types/intelligence.ts) but never referenced
// in their corresponding format*Section function (server/workspace-intelligence.ts).
// Must live at module scope because the rule lives in the CHECKS array and its
// customCheck closure looks these up by lexical binding at invocation time.

/** Map of slice interface name → formatter function name. */
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

/** Fields intentionally not rendered (complex nested types, metadata, or
 *  rendering handled differently — e.g. destructured `const { bySeverity } = ...`
 *  which the property-access regex can't catch). */
const KNOWN_UNRENDERED_FIELDS = new Set([
  // SeoContextSlice — backlinkProfile and serpFeatures are now rendered by formatSeoContextSection()
  // InsightsSlice
  'byType', 'forPage',
  // bySeverity: rendered via `const { bySeverity } = insights` (destructuring, not .bySeverity)
  'bySeverity',
  // LearningsSlice
  'forPage', 'winRateByActionType',
  // SiteHealthSlice
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

/**
 * Pure helper for the 'Assembled-but-never-rendered slice fields' rule.
 *
 * Exported so the harness can exercise it directly without monkeypatching ROOT.
 * Takes both file contents as strings plus the paths to cite in hits, so a
 * test can pass synthetic fixtures while production uses the real repo files.
 *
 * Returns a list of matches for fields declared in any *Slice interface in
 * `typesContent` but never referenced in the corresponding format*Section
 * function in `serverContent`. Fields in KNOWN_UNRENDERED_FIELDS are skipped.
 */
export function findUnrenderedSliceFields(
  typesContent: string,
  serverContent: string,
  typesPath: string,
  serverPath: string,
): CustomCheckMatch[] {
  if (!typesContent || !serverContent) return [];
  const hits: CustomCheckMatch[] = [];
  for (const { sliceName, formatterName } of SLICE_FORMATTER_MAP) {
    const fields = extractInterfaceFields(typesContent, sliceName);
    const formatterBody = extractFormatterBody(serverContent, formatterName);
    if (!formatterBody) {
      hits.push({
        file: serverPath,
        line: 1,
        text: `${sliceName}: formatter ${formatterName} not found`,
      });
      continue;
    }
    for (const field of fields) {
      if (KNOWN_UNRENDERED_FIELDS.has(field)) continue;
      if (
        !formatterBody.includes(`.${field}`) &&
        !formatterBody.includes(`['${field}']`) &&
        !formatterBody.includes(`["${field}"]`)
      ) {
        // Locate the field's declaration line in the types file for
        // actionable output. Falls back to line 1 if not found.
        const typeLines = typesContent.split('\n');
        const fieldLineIdx = typeLines.findIndex(l => new RegExp(`^\\s+${field}\\??:`).test(l));
        hits.push({
          file: typesPath,
          line: fieldLineIdx >= 0 ? fieldLineIdx + 1 : 1,
          text: `${sliceName}.${field} → not referenced in ${formatterName}`,
        });
      }
    }
  }
  return hits;
}

/**
 * Pure helper for the 'Constants in sync (STUDIO_NAME, STUDIO_URL)' rule.
 *
 * Exported so the harness can exercise it directly without monkeypatching ROOT.
 * Takes both file contents as strings plus the server path to cite in hits.
 *
 * Returns a list of matches for each STUDIO_* constant whose value differs
 * between `serverSrc` and `frontendSrc`. The `serverConstPath` is the jump
 * target written into each hit so clicking takes you to the server file's
 * declaration line.
 */
export function compareStudioConstants(
  serverSrc: string,
  frontendSrc: string,
  serverConstPath: string,
): CustomCheckMatch[] {
  if (!serverSrc || !frontendSrc) return [];
  const extract = (src: string, name: string): string | null => {
    const m = src.match(new RegExp(`export const ${name}\\s*=\\s*['"]([^'"]+)['"]`));
    return m?.[1] ?? null;
  };
  const hits: CustomCheckMatch[] = [];
  for (const name of ['STUDIO_NAME', 'STUDIO_URL']) {
    const sv = extract(serverSrc, name);
    const fv = extract(frontendSrc, name);
    if (sv !== fv) {
      // Point at the server file's declaration line for a useful jump target.
      const lines = serverSrc.split('\n');
      const lineIdx = lines.findIndex(l => l.includes(`export const ${name}`));
      hits.push({
        file: serverConstPath,
        line: lineIdx >= 0 ? lineIdx + 1 : 1,
        text: `${name}: server='${sv}' vs frontend='${fv}'`,
      });
    }
  }
  return hits;
}

// ─── Brand-engine route list ──────────────────────────────────────────────────
// Used by the 'requireAuth in brand-engine routes' rule. These routes must use
// `requireWorkspaceAccess` — the admin panel authenticates via HMAC (global gate)
// and `requireAuth` (JWT-only) would 401 every admin call. See Auth Conventions
// in CLAUDE.md.
//
// Stored as a Set of *basenames* so the rule can be exercised against fixture
// files under tmpdir (where the relative path is `rule-33/case-1/...`, not
// `server/routes/...`). Basename matching is safe because Express mounts these
// routes under specific, unambiguous filenames — there is no other
// `voice-calibration.ts` in the repo that could shadow them.
export const BRAND_ENGINE_ROUTE_BASENAMES: ReadonlySet<string> = new Set([
  'voice-calibration.ts',
  'discovery-ingestion.ts',
  'brand-identity.ts',
  'brandscript.ts',
  'page-strategy.ts',
  'copy-pipeline.ts',
]);

// ─── requireAuth allowlist ───────────────────────────────────────────────────
// Files that legitimately use `requireAuth` (JWT-only middleware). Every other
// server route file should use `requireWorkspaceAccess` or rely on the global
// APP_PASSWORD HMAC gate. Brand-engine routes have their own dedicated rule
// (see "requireAuth in brand-engine route files") so they are excluded here
// to avoid double-flagging.
//
// Stored as basenames for harness testability (same rationale as
// BRAND_ENGINE_ROUTE_BASENAMES above).
export const REQUIRE_AUTH_ALLOWED_BASENAMES: ReadonlySet<string> = new Set([
  'auth.ts',       // JWT login/refresh endpoints
  'users.ts',      // user management — JWT-gated by design
]);

// ─── Globally-applied rate limiters ──────────────────────────────────────────
// These three limiters are applied to ALL `/api/public/` routes in app.ts.
// Importing and re-applying them inside individual route files increments the
// same shared in-memory bucket twice, silently halving the effective rate limit
// (e.g. 10 req/min becomes 5). See the warning comment in server/app.ts and
// the `rateLimit()` implementation in server/middleware.ts.
export const GLOBALLY_APPLIED_LIMITERS: ReadonlySet<string> = new Set([
  'globalPublicLimiter',
  'publicApiLimiter',
  'publicWriteLimiter',
]);

// Maximum number of lines to scan forward in a route handler body
// when looking for a broadcastToWorkspace/broadcast call.
const ROUTE_BROADCAST_LOOKAHEAD = 120;

/** Max lines to scan forward when looking for an `addActivity(` call
 *  in an admin route handler body. Reuses the same generous cap as the
 *  public-portal rule — admin handlers can be similarly long. */
const ADMIN_ACTIVITY_LOOKAHEAD = 250;

/** Extracts workspace-*only* event string values from `server/ws-events.ts`.
 *  Returns WS_EVENTS values minus any values that also appear in ADMIN_EVENTS.
 *  Values that exist in both objects (e.g. 'workspace:updated', 'request:created')
 *  are legitimate admin-global events and must not be flagged. */
function loadWsEventValues(): Set<string> {
  const wsEventsPath = path.join(ROOT, 'server', 'ws-events.ts');
  const content = readFileOrEmpty(wsEventsPath);
  if (!content) return new Set();
  const valueRe = /:\s*['"]([^'"]+)['"]/g;

  // Extract the WS_EVENTS block (ends at `} as const;`)
  const wsBlock = content.match(/export\s+const\s+WS_EVENTS\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  if (!wsBlock) return new Set();
  const wsValues = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = valueRe.exec(wsBlock[1])) !== null) {
    wsValues.add(m[1]);
  }

  // Extract the ADMIN_EVENTS block and subtract overlapping values.
  const adminBlock = content.match(/export\s+const\s+ADMIN_EVENTS\s*=\s*\{([\s\S]*?)\}\s*as\s+const/);
  if (adminBlock) {
    valueRe.lastIndex = 0;
    while ((m = valueRe.exec(adminBlock[1])) !== null) {
      wsValues.delete(m[1]);
    }
  }

  return wsValues;
}

/** Extracts the set of activity-type string literals from the
 *  `CLIENT_VISIBLE_TYPES` set declaration in `server/activity-log.ts`.
 *  Returns an empty set if the file or declaration cannot be parsed. */
function loadClientVisibleTypes(): Set<string> {
  const activityPath = path.join(ROOT, 'server', 'activity-log.ts');
  const content = readFileOrEmpty(activityPath);
  if (!content) return new Set();
  // Match the `CLIENT_VISIBLE_TYPES: Set<ActivityType> = new Set([...])` block
  const block = content.match(/const\s+CLIENT_VISIBLE_TYPES[^=]*=\s*new\s+Set\(\[([\s\S]*?)\]\)/);
  if (!block) return new Set();
  const values = new Set<string>();
  const valueRe = /['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = valueRe.exec(block[1])) !== null) {
    values.add(m[1]);
  }
  return values;
}

export const CHECKS: Check[] = [
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
      'server/semrush.ts', // disk files: SEMRush API usage log + credit log files (not DB columns)
      'server/providers/dataforseo-provider.ts', // disk files: DataForSEO credit log files (not DB columns)
      'server/monthly-report.ts', // disk files: sent-report tracking + report output files (not DB columns)
      'server/competitor-schema.ts', // HTTP fetch response (JSON-LD from HTML) + disk cache file (not DB columns)
      'server/storage-stats.ts', // disk files: workspace storage stat files (not DB columns)
      'server/db/migrate-json.ts', // disk files: one-time migration tool reads legacy flat-file JSON stores (not DB columns)
      'server/db/json-column.ts', // safe JSON column helper — implements the wrapper, not a raw DB read
      'server/email-queue.ts', // disk file: email queue persistence file (not DB columns)
      'server/routes/semrush.ts', // disk cache files: SEMRush response cache (not DB columns)
      'server/routes/reports.ts', // disk files: report output files served via API (not DB columns)
      'server/routes/roadmap.ts', // disk files: roadmap.json + runtime status files (not DB columns)
      'server/routes/content-publish.ts', // AI response text parser: parses Claude field-mapping suggestion (not DB columns)
      'server/stripe-config.ts', // disk file: AES-encrypted Stripe config file (not DB columns)
      'server/diagnostic-orchestrator.ts', // AI response text parser (GPT-4.1 synthesis result), not DB columns
      'server/workspace-intelligence.ts', // disk file: AEO review JSON from aeo-reviews/ directory (not DB columns)
    ],
    message: 'Use parseJsonSafe() or parseJsonFallback() from server/db/json-validation.ts.',
    severity: 'error',
  },
  {
    name: 'Hard-coded studio name',
    pattern: 'hmpsn[ .]studio',
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['server/constants.ts', 'src/constants.ts'],
    excludeLines: [
      'hmpsn-studio-logo-wordmark-white.svg',
      'alt="hmpsn studio"',
      'alt="hmpsn.studio"',
    ],
    message: 'Use the STUDIO_NAME / STUDIO_URL constant from src/constants.ts (frontend) or server/constants.ts (backend).',
    severity: 'error',
  },
  {
    // Do-not-reintroduce rule. `formatBrandVoiceForPrompt` was deleted in PR #168
    // because it bypassed voice-profile authority: any caller that grabbed the
    // helper and wrapped the raw `seo?.brandVoice` field silently dropped the
    // calibrated DNA/samples/guardrails layers that `buildSeoContext` applies
    // via `effectiveBrandVoiceBlock`. The TypeScript signature didn't change
    // when voice profiles were added, so the compiler couldn't catch the bypass
    // — that's why we mechanize the ban here. See CLAUDE.md
    // "Authority-layered fields — expose one resolved representation, never raw
    // + format helper" for the general principle.
    //
    // Tests and auto-generated codesight files are excluded because they
    // legitimately reference the deleted name when explaining why it's gone.
    name: 'formatBrandVoiceForPrompt reintroduction',
    pattern: '\\bformatBrandVoiceForPrompt\\b',
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: [
      'tests/',
      '.codesight/',
      'scripts/pr-check.ts', // this rule itself references the name
    ],
    message: 'formatBrandVoiceForPrompt was deleted in PR #168 because it bypassed voice-profile authority. Use `seo?.effectiveBrandVoiceBlock ?? ""` — it is pre-formatted by buildSeoContext with full authority applied. See CLAUDE.md "Authority-layered fields — expose one resolved representation, never raw + format helper".',
    severity: 'error',
    rationale: 'A generic format helper that wraps a raw authority-layered field bypasses the authority chain silently — the compiler cannot catch it because the raw field type is still `string`.',
    claudeMdRef: '#code-conventions',
  },
  {
    // Catches the silent-overwrite bug class from PR #267: `new Map(arr.map(r => [key.toLowerCase(), v]))`
    // keeps only the LAST entry when the source array has duplicate normalized keys.
    // The canonical failure: GSC query×page data (one row per (query, page)) built this way,
    // so `currentPosition` on emerging_keyword insights reflected an arbitrary page's position
    // rather than the strongest ranking. Fix is to use `reduce` with a merge/min function.
    //
    // Scoped to `.toLowerCase()` keys because that's the distinctive signal of a normalizer
    // that can collapse distinct source rows into the same key. Raw id keys are almost always
    // unique by DB constraint; normalized-string keys are where the bug hides.
    name: 'new Map from .toLowerCase() key without uniqueness proof',
    // NOTE: BSD `grep -E` (macOS) doesn't support `\s` or `[^\]]`. Use POSIX
    // classes instead: `[[:space:]]` and `[^]]`. Tested against all 14 known
    // sites in server/ — all match.
    pattern: 'new Map\\([^)]*\\.map\\([^)]*=>[[:space:]]*\\[[^]]*\\.toLowerCase\\(\\)',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['// map-dup-ok'],
    message: 'new Map(arr.map(r => [key.toLowerCase(), v])) silently keeps the LAST entry on duplicate normalized keys. If the source array has one row per key (API returning unique keywords), add // map-dup-ok inline. If it can have multiple rows per key (GSC query×page, etc.), use reduce to merge/pick: arr.reduce<Map<K,V>>((m, r) => { const k = r.x.toLowerCase(); const existing = m.get(k); if (!existing || r.pos < existing.pos) m.set(k, r); return m; }, new Map()).',
    severity: 'warn',
    rationale: 'Silent-overwrite in Map construction from tuples — TypeScript cannot see the key collision, and the bug only manifests for a subset of input distributions.',
    claudeMdRef: '#code-conventions',
  },
  {
    name: 'window.confirm() in client components',
    pattern: 'window\\.confirm\\(',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/components/client/',
    message: 'Use <ConfirmDialog> from src/components/ui/ConfirmDialog.tsx instead of window.confirm() — the native dialog appears at the top of the screen, not centered.',
    severity: 'error',
    rationale: 'window.confirm() produces a browser-native dialog anchored to the top of the viewport, which disorients users working near the bottom of long pages. ConfirmDialog renders centered with teal CTA and keyboard support.',
    claudeMdRef: '#uiux-rules-mandatory',
  },
  {
    name: 'Raw fetch() in components',
    // customCheck (was regex) — see Round 2 Task P1.5. The original pattern
    // `(?<![a-zA-Z])fetch\\(` uses a lookbehind assertion. BSD `grep -E`
    // does not support lookbehind; running it errored with
    // `grep: repetition-operator operand invalid` and `|| true` in the
    // shell invocation silently swallowed the failure. The runner then
    // reported ✓ while 6 real violations existed in src/components.
    // Silent-failure Category B/D hybrid (regex feature unsupported by the
    // shell tool). Fix: run the regex in-process as a JS regex where
    // lookbehind is supported natively.
    pattern: '',
    fileGlobs: ['*.tsx', '*.ts'],
    pathFilter: 'src/components/',
    excludeLines: ['// fetch-ok'],
    message: 'Use typed API client modules from src/api/ — no raw fetch() in components. Add // fetch-ok on the fetch line or the line immediately above if intentional (e.g., uploading FormData where api/ has no helper).',
    severity: 'warn',
    rationale: 'Raw fetch() bypasses typed API wrappers, error normalization, and auth headers — the #1 source of untyped response bugs in UI code.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // JS regex — lookbehind is supported here even though BSD grep -E
      // chokes on it. Matches bare `fetch(` but not `.fetch(` (method calls
      // like `client.fetch()` or `queryClient.fetchQuery()`) or `refetch(`
      // (React Query). The char before `fetch` must not be a letter or `.`.
      const fetchRe = /(?<![a-zA-Z.])fetch\s*\(/;
      for (const file of files) {
        if (!file.includes('/src/components/')) continue;
        if (!/\.(ts|tsx)$/.test(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('fetch(')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!fetchRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// fetch-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
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
    // customCheck (was regex) — see Round 2 Task P1.3. The original pattern
    // `broadcastToWorkspace\\([^,]+,\\s*[\'"]` embedded a literal `"`
    // which, when interpolated into the outer `grep -E "${pattern}"`
    // invocation in `checkDirectory`, closed the outer double-quote and
    // mangled the shell command. `grep` errored; `|| true` swallowed the
    // error; the runner reported ✓ while 36+ real violations existed
    // (server/feedback.ts, server/routes/workspaces.ts, etc.).
    // Silent-failure Category D (shell quoting). Fix: run the regex
    // in-process as a JS regex — the shell never sees it.
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/broadcast.ts'],
    excludeLines: ['// ws-event-ok'],
    message: 'Use WS_EVENTS.* constants from server/ws-events.ts instead of string literals. Literals cause silent drift between broadcast and frontend handler. Add // ws-event-ok on the broadcast line or the line immediately above if intentional.',
    // warn not error: ~36 pre-existing violations in unchanged files;
    // new code is blocked by the changed-files scan. Upgrade to error
    // once the Task B12 backfill is done.
    severity: 'warn',
    rationale: 'Silent drift between broadcast emitter and frontend handler when an event string is typo\u2019d or renamed on one side only.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Matches `broadcastToWorkspace(anything, 'event', ...)` or the
      // double-quoted variant. Does NOT match
      // `broadcastToWorkspace(wsId, WS_EVENTS.FOO, data)` because the
      // second arg does not start with a quote.
      const bcastRe = /broadcastToWorkspace\s*\([^,]+,\s*['"]/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('broadcastToWorkspace')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!bcastRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// ws-event-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'Raw string literal in broadcast() event arg',
    // customCheck (was regex) — same Category D shell-quoting bug as the
    // broadcastToWorkspace rule above. Original pattern was
    // `(^|[^a-zA-Z_])broadcast\\(\\s*[\'"]`. Preserves the original
    // exclusion semantics: `broadcast(` is flagged only when not preceded
    // by a letter or underscore, so private wrappers like
    // `_broadcast()` and `websocket._broadcast()` do not trigger.
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/broadcast.ts'],
    excludeLines: ['// ws-event-ok'],
    message: 'Use ADMIN_EVENTS.* constants from server/ws-events.ts instead of string literals. Literals cause silent drift between broadcast and frontend handler. Add // ws-event-ok on the broadcast line or the line immediately above if intentional.',
    severity: 'warn',
    rationale: 'Silent drift between broadcast emitter and frontend handler when an event string is typo\u2019d or renamed on one side only.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // The `(?:^|[^a-zA-Z_])` prefix preserves the original rule's
      // exclusion of `_broadcast(` (private wrappers in websocket.ts).
      // Note: `.` IS in `[^a-zA-Z_]`, so `foo.broadcast('literal')` WILL
      // be flagged — this is intentional. There are currently no
      // legitimate method-call `.broadcast('literal')` sites in server/
      // (only the global helper and the `_broadcast` private wrappers),
      // so no false-positive carve-out is needed. If one is ever added,
      // extend the exclusion to `[^a-zA-Z_.]` and annotate the exception.
      // JS regex doesn't need shell escaping so both quote styles work
      // directly (the original regex-in-shell version couldn't use `['"]`
      // without closing the outer shell quote — Category D).
      const bcastRe = /(?:^|[^a-zA-Z_])broadcast\s*\(\s*['"]/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('broadcast(')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!bcastRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// ws-event-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
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
    // Accept both JS comment (`// status-ok`) and SQL comment (`-- status-ok`)
    // forms since this rule fires on lines that are often inside backtick-SQL
    // template literals where `//` would break the SQL. The comment prefix
    // (`//` or `--`) is required so the hatch can't false-suppress via a bare
    // `status-ok` substring inside an identifier, enum value, or string literal.
    excludeLines: ['// status-ok', '-- status-ok', 'validateTransition'],
    message: 'State machine transitions must use validateTransition(from, to). Direct SET status = ? skips guard. Add // status-ok (JS comment) or -- status-ok (SQL comment) if this is a non-state-machine column.',
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
    name: 'Silent bare catch in server files',
    // Matches lines that open a bare catch block with no error variable — the most
    // dangerous pattern: no err reference means isProgrammingError() can never be called.
    // Originally scoped to workspace-intelligence.ts, now expanded to all server files
    // after the broad catch-hardening pass (#576) converted ~344 bare catches.
    // Suppression: append `// catch-ok` to the same line. Because the pattern is anchored
    // with `$`, adding any suffix prevents the regex from matching — so excludeLines is not
    // needed here but left as documentation of the convention.
    pattern: '\\} catch \\{$',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    message: 'Bare `catch {` hides TypeError/ReferenceError as silent degradation. Use `catch (err)` and call isProgrammingError(err), or log.debug for expected failures (JSON parse, migration). Annotate intentionally-silent catches with `// catch-ok`.',
    severity: 'error',
  },
  {
    name: 'isProgrammingError near new URL() or fetch()',
    // Catches that wrap `new URL()` on external input or `fetch()` on external
    // URLs throw TypeError for expected failures (malformed URL, DNS, network).
    // isProgrammingError() classifies these as code bugs — a false positive.
    // See the caveats in server/errors.ts.
    // Suppression: add `// url-fetch-ok` on the isProgrammingError line.
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['// url-fetch-ok'],
    message: 'isProgrammingError() in a catch block that wraps `new URL()` or `fetch()` may produce false positives — TypeError from malformed URLs or network failures is expected degradation, not a code bug. Verify the catch is not wrapping external input, or add `// url-fetch-ok` to suppress.',
    severity: 'warn',
    rationale: 'False-positive log.warn noise: network failures and user-supplied malformed URLs trigger TypeError alerts that obscure real code bugs.',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const urlOrFetchRe = /\bnew\s+URL\s*\(|\bfetch\s*\(/;
      const isPECall = /isProgrammingError\s*\(/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        // Walk backward from each isProgrammingError call to find the
        // enclosing `catch`. Then walk backward from that catch to the
        // matching `try` via brace-depth tracking. Only flag if the
        // try body contains new URL( or fetch(.
        for (let i = 0; i < lines.length; i++) {
          if (!isPECall.test(lines[i])) continue;
          if (hasHatch(lines, i, '// url-fetch-ok')) continue;
          // Skip comment lines (the caveats in errors.ts)
          if (/^\s*\/\//.test(lines[i])) continue;
          // Find enclosing catch — scan backward for `catch`
          let catchLine = -1;
          for (let j = i; j >= Math.max(0, i - 5); j--) {
            if (/\bcatch\s*\(/.test(lines[j])) { catchLine = j; break; }
          }
          if (catchLine < 0) continue;
          // Walk backward from catch to find matching try via brace depth
          let depth = 0;
          let tryLine = -1;
          for (let j = catchLine; j >= 0; j--) {
            for (let c = lines[j].length - 1; c >= 0; c--) {
              if (lines[j][c] === '}') depth++;
              else if (lines[j][c] === '{') depth--;
            }
            if (/\btry\s*\{/.test(lines[j]) && depth <= 0) { tryLine = j; break; }
          }
          if (tryLine < 0) continue;
          // Check if try body contains new URL( or fetch(
          for (let j = tryLine; j < catchLine; j++) {
            if (urlOrFetchRe.test(lines[j])) {
              hits.push({ file, line: i + 1, text: lines[i] });
              break;
            }
          }
        }
      }
      return hits;
    },
  },

  // ─── New rules (2026-04-10 audit) ───
  {
    name: 'useGlobalAdminEvents import restriction',
    // customCheck (was regex) — see Round 2 postmortem in
    // docs/superpowers/plans/2026-04-10-pr-check-audit-and-backfill.md.
    // The original `pattern: "from '[^']*useGlobalAdminEvents"` caught only
    // single-quoted imports; a double-quoted importer silently bypassed an
    // error-severity gate (silent-failure Category B). A regex with
    // `['"]` can't be passed through `grep -E "..."` because the `"` closes
    // the outer shell quote, so the only safe fix is a customCheck that
    // runs the detection as a JS regex in-process.
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    // Allowlist of audited global-fanout sites. Any new importer must be
    // reviewed and added here explicitly. Enforced by resolveCheckFileList.
    exclude: [
      'src/hooks/useGlobalAdminEvents.ts',
      'src/components/WorkspaceOverview.tsx',
      'src/App.tsx',
    ],
    excludeLines: ['// global-events-ok'],
    message: 'useGlobalAdminEvents does not subscribe — workspace-scoped events will be silently filtered. Use useWorkspaceEvents(workspaceId, ...) instead. Only audited global-fanout sites may import it. Add // global-events-ok on the import line or the line immediately above if this file is a legitimate global-fanout site.',
    severity: 'error',
    rationale: 'Silent dead broadcast handlers: the frontend never receives the event and the UI appears stale until a manual refetch.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Match `from '...useGlobalAdminEvents...'` OR
      //        `from "...useGlobalAdminEvents..."`
      // Anchoring on `from ['"]` ensures we only flag actual import
      // statements — bare identifier references, string-literal mentions,
      // and comments do not trigger. The quote-style class is the whole
      // point of this fix.
      const importRe = /from\s+['"][^'"]*useGlobalAdminEvents/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!importRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// global-events-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i] });
        }
      }
      return hits;
    },
  },
  {
    name: 'Global keydown missing isContentEditable guard',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    exclude: ['src/App.tsx'],
    excludeLines: ['// keydown-ok'],
    message: 'Global keydown handlers must early-return if e.target is an input/textarea/contenteditable. Use the pattern from src/App.tsx (check HTMLInputElement/HTMLTextAreaElement/HTMLSelectElement and isContentEditable). Add // keydown-ok if intentional.',
    severity: 'error',
    rationale: 'Escape/Enter/arrow keys hijack text fields, destroying the user\u2019s typing or closing modals from the wrong event.',
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
          const lookahead = lines.slice(i, Math.min(lines.length, i + KEYDOWN_BODY_LOOKAHEAD)).join('\n');
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
    severity: 'error',
    rationale: 'Partial failure leaves the DB in an inconsistent state; retries then hit PRIMARY KEY violations and permanently block the operation.',
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
          const lookahead = lines.slice(i, Math.min(lines.length, i + DB_PREPARE_MULTILINE_LOOKAHEAD)).join('\n');
          if (!/\.run\s*\(/.test(lookahead)) continue;
          // Skip stmts() cache definitions — these are always part of a
          // createStmtCache object literal where every value is a prepare.
          if (/:\s*db\.prepare/.test(lines[i])) continue;
          if (hasHatch(lines, i, '// txn-ok')) continue;
          writeIdx.push(i);
        }
        if (writeIdx.length < 2) continue;
        // A function boundary between two writes means they are in separate
        // functions and are NOT a multi-step mutation. See FUNC_BOUNDARY_RE
        // (module scope) for the rationale behind matching only openers.
        const reported = new Set<number>();
        for (let k = 0; k < writeIdx.length - 1; k++) {
          const a = writeIdx[k];
          const b = writeIdx[k + 1];
          // Belt-and-suspenders: the function-opener walkback below already
          // prevents cross-function pairing, but a hard distance cap still
          // bounds the worst-case window. See TXN_PAIR_MAX_DISTANCE.
          if (b - a > TXN_PAIR_MAX_DISTANCE) continue;
          // Skip if a function boundary sits between the two writes — they
          // live in different scopes and a shared transaction is nonsensical.
          let boundaryBetween = false;
          for (let m = a + 1; m < b; m++) {
            if (FUNC_BOUNDARY_RE.test(lines[m])) { boundaryBetween = true; break; }
          }
          if (boundaryBetween) continue;
          const winStart = Math.max(0, a - TXN_WRAPPER_LOOKBEHIND);
          const lookbehind = lines.slice(winStart, a + 1).join('\n');
          if (/\bdb\.transaction\s*\(/.test(lookbehind)) continue;
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
    severity: 'error',
    rationale: 'Two concurrent handlers both observe \u201cno existing row\u201d during the AI call and both INSERT, creating permanent duplicate rows on a logical natural key.',
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
          const lookahead = lines.slice(i + 1, i + 1 + AI_RACE_FORWARD_LOOKAHEAD);
          const hasWrite = lookahead.some(l => /\bdb\.prepare\s*\(/.test(l) || /\bstmts\s*\(\s*\)\./.test(l));
          if (!hasWrite) continue;
          // Forward scan: txn declared AFTER the AI call (rare — requires an
          // async txn, which SQLite doesn't support, so this is mostly a
          // defensive check).
          const hasTxnForward = lookahead.some(l => /\bdb\.transaction\s*\(/.test(l));
          if (hasTxnForward) continue;
          // Backward scan: the CANONICAL correct pattern hoists the txn above
          // the AI call because you cannot `await` inside db.transaction():
          //   const doWork = db.transaction(() => { existence-check + upsert });
          //   const result = await callOpenAI(...);
          //   doWork();
          // Without this backward scan, the rule false-positives on every
          // correct implementation of the ai-dispatch-patterns.md contract.
          const before = lines.slice(Math.max(0, i - AI_RACE_BACKWARD_LOOKBEHIND), i);
          const hasTxnBackward = before.some(l => /\bdb\.transaction\s*\(/.test(l));
          if (hasTxnBackward) continue;
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
    severity: 'error',
    rationale: 'Cross-tenant read or write exposure: a forged row id or misrouted request can touch another workspace\u2019s data if the auth layer is ever compromised.',
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
          // Grab the next WS_SCOPE_SQL_LOOKAHEAD lines to reconstruct the SQL
          // string; the paren-depth tokeniser walks the chunk and returns the
          // substring inside `db.prepare(...)`, respecting string-literal
          // delimiters so an inline `);` inside a SQL CHECK constraint or
          // string fragment does not prematurely close the call. Replaces
          // the prior `chunk.indexOf(');')` truncation — see
          // `extractDbPrepareArg` doc comment for the failure class avoided.
          const chunk = lines.slice(i, Math.min(lines.length, i + WS_SCOPE_SQL_LOOKAHEAD)).join('\n');
          // The tokeniser returns the substring strictly inside the
          // `db.prepare(` parens — i.e. it has already stripped `db.prepare(`
          // and the matching `)`. The first non-whitespace character of the
          // result should therefore be the opening string delimiter.
          const sqlBlob = extractDbPrepareArg(chunk);
          // Normalise whitespace so regex patterns can match across newlines
          const sql = sqlBlob.replace(/\s+/g, ' ');
          // Extract the SQL statement inside the template/quote — the arg
          // begins with a backtick/quote, so anchor at the start of the
          // (whitespace-stripped) blob. Capture the opening delimiter and use
          // \1 so embedded different-quote characters don't truncate.
          const m = sql.match(/^\s*([`'"])([\s\S]*?)\1/);
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
          if (!workspaceScopedTables().has(tableName)) continue;
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
    rationale: 'Dead `if (!result)` guard branches lie to reviewers about the function\u2019s real shape and hide downstream assumptions that would fail on a genuine null.',
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
          const joined = lines.slice(i, Math.min(lines.length, i + GETORCREATE_RETURN_TYPE_LOOKAHEAD)).join('\n');
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
          // After the closing `)`, read until the body opener — either the
          // function-body `{` (followed only by whitespace to EOL) or the
          // arrow `=>`. `findReturnRegionEnd` tracks brace/angle/paren/
          // bracket depth so object-literal types, `Promise<...>` generics,
          // and tuple types inside the return annotation are NOT mistaken
          // for the body opener. Without depth tracking, `tail.search(/[{=]/)`
          // truncated `returnRegion` at the first `{` it saw, silently
          // bypassing every declaration whose return type contained `{`.
          const tail = joined.slice(j + 1);
          const bodyIdx = findReturnRegionEnd(tail);
          const returnRegion = tail.slice(0, bodyIdx);
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
    // Tolerate flexible spacing: `Record<string,unknown>`, `Record< string , unknown >`,
    // and `Record<string,  unknown>` all match. A developer using extra
    // whitespace (or none) must not bypass the rule.
    pattern: 'Record<\\s*string\\s*,\\s*unknown\\s*>',
    fileGlobs: ['*.ts'],
    pathFilter: 'shared/types/',
    excludeLines: ['// record-unknown-ok'],
    message: 'Define typed interfaces at layer boundaries, not Record<string, unknown>. Untyped contracts are the #1 recurring bug pattern. See InsightDataMap for the discriminated-union pattern. Add // record-unknown-ok only for grandfathered escape-hatch fields (e.g. AnalyticsInsight.data).',
    severity: 'error',
    rationale: 'Producer/consumer drift: field renames and semantic changes compile silently until a runtime bug surfaces in production.',
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
    severity: 'error',
    rationale: 'Nested sub-objects (e.g. `address` inside a profile blob) are silently replaced instead of merged, clobbering fields the PATCH body didn\u2019t mention.',
    claudeMdRef: '#code-conventions',
  },
  {
    name: 'Public-portal mutation without addActivity',
    pattern: '',
    fileGlobs: ['*.ts'],
    // No `pathFilter` — the customCheck self-filters via an explicit
    // `endsWith('public-portal.ts')` guard below. A `pathFilter` here would
    // be a Category A failure waiting to happen: if the resolveCheckFileList
    // logic ever drifts (e.g. matches by directory prefix instead of full
    // suffix), the customCheck silently receives an empty array and reports
    // ✓. Self-filtering keeps the rule independent of the file-list pipeline.
    excludeLines: ['// activity-ok'],
    message: 'Every public-portal POST/PUT/PATCH/DELETE must call addActivity() so admins have visibility into client portal engagement in the activity feed. Add // activity-ok on the router line if this endpoint is intentionally silent (e.g. read-only health probe).',
    severity: 'error',
    rationale: 'Admins lose visibility into client portal engagement \u2014 writes performed by clients leave no trace in the activity feed.',
    claudeMdRef: '#code-conventions',
    // Doc-only: the customCheck below self-filters to this one file via
    // `endsWith('server/routes/public-portal.ts')`. Without `displayScope`
    // the generated docs would show `*.ts` (the file-resolution glob),
    // which is technically accurate but misleading to readers.
    displayScope: 'server/routes/public-portal.ts',
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
      for (let i = 0; i < lines.length; i++) {
        if (routeRe.test(lines[i])) routeIdx.push(i);
      }
      for (let k = 0; k < routeIdx.length; k++) {
        const start = routeIdx[k];
        if (hasHatch(lines, start, '// activity-ok')) continue;
        const nextStart = k + 1 < routeIdx.length ? routeIdx[k + 1] : lines.length;
        const routeBodyEnd = Math.min(nextStart, start + PUBLIC_PORTAL_ROUTE_BODY_LOOKAHEAD);
        const routeBody = lines.slice(start, routeBodyEnd).join('\n');
        if (/\baddActivity\s*\(/.test(routeBody)) continue;
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
    severity: 'error',
    rationale: 'Double-dispatched WS events: every subscriber receives the same update twice, producing UI flicker or masking genuine retries behind idempotency guards.',
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
          // TODO: migrate to for...of when refactoring — uses early-exit
          // returns (`return` inside forEach) which need translating to
          // `continue`. Mechanically trivial but kept as-is per B9 Step 6's
          // "skip if early-exit" guidance to minimise risk in this commit.
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
    rationale: 'One-frame layout flash: the browser paints with stale layout state, then the effect runs and re-lays-out, producing visible jitter.',
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
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!/\buseEffect\s*\(/.test(lines[i])) continue;
          if (hasHatch(lines, i, '// effect-layout-ok')) continue;
          // Brace-balance the callback body so we don't bleed into an
          // adjacent useEffect (small components often stack multiple
          // useEffects within a few lines of each other). We start
          // counting from the first `{` on or after the useEffect line and
          // stop when the balance returns to 0. This is not lexer-perfect
          // (ignores strings/comments) but is good enough for the 99% case
          // and is bounded by MAX_LOOKAHEAD as a safety net.
          let bodyStart = -1;
          let bodyEnd = -1;
          let depth = 0;
          let started = false;
          for (let j = i; j < Math.min(lines.length, i + USE_EFFECT_BODY_LOOKAHEAD); j++) {
            for (const ch of lines[j]) {
              if (ch === '{') { depth++; started = true; if (bodyStart === -1) bodyStart = j; }
              else if (ch === '}') { depth--; }
            }
            if (started && depth <= 0) { bodyEnd = j; break; }
          }
          if (bodyStart === -1 || bodyEnd === -1) continue;
          const effectBody = lines.slice(bodyStart, bodyEnd + 1);
          // Collect every layout-setter called inside this useEffect body
          // (not just "any match" — we need to know *which* states are set
          // so the per-state escape check works).
          const setterNames: string[] = [];
          for (const l of effectBody) {
            const m = l.match(/\bset([A-Z]\w*)\s*\(/);
            if (m && layoutSetterRe.test(l)) setterNames.push(m[1]);
          }
          if (setterNames.length === 0) continue;
          // Per-state escape: the CLAUDE.md rule says "derive it as
          //   const effective = state && syncCondition"
          // and use `effective` in JSX. The effect may still run to clean up
          // backing state. We escape ONLY if EVERY setter called in this
          // useEffect body has a matching `const effective<X> = ... <state>`
          // declaration somewhere in the file that references the state
          // corresponding to that setter. A file-wide escape (one effective*
          // suppressing every useEffect) was previously too permissive.
          const allEscaped = setterNames.every((setterName) => {
            const stateName = setterName[0].toLowerCase() + setterName.slice(1);
            // `const effective<Anything> = <expression containing stateName>`
            // Match up to the first `;` or newline so we don't accidentally
            // span into an unrelated declaration.
            const escapeRe = new RegExp(
              `\\bconst\\s+effective\\w*\\s*=[^;\\n]*\\b${stateName}\\b`
            );
            return escapeRe.test(content);
          });
          if (allEscaped) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    // Migrated from inline block (PR #168 scaled-review I17).
    //
    // Detects fields declared in a *Slice interface whose corresponding
    // format*Section function never references them. Those fields are
    // assembled at query time and silently dropped at prompt time — they
    // never reach the AI. Add to KNOWN_UNRENDERED_FIELDS if intentional.
    //
    // Scope: diff-mode fires when either `shared/types/intelligence.ts` or
    // `server/workspace-intelligence.ts` changes; the customCheck always
    // reads both from disk. The fileGlobs include both basenames so that
    // the diff-mode filter matches whichever file triggered the run; the
    // customCheck then operates on the fixed pair.
    name: 'Assembled-but-never-rendered slice fields',
    fileGlobs: ['intelligence.ts', 'workspace-intelligence.ts'],
    exclude: ['.test.ts'],
    displayScope: 'shared/types/intelligence.ts + server/workspace-intelligence.ts',
    message: 'Fields declared in *Slice types but not referenced in their format*Section formatter are silently dropped at prompt time. Add to KNOWN_UNRENDERED_FIELDS in scripts/pr-check.ts if intentionally omitted.',
    severity: 'warn',
    rationale: 'A slice field present in the type but absent from the formatter is assembled but never reaches the AI prompt — silent data loss.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      // Diff-mode: only run if one of the two source files is in the diff set.
      // Full-scan mode: resolveCheckFileList returns the files + possible test
      // variants — non-empty, so the check runs.
      if (files.length === 0) return [];
      const typesPath = path.join(ROOT, 'shared/types/intelligence.ts');
      const serverPath = path.join(ROOT, 'server/workspace-intelligence.ts');
      return findUnrenderedSliceFields(
        readFileOrEmpty(typesPath),
        readFileOrEmpty(serverPath),
        typesPath,
        serverPath,
      );
    },
  },
  {
    // Migrated from inline block (PR #168 scaled-review I17).
    //
    // Detects `callCreativeAI(...)` calls that lack the `json:` flag in
    // files that also use `parseJsonFallback`. Mixing the two is a strong
    // signal that the caller expects JSON back but forgot to opt into the
    // model's json-mode response format — prompt may succeed on one model
    // but drift on another.
    name: 'callCreativeAI without json: flag in files that use parseJsonFallback',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    message: 'Add json: true when the result is parsed as JSON, json: false when prose. See docs/rules/ai-dispatch-patterns.md.',
    severity: 'warn',
    rationale: 'callCreativeAI without an explicit json: flag silently drifts between models that return valid JSON and ones that wrap it in prose.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Files excluded from this check and why:
      //   content-posts-ai.ts — definition file; callCreativeAI lives here, not a consumer
      //   brand-identity.ts   — uses parseJsonFallback for DB column parsing, not AI output;
      //                         its callCreativeAI calls correctly return prose (no json: needed)
      const JSON_MODE_EXCLUSIONS = new Set([
        path.join(ROOT, 'server/content-posts-ai.ts'),
        path.join(ROOT, 'server/brand-identity.ts'),
      ]);
      for (const file of files) {
        if (JSON_MODE_EXCLUSIONS.has(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        // Only flag files that call both callCreativeAI AND parseJsonFallback.
        if (!content.includes('callCreativeAI') || !content.includes('parseJsonFallback')) continue;
        // Walk each callCreativeAI block. If ANY call lacks `json:`, flag the
        // file at its first such call's line so the developer has a jump target.
        const lines = content.split('\n');
        let unsafeCount = 0;
        let firstUnsafeLine = -1;
        const calls = content.split('callCreativeAI(').slice(1); // one entry per call
        let cursor = 0;
        for (const block of calls) {
          // Advance cursor past this call's opening paren to find its line
          cursor = content.indexOf('callCreativeAI(', cursor);
          if (cursor === -1) break;
          const lineNum = content.slice(0, cursor).split('\n').length;
          cursor += 'callCreativeAI('.length;
          const closeParen = block.indexOf(')');
          const callBlock = closeParen > 0 ? block.slice(0, closeParen) : block.slice(0, 300);
          if (!callBlock.includes('json:')) {
            unsafeCount++;
            if (firstUnsafeLine === -1) firstUnsafeLine = lineNum;
          }
        }
        if (unsafeCount > 0) {
          hits.push({
            file,
            line: firstUnsafeLine > 0 ? firstUnsafeLine : 1,
            text: `${unsafeCount} callCreativeAI block(s) missing json: flag — ${lines[firstUnsafeLine - 1]?.trim() ?? ''}`,
          });
        }
      }
      return hits;
    },
  },
  {
    // Migrated from inline block (PR #168 scaled-review I17).
    //
    // Brand-engine routes must use `requireWorkspaceAccess`, not
    // `requireAuth`. The admin panel authenticates via HMAC token (global
    // gate); `requireAuth` only accepts JWTs and would 401 every admin
    // call. See Auth Conventions in CLAUDE.md. Suppress with `// auth-ok`
    // if you intentionally want JWT-only access on a specific handler.
    name: 'requireAuth in brand-engine route files (should be requireWorkspaceAccess)',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    // Doc-only: the customCheck below filters hatches via `hasHatch(lines, i,
    // '// auth-ok')` — this `excludeLines` entry is a no-op at runtime but
    // drives the `Escape hatch` column of docs/rules/automated-rules.md via
    // `generate-rules-doc.ts::describeHatch`.
    excludeLines: ['// auth-ok'],
    message: 'Admin panel uses HMAC token; requireAuth only accepts JWTs. Use requireWorkspaceAccess. See Auth Conventions in CLAUDE.md. Suppress with // auth-ok if intentionally JWT-only.',
    severity: 'error',
    rationale: 'requireAuth on brand-engine routes 401s every admin call because the admin panel authenticates via HMAC, not JWT.',
    claudeMdRef: '#auth-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        // Match by basename so the harness can test this rule against fixture
        // files under tmpdir. The six brand-engine routes have unique,
        // unambiguous filenames — there is no other `voice-calibration.ts`
        // (or siblings) anywhere in the repo that could shadow them.
        if (!BRAND_ENGINE_ROUTE_BASENAMES.has(path.basename(file))) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match `requireAuth` as an identifier reference (middleware chain),
          // not just as a function call. Express middleware is passed by
          // reference: `router.get(path, requireAuth, handler)`.
          if (!/\brequireAuth\b/.test(line)) continue;
          // Skip import statements and JSDoc comments — the rule only flags
          // actual usage sites, not the import line itself.
          if (/^\s*import\b/.test(line)) continue;
          if (/^\s*\*/.test(line)) continue;
          // Skip the function definition line (shouldn't exist in routes, but
          // defensive — if auth.ts is ever misplaced, don't flag its declaration).
          if (/\bfunction\s+requireAuth\b/.test(line)) continue;
          if (hasHatch(lines, i, '// auth-ok')) continue;
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
      return hits;
    },
  },
  {
    // Migrated from inline block (PR #168 scaled-review I17).
    //
    // Catches the BrandscriptTab SectionEditorCard pattern where a dirty
    // check recomputed against the live prop prevents an external-sync
    // useEffect from ever firing. Correct pattern uses a useRef to track
    // the last-synced prop. Suppress with `// sync-ok` on the guard line.
    name: 'useEffect external-sync dirty guard against the live prop',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/',
    // Doc-only: the customCheck below filters hatches via `hasHatch(fileLines,
    // lineIdx, '// sync-ok')` — this `excludeLines` entry is a no-op at
    // runtime but drives the `Escape hatch` column of
    // docs/rules/automated-rules.md via `generate-rules-doc.ts::describeHatch`.
    excludeLines: ['// sync-ok'],
    message: 'The dirty check is recomputed against the new prop on every render, so it always reads "dirty" the moment an external update arrives — the sync skips and the user sees stale content. Track the last-synced prop in a useRef. See src/components/brand/BrandscriptTab.tsx. Suppress with // sync-ok on the guard line.',
    severity: 'error',
    rationale: 'Comparing a dirty flag against the live prop (not a ref) prevents external-sync useEffects from ever firing after an update arrives — classic stale-state bug.',
    claudeMdRef: '#ui-ux-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('useEffect') || !content.includes('isDirty')) continue;

        // Walk every useEffect block and check whether its body contains
        // `if (!isDirty)` (or a near-synonym) followed by a setState call.
        // If so, also confirm the file defines `isDirty` as a comparison
        // against a prop/state field — i.e. a recomputed-each-render value,
        // not a ref.
        const fileLines = content.split('\n');
        const effectRegex = /useEffect\s*\(\s*\(\s*\)\s*=>\s*\{/g;
        let match: RegExpExecArray | null;
        while ((match = effectRegex.exec(content)) !== null) {
          const start = match.index + match[0].length - 1; // position of '{'
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
          const guardRegex = /if\s*\(\s*!\s*(isDirty|isEdited|hasChanges|hasEdits|hasUnsavedChanges)\s*\)\s*\{?\s*set[A-Z]\w*\s*\(/;
          const guardMatch = body.match(guardRegex);
          if (!guardMatch) continue;

          // Compute file-relative line index (0-based) for the guard line.
          const lineStartInBody = body.lastIndexOf('\n', body.indexOf(guardMatch[0])) + 1;
          const absoluteIndex = start + lineStartInBody;
          const lineNumber = content.slice(0, absoluteIndex).split('\n').length;
          const lineIdx = lineNumber - 1;

          // Check the matched line AND the preceding line for the suppression
          // marker. hasHatch gives inline + one-line-above semantics matching
          // every other hatch-ok hatch in this file.
          if (hasHatch(fileLines, lineIdx, '// sync-ok')) continue;

          const flagName = guardMatch[1];
          const dirtyDefRegex = new RegExp(`const\\s+${flagName}\\s*=\\s*([^;\\n]+)`);
          const dirtyDef = content.match(dirtyDefRegex);
          if (!dirtyDef) continue;
          if (dirtyDef[1].includes('.current')) continue; // already ref-based

          hits.push({ file, line: lineNumber, text: (fileLines[lineIdx] ?? '').trim() });
        }
      }
      return hits;
    },
  },
  {
    // Migrated from inline block (PR #168 scaled-review I17).
    //
    // STUDIO_NAME and STUDIO_URL exist in both server/constants.ts and
    // src/constants.ts. They can't share a runtime module (different
    // module resolution), so this check verifies the two files declare
    // identical values. A drift means the studio name/URL shown in the
    // admin UI disagrees with the one the server uses in emails, AI
    // prompts, etc.
    name: 'Constants in sync (STUDIO_NAME, STUDIO_URL)',
    fileGlobs: ['constants.ts'],
    exclude: ['.test.ts'],
    displayScope: 'server/constants.ts + src/constants.ts',
    message: 'Keep STUDIO_NAME and STUDIO_URL identical in server/constants.ts and src/constants.ts. The two files cannot share a runtime module due to differing module resolution, so drift is the only failure mode.',
    severity: 'error',
    rationale: 'STUDIO_NAME/STUDIO_URL drift silently desynchronizes the studio branding between the admin UI (src/) and server-generated content like emails and AI prompts (server/).',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      // Diff-mode: only run if either constants.ts is in scope.
      // Full-scan: resolveCheckFileList returns any `constants.ts` it finds.
      if (files.length === 0) return [];
      const serverConst = path.join(ROOT, 'server/constants.ts');
      const frontendConst = path.join(ROOT, 'src/constants.ts');
      return compareStudioConstants(
        readFileOrEmpty(serverConst),
        readFileOrEmpty(frontendConst),
        serverConst,
      );
    },
  },
  {
    // Added post-PR #168 scaled-review cleanup (2026-04-11).
    //
    // Admin-mutating functions on workspace-scoped tables must take an
    // explicit `expectedWorkspaceId` parameter AND route the target id
    // through a guard (`assertUserInWorkspace` or equivalent) that returns
    // null for both "not found" and "belongs to a different workspace".
    //
    // The route-level `requireWorkspaceAccess(:id)` middleware only verifies
    // the caller has access to the `:id` workspace — it does NOT verify that
    // a nested `:userId` path parameter actually belongs to that workspace.
    // Without the in-function guard, an admin authenticated for workspace A
    // could call `DELETE /api/workspaces/A/client-users/<userInB>` and knock
    // out a user from workspace B by guessing the UUID. PR #168 commit
    // 293485d addressed the existing three functions (`updateClientUser`,
    // `changeClientPassword`, `deleteClientUser`); TypeScript catches
    // callers that forget to pass the argument NOW, but cannot catch a
    // NEW mutation function added without the parameter at all.
    //
    // Scope: server/client-users.ts ONLY. The verb prefix `update|delete|
    // change` captures the current three plus any future variants that
    // preserve the naming convention. Add new verbs here when introducing
    // new mutation classes (e.g. `archive*`) in the same commit.
    name: 'Admin mutation on client_users missing expectedWorkspaceId param',
    fileGlobs: ['client-users.ts'],
    pathFilter: 'server/',
    displayScope: 'server/client-users.ts',
    // Doc-only: the customCheck below filters hatches via `hasHatch(lines, i,
    // '// ws-authz-ok')` — this `excludeLines` entry is a no-op at runtime
    // but drives the `Escape hatch` column of docs/rules/automated-rules.md
    // via `generate-rules-doc.ts::describeHatch`.
    excludeLines: ['// ws-authz-ok'],
    message: 'Admin mutation functions in server/client-users.ts must take `expectedWorkspaceId: string` and pass `(id, expectedWorkspaceId)` to `assertUserInWorkspace` — `requireWorkspaceAccess(:id)` only verifies the URL workspace, not that `:userId` belongs to it. Suppress with // ws-authz-ok only if the function is not workspace-scoped (rare — justify in a comment). See CLAUDE.md Auth Conventions.',
    severity: 'warn',
    rationale: 'Without an in-function cross-workspace guard on admin mutations, an admin auth\'d for workspace A can mutate a user in workspace B by passing the foreign UUID through a workspace-A URL.',
    claudeMdRef: '#auth-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Match `export function update*(` or `export async function delete*(` etc.
      const declRe = /^\s*export\s+(?:async\s+)?function\s+(update|delete|change)\w*\s*\(/;
      // Max lines a param list may span — 20 is generous; longest current
      // declaration (updateClientUser) spans 5 lines. Acts as a safety bound
      // against an unterminated signature eating the rest of the file.
      const PARAM_LIST_MAX_SPAN = 20;
      for (const file of files) {
        if (path.basename(file) !== 'client-users.ts') continue;
        // Defensive — there is only one client-users.ts in the repo, but
        // anchor to server/ so an accidentally-created frontend copy can't
        // shadow it silently.
        if (!file.includes(`server${path.sep}client-users.ts`) && !file.includes('server/client-users.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!declRe.test(lines[i])) continue;
          // Extract the full parameter list. It may span multiple lines; walk
          // forward tracking paren depth until the declaration's opening `(`
          // matches its closing `)`. Skip string literals so `)` inside a
          // default-value literal or a string doesn't prematurely close the
          // param list.
          const openParen = lines[i].indexOf('(');
          if (openParen === -1) continue;
          let depth = 1;
          let quote: string | null = null;
          let params = '';
          let closed = false;
          const maxLine = Math.min(lines.length, i + PARAM_LIST_MAX_SPAN);
          outer: for (let j = i; j < maxLine; j++) {
            const seg = lines[j];
            const startChar = j === i ? openParen + 1 : 0;
            let k = startChar;
            while (k < seg.length) {
              const ch = seg[k];
              if (quote) {
                if (ch === '\\' && k + 1 < seg.length) { k += 2; continue; }
                if (ch === quote) quote = null;
              } else if (ch === '`' || ch === "'" || ch === '"') {
                quote = ch;
              } else if (ch === '(') {
                depth++;
              } else if (ch === ')') {
                depth--;
                if (depth === 0) {
                  params += seg.slice(startChar, k);
                  closed = true;
                  break outer;
                }
              }
              k++;
            }
            params += seg.slice(startChar) + '\n';
          }
          if (!closed) continue; // malformed — skip rather than false-flag
          if (/\bexpectedWorkspaceId\b/.test(params)) continue;
          if (hasHatch(lines, i, '// ws-authz-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    // Added post-PR #168 scaled-review cleanup (2026-04-11).
    //
    // Voice profile authority — the decision to let a voice profile OVERRIDE
    // the legacy `workspace.brandVoice` + brand-docs block — must go through
    // the `isVoiceProfileAuthoritative(profile, voiceProfileBlock)` helper.
    // PR #168 commit 3c8a6cd factored the helper out of three inline call
    // sites (`buildSeoContext` no-strategy branch, with-strategy branch, and
    // the shadow-mode parity check). The shadow-mode copy had drifted,
    // missing the `hasExplicitConfig` gate, so draft profiles with voice
    // samples but no saved DNA/guardrails were incorrectly treated as
    // authoritative — silently hiding the legacy brand voice from the
    // prompt. A samples-only draft is "preparing to calibrate", not a
    // configuration commitment.
    //
    // The inline pattern is `voiceProfileBlock.length` — any `> 0`, `=== 0`,
    // or `.length` comparison on the rendered voice profile block outside
    // the helper itself is a re-invention of the authority decision and MUST
    // go through the helper instead. The only legitimate site is the helper
    // body itself (line 115), which is hatched inline with `// voice-authority-ok`.
    //
    // Scope: server/seo-context.ts ONLY. Other files don't render a
    // `voiceProfileBlock` — if this name appears elsewhere in the future it
    // should also route through the helper.
    name: 'Inline voice-profile authority check (use isVoiceProfileAuthoritative helper)',
    pattern: 'voiceProfileBlock\\.length',
    fileGlobs: ['seo-context.ts'],
    pathFilter: 'server/',
    displayScope: 'server/seo-context.ts',
    excludeLines: ['// voice-authority-ok'],
    message: 'Do not inline `voiceProfileBlock.length > 0` authority checks. Call `isVoiceProfileAuthoritative(profile, voiceProfileBlock)` — the helper encodes the full calibration + hasExplicitConfig decision so every call site stays in sync. Suppress with // voice-authority-ok only inside the helper definition itself.',
    severity: 'warn',
    rationale: 'Inline authority checks drift: the shadow-mode copy missed the `hasExplicitConfig` gate, silently dropping the legacy brand voice for samples-only draft profiles (PR #168 bug).',
    claudeMdRef: '#code-conventions',
  },
  {
    // Added post-PR #168 scaled-review cleanup (2026-04-11).
    //
    // Brand-engine reader calls from inside `server/seo-context.ts` must be
    // wrapped in `safeBrandEngineRead<T>(context, workspaceId, fn, fallback)`.
    // In production the `voice_profiles`, `brandscripts`, and
    // `brand_identity_deliverables` tables always exist because migrations
    // run at startup, but test environments may skip migrations entirely
    // and a missing table throws from `db.prepare()` inside the stmt-cache
    // initializer — crashing the entire `buildSeoContext` call tree.
    //
    // The wrapper narrowly swallows `no such table|column` errors (the
    // specific test-env scenario) and re-throws everything else so
    // programming bugs (renamed exports, typeerrors, json parse failures)
    // still surface loudly in CI and Sentry. An unnarrowed try/catch at
    // each call site would hide real bugs as "brand engine quietly stopped
    // working in production" — the exact silent-failure class this
    // codebase is trying to eliminate.
    //
    // Scope: server/seo-context.ts ONLY. Route handlers that call these
    // functions directly are fine — errors at the request boundary become
    // 500s, which are loud and visible.
    //
    // Functions enforced: `getVoiceProfile`, `listBrandscripts`,
    // `listDeliverables`. Add to the customCheck's `targetFns` set if a new
    // brand-engine reader is introduced with the same schema-missing risk.
    name: 'Bare brand-engine read in seo-context.ts (use safeBrandEngineRead)',
    fileGlobs: ['seo-context.ts'],
    pathFilter: 'server/',
    displayScope: 'server/seo-context.ts',
    // Doc-only: the customCheck below filters hatches via `hasHatch(lines, i,
    // '// safe-read-ok')` — this `excludeLines` entry is a no-op at runtime
    // but drives the `Escape hatch` column of docs/rules/automated-rules.md
    // via `generate-rules-doc.ts::describeHatch`.
    excludeLines: ['// safe-read-ok'],
    message: 'Wrap `getVoiceProfile`, `listBrandscripts`, and `listDeliverables` calls in `safeBrandEngineRead("<context>", workspaceId, () => fn(workspaceId), fallback)` so a missing-table error in test envs degrades gracefully instead of crashing buildSeoContext. Suppress with // safe-read-ok on the call line (or the line immediately above for multi-line wrapper layouts). See CLAUDE.md Code Conventions.',
    severity: 'warn',
    rationale: 'A missing brand-engine table in a non-production env crashes the entire buildSeoContext call tree, and an unnarrowed catch would hide real programming bugs as silent degradation.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const targetFns = /\b(getVoiceProfile|listBrandscripts|listDeliverables)\s*\(/;
      for (const file of files) {
        if (path.basename(file) !== 'seo-context.ts') continue;
        if (!file.includes(`server${path.sep}seo-context.ts`) && !file.includes('server/seo-context.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const m = targetFns.exec(line);
          if (!m) continue;
          // Skip import lines (the bare function name here is a symbol
          // reference, not a call — it's followed by `}` or `,`, not `(`,
          // so the regex wouldn't match anyway, but anchor defensively).
          if (/^\s*import\b/.test(line)) continue;
          // Skip JSDoc continuation lines (` * ...`) and single-line
          // comments — both occasionally reference the helpers by name
          // with inline `()` for readability (e.g. ``getVoiceProfile()``).
          if (/^\s*\*/.test(line)) continue;
          if (/^\s*\/\//.test(line)) continue;
          // Wrapped when `safeBrandEngineRead(` appears EARLIER on the SAME
          // line as the bare call. Same-line-only is deliberate — a cross-
          // line wrapper layout is a stylistic deviation the rule flags so
          // callers either inline the wrapper or add a hatch.
          const callIdx = m.index;
          const wrapperIdx = line.indexOf('safeBrandEngineRead(');
          if (wrapperIdx !== -1 && wrapperIdx < callIdx) continue;
          if (hasHatch(lines, i, '// safe-read-ok')) continue;
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
      return hits;
    },
  },
  {
    // Added post-PR #168 scaled-review cleanup (2026-04-11).
    //
    // Silent-failure stop-gap for test bodies. A vitest `it()` / `test()`
    // block with no assertion and no `throw new Error` PASSES unconditionally,
    // which defeats the purpose of having a test at all. The 2026-04-11
    // test audit surfaced three such silent-pass bodies in the stripe
    // webhook + config suites — the test names claimed regression coverage
    // ("missing workspaceId silently returns", "is idempotent", "no crash")
    // but the bodies only called the function under test without asserting
    // anything about the observable side effects, so a regression that
    // broke the handler's early-return (or the idempotency guard, etc.)
    // would not have tripped the suite.
    //
    // Scope: vitest + jest test files (`*.test.ts`, `*.test.tsx`). Playwright
    // e2e tests under `tests/e2e/` are intentionally excluded — their
    // "assertions" are implicit Playwright actions (`page.click`, `page.goto`)
    // whose failures throw directly and don't need an `expect(...)` wrapper.
    //
    // Algorithm:
    //   1. For each `it(...)` or `test(...)` call at file scope (not
    //      `.todo`, `.skip`, `.only`, or `.each`), walk forward to find the
    //      arrow function body (`=>` followed by `{`).
    //   2. Brace-walk the body to the matching `}` (same technique as the
    //      bridge-broadcast rule — tracks string literals to avoid false
    //      closes inside template literals).
    //   3. Scan the body text for ANY of the assertion tokens below. The
    //      token set is deliberately broad: `expect(`, `assert(`,
    //      `.toBe`/`.toEqual`/`.toMatch`/`.toThrow`/`.toHaveLength`/
    //      `.toContain`/`.toHaveBeenCalled`/`.rejects`/`.resolves`, and
    //      `throw new Error` (explicit failure throw is a legitimate
    //      pattern for "this branch should be unreachable" tests).
    //   4. If none match and the `it(` line has no `// no-assertion-ok`
    //      hatch (inline or on the preceding line), report it.
    //
    // The hatch is for the ~13 helper-delegation cases where the assertion
    // lives inside a helper (`walkStatuses`, `noGarbage`, …) the `it` body
    // calls. Those helpers contain real `expect(` calls but the rule can't
    // see through the function boundary. Each hatch must carry a one-line
    // rationale naming the helper.
    name: 'Test body has no assertion or explicit failure throw',
    fileGlobs: ['*.test.ts', '*.test.tsx'],
    excludeLines: ['// no-assertion-ok'],
    message: 'Test body has no assertion (no expect(...), assert(...), .rejects, .resolves, or `throw new Error`). A test with no assertion passes unconditionally and provides zero regression coverage. Either add an assertion or delegate to a helper that asserts (and add `// no-assertion-ok` with a comment naming the helper).',
    severity: 'warn',
    rationale: 'A vitest/jest test body with no assertion passes unconditionally — a broken implementation will not trip the suite. 2026-04-11 audit found 3 such silent-pass bodies in the stripe webhook suite claiming regression coverage they never had.',
    claudeMdRef: '#test-conventions-mandatory-for-feature-work',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Mask out string literals, template literal contents (except
      // ${...} interpolations, which ARE code), and line/block comments
      // so the main `it(` regex cannot match inside them. Preserves
      // newlines so line numbers stay 1:1 with the original file. Without
      // this pass, the rule finds `it(` inside its own test harness's
      // fixture strings AND inside JSDoc comments that reference `it()`
      // for readability, producing a torrent of false positives.
      const maskNonCode = (src: string): string => {
        const out: string[] = [];
        let i = 0;
        while (i < src.length) {
          const ch = src[i];
          // Line comment — preserve `//`, replace the rest with spaces.
          // The `src[i - 1] !== '\\'` guard prevents `//` at the end of
          // a regex literal like `/\/assets\//` from being mis-parsed as
          // a comment. Without it, the masker erases the rest of the line
          // and the brace walker terminates early at the regex's closing
          // context, producing a false positive on any test body whose
          // setup uses `mockWebflowSuccess(/regex/, { ... })`.
          if (ch === '/' && src[i + 1] === '/' && (i === 0 || src[i - 1] !== '\\')) {
            out.push('  ');
            i += 2;
            while (i < src.length && src[i] !== '\n') {
              out.push(' ');
              i++;
            }
            continue;
          }
          // Block comment — preserve `/*` and `*/`, replace the middle
          // with spaces; newlines stay so line numbers align. Same `\\`
          // guard as `//` above for `/\/*/`-style regex literals.
          if (ch === '/' && src[i + 1] === '*' && (i === 0 || src[i - 1] !== '\\')) {
            out.push('  ');
            i += 2;
            while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
              out.push(src[i] === '\n' ? '\n' : ' ');
              i++;
            }
            if (i < src.length) {
              out.push('  ');
              i += 2;
            }
            continue;
          }
          // String literal — ', ", `. Template literal contents are
          // masked EXCEPT for ${...} interpolations, which contain real
          // code the scanner may care about.
          if (ch === "'" || ch === '"' || ch === '`') {
            const quote = ch;
            out.push(quote);
            i++;
            while (i < src.length && src[i] !== quote) {
              if (src[i] === '\\' && i + 1 < src.length) {
                out.push('  ');
                i += 2;
                continue;
              }
              if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
                out.push('${');
                i += 2;
                let depth = 1;
                while (i < src.length && depth > 0) {
                  if (src[i] === '{') depth++;
                  else if (src[i] === '}') depth--;
                  if (depth > 0) {
                    out.push(src[i]);
                    i++;
                  }
                }
                if (i < src.length) {
                  out.push('}');
                  i++;
                }
                continue;
              }
              out.push(src[i] === '\n' ? '\n' : ' ');
              i++;
            }
            if (i < src.length) {
              out.push(quote);
              i++;
            }
            continue;
          }
          out.push(ch);
          i++;
        }
        return out.join('');
      };
      // Match `it(`, `test(`, `it.skip.todo` DOES NOT match (period before
      // paren blocks it). We deliberately allow `it(` and `test(` to be
      // preceded by any non-identifier character so `fit(`/`xit(` still
      // match — jest-compatible globals. `.each`, `.todo`, `.skip`, `.only`
      // are filtered explicitly below.
      const itRe = /(^|[^\w.$])(it|test)\s*\(/g;
      const assertionTokens = [
        'expect(',
        'assert(',
        '.toBe',
        '.toEqual',
        '.toMatch',
        '.toThrow',
        '.toHaveLength',
        '.toContain',
        '.toHaveBeenCalled',
        '.toHaveProperty',
        '.toBeDefined',
        '.toBeUndefined',
        '.toBeNull',
        '.toBeTruthy',
        '.toBeFalsy',
        '.toBeGreaterThan',
        '.toBeLessThan',
        '.toBeInstanceOf',
        '.rejects',
        '.resolves',
        'throw new Error',
        'throw new TypeError',
        'throw new RangeError',
      ];
      for (const file of files) {
        if (!file.endsWith('.test.ts') && !file.endsWith('.test.tsx')) continue;
        // Playwright e2e tests live under tests/e2e — their action calls
        // throw on failure, so `expect(...)` is often absent by design.
        if (file.includes(`${path.sep}e2e${path.sep}`) || file.includes('/e2e/')) continue;
        const rawContent = readFileOrEmpty(file);
        if (!rawContent || (!rawContent.includes('it(') && !rawContent.includes('test('))) continue;
        const content = maskNonCode(rawContent);
        const lines = rawContent.split('\n');
        itRe.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = itRe.exec(content)) !== null) {
          // Leading char of the match is either '' or a non-identifier
          // separator — index of the `it`/`test` keyword is match.index + len(leading).
          const leading = match[1];
          const kwStart = match.index + leading.length;
          const kwEnd = kwStart + match[2].length; // end of `it` / `test`
          // Reject `.each`, `.todo`, `.skip`, `.only` by peeking BEFORE the
          // keyword for a `.` — e.g. `it.each(` appears as `it` preceded by
          // `.`, which is an identifier char so our regex wouldn't match.
          // We still check defensively to stay robust to regex evolution.
          if (content[kwStart - 1] === '.') continue;
          // Walk from the first `(` after the keyword, find the description
          // string, then skip commas until we land on the arrow function.
          // Rather than fully parse JS, we look for `=> {` within the next
          // 800 chars — far enough to cover long describe-style titles, but
          // bounded so a pathological file can't blow the scan open.
          const paramOpen = content.indexOf('(', kwEnd);
          if (paramOpen === -1) continue;
          const searchWindow = content.slice(paramOpen, paramOpen + 800);
          const arrowMatch = /=>\s*\{/.exec(searchWindow);
          if (!arrowMatch) continue;
          const bodyOpen = paramOpen + arrowMatch.index + arrowMatch[0].length - 1;
          // Brace-walk the body on the MASKED content. String literals and
          // comments are already replaced with spaces, so brace counting is
          // now a simple scan with no quote tracking needed.
          let depth = 0;
          let i = bodyOpen;
          while (i < content.length) {
            const ch = content[i];
            if (ch === '{') {
              depth++;
            } else if (ch === '}') {
              depth--;
              if (depth === 0) break;
            }
            i++;
          }
          if (i >= content.length) continue;
          const body = content.slice(bodyOpen, i + 1);
          const hasAssertion = assertionTokens.some(tok => body.includes(tok));
          if (hasAssertion) continue;
          // Compute the 1-indexed line number of the `it(` / `test(` opener
          // for the hit + hatch lookup.
          const lineNum = content.slice(0, kwStart).split('\n').length;
          if (hasHatch(lines, lineNum - 1, '// no-assertion-ok')) continue;
          hits.push({ file, line: lineNum, text: lines[lineNum - 1]?.trim() ?? '' });
        }
      }
      return hits;
    },
  },
  {
    name: 'TabBar component without ?tab= deep-link support',
    // customCheck because we need to verify two conditions in the same file:
    // presence of <TabBar AND absence of searchParams.get('tab').
    pattern: '',
    fileGlobs: ['*.tsx'],
    pathFilter: 'src/components/',
    excludeLines: ['tab-deeplink-ok'],
    message:
      'This component uses <TabBar> but does not read searchParams.get(\'tab\') for deep-link support. ' +
      'If another component navigates here with ?tab=X, the param will be silently ignored. ' +
      'Either add useSearchParams() and read the \'tab\' param in your useState initializer, ' +
      'or add a tab-deeplink-ok comment (// or {/* */}) on or above the <TabBar line if deep-linking is intentionally unsupported.',
    severity: 'warn',
    rationale:
      'A ?tab= URL that the target component ignores is a silent navigation bug — ' +
      'the user sees the default tab instead of the requested one.',
    claudeMdRef: '#uiux-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!/\.tsx$/.test(file)) continue;
        if (!file.includes('/src/components/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        if (!content.includes('<TabBar')) continue;
        // Already wired — skip
        if (
          content.includes("searchParams.get('tab')") ||
          content.includes('searchParams.get("tab")')
        ) continue;
        // File-level escape hatch (matches both // and {/* */} comment styles)
        if (content.includes('tab-deeplink-ok')) continue;
        // Report the first <TabBar line
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].includes('<TabBar')) continue;
          if (hasHatch(lines, i, 'tab-deeplink-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
          break; // one hit per file
        }
      }
      return hits;
    },
  },
  {
    name: 'seo-context.ts import restriction (deprecated module)',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'server/',
    // Existing callers that are already imported — these are grandfathered until migrated.
    // seo-context.ts itself and workspace-intelligence.ts (shadow-mode comparison) are allowed.
    exclude: [
      'server/seo-context.ts',
      'server/workspace-intelligence.ts',
      'server/prompt-assembly.ts',
      'server/admin-chat-context.ts',
      'server/helpers.ts',
      'server/copy-review.ts',
      'server/internal-links.ts',
      'server/aeo-page-review.ts',
      'server/deep-diagnostic.ts',
      'server/schema-generator.ts',
      'server/content-brief.ts',
      'server/routes/ai-chat.ts',
      'server/routes/content-generation.ts',
      'server/routes/seo-audit.ts',
      'server/routes/schema-generator.ts',
      'server/routes/content-matrix.ts',
      'server/routes/aeo-review.ts',
      'server/routes/copy-generation.ts',
      'server/routes/page-strategy.ts',
      'server/routes/content-brief.ts',
      'server/routes/ai-rewrite.ts',
      'server/routes/internal-links.ts',
      'server/routes/diagnostics.ts',
      'server/routes/public-analytics.ts',
      'server/routes/workspaces.ts',
      'server/routes/voice-calibration.ts',
      'server/routes/webflow-seo.ts',
      'server/routes/discovery-ingestion.ts',
      'server/routes/google.ts',
      'server/routes/webflow-keywords.ts',
      'server/routes/copy-pipeline.ts',
      'server/routes/brandscript.ts',
      'server/routes/brand-identity.ts',
      'server/routes/jobs.ts',
      'server/routes/public-portal.ts',
      'server/routes/keyword-strategy.ts',
      'tests/',
    ],
    excludeLines: ['// seo-context-ok'],
    message: 'seo-context.ts is deprecated — use buildWorkspaceIntelligence() + formatForPrompt() from workspace-intelligence.ts instead. Add // seo-context-ok on the import line if this is a grandfathered caller awaiting migration.',
    severity: 'error',
    rationale: 'seo-context.ts is being retired in favor of the unified workspace intelligence system. New callers must use the intelligence assembler.',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const importRe = /from\s+['"][^'"]*seo-context/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!importRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// seo-context-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i] });
        }
      }
      return hits;
    },
  },
  {
    // P0 expansion rule: requireAuth outside allowed files.
    //
    // `requireAuth` is JWT-only middleware. Most server routes are protected by
    // the global APP_PASSWORD HMAC gate; using `requireAuth` on them would 401
    // every admin call. Only `routes/auth.ts` and `routes/users.ts` legitimately
    // need JWT-based auth. Brand-engine routes have their own dedicated rule
    // ("requireAuth in brand-engine route files") so they are excluded here to
    // avoid double-flagging.
    //
    // The definition file `server/auth.ts` is also excluded (it exports the
    // function, not a usage site).
    name: 'requireAuth usage outside allowed route files',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['// auth-ok'],
    message:
      'requireAuth is JWT-only — most routes are protected by the global APP_PASSWORD HMAC gate. ' +
      'Using requireAuth on an admin route will 401 every admin call. Use requireWorkspaceAccess ' +
      'for workspace routes, or rely on the HMAC gate for admin routes. ' +
      'Suppress with // auth-ok if this endpoint intentionally requires JWT.',
    severity: 'error',
    rationale:
      'requireAuth on a non-JWT route silently rejects all admin-panel requests because the admin ' +
      'panel authenticates via HMAC token, not JWT.',
    claudeMdRef: '#auth-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        // Only scan server route files
        if (!file.includes('/server/')) continue;
        const basename = path.basename(file);
        // Skip allowed files (definition + legitimate JWT-only routes)
        if (basename === 'auth.ts' && !file.includes('/routes/')) continue; // server/auth.ts definition
        if (REQUIRE_AUTH_ALLOWED_BASENAMES.has(basename) && file.includes('/routes/')) continue;
        // Skip brand-engine routes (covered by their own dedicated rule)
        if (BRAND_ENGINE_ROUTE_BASENAMES.has(basename)) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('requireAuth')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!/\brequireAuth\b/.test(line)) continue;
          // Skip import statements — only flag usage sites
          if (/^\s*import\b/.test(line)) continue;
          // Skip comments (single-line // and JSDoc *)
          if (/^\s*(\/\/|\*)/.test(line)) continue;
          // Skip function definitions (e.g. if auth.ts is misplaced)
          if (/\bfunction\s+requireAuth\b/.test(line)) continue;
          if (hasHatch(lines, i, '// auth-ok')) continue;
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
      return hits;
    },
  },
  {
    // P0 expansion rule: duplicate rate limiter on public routes.
    //
    // `globalPublicLimiter`, `publicApiLimiter`, and `publicWriteLimiter` are
    // applied to ALL `/api/public/` routes in `server/app.ts`. If a route file
    // imports and re-applies any of these, the shared in-memory bucket is
    // incremented twice per request, silently halving the effective rate limit
    // (e.g. 10 req/min becomes 5, 200 req/min becomes 100).
    //
    // Route-specific limiters like `loginLimiter`, `aiLimiter`, and
    // `checkoutLimiter` are NOT globally applied, so importing them is fine.
    name: 'Duplicate globally-applied rate limiter in route file',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    excludeLines: ['// limiter-ok'],
    message:
      'globalPublicLimiter, publicApiLimiter, and publicWriteLimiter are applied globally in ' +
      'server/app.ts to all /api/public/ routes. Importing or using them in a route file ' +
      'increments the same shared bucket twice, silently halving the effective rate limit. ' +
      'Remove the duplicate application. Suppress with // limiter-ok if intentional.',
    severity: 'error',
    rationale:
      'Double-applied rate limiters share the same in-memory bucket, so each request increments ' +
      'the counter twice — a 10 req/min limit silently becomes 5 req/min.',
    claudeMdRef: '#auth-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/routes/') && !file.includes('/routes/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comments before entering the inner loop
          if (/^\s*(\/\/|\*)/.test(line)) continue;
          if (hasHatch(lines, i, '// limiter-ok')) continue;
          // Check if any globally-applied limiter name appears on this line
          for (const limiter of GLOBALLY_APPLIED_LIMITERS) {
            // Match as a word boundary to avoid partial matches
            const re = new RegExp(`\\b${limiter}\\b`);
            if (!re.test(line)) continue;
            hits.push({ file, line: i + 1, text: line.trim() });
            break; // one hit per limiter per line
          }
        }
      }
      return hits;
    },
  },
  {
    // P1 expansion rule: port collision in integration tests.
    //
    // Every integration test file allocates a unique port via
    // `createTestContext(NNNN)`. If two files share a port, the second test
    // to bind gets EADDRINUSE and the CI run is flaky. This rule collects
    // all port allocations across every `*.test.ts` file and flags any
    // duplicate. It also flags ports outside the documented range
    // (13201–13319 per CLAUDE.md) as a separate warning.
    name: 'Port collision in integration tests',
    pattern: '',
    fileGlobs: ['*.test.ts'],
    pathFilter: 'tests/',
    excludeLines: ['// port-ok'],
    message:
      'Two or more test files use the same port in createTestContext(). ' +
      'Each integration test must use a unique port to avoid EADDRINUSE in parallel CI runs. ' +
      'Pick an unused port in the 13201–13319 range (grep existing ports first). ' +
      'Suppress with // port-ok if this is intentionally shared.',
    severity: 'error',
    rationale:
      'Duplicate test ports cause flaky CI: the second test file to bind gets EADDRINUSE, ' +
      'producing intermittent failures that are hard to diagnose.',
    claudeMdRef: '#testing-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Collect all port → [{ file, line }] mappings
      const portMap = new Map<number, { file: string; line: number; text: string }[]>();
      const portRe = /\bcreateTestContext\(\s*(\d+)\s*\)/;
      for (const file of files) {
        if (!file.endsWith('.test.ts')) continue;
        // Skip the pr-check test harness — its fixture strings contain
        // createTestContext() literals that aren't real port allocations.
        if (file.endsWith('pr-check.test.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = portRe.exec(lines[i]);
          if (!m) continue;
          if (hasHatch(lines, i, '// port-ok')) continue;
          const port = parseInt(m[1], 10);
          if (!portMap.has(port)) portMap.set(port, []);
          portMap.get(port)!.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      // Flag every occurrence of a port used more than once
      for (const [, usages] of portMap) {
        if (usages.length > 1) {
          for (const u of usages) hits.push(u);
        }
      }
      // Flag ports outside the documented 13201–13319 range
      const PORT_MIN = 13201;
      const PORT_MAX = 13319;
      for (const [port, usages] of portMap) {
        if (port < PORT_MIN || port > PORT_MAX) {
          for (const u of usages) {
            // Don't double-flag if already flagged as a duplicate
            if (!hits.some((h) => h.file === u.file && h.line === u.line)) {
              hits.push(u);
            }
          }
        }
      }
      return hits;
    },
  },
  {
    // P1 expansion rule: inline React Query string keys.
    //
    // All query keys must go through `queryKeys.*` from `src/lib/queryKeys.ts`.
    // Inline array literals (`queryKey: ['some-key', ...]`) bypass the
    // centralized factory, causing cache drift: invalidating via `queryKeys.X()`
    // won't clear a cache entry created with a bare string literal.
    //
    // The rule scans `useQuery(`, `useInfiniteQuery(`, and
    // `queryClient.invalidateQueries(` / `queryClient.setQueryData(` /
    // `queryClient.getQueryData(` calls. It flags `queryKey: [` patterns
    // where the array literal doesn't start with `queryKeys.`.
    //
    // Test files and the queryKeys definition file itself are excluded.
    name: 'Inline React Query string key (use queryKeys.*)',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    excludeLines: ['// querykey-ok'],
    message:
      'Query keys must use the centralized queryKeys.* factory from src/lib/queryKeys.ts. ' +
      'Inline string arrays cause cache drift — invalidation via queryKeys.X() won\'t clear ' +
      'entries created with bare literals. Replace with the appropriate queryKeys.* call. ' +
      'Suppress with // querykey-ok if this is a one-off key that intentionally bypasses the factory.',
    severity: 'error',
    rationale:
      'Inline query key literals drift from the centralized factory, causing stale-cache bugs ' +
      'where invalidateQueries misses entries because the key arrays don\'t match.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        if (!file.includes('/src/')) continue;
        // Skip the queryKeys definition file itself
        if (file.endsWith('lib/queryKeys.ts')) continue;
        // Skip test files
        if (file.includes('.test.')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        // Quick bail: if neither queryKey nor invalidateQueries appears, skip
        if (!content.includes('queryKey') && !content.includes('invalidateQueries') &&
            !content.includes('setQueryData') && !content.includes('getQueryData')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Match queryKey: ['...  (inline array with string literal)
          if (!/queryKey:\s*\[/.test(line)) continue;
          // Skip if it uses queryKeys.* (the correct pattern)
          if (/queryKey:\s*queryKeys\./.test(line)) continue;
          // Skip if it spreads queryKeys.* into the array (e.g. [...queryKeys.admin.X(), extra])
          if (/queryKey:\s*\[\s*\.\.\.queryKeys\./.test(line)) continue;
          // Skip comments
          if (/^\s*(\/\/|\*)/.test(line)) continue;
          // Skip JSDoc examples
          if (/^\s*\*/.test(line)) continue;
          if (hasHatch(lines, i, '// querykey-ok')) continue;
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
      return hits;
    },
  },
  {
    // P1 expansion rule: missing broadcastToWorkspace after DB write in route files.
    //
    // Route handlers that perform DB writes (INSERT/UPDATE/DELETE via
    // `db.prepare(...).run(`) should broadcast to connected clients so the
    // real-time UI stays in sync. This rule scans `server/routes/*.ts` files,
    // finds `router.post/put/patch/delete` handler bodies, checks for
    // `db.prepare` calls, and flags if no `broadcastToWorkspace(` or
    // `broadcast(` call follows within the same handler body.
    //
    // Public routes, health checks, and internal-only endpoints can suppress
    // with `// broadcast-ok`.
    name: 'Missing broadcastToWorkspace after DB write in route handler',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    excludeLines: ['// broadcast-ok'],
    message:
      'This route handler writes to the DB (db.prepare().run) but never calls ' +
      'broadcastToWorkspace() or broadcast(). Connected clients won\'t see the change ' +
      'until they manually refresh. Add a broadcast call, or suppress with // broadcast-ok ' +
      'if this endpoint intentionally doesn\'t need real-time updates (e.g. analytics, logging).',
    severity: 'warn',
    rationale:
      'Route handlers that write to the DB without broadcasting leave connected clients ' +
      'with stale data until they manually refresh.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const routeRe = /\brouter\.(post|put|patch|delete)\s*\(/i;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/routes/') && !file.includes('/routes/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        // Find all route handler start lines
        const routeIdx: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (routeRe.test(lines[i])) routeIdx.push(i);
        }
        for (let k = 0; k < routeIdx.length; k++) {
          const start = routeIdx[k];
          if (hasHatch(lines, start, '// broadcast-ok')) continue;
          // Route body extends to the next route declaration or end of file
          const nextStart = k + 1 < routeIdx.length ? routeIdx[k + 1] : lines.length;
          const routeBodyEnd = Math.min(nextStart, start + ROUTE_BROADCAST_LOOKAHEAD);
          const routeBody = lines.slice(start, routeBodyEnd).join('\n');
          // Must have a DB write
          if (!/\bdb\.prepare\b/.test(routeBody)) continue;
          if (!/\.run\s*\(/.test(routeBody)) continue;
          // Check for broadcast call
          if (/\bbroadcastToWorkspace\s*\(/.test(routeBody)) continue;
          if (/\bbroadcast\s*\(/.test(routeBody)) continue;
          hits.push({ file, line: start + 1, text: lines[start].trim() });
        }
      }
      return hits;
    },
  },

  // ─── P2 expansion rules ───
  {
    // Extends the existing "Public-portal mutation without addActivity" rule
    // to all admin route files. Public-portal.ts is excluded because it has
    // its own dedicated rule with error severity.
    name: 'Admin route mutation without addActivity',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    exclude: [
      // Already covered by the dedicated public-portal rule (error severity).
      'server/routes/public-portal.ts',
      // Public routes — these serve unauthenticated client-portal traffic.
      // Activity logging for public routes is a separate concern.
      'server/routes/public-analytics.ts',
      'server/routes/public-auth.ts',
      'server/routes/public-chat.ts',
      'server/routes/public-content.ts',
      'server/routes/public-feedback.ts',
      'server/routes/public-requests.ts',
      // Infrastructure routes that don't represent user-visible mutations.
      'server/routes/auth.ts',
      'server/routes/users.ts',
      'server/routes/health.ts',
    ],
    excludeLines: ['// activity-ok'],
    message:
      'This admin route handler performs a DB write (db.prepare().run) but never calls ' +
      'addActivity(). Admin mutations should be logged to the activity feed so workspace ' +
      'history is complete. Add an addActivity() call, or suppress with // activity-ok ' +
      'if this endpoint intentionally doesn\'t need activity logging (e.g. internal bookkeeping, ' +
      'analytics, settings that don\'t affect workspace content).',
    severity: 'warn',
    rationale:
      'Significant admin operations that skip addActivity() leave gaps in the workspace ' +
      'activity feed, making it impossible for team members to audit what changed and when.',
    claudeMdRef: '#code-conventions',
    displayScope: 'server/routes/*.ts (excluding public-* and infrastructure routes)',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const routeRe = /\brouter\.(post|put|patch|delete)\s*\(/i;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        // Self-filter: only admin route files under server/routes/.
        if (!file.includes('/server/routes/') && !file.includes('\\server\\routes\\')) continue;
        // Skip public routes (covered by their own rule or not applicable).
        const basename = path.basename(file);
        if (/^public-/.test(basename)) continue;
        // Skip infrastructure routes that aren't user-visible mutations.
        if (['auth.ts', 'users.ts', 'health.ts'].includes(basename)) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        const routeIdx: number[] = [];
        for (let i = 0; i < lines.length; i++) {
          if (routeRe.test(lines[i])) routeIdx.push(i);
        }
        for (let k = 0; k < routeIdx.length; k++) {
          const start = routeIdx[k];
          if (hasHatch(lines, start, '// activity-ok')) continue;
          const nextStart = k + 1 < routeIdx.length ? routeIdx[k + 1] : lines.length;
          const routeBodyEnd = Math.min(nextStart, start + ADMIN_ACTIVITY_LOOKAHEAD);
          const routeBody = lines.slice(start, routeBodyEnd).join('\n');
          // Must have a DB write — same gate as the broadcast rule.
          if (!/\bdb\.prepare\b/.test(routeBody)) continue;
          if (!/\.run\s*\(/.test(routeBody)) continue;
          // Check for addActivity() call
          if (/\baddActivity\s*\(/.test(routeBody)) continue;
          hits.push({ file, line: start + 1, text: lines[start].trim() });
        }
      }
      return hits;
    },
  },
  {
    // Extends the existing "useGlobalAdminEvents import restriction" rule.
    // That rule catches *unauthorized imports*. This rule catches *wrong event
    // names* in the authorized call sites — i.e. passing a workspace-scoped
    // event (WS_EVENTS.*) to useGlobalAdminEvents, which is dead code because
    // the hook doesn't subscribe to workspace rooms.
    name: 'useGlobalAdminEvents called with workspace-scoped event name',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    excludeLines: ['// global-events-ok'],
    message:
      'useGlobalAdminEvents() is being called with a workspace-scoped event name ' +
      '(from WS_EVENTS). This handler is dead code — the hook doesn\'t send a ' +
      '`subscribe` action, so broadcastToWorkspace events are never delivered. ' +
      'Use useWorkspaceEvents(workspaceId, ...) for workspace-scoped events, or ' +
      'suppress with // global-events-ok if this is intentional.',
    severity: 'error',
    rationale:
      'Silent dead broadcast handlers: useGlobalAdminEvents never subscribes to a ' +
      'workspace room, so workspace-scoped events (WS_EVENTS.*) are silently dropped ' +
      'by the server\'s broadcastToWorkspace filter. The UI appears stale with no ' +
      'error message.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const wsEventValues = loadWsEventValues();
      if (wsEventValues.size === 0) return hits;
      // Match `useGlobalAdminEvents({` to find call sites.
      const callRe = /\buseGlobalAdminEvents\s*\(\s*\{/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !callRe.test(content)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!callRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// global-events-ok')) continue;
          // Scan forward from the call site to find handler keys.
          // The object literal typically spans a few lines:
          //   useGlobalAdminEvents({
          //     [ADMIN_EVENTS.QUEUE_UPDATE]: handler,
          //     'queue:update': handler,
          //   });
          // We scan up to 30 lines or until we hit `});`.
          const scanEnd = Math.min(lines.length, i + 30);
          for (let j = i; j < scanEnd; j++) {
            const line = lines[j];
            // Stop at closing `});`
            if (/\}\s*\)/.test(line) && j > i) break;
            // Match string-literal keys: 'event:name' or "event:name"
            const stringKeyRe = /['"]([^'"]+)['"]\s*:/g;
            let km: RegExpExecArray | null;
            while ((km = stringKeyRe.exec(line)) !== null) {
              if (wsEventValues.has(km[1])) {
                hits.push({ file, line: j + 1, text: lines[j].trim() });
              }
            }
            // Match computed keys: [WS_EVENTS.SOMETHING] or [WS_EVENTS['SOMETHING']]
            if (/\[\s*WS_EVENTS[.\[]/.test(line)) {
              hits.push({ file, line: j + 1, text: lines[j].trim() });
            }
          }
        }
      }
      return hits;
    },
  },

  // ── P3: Activity type not in CLIENT_VISIBLE_TYPES ──────────────────────────
  {
    name: 'addActivity type not in CLIENT_VISIBLE_TYPES (public route)',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/routes/',
    excludeLines: ['client-visibility-ok'],
    message:
      'addActivity() uses a type that is not in CLIENT_VISIBLE_TYPES — clients will never see this entry. ' +
      'Add the type to CLIENT_VISIBLE_TYPES in server/activity-log.ts if clients should see it, ' +
      'or add `// client-visibility-ok` to suppress.',
    severity: 'warn',
    rationale:
      'Public-portal mutations that log activity with a type absent from CLIENT_VISIBLE_TYPES ' +
      'create invisible entries — the activity is recorded but never shown to client-portal users. ' +
      'This is sometimes intentional (admin-only bookkeeping) but often an oversight when adding new activity types.',
    claudeMdRef:
      'Activity Log: new types must be added to CLIENT_VISIBLE_TYPES if clients should see them',
    customCheck(files) {
      const clientVisible = loadClientVisibleTypes();
      if (clientVisible.size === 0) return []; // parse failure — bail silently
      const hits: { file: string; line: number; text: string }[] = [];
      for (const file of files) {
        // Only inspect public-* route files (matches fileGlobs, but
        // customCheck receives whatever the runner passes — enforce here too).
        if (!/public-[^/\\]*\.ts$/.test(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          // Match: addActivity(workspaceId, 'type_name', ...)  or  addActivity(wsId, "type_name", ...)
          const callRe = /addActivity\s*\([^,]+,\s*['"]([^'"]+)['"]/g;
          let cm: RegExpExecArray | null;
          while ((cm = callRe.exec(lines[i])) !== null) {
            const activityType = cm[1];
            if (!clientVisible.has(activityType)) {
              if (hasHatch(lines, i, 'client-visibility-ok')) continue;
              hits.push({ file, line: i + 1, text: lines[i].trim() });
            }
          }
        }
      }
      return hits;
    },
  },
  {
    // P1 expansion rule: discarded updatePageSeo return value.
    //
    // `updatePageSeo()` (imported from server/webflow.ts) returns
    // `{ success: boolean, error?: string }` rather than throwing on Webflow
    // API failures. A bare `await updatePageSeo(...)` (no assignment) silently
    // treats Webflow API errors as success — the caller proceeds on the happy
    // path with no indication that the page was not actually updated.
    //
    // PR #1 of the Platform Health Sprint fixed 4 such call sites in
    // server/routes/webflow-seo.ts; this rule prevents recurrence wherever
    // the function is called in the future.
    //
    // Escape hatch: `// seo-ok` on the same line or one line above, for any
    // legitimate fire-and-forget case (e.g. a best-effort cache warm where
    // failure is intentionally not surfaced to the caller — justify why).
    name: 'Discarded updatePageSeo return value',
    pattern: 'await updatePageSeo\\(',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['= await updatePageSeo(', '// seo-ok'],
    message:
      'updatePageSeo() returns { success, error } — it does NOT throw on Webflow API failure. ' +
      'A bare `await updatePageSeo(...)` silently treats Webflow errors as success. ' +
      'Capture the return value: `const result = await updatePageSeo(...);` and check `result.success`. ' +
      'Suppress with // seo-ok only for legitimate fire-and-forget calls (add a comment explaining why).',
    severity: 'error',
    rationale:
      'updatePageSeo() returns rather than throws on Webflow API errors. Discarding the return value ' +
      'silently treats failures as success, causing incorrect "applied" counts and phantom successful operations. ' +
      'PR #1 Platform Health Sprint fixed 4 such sites; this rule prevents recurrence.',
    claudeMdRef: '#code-conventions',
  },
  {
    // Re-upserting an existing insight by manually copying fields drops any field
    // the author forgets (e.g. resolutionSource). Use cloneInsightParams(insight)
    // to get all fields, then spread and override. See PR #201 code review.
    //
    // Detection: upsertInsight({ followed within 20 lines by `insight.workspaceId`
    // (the hallmark of manual field copying) without `...cloneInsightParams` spread.
    //
    // Escape hatch: `// clone-ok` on the upsertInsight line.
    name: 'Re-upsert without cloneInsightParams',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/analytics-insights-store.ts'],
    message:
      'Re-upserting an existing insight without cloneInsightParams() silently drops fields ' +
      '(e.g. resolutionSource). Use: upsertInsight({ ...cloneInsightParams(insight), <overrides> }). ' +
      'Suppress with // clone-ok if you are intentionally building a partial upsert.',
    severity: 'error',
    rationale:
      'upsertInsight defaults omitted optional fields to null. When re-upserting from an existing ' +
      'AnalyticsInsight record, manually copying fields one-by-one silently drops any field the author ' +
      'does not think to include. cloneInsightParams maps all fields in one place.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const matches: CustomCheckMatch[] = [];
      for (const file of files) {
        let lines: string[];
        try { lines = readFileSync(file, 'utf-8').split('\n'); } catch { continue; }
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!line.includes('upsertInsight(') && !line.includes('updateInsight(')) continue;
          if (line.includes('cloneInsightParams') || line.includes('cloneParams') || line.includes('// clone-ok')) continue;
          // Look ahead up to 20 lines for manual field copies from an existing insight
          const window = lines.slice(i + 1, i + 21).join('\n');
          if (window.includes('insight.workspaceId') || window.includes('insight.pageId')) {
            // Confirm it's NOT using spread with cloneInsightParams on the next line
            const spreadLine = lines[i + 1] ?? '';
            if (spreadLine.includes('cloneInsightParams') || spreadLine.includes('cloneParams')) continue;
            matches.push({ file, line: i + 1, text: line.trim() });
          }
        }
      }
      return matches;
    },
  },
  {
    name: 'Raw provider date passed to new Date()',
    pattern: 'new Date\\((\\w+\\.)?(first_?[sS]een|last_?[sS]een|last_?[vV]isited)',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: ['server/seo-data-provider.ts'],
    excludeLines: ['// provider-date-ok'],
    message: 'Raw provider date fields (first_seen, last_seen, last_visited) must go through normalizeProviderDate() at the provider boundary, not new Date() directly. Unix-epoch strings do not parse and cause "Invalid Date" downstream. Add // provider-date-ok if the value is already normalized.',
    severity: 'warn',
    rationale: 'Prevents Invalid Date regressions after PR #218 A4 finding: SEMRush emits Unix epoch strings that new Date() cannot parse.',
    claudeMdRef: '#code-conventions',
  },
  {
    name: 'Competitor keyword push missing serpFeatures',
    pattern: 'competitorKeywordData\\.push\\(\\{',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    excludeLines: ['// compkw-serp-ok'],
    message: 'competitorKeywordData entries must carry serpFeatures from the source DomainKeyword. Without it, downstream SERP-feature chip rendering and opportunity scoring go dark. See docs/rules/automated-rules.md. Add // compkw-serp-ok if intentionally dropping.',
    severity: 'warn',
    rationale: 'Prevents regression of PR #218 A3 finding: DomainKeyword.serpFeatures was silently dropped in the inline mapping.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      // For each match of the pattern, look ahead up to 12 lines and require
      // `serpFeatures` to appear before a closing `});`. Flag if not.
      const hits: Array<{ file: string; line: number; text: string }> = [];
      for (const file of files) {
        if (!file.endsWith('.ts') || !file.includes('server/')) continue;
        let content: string;
        try { content = readFileSync(file, 'utf-8'); } catch { continue; }
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!lines[i].includes('competitorKeywordData.push({')) continue;
          // Look ahead up to 12 lines for either `serpFeatures:` or the closing `});`
          let foundField = false;
          let foundClose = false;
          for (let j = i; j < Math.min(i + 12, lines.length); j++) {
            if (lines[j].includes('serpFeatures')) { foundField = true; break; }
            if (lines[j].includes('});')) { foundClose = true; break; }
          }
          if (foundClose && !foundField) {
            const hatch = '// compkw-serp-ok';
            if (hasHatch(lines, i, hatch)) continue;
            hits.push({ file, line: i + 1, text: lines[i].trim() });
          }
        }
      }
      return hits;
    },
  },
  {
    // Slug-path hardening sprint (2026-04-21).
    //
    // Webflow nested pages have a `publishedPath` like `/services/seo` and a
    // `slug` like `seo` (only the final segment). Using `/${page.slug}` directly
    // as a page path produces wrong URLs for nested pages. The correct helper is
    // `resolvePagePath(page)` from `server/helpers.ts` (backend) or
    // `src/lib/pathUtils.ts` (frontend), which prefers `publishedPath` and
    // falls back to `/${slug}` only when publishedPath is absent.
    //
    // This rule flags the two bare-slug constructions that caused the regressions:
    //   1. `/${page.slug}` or `/${p.slug}` (standalone template literal)
    //   2. `/${page.slug || ''}` (empty-fallback variant from pagePath assignments)
    //
    // Excluded:
    //   - server/helpers.ts and src/lib/pathUtils.ts — the canonical implementations
    //     that define the correct fallback logic
    //   - Lines containing `.startsWith('/')` — ternary slug-normalization patterns
    //     (`p.slug.startsWith('/') ? p.slug : \`/${p.slug}\``) that are a safe
    //     intermediate form, NOT a pagePath construction
    //   - Lines containing `publishedPath` — already have the correct guard
    //
    // Escape hatch: add `// slug-path-ok` on the same line or the preceding line
    // for display-only uses (e.g. breadcrumb labels) where the slug suffix is intentional.
    name: 'Bare slug used in pagePath construction — use resolvePagePath(page)',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['server/helpers.ts', 'src/lib/pathUtils.ts'],
    excludeLines: ['.startsWith(\'/\')', '.startsWith("/")', 'publishedPath', '// slug-path-ok'],
    message:
      'Use resolvePagePath(page) instead of `/${page.slug}` — slug is only the final URL segment ' +
      'for nested Webflow pages. resolvePagePath() prefers publishedPath. ' +
      'Suppress with // slug-path-ok for intentional display-only slug suffixes.',
    severity: 'warn',
    rationale:
      'Webflow nested pages (`/services/seo`) have slug=`seo` — using `/${page.slug}` directly ' +
      'produces wrong short URLs that break GSC matching and pagePath lookups.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      // Matches `/${page.slug}`, `/${p.slug}`, with optional `|| 'fallback'`
      // INSIDE the template literal (e.g. `/${page.slug || ''}`) or as a
      // standalone expression.
      const bareSlugRe = /`\/\$\{(?:page|p)\.slug(?:\s*\|\|\s*['"].*?['"])?\}`/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        // Skip canonical implementation files
        if (file.endsWith('server/helpers.ts') || file.endsWith('src/lib/pathUtils.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!bareSlugRe.test(lines[i])) continue;
          // Skip ternary slug-normalization: `p.slug.startsWith('/') ? p.slug : \`/${p.slug}\``
          if (lines[i].includes(".startsWith('/')") || lines[i].includes('.startsWith("/")')) continue;
          // Skip lines that already check publishedPath (safe guard pattern)
          if (lines[i].includes('publishedPath')) continue;
          if (hasHatch(lines, i, '// slug-path-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    // ── resolvePagePath(...) || undefined is dead code ──
    //
    // `resolvePagePath(page)` always returns a truthy string (`page.publishedPath`
    // OR `/${page.slug}` OR `/`), so `resolvePagePath(page) || undefined` can
    // never evaluate to `undefined`. This is almost always a signal that the
    // caller wanted `tryResolvePagePath(page)` — which returns `undefined` when
    // the page has neither slug nor publishedPath, so downstream guards like
    // `if (basePath)` actually work.
    //
    // Escape hatch: `// slug-path-ok` on the same line or preceding line.
    name: 'resolvePagePath(...) with undefined fallback is dead code — use tryResolvePagePath',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    exclude: ['server/helpers.ts', 'src/lib/pathUtils.ts'],
    excludeLines: ['// slug-path-ok'],
    message:
      'resolvePagePath(page) is always truthy (returns "/" as last resort), so ' +
      '`resolvePagePath(page) || undefined` can never be undefined. Use ' +
      'tryResolvePagePath(page) if you need undefined for path-less pages.',
    severity: 'error',
    rationale:
      'The dead-code pattern silently neutralizes downstream guards like ' +
      '`if (basePath)` that are meant to skip fetch/GSC-match for path-less pages.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const deadCodeRe = /resolvePagePath\([^)]*\)\s*\|\|\s*undefined\b/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        if (file.endsWith('server/helpers.ts') || file.endsWith('src/lib/pathUtils.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!deadCodeRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// slug-path-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    // ── Manual pageMap pairing outside shared helpers ──
    //
    // Three components (SeoEditor, PageIntelligence, ApprovalsTab) independently
    // reimplemented `pageMap.find(...)` with divergent semantics — each missed
    // case-insensitive matching and/or legacy `/${slug}` fallbacks. The shared
    // helpers in `src/lib/pathUtils.ts` (`findPageMapEntry`, `findPageMapEntryForPage`)
    // and the `usePageJoin` hook in `src/hooks/admin/usePageJoin.ts` normalize
    // all matching. Direct `.find()` calls bypass these guards.
    //
    // Excluded:
    //   - src/hooks/admin/usePageJoin.ts — canonical hook (authorized usage via
    //     findPageMapEntryForPage internally)
    //   - src/lib/pathUtils.ts — the canonical helpers themselves
    //
    // Escape hatch: add `// pagemap-find-ok` on the same line or the preceding line
    // for any use that genuinely cannot use the shared helpers.
    name: 'Manual pageMap pairing outside shared helpers — use findPageMapEntry(ForPage) or usePageJoin',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    message:
      'Use findPageMapEntry(ForPage) or usePageJoin instead of inline pageMap.find(). ' +
      'Direct .find() misses case-insensitive matching and legacy /${slug} fallbacks.',
    severity: 'error',
    rationale:
      'Three components independently reimplemented pageMap.find with divergent semantics ' +
      '(SeoEditor, PageIntelligence, ApprovalsTab). The shared helpers in pathUtils.ts and ' +
      'the usePageJoin hook normalize all matching. Direct .find() silently breaks case ' +
      'variants and legacy paths.',
    claudeMdRef: '#data-flow-rules',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const pageMapFindRe = /pageMap(\?)?.find\(/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        // Skip canonical implementation files
        if (file.endsWith('src/hooks/admin/usePageJoin.ts')) continue;
        if (file.endsWith('src/lib/pathUtils.ts')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!pageMapFindRe.test(lines[i])) continue;
          if (hasHatch(lines, i, '// pagemap-find-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    // ── useWorkspaceEvents handler for an already-centralized event ──
    //
    // `src/hooks/useWsInvalidation.ts` is the single source of truth for
    // workspace-scoped WS event → React Query cache invalidation. Any component
    // or hook that also subscribes to one of those events with useWorkspaceEvents
    // duplicates the invalidation logic and creates silent drift — the two
    // handlers can disagree on which query keys to invalidate.
    //
    // The allowlist is derived dynamically by parsing useWsInvalidation.ts at
    // rule startup (readFileSync once). This keeps the rule in sync automatically
    // as new events are centralized without requiring manual CHECKS updates.
    //
    // Fail-closed: if useWsInvalidation.ts is missing or has zero handler keys,
    // the rule throws so the overall pr-check exits non-zero rather than
    // silently passing.
    //
    // Escape hatch: `// ws-invalidation-ok` on the same line or the line
    // immediately above, for legitimate local side effects that truly cannot live
    // in the central hook (e.g. BulkOperation progress keyed off component-local
    // state that is not shared across the workspace).
    name: 'useWorkspaceEvents handler for centralized event',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    exclude: [
      'src/hooks/useWsInvalidation.ts',
    ],
    excludeLines: ['// ws-invalidation-ok'],
    message:
      'Inline useWorkspaceEvents subscriptions for events already handled in ' +
      'src/hooks/useWsInvalidation.ts duplicate invalidation logic and create silent drift. ' +
      'Move the cache invalidation to the central hook. ' +
      'Use // ws-invalidation-ok on the [WS_EVENTS.X] line or the line immediately above ' +
      'for legitimate local-only side effects (e.g. component-local state driven by bulk-op progress).',
    severity: 'error',
    rationale:
      'Duplicated useWorkspaceEvents subscriptions diverge over time — one side gets ' +
      'updated, the other silently misses cache keys — producing stale UI bugs ' +
      'that are hard to reproduce because they depend on event ordering.',
    claudeMdRef: '#data-flow-rules-mandatory',
    customCheck: (files) => {
      // ── Parse useWsInvalidation.ts to build the centralized-events allowlist ──
      // Fail-closed: if the file is missing or has no handler keys, throw so the
      // rule is not silently skipped (a missing/empty allowlist would pass every
      // file, hiding real violations).
      const wsInvalidationPath = path.join(ROOT, 'src', 'hooks', 'useWsInvalidation.ts');
      let wsInvalidationContent: string;
      try {
        wsInvalidationContent = readFileSync(wsInvalidationPath, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `useWorkspaceEvents-centralization rule: cannot read src/hooks/useWsInvalidation.ts — ${msg}. ` +
          'The file must exist; this rule is a guardrail, not a suggestion.'
        );
      }

      // Extract every [WS_EVENTS.NAME] handler key present in the file.
      // Pattern: `[WS_EVENTS.SOME_EVENT_NAME]` at computed-property position.
      const keyRe = /\[WS_EVENTS\.([A-Z_]+)\]/g;
      const centralizedEvents = new Set<string>();
      let km: RegExpExecArray | null;
      while ((km = keyRe.exec(wsInvalidationContent)) !== null) {
        centralizedEvents.add(km[1]);
      }

      if (centralizedEvents.size === 0) {
        throw new Error(
          'useWorkspaceEvents-centralization rule: found zero [WS_EVENTS.*] handler keys in ' +
          'src/hooks/useWsInvalidation.ts. The file may be malformed or the regex needs updating. ' +
          'Expected pattern: `[WS_EVENTS.EVENT_NAME]: () => { ... }`'
        );
      }

      // ── Scan src/ files for inline [WS_EVENTS.X] patterns whose event is centralized ──
      const hits: CustomCheckMatch[] = [];
      const lineRe = /\[WS_EVENTS\.([A-Z_]+)\]/;

      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        // Never flag the central hook itself (it defines the handlers, not duplicates them).
        if (file.endsWith('useWsInvalidation.ts')) continue;
        // Skip test files — test mocks/fixtures may legitimately reference WS_EVENTS keys.
        if (file.includes('.test.') || file.includes('.spec.')) continue;

        const content = readFileOrEmpty(file);
        if (!content) continue;
        // Quick pre-filter: skip files that don't reference WS_EVENTS at all.
        if (!content.includes('WS_EVENTS.')) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const m = lines[i].match(lineRe);
          if (!m) continue;
          const eventName = m[1];
          if (!centralizedEvents.has(eventName)) continue;
          // Check escape hatch on this line or the line immediately above.
          if (hasHatch(lines, i, '// ws-invalidation-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
  {
    name: 'roadmap.json item ID uniqueness',
    pattern: '',
    fileGlobs: ['*.json'],
    pathFilter: 'data/',
    displayScope: 'data/roadmap.json',
    severity: 'error',
    message: 'data/roadmap.json contains duplicate item IDs across sprints. Run `npx tsx scripts/dedupe-roadmap-ids.ts` to renumber the later occurrences. Item IDs are addressed by `(sprintId, id)` everywhere they\'re used as identity (React keys, expand state, PATCH lookups), and a duplicate id silently routes status toggles to the wrong row.',
    rationale: 'Cross-sprint duplicate IDs caused PR #258 round-4: clicking expand on one row toggled both, and the server PATCH updated whichever sprint came first.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      // Prefer a roadmap.json passed via `files` (lets fixture tests swap in
      // a controlled JSON); fall back to the real repo file so the integrity
      // check ALWAYS runs, even on commits that don't touch roadmap.json.
      const target = files.find(f => /(?:^|\/)roadmap\.json$/.test(f))
        ?? path.join(ROOT, 'data', 'roadmap.json');
      let raw: string;
      try { raw = readFileSync(target, 'utf-8'); }
      catch { return []; }
      let data: { sprints?: Array<{ id?: string; items?: Array<{ id?: number | string; title?: string }> }> };
      try { data = JSON.parse(raw); }
      catch { return [{ file: target, line: 1, text: 'JSON parse error' }]; }
      const sprints = Array.isArray(data.sprints) ? data.sprints : [];
      const seen = new Map<string, { sprint: string; title: string }>();
      const hits: CustomCheckMatch[] = [];
      for (const sprint of sprints) {
        const sprintId = String(sprint.id ?? '');
        for (const item of sprint.items ?? []) {
          if (item.id == null) continue;
          const key = String(item.id);
          const prior = seen.get(key);
          if (prior) {
            hits.push({
              file: target,
              line: 1,
              text: `id ${key} duplicated: "${prior.title}" (sprint=${prior.sprint}) ↔ "${String(item.title ?? '')}" (sprint=${sprintId})`,
            });
          } else {
            seen.set(key, { sprint: sprintId, title: String(item.title ?? '') });
          }
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

// Exported for tests/pr-check.test.ts — see the 'pathFilter vs EXCLUDED_DIRS
// collision' regression test. Not part of the public API; do not import from
// anywhere except the test harness.
export function checkDirectory(dir: string, check: Check): string[] {
  const globs = check.fileGlobs.map(g => `--include="${g}"`).join(' ');
  // If the rule opts into a normally-excluded directory via pathFilter (e.g.
  // 'tests/'), that directory must NOT be in the grep --exclude-dir list.
  // grep applies --exclude-dir against the starting directory too, so
  // `grep -r --exclude-dir="tests" tests/` returns zero matches — the exact
  // silent-false-negative class this audit prevents.
  const pathFilterDir = check.pathFilter?.replace(/\/$/, '').split('/').pop() ?? null;
  const effectiveExcludeDirs = EXCLUDED_DIRS.filter(d => d !== pathFilterDir);
  const excludeDirs = effectiveExcludeDirs.map(d => `--exclude-dir="${d}"`).join(' ');
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

// ─── CLI runner (gated so `import { CHECKS }` from tests doesn't fire this) ──
// Everything from here to EOF is wrapped in runCli() which is only invoked
// when this file is executed directly (npx tsx scripts/pr-check.ts), not when
// imported (e.g. from tests/pr-check.test.ts). The body is intentionally NOT
// re-indented — keeps the diff minimal and the git history readable.
function runCli() {
let errors = 0;
let warnings = 0;

// Resolve changed files ONCE here so all consumers in runCli() share the same
// snapshot. The lazy cache prevents the import in tests/pr-check.test.ts from
// spawning git subprocesses at module-load time.
const changedFiles = cachedChangedFiles();
const mode = SCAN_ALL ? 'full scan' : changedFiles.length > 0
  ? `${changedFiles.length} changed file(s)`
  : 'full scan (no diff detected)';

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
  // A rule that opts into a normally-excluded directory via pathFilter (e.g.
  // `pathFilter: 'tests/'`) must still scan that directory on a full run. The
  // diff-only branch above already has this carve-out; mirror it here so the
  // `--all` path is a proper superset of the diff path.
  const baseDir = path.join(ROOT, check.pathFilter ?? '.');
  // Basename of the pathFilter leaf (e.g. 'tests/' → 'tests', 'server/routes/'
  // → 'routes'). Compared against EXCLUDED_DIRS basenames so a rule that opts
  // into an excluded dir via pathFilter is actually scanned.
  const pathFilterDir = check.pathFilter?.replace(/\/$/, '').split('/').pop() ?? null;
  const all = new Set<string>();
  for (const glob of check.fileGlobs) {
    const pattern = glob.replace('**/', '');
    for (const f of getFiles(baseDir, pattern)) {
      if (isExcluded(f, check.exclude)) continue;
      // Use the relative path for EXCLUDED_DIRS checks so that running from
      // inside a worktree (e.g. `.claude/worktrees/<name>/`) doesn't cause every
      // file to be silently excluded because the absolute path contains `/.claude/`.
      const rel = path.relative(ROOT, f);
      if (EXCLUDED_DIRS.some(d => d !== pathFilterDir && (rel === d || rel.startsWith(d + '/') || rel.includes('/' + d + '/')))) continue;
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
    // Guard against a rule whose customCheck throws at runtime (regex bug on
    // weird input, unexpected file shape, OOM on a huge file). Without this,
    // one bad rule kills the whole runner mid-loop and every subsequent rule
    // is silently skipped — the exact silent-false-negative class this audit
    // is trying to eliminate. On throw we log, count as an error, set
    // exitCode, and continue so remaining rules still run.
    try {
      const files = resolveCheckFileList(check);
      const raw = check.customCheck(files);
      matches = formatCustomMatches(check, raw);
    } catch (err) {
      const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
      console.error(`\n  ✗ ${check.name}`);
      console.error(`    customCheck threw: ${msg}`);
      errors++;
      process.exitCode = 1;
      continue;
    }
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
  'In-place sort on shared arrays: any `.sort(` on a React Query result, a function parameter, or a prop must use `[...arr].sort(...)` to avoid mutating cached/shared state. Only safe to omit the spread when the array was just constructed locally (e.g. result of `.filter()` on a local variable that is not a prop/parameter). See docs/rules/analytics-insights.md §8.',
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
} // end runCli()

// Run the CLI only when this file is executed directly. When imported from
// tests (vitest), import.meta.url is the module URL and process.argv[1] is
// the vitest entry — the comparison below is false and this is a no-op.
//
// We use the ESM main-module idiom (resolve both sides to the same shape via
// fileURLToPath + realpathSync) rather than a basename string match, because
// a string match on 'pr-check.ts' breaks silently under symlinks, compiled
// .js output, npm-run wrappers, and any other script in the project that
// happens to share the basename. A mismatch here silently no-ops the whole
// runner and exits 0, which is the worst possible failure mode for CI.
function isMainModule(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    const entryPath = realpathSync(argv1);
    return modulePath === entryPath;
  } catch {
    // realpathSync throws on missing files — fall back to the looser
    // basename check rather than silently no-op, so a developer running
    // `tsx scripts/pr-check.ts` from an unusual CWD still gets a run.
    return path.basename(argv1) === 'pr-check.ts';
  }
}

if (isMainModule()) {
  runCli();
}
