/**
 * pr-check customCheck rule harness.
 *
 * Exercises every customCheck rule in scripts/pr-check.ts against synthetic
 * fixture files for four scenarios each:
 *
 *   1. trigger       — has the bug, expect 1 hit on a known line
 *   2. hatch-inline  — has the bug + hatch comment on the flagged line
 *   3. hatch-above   — has the bug + hatch comment on the line above
 *   4. negative      — pattern-adjacent but correct, expect 0 hits
 *
 * Motivation: see docs/rules/pr-check-rule-authoring.md → "Common mistakes
 * in customCheck rules" and the postmortem in the 2026-04-10 audit plan.
 * Four rounds of whack-a-mole bugs on this file convinced us that
 * typecheck-plus-match-count-unchanged is not a verification strategy for
 * rules whose correctness hinges on silent false-negatives (hatch lookbehind,
 * function-boundary detection). This harness converts each rule's contract
 * into an executable pass/fail so future changes fail loudly.
 *
 * Fixtures are written to a per-file tmpdir with synthetic sub-paths chosen
 * to satisfy each rule's internal path filter (Rule 6 requires `/server/`,
 * Rule 9 requires the exact `server/routes/public-portal.ts` suffix, etc.).
 * Fixtures never live in the real tree so they cannot pollute `pr-check --all`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  CHECKS,
  checkDirectory,
  buildWorkspaceScopedTables,
  extractDbPrepareArg,
  findUnrenderedSliceFields,
  compareStudioConstants,
  BRAND_ENGINE_ROUTE_BASENAMES,
  REQUIRE_AUTH_ALLOWED_BASENAMES,
  GLOBALLY_APPLIED_LIMITERS,
  type Check,
  type CustomCheckMatch,
} from '../scripts/pr-check.js';

let TMPDIR: string;

beforeAll(() => {
  TMPDIR = mkdtempSync(path.join(tmpdir(), 'pr-check-fixtures-'));
});

afterAll(() => {
  rmSync(TMPDIR, { recursive: true, force: true });
});

// Write `content` to `<TMPDIR>/<relPath>`, creating parent dirs as needed.
// Returns the absolute path so tests can pass it to a rule's customCheck.
function write(relPath: string, content: string): string {
  const full = path.join(TMPDIR, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf-8');
  return full;
}

// Look up a rule by exact name and invoke its customCheck on the given files.
// Throws if the rule doesn't exist or has no customCheck — both signal a
// regression (the harness is out of sync with scripts/pr-check.ts).
function runRule(name: string, files: string[]): CustomCheckMatch[] {
  const check = CHECKS.find(c => c.name === name);
  if (!check) throw new Error(`Rule not found: "${name}"`);
  if (!check.customCheck) throw new Error(`Rule "${name}" has no customCheck`);
  return check.customCheck(files);
}

// Join lines with \n to build a fixture. The returned string has no leading
// newline, so line numbers are 1-indexed into the input array (lines[0] is
// file line 1). Keeps assertions on `hit.line` obvious.
function lines(...ls: string[]): string {
  return ls.join('\n');
}

// Unique file path per test within the shared tmpdir. Prefixing with the
// rule id keeps collisions impossible even if two rules share a filename.
let counter = 0;
function uniqPath(ruleId: string, name: string): string {
  counter += 1;
  return `${ruleId}/case-${counter}/${name}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Rule 2: Global keydown missing isContentEditable guard
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Global keydown missing isContentEditable guard', () => {
  const RULE = 'Global keydown missing isContentEditable guard';

  it('flags a listener whose inline body omits isContentEditable', () => {
    const file = write(
      uniqPath('rule-02', 'trigger.tsx'),
      lines(
        "export function Foo() {",                                       // 1
        "  window.addEventListener('keydown', (e) => {",                 // 2
        "    if (e.key === 'Escape') doThing();",                        // 3
        "  });",                                                         // 4
        "}",                                                             // 5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].file).toBe(file);
  });

  it('respects inline // keydown-ok hatch on the listener line', () => {
    const file = write(
      uniqPath('rule-02', 'hatch-inline.tsx'),
      lines(
        "export function Foo() {",
        "  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') doThing(); }); // keydown-ok",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // keydown-ok hatch on the immediately preceding line', () => {
    const file = write(
      uniqPath('rule-02', 'hatch-above.tsx'),
      lines(
        "export function Foo() {",
        "  // keydown-ok — intentional",
        "  window.addEventListener('keydown', (e) => {",
        "    if (e.key === 'Escape') doThing();",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a listener that checks e.target.isContentEditable', () => {
    const file = write(
      uniqPath('rule-02', 'negative.tsx'),
      lines(
        "export function Foo() {",
        "  window.addEventListener('keydown', (e) => {",
        "    const t = e.target as HTMLElement;",
        "    if (t.isContentEditable) return;",
        "    if (e.key === 'Escape') doThing();",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 3: Multi-step DB writes outside db.transaction()
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Multi-step DB writes outside db.transaction()', () => {
  const RULE = 'Multi-step DB writes outside db.transaction()';

  it('flags two sequential db.prepare().run() calls in the same function', () => {
    const file = write(
      uniqPath('rule-03', 'server/trigger.ts'),
      lines(
        "import db from './db.js';",                                   // 1
        "export function save() {",                                    // 2
        "  db.prepare('INSERT INTO a VALUES (?)').run('x');",          // 3
        "  db.prepare('INSERT INTO b VALUES (?)').run('y');",          // 4
        "}",                                                           // 5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('respects inline // txn-ok on the first write line', () => {
    const file = write(
      uniqPath('rule-03', 'server/hatch-inline.ts'),
      lines(
        "import db from './db.js';",
        "export function save() {",
        "  db.prepare('INSERT INTO a VALUES (?)').run('x'); // txn-ok",
        "  db.prepare('INSERT INTO b VALUES (?)').run('y');",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // txn-ok on the line above a multi-line db.prepare', () => {
    const file = write(
      uniqPath('rule-03', 'server/hatch-above.ts'),
      lines(
        "import db from './db.js';",
        "export function save() {",
        "  // txn-ok — idempotent writes",
        "  db.prepare(`",
        "    INSERT INTO a VALUES (?)",
        "  `).run('x');",
        "  db.prepare('INSERT INTO b VALUES (?)').run('y');",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag writes wrapped in db.transaction()', () => {
    const file = write(
      uniqPath('rule-03', 'server/negative.ts'),
      lines(
        "import db from './db.js';",
        "export function save() {",
        "  const txn = db.transaction(() => {",
        "    db.prepare('INSERT INTO a VALUES (?)').run('x');",
        "    db.prepare('INSERT INTO b VALUES (?)').run('y');",
        "  });",
        "  txn();",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  // Regression for FUNC_BOUNDARY_RE greedy `.*=>` bug: an inline arrow
  // *expression* like `const ids = items.map(item => item.id)` is NOT a
  // function boundary. Before the fix, the regex matched any `const ... =>`
  // line, causing Rule 3 to stop its backward scan mid-function and silently
  // miss real multi-step write violations.
  it('flags multi-step writes separated by an inline arrow expression (FUNC_BOUNDARY_RE regression)', () => {
    const file = write(
      uniqPath('rule-03', 'server/arrow-expr.ts'),
      lines(
        "import db from './db.js';",                                      // 1
        "export function save(rows: Array<{ id: string }>) {",            // 2
        "  db.prepare('INSERT INTO a VALUES (?)').run('x');",             // 3
        "  const ids = rows.map(r => r.id);",                             // 4 — inline arrow, NOT a boundary
        "  db.prepare('INSERT INTO b VALUES (?)').run(ids[0]);",          // 5
        "}",                                                              // 6
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  // Complementary negative: a REAL arrow function declaration between the
  // two writes IS a boundary (the second write is inside a different
  // function's body), so Rule 3 must NOT flag.
  it('does not flag writes in separate arrow-function declarations', () => {
    const file = write(
      uniqPath('rule-03', 'server/arrow-decl.ts'),
      lines(
        "import db from './db.js';",
        "export const first = () => {",
        "  db.prepare('INSERT INTO a VALUES (?)').run('x');",
        "};",
        "export const second = () => {",
        "  db.prepare('INSERT INTO b VALUES (?)').run('y');",
        "};",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 4: AI call before db.prepare without transaction guard
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: AI call before db.prepare without transaction guard', () => {
  const RULE = 'AI call before db.prepare without transaction guard';

  it('flags callOpenAI followed by db.prepare within 30 lines, no transaction', () => {
    const file = write(
      uniqPath('rule-04', 'server/trigger.ts'),
      lines(
        "import db from './db.js';",                                  // 1
        "import { callOpenAI } from './openai-helpers.js';",          // 2
        "export async function run() {",                              // 3
        "  const out = await callOpenAI({ prompt: 'hi' });",          // 4
        "  db.prepare('INSERT INTO a VALUES (?)').run(out);",         // 5
        "}",                                                          // 6
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
  });

  it('respects inline // ai-race-ok hatch on the AI call line', () => {
    const file = write(
      uniqPath('rule-04', 'server/hatch-inline.ts'),
      lines(
        "import db from './db.js';",
        "import { callOpenAI } from './openai-helpers.js';",
        "export async function run() {",
        "  const out = await callOpenAI({ prompt: 'hi' }); // ai-race-ok",
        "  db.prepare('INSERT INTO a VALUES (?)').run(out);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // ai-race-ok hatch on the line above a multi-line callOpenAI', () => {
    const file = write(
      uniqPath('rule-04', 'server/hatch-above.ts'),
      lines(
        "import db from './db.js';",
        "import { callOpenAI } from './openai-helpers.js';",
        "export async function run() {",
        "  // ai-race-ok — upsert with ON CONFLICT",
        "  const out = await callOpenAI({",
        "    prompt: 'hi',",
        "    temperature: 0.2,",
        "  });",
        "  db.prepare('INSERT INTO a VALUES (?)').run(out);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag when the write is inside db.transaction()', () => {
    const file = write(
      uniqPath('rule-04', 'server/negative.ts'),
      lines(
        "import db from './db.js';",
        "import { callOpenAI } from './openai-helpers.js';",
        "export async function run() {",
        "  const out = await callOpenAI({ prompt: 'hi' });",
        "  const txn = db.transaction(() => {",
        "    db.prepare('INSERT INTO a VALUES (?)').run(out);",
        "  });",
        "  txn();",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  // Regression test for the CANONICAL correct pattern from
  // docs/rules/ai-dispatch-patterns.md: the transaction is HOISTED above the
  // AI call because you cannot await inside db.transaction(). Before the
  // backward-scan fix, this false-positived on every correct implementation.
  it('does not flag when db.transaction() is hoisted above the AI call (canonical pattern)', () => {
    const file = write(
      uniqPath('rule-04', 'server/negative-hoisted.ts'),
      lines(
        "import db from './db.js';",
        "import { callOpenAI } from './openai-helpers.js';",
        "export async function run() {",
        "  const doWork = db.transaction((result: string) => {",
        "    db.prepare('INSERT INTO a VALUES (?)').run(result);",
        "  });",
        "  const out = await callOpenAI({ prompt: 'hi' });",
        "  doWork(out);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 5: UPDATE/DELETE missing workspace_id scope
// `brandscripts` is a confirmed workspace-scoped table (probed at harness
// authoring time against buildWorkspaceScopedTables).
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: UPDATE/DELETE missing workspace_id scope', () => {
  const RULE = 'UPDATE/DELETE missing workspace_id scope';

  it('flags UPDATE on a workspace-scoped table without workspace_id in SQL', () => {
    const file = write(
      uniqPath('rule-05', 'server/trigger.ts'),
      lines(
        "import db from './db.js';",                                           // 1
        "export function update(id: string) {",                                // 2
        "  db.prepare('UPDATE brandscripts SET name = ? WHERE id = ?').run('x', id);", // 3
        "}",                                                                   // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('respects inline // ws-scope-ok hatch on the prepare line', () => {
    const file = write(
      uniqPath('rule-05', 'server/hatch-inline.ts'),
      lines(
        "import db from './db.js';",
        "export function update(id: string) {",
        "  db.prepare('UPDATE brandscripts SET name = ? WHERE id = ?').run('x', id); // ws-scope-ok",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // ws-scope-ok hatch on the line above a multi-line db.prepare', () => {
    const file = write(
      uniqPath('rule-05', 'server/hatch-above.ts'),
      lines(
        "import db from './db.js';",
        "export function update(id: string) {",
        "  // ws-scope-ok — id is already workspace-unique",
        "  db.prepare(`",
        "    UPDATE brandscripts",
        "    SET name = ?",
        "    WHERE id = ?",
        "  `).run('x', id);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag UPDATE that includes workspace_id in the WHERE clause', () => {
    const file = write(
      uniqPath('rule-05', 'server/negative.ts'),
      lines(
        "import db from './db.js';",
        "export function update(id: string, wsId: string) {",
        "  db.prepare('UPDATE brandscripts SET name = ? WHERE id = ? AND workspace_id = ?').run('x', id, wsId);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  // ── Step 7 regression: paren-depth tokeniser ────────────────────────────
  //
  // The original SQL extractor truncated at the first literal `);` it saw,
  // which is wrong when `);` appears inside a string literal (a CHECK
  // constraint, an inline SQL fragment, etc.). Replaced in B9 Step 7 with
  // `extractDbPrepareArg` — a paren-depth tokeniser that respects backtick,
  // single-quote, and double-quote string boundaries. These tests pin the
  // exact failure shapes the new tokeniser must handle.

  it('flags UPDATE on a workspace-scoped table even when the SQL contains an inline `);` inside a string literal', () => {
    // The string fragment "value with ); inside" used to truncate the SQL
    // blob at the first `);`, leaving only `UPDATE brandscripts SET note = '`
    // which contains no UPDATE/DELETE keyword and silently bypassed the rule.
    const file = write(
      uniqPath('rule-05', 'server/inline-paren.ts'),
      lines(
        "import db from './db.js';",
        "export function update(id: string, note: string) {",
        "  db.prepare(\"UPDATE brandscripts SET note = 'value with ); inside' WHERE id = ?\").run(id);",
        "}",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('extractDbPrepareArg returns the full arg when SQL contains nested parens and inline `);`', () => {
    // Pure-function unit test on the tokeniser itself: assert it walks past
    // an embedded `);` inside a single-quoted string without prematurely
    // returning. The arg should be the entire string-literal substring.
    const chunk = "db.prepare('UPDATE t SET note = '');value('' WHERE id = ?').run(id)";
    const arg = extractDbPrepareArg(chunk);
    // The tokeniser should walk past the `);` inside the doubled-single-quote
    // SQL string and return the full arg up to the matching outer `)`.
    // We assert the returned slice contains the post-`);` content `value(`,
    // not just the truncated prefix.
    expect(arg).toContain('value(');
    expect(arg).toContain('WHERE id');
  });

  it('extractDbPrepareArg respects backtick template literals containing `);`', () => {
    // Backtick templates are the most common multi-line db.prepare shape.
    // The tokeniser must treat the backtick as a string delimiter so an
    // embedded `);` inside the SQL does not close the call.
    const chunk = "db.prepare(`UPDATE t SET note = ');' WHERE id = ?`).run(id)";
    const arg = extractDbPrepareArg(chunk);
    expect(arg).toContain('WHERE id');
    expect(arg.startsWith('`')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 6: getOrCreate* function returns nullable
// Path MUST contain `/server/` — the rule skips any file outside.
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: getOrCreate* function returns nullable', () => {
  const RULE = 'getOrCreate* function returns nullable';

  it('flags a getOrCreate function whose return type includes | null', () => {
    const file = write(
      uniqPath('rule-06', 'server/trigger.ts'),
      lines(
        "interface Foo { id: string }",                            // 1
        "export function getOrCreateFoo(id: string): Foo | null {", // 2
        "  return null;",                                          // 3
        "}",                                                       // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('respects inline // getorcreate-nullable-ok on the declaration line', () => {
    const file = write(
      uniqPath('rule-06', 'server/hatch-inline.ts'),
      lines(
        "interface Foo { id: string }",
        "export function getOrCreateFoo(id: string): Foo | null { // getorcreate-nullable-ok",
        "  return null;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // getorcreate-nullable-ok hatch on the line above', () => {
    const file = write(
      uniqPath('rule-06', 'server/hatch-above.ts'),
      lines(
        "interface Foo { id: string }",
        "// getorcreate-nullable-ok — renamed from getOrCreate, kept for compat",
        "export function getOrCreateFoo(id: string): Foo | null {",
        "  return null;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a getOrCreate function with a non-nullable return type', () => {
    const file = write(
      uniqPath('rule-06', 'server/negative.ts'),
      lines(
        "interface Foo { id: string }",
        "export function getOrCreateFoo(id: string): Foo {",
        "  return { id };",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  // ── Silent-failure Category C regression tests ──────────────────────────
  //
  // The original customCheck used `tail.search(/[{=]/)` to find the end of
  // the return-type annotation region. That search hit the first `{` or
  // `=` inside the return type itself (e.g. object-literal types,
  // `Promise<T | null>` generics, default param values in later params),
  // truncating `returnRegion` before the `| null` clause and letting every
  // such declaration slip past an `error`-severity gate.
  //
  // Round 2 P1.2 replaced the `.search(...)` with a depth-tracked walker.
  // These tests pin the exact shapes that used to bypass the rule.

  it('flags object-literal return type with | null (bypassed the original .search(/[{=]/))', () => {
    const file = write(
      uniqPath('rule-06', 'server/object-literal-nullable.ts'),
      lines(
        "interface Foo { id: string }",                                          // 1
        "export function getOrCreateFoo(id: string): { id: string } | null {", // 2
        "  return null;",                                                        // 3
        "}",                                                                     // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('flags Promise<{ shape } | null> return type', () => {
    const file = write(
      uniqPath('rule-06', 'server/promise-object-nullable.ts'),
      lines(
        "export async function getOrCreateFoo(id: string): Promise<{ id: string } | null> {", // 1
        "  return null;",                                                                       // 2
        "}",                                                                                    // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags Array<{ shape } | null> return type', () => {
    const file = write(
      uniqPath('rule-06', 'server/array-object-nullable.ts'),
      lines(
        "export function getOrCreateFoo(id: string): Array<{ x: number } | null> {", // 1
        "  return [null];",                                                             // 2
        "}",                                                                            // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags arrow-form declaration with object-literal nullable return type', () => {
    const file = write(
      uniqPath('rule-06', 'server/arrow-object-nullable.ts'),
      lines(
        "export const getOrCreateFoo = (id: string): { id: string } | null => {", // 1
        "  return null;",                                                            // 2
        "};",                                                                        // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('does not flag a non-nullable object-literal return type', () => {
    const file = write(
      uniqPath('rule-06', 'server/object-literal-non-null.ts'),
      lines(
        "export function getOrCreateFoo(id: string): { id: string } {", // 1
        "  return { id };",                                                // 2
        "}",                                                               // 3
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag an intersection return type containing an object literal (VoiceProfile & { samples })', () => {
    // Mirrors server/voice-calibration.ts:getOrCreateVoiceProfile — the
    // canonical non-nullable object-literal-in-intersection case.
    const file = write(
      uniqPath('rule-06', 'server/intersection-non-null.ts'),
      lines(
        "interface Foo { id: string }",                                                            // 1
        "interface Sample { content: string }",                                                    // 2
        "export function getOrCreateFoo(id: string): Foo & { samples: Sample[] } {",              // 3
        "  return { id, samples: [] };",                                                           // 4
        "}",                                                                                       // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a param with object-literal type (object-type params must not fool the walker)', () => {
    const file = write(
      uniqPath('rule-06', 'server/object-param-non-null.ts'),
      lines(
        "interface Foo { id: string }",                                                 // 1
        "export function getOrCreateFoo(opts: { id: string; name: string }): Foo {",   // 2
        "  return { id: opts.id };",                                                    // 3
        "}",                                                                            // 4
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 9: Public-portal mutation without addActivity
// File MUST end with `server/routes/public-portal.ts`. Each test fixture is
// written to its own subdir so multiple "public-portal.ts" files can coexist.
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Public-portal mutation without addActivity', () => {
  const RULE = 'Public-portal mutation without addActivity';

  // Helper: place fixture at <subdir>/server/routes/public-portal.ts so the
  // rule's endsWith() check finds it.
  function writePublicPortal(subdir: string, content: string): string {
    return write(`${subdir}/server/routes/public-portal.ts`, content);
  }

  it('flags a router.post mutation that does not call addActivity', () => {
    const file = writePublicPortal(
      uniqPath('rule-09', 'trigger'),
      lines(
        "import { router } from './router.js';",                     // 1
        "router.post('/thing', (req, res) => {",                     // 2
        "  db.prepare('INSERT INTO a VALUES (?)').run(req.body.x);", // 3
        "  res.json({ ok: true });",                                 // 4
        "});",                                                       // 5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('respects inline // activity-ok on the router line', () => {
    const file = writePublicPortal(
      uniqPath('rule-09', 'hatch-inline'),
      lines(
        "import { router } from './router.js';",
        "router.post('/thing', (req, res) => { // activity-ok — read-only probe",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // activity-ok hatch on the line above router.post', () => {
    const file = writePublicPortal(
      uniqPath('rule-09', 'hatch-above'),
      lines(
        "import { router } from './router.js';",
        "// activity-ok — activity logged upstream",
        "router.post('/thing', (req, res) => {",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a router.post that calls addActivity', () => {
    const file = writePublicPortal(
      uniqPath('rule-09', 'negative'),
      lines(
        "import { router } from './router.js';",
        "router.post('/thing', (req, res) => {",
        "  db.prepare('INSERT INTO a VALUES (?)').run(req.body.x);",
        "  addActivity({ type: 'thing', workspaceId: req.wsId });",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 10: broadcastToWorkspace inside bridge callback
// File MUST contain both `executeBridge` and `broadcastToWorkspace` to enter
// the scan loop at all. Negative case uses a broadcast OUTSIDE the callback.
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: broadcastToWorkspace inside bridge callback', () => {
  const RULE = 'broadcastToWorkspace inside bridge callback';

  it('flags broadcastToWorkspace inside an executeBridge callback body', () => {
    const file = write(
      uniqPath('rule-10', 'server/trigger.ts'),
      lines(
        "import { executeBridge } from './bridges.js';",                    // 1
        "import { broadcastToWorkspace } from './broadcast.js';",           // 2
        "export async function run(wsId: string) {",                        // 3
        "  await executeBridge('thing', async () => {",                     // 4
        "    broadcastToWorkspace(wsId, 'evt');",                           // 5
        "    return { modified: 1 };",                                      // 6
        "  });",                                                            // 7
        "}",                                                                // 8
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(5);
  });

  it('respects inline // bridge-broadcast-ok on the broadcast line', () => {
    const file = write(
      uniqPath('rule-10', 'server/hatch-inline.ts'),
      lines(
        "import { executeBridge } from './bridges.js';",
        "import { broadcastToWorkspace } from './broadcast.js';",
        "export async function run(wsId: string) {",
        "  await executeBridge('thing', async () => {",
        "    broadcastToWorkspace(wsId, 'evt'); // bridge-broadcast-ok",
        "    return { modified: 1 };",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // bridge-broadcast-ok hatch on the line above the broadcast', () => {
    const file = write(
      uniqPath('rule-10', 'server/hatch-above.ts'),
      lines(
        "import { executeBridge } from './bridges.js';",
        "import { broadcastToWorkspace } from './broadcast.js';",
        "export async function run(wsId: string) {",
        "  await executeBridge('thing', async () => {",
        "    // bridge-broadcast-ok — separate from bridge result",
        "    broadcastToWorkspace(wsId, 'evt');",
        "    return { modified: 1 };",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag broadcast that lives outside the bridge callback body', () => {
    const file = write(
      uniqPath('rule-10', 'server/negative.ts'),
      lines(
        "import { executeBridge } from './bridges.js';",
        "import { broadcastToWorkspace } from './broadcast.js';",
        "export async function run(wsId: string) {",
        "  await executeBridge('thing', async () => {",
        "    return { modified: 1 };",
        "  });",
        "  broadcastToWorkspace(wsId, 'other-unrelated-event');",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule 11: Layout-driving state set in useEffect
// The escape hatch is a PER-STATE `const effective<X> = ... <stateName>`
// declaration that references the state the flagged setter controls. A file
// that derives `effectiveFocusMode` from `focusMode` still flags an unrelated
// `setSidebarOpen` inside a useEffect — the old file-wide escape was too
// permissive and let real bugs slip through.
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Layout-driving state set in useEffect', () => {
  const RULE = 'Layout-driving state set in useEffect';

  it('flags useEffect that calls a layout setter (setFocusMode)', () => {
    const file = write(
      uniqPath('rule-11', 'src/trigger.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",        // 1
        "export function Foo({ tab }: { tab: string }) {",     // 2
        "  const [focusMode, setFocusMode] = useState(false);", // 3
        "  useEffect(() => {",                                 // 4
        "    if (tab !== 'rewrite') setFocusMode(false);",     // 5
        "  }, [tab]);",                                        // 6
        "  return <div>{focusMode ? 'F' : 'N'}</div>;",        // 7
        "}",                                                   // 8
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
  });

  it('respects inline // effect-layout-ok on the useEffect line', () => {
    const file = write(
      uniqPath('rule-11', 'src/hatch-inline.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",
        "export function Foo({ tab }: { tab: string }) {",
        "  const [focusMode, setFocusMode] = useState(false);",
        "  useEffect(() => { // effect-layout-ok",
        "    if (tab !== 'rewrite') setFocusMode(false);",
        "  }, [tab]);",
        "  return <div>{focusMode ? 'F' : 'N'}</div>;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // effect-layout-ok hatch on the line above useEffect', () => {
    const file = write(
      uniqPath('rule-11', 'src/hatch-above.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",
        "export function Foo({ tab }: { tab: string }) {",
        "  const [focusMode, setFocusMode] = useState(false);",
        "  // effect-layout-ok — not layout-driving",
        "  useEffect(() => {",
        "    if (tab !== 'rewrite') setFocusMode(false);",
        "  }, [tab]);",
        "  return <div>{focusMode ? 'F' : 'N'}</div>;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a file that already derives an effective* value', () => {
    const file = write(
      uniqPath('rule-11', 'src/negative.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",
        "export function Foo({ tab }: { tab: string }) {",
        "  const [focusMode, setFocusMode] = useState(false);",
        "  const effectiveFocusMode = focusMode && tab === 'rewrite';",
        "  useEffect(() => {",
        "    if (tab !== 'rewrite') setFocusMode(false);",
        "  }, [tab]);",
        "  return <div>{effectiveFocusMode ? 'F' : 'N'}</div>;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  // Regression test for the per-state escape scoping. Before the fix, one
  // `effectiveFocusMode` const in the file would suppress EVERY layout-
  // setting useEffect in that file, including unrelated ones that set
  // different state variables. After the fix, only the useEffect whose
  // setter maps to the escaped state is suppressed.
  it('still flags an unrelated setSidebarOpen useEffect even when effectiveFocusMode exists', () => {
    const file = write(
      uniqPath('rule-11', 'src/per-state-scope.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",                    // 1
        "export function Foo({ tab }: { tab: string }) {",                  // 2
        "  const [focusMode, setFocusMode] = useState(false);",             // 3
        "  const [sidebarOpen, setSidebarOpen] = useState(true);",          // 4
        "  const effectiveFocusMode = focusMode && tab === 'rewrite';",     // 5
        "  useEffect(() => {",                                              // 6  ← focusMode branch, escaped
        "    if (tab !== 'rewrite') setFocusMode(false);",                  // 7
        "  }, [tab]);",                                                     // 8
        "  useEffect(() => {",                                              // 9  ← sidebarOpen branch, NOT escaped
        "    if (tab === 'rewrite') setSidebarOpen(false);",                // 10
        "  }, [tab]);",                                                     // 11
        "  return <div>{effectiveFocusMode ? 'F' : 'N'}{sidebarOpen}</div>;", // 12
        "}",                                                                // 13
      )
    );
    const hits = runRule(RULE, [file]);
    // Only the sidebarOpen useEffect (line 9) should be flagged — the
    // focusMode useEffect (line 6) is escaped by the per-state check.
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(9);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: useGlobalAdminEvents import restriction
// ════════════════════════════════════════════════════════════════════════════
//
// Silent-failure Category B (regex too narrow). The original regex rule used
// `from '[^']*useGlobalAdminEvents`, catching only single-quoted imports. A
// double-quoted import (`from "../hooks/useGlobalAdminEvents"`) slipped past
// an `error`-severity gate — the exact class of silent false-negative this
// audit exists to prevent. Round 2 converts the rule to a customCheck so the
// detection is quote-style-agnostic and cannot be re-broken by a future
// regex tweak.

describe('Rule: useGlobalAdminEvents import restriction', () => {
  const RULE = 'useGlobalAdminEvents import restriction';

  it('flags a single-quoted import', () => {
    const file = write(
      uniqPath('rule-global-events', 'single-quote.tsx'),
      lines(
        "import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents';",  // 1
        "export function Foo() { useGlobalAdminEvents([]); return null; }",       // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].file).toBe(file);
  });

  it('flags a double-quoted import (the bug being fixed)', () => {
    // This is the specific silent-failure case: the original regex-only rule
    // did not match `from "..."` and let every double-quoted importer through.
    const file = write(
      uniqPath('rule-global-events', 'double-quote.tsx'),
      lines(
        'import { useGlobalAdminEvents } from "../hooks/useGlobalAdminEvents";',  // 1
        'export function Foo() { useGlobalAdminEvents([]); return null; }',       // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('respects inline // global-events-ok hatch on the import line', () => {
    const file = write(
      uniqPath('rule-global-events', 'hatch-inline.tsx'),
      lines(
        "import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents'; // global-events-ok",  // 1
        "export function Foo() { return null; }",                                                     // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });

  it('respects // global-events-ok on the preceding line', () => {
    // Multi-line imports can't fit the hatch inline without breaking syntax,
    // so the rule must honour a hatch comment on the line immediately above.
    const file = write(
      uniqPath('rule-global-events', 'hatch-above.tsx'),
      lines(
        "// global-events-ok — audited global-fanout site",                                  // 1
        "import { useGlobalAdminEvents } from '../hooks/useGlobalAdminEvents';",             // 2
        "export function Foo() { return null; }",                                             // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });

  it('does not flag useWorkspaceEvents imports', () => {
    const file = write(
      uniqPath('rule-global-events', 'workspace-events.tsx'),
      lines(
        "import { useWorkspaceEvents } from '../hooks/useWorkspaceEvents';",                  // 1
        "export function Foo({ id }: { id: string }) { useWorkspaceEvents(id, []); return null; }", // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });

  it('does not flag comments that merely mention useGlobalAdminEvents', () => {
    // The rule is anchored on `from '/"..."` so a comment or identifier
    // reference that isn't part of an import statement should not trigger.
    const file = write(
      uniqPath('rule-global-events', 'mention-only.tsx'),
      lines(
        "// Prefer useWorkspaceEvents over useGlobalAdminEvents in workspace-scoped components.", // 1
        "const kind: string = 'useGlobalAdminEvents';",                                           // 2
        "export function Foo() { return null; }",                                                  // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Raw string literal in broadcastToWorkspace() event arg
// ════════════════════════════════════════════════════════════════════════════
//
// Silent-failure Category D (shell quoting). The original regex contained
// `[\'"]` which, when interpolated into `grep -E "${pattern}" "${file}"`,
// closed the outer double-quote and mangled the shell command. grep errored;
// `|| true` swallowed the error; the runner reported ✓ while the codebase
// contained 36+ real violations (server/feedback.ts:148 et al). Round 2
// converts the rule to a customCheck so the JS regex runs in-process and
// the shell never sees the pattern.

describe('Rule: Raw string literal in broadcastToWorkspace() event arg', () => {
  const RULE = 'Raw string literal in broadcastToWorkspace() event arg';

  it('flags a single-quoted event string', () => {
    const file = write(
      uniqPath('rule-bcast-ws', 'server/trigger-single.ts'),
      lines(
        "import { broadcastToWorkspace } from './broadcast.js';",                 // 1
        "export function notify(wsId: string) {",                                  // 2
        "  broadcastToWorkspace(wsId, 'feedback:new', { id: 1 });",                // 3
        "}",                                                                        // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('flags a double-quoted event string (the Category D bug)', () => {
    const file = write(
      uniqPath('rule-bcast-ws', 'server/trigger-double.ts'),
      lines(
        'import { broadcastToWorkspace } from "./broadcast.js";',                  // 1
        'export function notify(wsId: string) {',                                   // 2
        '  broadcastToWorkspace(wsId, "feedback:new", { id: 1 });',                 // 3
        '}',                                                                         // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('does not flag WS_EVENTS.* constant references', () => {
    const file = write(
      uniqPath('rule-bcast-ws', 'server/negative-constant.ts'),
      lines(
        "import { broadcastToWorkspace } from './broadcast.js';",                  // 1
        "import { WS_EVENTS } from './ws-events.js';",                              // 2
        "export function notify(wsId: string) {",                                   // 3
        "  broadcastToWorkspace(wsId, WS_EVENTS.FEEDBACK_NEW, { id: 1 });",         // 4
        "}",                                                                         // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects inline // ws-event-ok hatch on the broadcast line', () => {
    const file = write(
      uniqPath('rule-bcast-ws', 'server/hatch-inline.ts'),
      lines(
        "import { broadcastToWorkspace } from './broadcast.js';",                                // 1
        "export function notify(wsId: string) {",                                                 // 2
        "  broadcastToWorkspace(wsId, 'feedback:new', { id: 1 }); // ws-event-ok",                // 3
        "}",                                                                                       // 4
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // ws-event-ok on the line immediately above (multi-line calls)', () => {
    // Multi-line broadcastToWorkspace calls can't fit the hatch inline
    // without breaking syntax. The rule must honour a hatch on the line above.
    const file = write(
      uniqPath('rule-bcast-ws', 'server/hatch-above.ts'),
      lines(
        "import { broadcastToWorkspace } from './broadcast.js';",   // 1
        "export function notify(wsId: string) {",                    // 2
        "  // ws-event-ok — legacy event name, scheduled for rename", // 3
        "  broadcastToWorkspace(wsId, 'feedback:new', { id: 1 });",  // 4
        "}",                                                          // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Raw string literal in broadcast() event arg
// ════════════════════════════════════════════════════════════════════════════
//
// Same Category D shell-quoting bug as the broadcastToWorkspace() rule. The
// pattern `(^|[^a-zA-Z_])broadcast\(\s*[\'"]` also collides with the outer
// double-quoted shell invocation. Converted to customCheck for the same
// reason, and the `(^|[^a-zA-Z_])` exclusion is preserved so private
// wrappers like `_broadcast()` and any future `.broadcast()` method calls
// do not trigger.

describe('Rule: Raw string literal in broadcast() event arg', () => {
  const RULE = 'Raw string literal in broadcast() event arg';

  it('flags standalone broadcast() with a single-quoted event', () => {
    const file = write(
      uniqPath('rule-bcast-global', 'server/trigger-single.ts'),
      lines(
        "import { broadcast } from './broadcast.js';",     // 1
        "export function notify() {",                       // 2
        "  broadcast('workspace:created', { id: 1 });",     // 3
        "}",                                                 // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('flags standalone broadcast() with a double-quoted event', () => {
    const file = write(
      uniqPath('rule-bcast-global', 'server/trigger-double.ts'),
      lines(
        'import { broadcast } from "./broadcast.js";',      // 1
        'export function notify() {',                        // 2
        '  broadcast("workspace:created", { id: 1 });',      // 3
        '}',                                                  // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('does not flag private wrappers like _broadcast()', () => {
    const file = write(
      uniqPath('rule-bcast-global', 'server/private-wrapper.ts'),
      lines(
        "function _broadcast(event: string, data: unknown) {", // 1
        "  _broadcast('admin:raw', data);",                     // 2 ← should NOT trigger (leading underscore)
        "}",                                                     // 3
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag broadcastToWorkspace() calls (different function)', () => {
    const file = write(
      uniqPath('rule-bcast-global', 'server/scoped-variant.ts'),
      lines(
        "import { broadcastToWorkspace } from './broadcast.js';",          // 1
        "export function notify(wsId: string) {",                           // 2
        "  broadcastToWorkspace(wsId, 'feedback:new', { id: 1 });",         // 3
        "}",                                                                 // 4
      )
    );
    // The rule is scoped to standalone `broadcast(` — the `broadcastToWorkspace`
    // rule catches the scoped variant separately.
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag ADMIN_EVENTS.* constant references', () => {
    const file = write(
      uniqPath('rule-bcast-global', 'server/negative-constant.ts'),
      lines(
        "import { broadcast } from './broadcast.js';",                 // 1
        "import { ADMIN_EVENTS } from './ws-events.js';",               // 2
        "export function notify() {",                                    // 3
        "  broadcast(ADMIN_EVENTS.WORKSPACE_CREATED, { id: 1 });",       // 4
        "}",                                                              // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // ws-event-ok inline and on preceding line', () => {
    const inline = write(
      uniqPath('rule-bcast-global', 'server/hatch-inline.ts'),
      lines(
        "import { broadcast } from './broadcast.js';",                            // 1
        "broadcast('workspace:created', { id: 1 }); // ws-event-ok",              // 2
      )
    );
    expect(runRule(RULE, [inline])).toHaveLength(0);

    const above = write(
      uniqPath('rule-bcast-global', 'server/hatch-above.ts'),
      lines(
        "import { broadcast } from './broadcast.js';",                            // 1
        "// ws-event-ok",                                                          // 2
        "broadcast('workspace:created', { id: 1 });",                              // 3
      )
    );
    expect(runRule(RULE, [above])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Raw fetch() in components
// ════════════════════════════════════════════════════════════════════════════
//
// Round 2 Task P1.5. The original rule used a regex pattern
// `(?<![a-zA-Z])fetch\(` — a lookbehind assertion. BSD `grep -E` does not
// support lookbehind; it errored with `repetition-operator operand invalid`
// and the shell's `|| true` swallowed the failure. The runner reported ✓
// while 6 real violations existed in src/components (DropZone, AssetBrowser,
// KeywordStrategy, PostEditor, ContentBriefs, client/ContentTab).
//
// Silent-failure Category B/D hybrid — regex feature unsupported by the
// shell tool. Fix: in-process JS regex, which supports lookbehind natively.

describe('Rule: Raw fetch() in components', () => {
  const RULE = 'Raw fetch() in components';

  it('flags a bare fetch() call inside src/components/', () => {
    const file = write(
      uniqPath('rule-fetch', 'src/components/Trigger.tsx'),
      lines(
        "export async function load() {",                         // 1
        "  const res = await fetch('/api/things');",              // 2
        "  return res.json();",                                   // 3
        "}",                                                      // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].file).toBe(file);
  });

  it('does not flag .fetch() method calls (preceded by a letter)', () => {
    const file = write(
      uniqPath('rule-fetch', 'src/components/DotMethod.tsx'),
      lines(
        "export async function load() {",                         // 1
        "  const res = await client.fetch('/api/things');",       // 2
        "  return res.json();",                                   // 3
        "}",                                                      // 4
      )
    );
    // `.fetch(` is preceded by `t` — the lookbehind excludes it.
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag refetch() calls (preceded by a letter)', () => {
    const file = write(
      uniqPath('rule-fetch', 'src/components/Refetch.tsx'),
      lines(
        "export function Foo({ refetch }: { refetch: () => void }) {", // 1
        "  return <button onClick={() => refetch()}>reload</button>;", // 2
        "}",                                                            // 3
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag fetch() calls outside src/components/ (pathFilter)', () => {
    const file = write(
      uniqPath('rule-fetch', 'src/hooks/useThings.ts'),
      lines(
        "export async function load() {",                         // 1
        "  const res = await fetch('/api/things');",              // 2
        "  return res.json();",                                   // 3
        "}",                                                      // 4
      )
    );
    // The customCheck gates on `/src/components/`; a src/hooks/ file is
    // filtered out even when passed in the file list.
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // fetch-ok inline and on preceding line', () => {
    const inline = write(
      uniqPath('rule-fetch', 'src/components/HatchInline.tsx'),
      lines(
        "export async function load() {",                                    // 1
        "  const res = await fetch('/api/things'); // fetch-ok — FormData", // 2
        "}",                                                                  // 3
      )
    );
    expect(runRule(RULE, [inline])).toHaveLength(0);

    const above = write(
      uniqPath('rule-fetch', 'src/components/HatchAbove.tsx'),
      lines(
        "export async function load() {",                         // 1
        "  // fetch-ok — no api/ helper for FormData uploads",    // 2
        "  const res = await fetch('/api/upload', {",             // 3
        "    method: 'POST', body: formData,",                    // 4
        "  });",                                                  // 5
        "}",                                                      // 6
      )
    );
    expect(runRule(RULE, [above])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Assembled-but-never-rendered slice fields
// ════════════════════════════════════════════════════════════════════════════
//
// Structural difference from the other rule harnesses: this rule's customCheck
// always reads two hardcoded ROOT-relative files (`shared/types/intelligence.ts`
// and `server/workspace-intelligence.ts`). A fixture-based runRule() test would
// bypass the files parameter entirely. Instead, we test the pure helper
// `findUnrenderedSliceFields(typesContent, serverContent, typesPath, serverPath)`
// directly — the customCheck is a thin wrapper that reads from disk and forwards
// to this helper.

describe('Rule: Assembled-but-never-rendered slice fields', () => {
  // Minimal synthetic types file. The helper walks SLICE_FORMATTER_MAP which
  // includes 'SeoContextSlice' → 'formatSeoContextSection'; we provide a
  // matching slice/formatter pair with exactly ONE field that the formatter
  // does not reference. Other slices in the map are absent from the types
  // string and produce "formatter not found" hits — we filter to the
  // SeoContextSlice.widgetCount line for the trigger assertion.

  it('flags a field declared in a Slice type but never referenced in its formatter', () => {
    const typesSrc = lines(
      "export interface SeoContextSlice {", //                         1
      "  brandVoice: string;", //                                       2
      "  widgetCount: number; // unused — silently dropped", //          3
      "}", //                                                           4
    );
    const serverSrc = lines(
      "function formatSeoContextSection(slice: SeoContextSlice) {",
      "  return `Brand voice: ${slice.brandVoice}`;",
      "}",
    );
    const hits = findUnrenderedSliceFields(typesSrc, serverSrc, 'types.ts', 'server.ts');
    // widgetCount is the only unreferenced field on the slice we declared;
    // SeoContextSlice otherwise has fields we don't emit in the types stub,
    // so we expect exactly one hit on the widgetCount line.
    const widgetCountHit = hits.find(h => h.text.includes('widgetCount'));
    expect(widgetCountHit).toBeDefined();
    expect(widgetCountHit?.line).toBe(3);
    expect(widgetCountHit?.file).toBe('types.ts');
  });

  it('does not flag fields the formatter references via dot access', () => {
    const typesSrc = lines(
      "export interface SeoContextSlice {",
      "  brandVoice: string;",
      "  siteHealth: number;",
      "}",
    );
    const serverSrc = lines(
      "function formatSeoContextSection(slice: SeoContextSlice) {",
      "  return [slice.brandVoice, slice.siteHealth].join('\\n');",
      "}",
    );
    const hits = findUnrenderedSliceFields(typesSrc, serverSrc, 'types.ts', 'server.ts');
    expect(hits.some(h => h.text.includes('brandVoice'))).toBe(false);
    expect(hits.some(h => h.text.includes('siteHealth'))).toBe(false);
  });

  it('does not flag fields the formatter references via bracket access', () => {
    const typesSrc = lines(
      "export interface SeoContextSlice {",
      "  brandVoice: string;",
      "}",
    );
    const serverSrc = lines(
      "function formatSeoContextSection(slice: SeoContextSlice) {",
      "  return slice['brandVoice'];",
      "}",
    );
    const hits = findUnrenderedSliceFields(typesSrc, serverSrc, 'types.ts', 'server.ts');
    expect(hits.some(h => h.text.includes('brandVoice'))).toBe(false);
  });

  it('emits a "formatter not found" hit when the format*Section function is missing', () => {
    const typesSrc = lines(
      "export interface SeoContextSlice {",
      "  brandVoice: string;",
      "}",
    );
    // Empty server file — formatSeoContextSection is never declared.
    const serverSrc = '';
    const hits = findUnrenderedSliceFields(typesSrc, serverSrc, 'types.ts', 'server.ts');
    // Empty serverSrc short-circuits the helper to [], confirming we don't
    // blow up on a blank formatter file (the normal diff-mode fast-path).
    expect(hits).toEqual([]);
  });

  it('returns [] when both inputs are empty (diff-mode short-circuit)', () => {
    const hits = findUnrenderedSliceFields('', '', 'types.ts', 'server.ts');
    expect(hits).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: callCreativeAI without json: flag in files that use parseJsonFallback
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: callCreativeAI without json: flag in files that use parseJsonFallback', () => {
  const RULE = 'callCreativeAI without json: flag in files that use parseJsonFallback';

  it('flags a callCreativeAI call that lacks json: in a file that also uses parseJsonFallback', () => {
    const file = write(
      uniqPath('rule-cai-json', 'server/feature.ts'),
      lines(
        "import { callCreativeAI } from './openai-helpers.js';", //             1
        "import { parseJsonFallback } from './db/json-validation.js';", //      2
        "export async function run() {", //                                     3
        "  const out = await callCreativeAI({ prompt: 'hi' });", //             4
        "  return parseJsonFallback(out, {});", //                              5
        "}", //                                                                 6
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
    expect(hits[0].file).toBe(file);
  });

  it('does not flag callCreativeAI when json: is present', () => {
    const file = write(
      uniqPath('rule-cai-json', 'server/with-json.ts'),
      lines(
        "import { callCreativeAI } from './openai-helpers.js';",
        "import { parseJsonFallback } from './db/json-validation.js';",
        "export async function run() {",
        "  const out = await callCreativeAI({ prompt: 'hi', json: true });",
        "  return parseJsonFallback(out, {});",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag callCreativeAI in a file that never uses parseJsonFallback', () => {
    const file = write(
      uniqPath('rule-cai-json', 'server/prose-only.ts'),
      lines(
        "import { callCreativeAI } from './openai-helpers.js';",
        "export async function run() {",
        "  const out = await callCreativeAI({ prompt: 'Write a tagline' });",
        "  return out.trim();",
        "}",
      )
    );
    // Without parseJsonFallback in the same file, the rule does not fire —
    // prose-mode callers are correct to omit `json:`.
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('flags mixed calls (some with json: true, some without)', () => {
    // Only the second call is unsafe — the helper tracks an unsafeCount and
    // flags the file on the FIRST unsafe line.
    const file = write(
      uniqPath('rule-cai-json', 'server/mixed.ts'),
      lines(
        "import { callCreativeAI } from './openai-helpers.js';", //           1
        "import { parseJsonFallback } from './db/json-validation.js';", //    2
        "export async function run() {", //                                   3
        "  const a = await callCreativeAI({ prompt: 'one', json: true });", //4
        "  const b = await callCreativeAI({ prompt: 'two' });", //            5 ← flagged
        "  return [parseJsonFallback(a, {}), parseJsonFallback(b, {})];", //  6
        "}", //                                                               7
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(5);
    expect(hits[0].text).toContain('1 callCreativeAI');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: requireAuth in brand-engine route files (should be requireWorkspaceAccess)
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: requireAuth in brand-engine route files (should be requireWorkspaceAccess)', () => {
  const RULE = 'requireAuth in brand-engine route files (should be requireWorkspaceAccess)';
  // Pick any basename from the canonical set so the test stays in sync if
  // the brand-engine route list changes membership.
  const BASENAME = [...BRAND_ENGINE_ROUTE_BASENAMES][0];

  it('flags requireAuth in a brand-engine route file', () => {
    const file = write(
      uniqPath('rule-req-auth', `server/routes/${BASENAME}`),
      lines(
        "import { requireAuth } from '../auth.js';", //                     1
        "import { Router } from 'express';", //                             2
        "const router = Router();", //                                      3
        "router.get('/api/voice/:id', requireAuth, (req, res) => {});", //  4
        "export default router;", //                                        5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
    expect(hits[0].file).toBe(file);
  });

  it('respects inline // auth-ok hatch on the route line', () => {
    const file = write(
      uniqPath('rule-req-auth', `server/routes/${BASENAME}`),
      lines(
        "import { requireAuth } from '../auth.js';",
        "import { Router } from 'express';",
        "const router = Router();",
        "router.get('/api/voice/:id', requireAuth, (req, res) => {}); // auth-ok",
        "export default router;",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // auth-ok hatch on the line above the router.get call', () => {
    const file = write(
      uniqPath('rule-req-auth', `server/routes/${BASENAME}`),
      lines(
        "import { requireAuth } from '../auth.js';",
        "import { Router } from 'express';",
        "const router = Router();",
        "// auth-ok — intentionally JWT-only",
        "router.get('/api/voice/:id', requireAuth, (req, res) => {});",
        "export default router;",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a non-brand-engine route file that uses requireAuth', () => {
    // Files whose basename is NOT in BRAND_ENGINE_ROUTE_BASENAMES are
    // allowed to use requireAuth — e.g. users.ts and auth.ts are the
    // canonical JWT-auth routes.
    const file = write(
      uniqPath('rule-req-auth', 'server/routes/users.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "import { Router } from 'express';",
        "const router = Router();",
        "router.get('/api/users/me', requireAuth, (req, res) => {});",
        "export default router;",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a brand-engine route file that uses requireWorkspaceAccess', () => {
    const file = write(
      uniqPath('rule-req-auth', `server/routes/${BASENAME}`),
      lines(
        "import { requireWorkspaceAccess } from '../auth.js';",
        "import { Router } from 'express';",
        "const router = Router();",
        "router.get('/api/voice/:workspaceId', requireWorkspaceAccess('workspaceId'), (req, res) => {});",
        "export default router;",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: useEffect external-sync dirty guard against the live prop
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: useEffect external-sync dirty guard against the live prop', () => {
  const RULE = 'useEffect external-sync dirty guard against the live prop';

  it('flags a useEffect whose guard recomputes isDirty against the live prop', () => {
    const file = write(
      uniqPath('rule-sync-prop', 'src/components/EditorCard.tsx'),
      lines(
        "import { useEffect, useState } from 'react';", //                           1
        "export function EditorCard(props: { value: string }) {", //                 2
        "  const [local, setLocal] = useState(props.value);", //                     3
        "  const isDirty = local !== props.value;", //                               4
        "  useEffect(() => {", //                                                    5
        "    if (!isDirty) setLocal(props.value);", //                               6
        "  }, [props.value]);", //                                                   7
        "  return null;", //                                                         8
        "}", //                                                                      9
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(6);
    expect(hits[0].file).toBe(file);
  });

  it('respects inline // sync-ok hatch on the guard line', () => {
    const file = write(
      uniqPath('rule-sync-prop', 'src/components/HatchInline.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",
        "export function EditorCard(props: { value: string }) {",
        "  const [local, setLocal] = useState(props.value);",
        "  const isDirty = local !== props.value;",
        "  useEffect(() => {",
        "    if (!isDirty) setLocal(props.value); // sync-ok",
        "  }, [props.value]);",
        "  return null;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // sync-ok hatch on the line above the guard', () => {
    const file = write(
      uniqPath('rule-sync-prop', 'src/components/HatchAbove.tsx'),
      lines(
        "import { useEffect, useState } from 'react';",
        "export function EditorCard(props: { value: string }) {",
        "  const [local, setLocal] = useState(props.value);",
        "  const isDirty = local !== props.value;",
        "  useEffect(() => {",
        "    // sync-ok — parent never updates after mount",
        "    if (!isDirty) setLocal(props.value);",
        "  }, [props.value]);",
        "  return null;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a useEffect whose dirty flag is tracked via a useRef', () => {
    const file = write(
      uniqPath('rule-sync-prop', 'src/components/RefBased.tsx'),
      lines(
        "import { useEffect, useRef, useState } from 'react';",
        "export function EditorCard(props: { value: string }) {",
        "  const [local, setLocal] = useState(props.value);",
        "  const lastSynced = useRef(props.value);",
        "  const isDirty = local !== lastSynced.current;",
        "  useEffect(() => {",
        "    if (!isDirty) {",
        "      setLocal(props.value);",
        "      lastSynced.current = props.value;",
        "    }",
        "  }, [props.value]);",
        "  return null;",
        "}",
      )
    );
    // The isDirty definition contains `.current` — the rule skips it.
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Constants in sync (STUDIO_NAME, STUDIO_URL)
// ════════════════════════════════════════════════════════════════════════════
//
// Structural difference from the other rule harnesses: this rule's customCheck
// always reads two hardcoded ROOT-relative files (`server/constants.ts` and
// `src/constants.ts`). A fixture-based runRule() test would bypass the files
// parameter entirely. Instead, we test the pure helper
// `compareStudioConstants(serverSrc, frontendSrc, serverPath)` directly — the
// customCheck is a thin wrapper that reads from disk and forwards to this helper.

describe('Rule: Constants in sync (STUDIO_NAME, STUDIO_URL)', () => {
  it('flags a STUDIO_NAME drift between server and frontend constants', () => {
    const serverSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';", //                1
      "export const STUDIO_URL = 'https://hmpsn.studio';", //         2
    );
    const frontendSrc = lines(
      "export const STUDIO_NAME = 'hmpsn-studio';", // different!    1
      "export const STUDIO_URL = 'https://hmpsn.studio';", //         2
    );
    const hits = compareStudioConstants(serverSrc, frontendSrc, 'server/constants.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
    expect(hits[0].file).toBe('server/constants.ts');
    expect(hits[0].text).toContain('STUDIO_NAME');
    expect(hits[0].text).toContain("server='hmpsn.studio'");
    expect(hits[0].text).toContain("frontend='hmpsn-studio'");
  });

  it('flags a STUDIO_URL drift between server and frontend constants', () => {
    const serverSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';", //                1
      "export const STUDIO_URL = 'https://hmpsn.studio';", //         2
    );
    const frontendSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';",
      "export const STUDIO_URL = 'https://staging.hmpsn.studio';", // different!
    );
    const hits = compareStudioConstants(serverSrc, frontendSrc, 'server/constants.ts');
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].text).toContain('STUDIO_URL');
  });

  it('flags both constants when both drift', () => {
    const serverSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';",
      "export const STUDIO_URL = 'https://hmpsn.studio';",
    );
    const frontendSrc = lines(
      "export const STUDIO_NAME = 'hmpsn-studio';",
      "export const STUDIO_URL = 'https://other.studio';",
    );
    const hits = compareStudioConstants(serverSrc, frontendSrc, 'server/constants.ts');
    expect(hits).toHaveLength(2);
    expect(hits.some(h => h.text.includes('STUDIO_NAME'))).toBe(true);
    expect(hits.some(h => h.text.includes('STUDIO_URL'))).toBe(true);
  });

  it('does not flag when both constants match exactly', () => {
    const serverSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';",
      "export const STUDIO_URL = 'https://hmpsn.studio';",
    );
    const frontendSrc = lines(
      "export const STUDIO_NAME = 'hmpsn.studio';",
      "export const STUDIO_URL = 'https://hmpsn.studio';",
    );
    expect(compareStudioConstants(serverSrc, frontendSrc, 'server/constants.ts')).toEqual([]);
  });

  it('returns [] when either input is empty (diff-mode short-circuit)', () => {
    expect(compareStudioConstants('', 'anything', 'server/constants.ts')).toEqual([]);
    expect(compareStudioConstants('anything', '', 'server/constants.ts')).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Admin mutation on client_users missing expectedWorkspaceId param
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Admin mutation on client_users missing expectedWorkspaceId param', () => {
  const RULE = 'Admin mutation on client_users missing expectedWorkspaceId param';

  it('flags an exported `update*` function whose param list omits expectedWorkspaceId', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "import db from './db.js';",                                         // 1
        "export async function updateClientPreferences(id: string, prefs: {}) {", // 2
        "  db.prepare('UPDATE client_users SET prefs = ? WHERE id = ?').run(prefs, id);", // 3
        "}",                                                                 // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].file).toBe(file);
  });

  it('flags a `delete*` function whose multi-line param list omits expectedWorkspaceId', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "import db from './db.js';",                                         // 1
        "export function deleteClientPreference(",                           // 2
        "  id: string,",                                                     // 3
        "  key: string,",                                                    // 4
        ") {",                                                               // 5
        "  db.prepare('DELETE FROM client_user_prefs WHERE id = ?').run(id);", // 6
        "}",                                                                 // 7
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('flags a `change*` function missing the param', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "export async function changeClientRole(id: string, role: string) {", // 1
        "  void id; void role;",                                               // 2
        "}",                                                                   // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('respects inline // ws-authz-ok hatch on the declaration line', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "export async function updateClientPreferences(id: string, prefs: {}) { // ws-authz-ok",
        "  void id; void prefs;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // ws-authz-ok hatch on the line immediately above the declaration', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "// ws-authz-ok — this mutation is global retention, not workspace-scoped",
        "export function deleteExpiredClientSessions(cutoffMs: number) {",
        "  void cutoffMs;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a function whose param list includes expectedWorkspaceId', () => {
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "export async function updateClientUser(",
        "  id: string,",
        "  expectedWorkspaceId: string,",
        "  updates: Partial<{ name: string }>,",
        ") {",
        "  void id; void expectedWorkspaceId; void updates;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag non-mutation functions (no update|delete|change verb prefix)', () => {
    // `recordClientLogin` is a mutation at the DB level but falls outside
    // the verb-prefix set. The rule intentionally whitelists it by
    // convention — login bookkeeping is already workspace-agnostic (the
    // caller has already authenticated the user and only passes the id).
    const file = write(
      uniqPath('rule-ws-authz', 'server/client-users.ts'),
      lines(
        "export function recordClientLogin(id: string) {",
        "  void id;",
        "}",
        "export function listClientUsers(workspaceId: string) {",
        "  void workspaceId;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag functions in files other than server/client-users.ts', () => {
    // Same declaration in a different file must not trip the rule —
    // scope is limited to server/client-users.ts because assertUserInWorkspace
    // lives there and the cross-workspace guard contract is file-local.
    const file = write(
      uniqPath('rule-ws-authz', 'server/unrelated.ts'),
      lines(
        "export async function updateUnrelated(id: string, data: string) {",
        "  void id; void data;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Bare brand-engine read in seo-context.ts (use safeBrandEngineRead)
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Bare brand-engine read in seo-context.ts (use safeBrandEngineRead)', () => {
  const RULE = 'Bare brand-engine read in seo-context.ts (use safeBrandEngineRead)';

  it('flags a bare getVoiceProfile() call', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { getVoiceProfile } from './brand-engine.js';",              // 1
        "export function build(ws: string) {",                               // 2
        "  const profile = getVoiceProfile(ws);",                            // 3
        "  return profile;",                                                 // 4
        "}",                                                                 // 5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
    expect(hits[0].file).toBe(file);
  });

  it('flags a bare listBrandscripts() call', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { listBrandscripts } from './brandscript.js';",
        "export function build(ws: string) {",
        "  const scripts = listBrandscripts(ws);",
        "  return scripts;",
        "}",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('flags a bare listDeliverables() call', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { listDeliverables } from './brand-identity.js';",
        "export function build(ws: string) {",
        "  const d = listDeliverables(ws);",
        "  return d;",
        "}",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it('respects inline // safe-read-ok hatch on the call line', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { getVoiceProfile } from './brand-engine.js';",
        "export function build(ws: string) {",
        "  const profile = getVoiceProfile(ws); // safe-read-ok",
        "  return profile;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // safe-read-ok hatch on the line immediately above the call', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { getVoiceProfile } from './brand-engine.js';",
        "export function build(ws: string) {",
        "  // safe-read-ok — handled by outer try/catch",
        "  const profile = getVoiceProfile(ws);",
        "  return profile;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a call wrapped in safeBrandEngineRead on the same line', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "import { getVoiceProfile } from './brand-engine.js';",
        "export function build(ws: string) {",
        "  const profile = safeBrandEngineRead('build.getVoiceProfile', ws, () => getVoiceProfile(ws), null);",
        "  return profile;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag JSDoc references to the bare function name', () => {
    // A JSDoc continuation line like ` * getVoiceProfile(ws) is called via ...`
    // mentions the function with parens for readability; the rule's JSDoc
    // skip (`^\s*\*`) ensures this is not a false positive.
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "/**",
        " * Build the SEO context.",
        " * Internally calls getVoiceProfile(workspaceId) through safeBrandEngineRead.",
        " */",
        "export function build(ws: string) {",
        "  void ws;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag line comments that reference the function name with parens', () => {
    const file = write(
      uniqPath('rule-safe-read', 'server/seo-context.ts'),
      lines(
        "export function build(ws: string) {",
        "  // NOTE: listDeliverables(ws) wrapped below for test-env schema guard",
        "  void ws;",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag functions in files other than server/seo-context.ts', () => {
    // Route handlers that call these directly are fine — errors at the
    // request boundary become 500s and surface loudly.
    const file = write(
      uniqPath('rule-safe-read', 'server/routes/brand-voice.ts'),
      lines(
        "import { getVoiceProfile } from '../brand-engine.js';",
        "export default function handler(ws: string) {",
        "  return getVoiceProfile(ws);",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Test body has no assertion or explicit failure throw
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Test body has no assertion or explicit failure throw', () => {
  const RULE = 'Test body has no assertion or explicit failure throw';

  it('flags an `it(...)` body with no assertion', () => {
    // The canonical failure mode this rule prevents: a test that calls the
    // function under test, expecting nothing, and passes silently even if
    // the function throws… wait, it wouldn't pass if the function throws.
    // The real failure mode is: the test name CLAIMS regression coverage
    // ("missing workspaceId silently returns") but the body does nothing
    // observable — a regression that removes the early-return won't throw,
    // so the test passes on a broken implementation.
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it } from 'vitest';",                                     // 1
        "it('silently passes', () => {",                                    // 2
        "  doSomething();",                                                 // 3
        "});",                                                              // 4
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
    expect(hits[0].file).toBe(file);
  });

  it('flags a `test(...)` body with no assertion', () => {
    // `test` is jest-compatible alias. Rule must match both.
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { test } from 'vitest';",
        "test('alias works', () => {",
        "  doSomething();",
        "});",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('does not flag a body with an expect() call', () => {
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it, expect } from 'vitest';",
        "it('asserts properly', () => {",
        "  const x = compute();",
        "  expect(x).toBe(42);",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a body that uses .toEqual', () => {
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it, expect } from 'vitest';",
        "it('asserts properly', () => {",
        "  const x = compute();",
        "  expect(x).toEqual({ a: 1 });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a body that uses .rejects', () => {
    // `.rejects` / `.resolves` are assertion-continuation chains. They
    // satisfy the rule even though `expect(` may also be present — we check
    // either separately.
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it, expect } from 'vitest';",
        "it('asserts async error', async () => {",
        "  await expect(compute()).rejects.toThrow('bad');",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a body that uses `throw new Error` as explicit failure', () => {
    // "this branch should be unreachable" is a legitimate pattern. A test
    // that bakes in an unreachable throw is asserting via control flow.
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it } from 'vitest';",
        "it('unreachable branch', () => {",
        "  try { doSomething(); } catch { return; }",
        "  throw new Error('expected doSomething to throw');",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects inline `// no-assertion-ok` hatch on the `it(` line', () => {
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it } from 'vitest';",
        "it('delegates to helper', () => { // no-assertion-ok — walkStatuses asserts internally",
        "  walkStatuses(['a', 'b']);",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects `// no-assertion-ok` hatch on the line above the `it(` opener', () => {
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it } from 'vitest';",
        "// no-assertion-ok — noGarbage() asserts via expect() inside",
        "it('delegates to helper', () => {",
        "  noGarbage('foo');",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag files outside *.test.ts / *.test.tsx', () => {
    // A vitest-style `it()` in a fixture file (non-test) must not trip.
    const file = write(
      uniqPath('rule-no-assertion', 'fixtures/sample.ts'),
      lines(
        "// A non-test file that mentions `it(` in a string or comment",
        "const doc = 'use it() and test() in your suites';",
        "it('fake', () => { doSomething(); });", // still exercises the helper, but file is filtered
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag e2e tests (Playwright actions throw on failure)', () => {
    // Playwright's `expect(page).toHaveURL(...)` is still an assertion, but
    // many e2e tests rely on action throws (`page.click('[data-missing]')`)
    // and have no `expect(` in the body. The rule skips `tests/e2e/`
    // entirely to match that convention.
    const file = write(
      uniqPath('rule-no-assertion', 'tests/e2e/flow.test.ts'),
      lines(
        "import { test } from '@playwright/test';",
        "test('navigates', async ({ page }) => {",
        "  await page.goto('/');",
        "  await page.click('button');",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('handles multiple its in the same file, flagging only the offenders', () => {
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it, expect } from 'vitest';",
        "it('asserts', () => {",
        "  expect(1 + 1).toBe(2);",
        "});",
        "it('does not assert', () => {",
        "  doSomething();",
        "});",
        "it('asserts again', () => {",
        "  expect(2 + 2).toBe(4);",
        "});",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(5);
  });

  it('does not get tripped up by `it(` appearing inside a string literal', () => {
    // Brace-walker tracks quotes so a `{` inside a template literal does
    // not skew depth and the `it(` inside a description string does not
    // get matched as a call.
    const file = write(
      uniqPath('rule-no-assertion', 'fake.test.ts'),
      lines(
        "import { it, expect } from 'vitest';",
        "it('handles `{ foo: bar }` in description', () => {",
        "  const s = `template with {braces}`;",
        "  expect(s).toContain('braces');",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Meta-test: pinned customCheck rule names
// ════════════════════════════════════════════════════════════════════════════
//
// Every rule this harness exercises is looked up by exact name string. A
// silent rename in scripts/pr-check.ts would leave the test throwing
// "Rule not found" but — more worryingly — would let new customCheck rules
// ship with ZERO harness coverage. This meta-test pins the full set of
// customCheck rule names so a reviewer of a new rule has to consciously
// decide whether it needs a harness entry.
//
// Adding a customCheck rule? Add it to EXPECTED_CUSTOM_CHECK_RULES below AND
// write trigger/hatch-inline/hatch-above/negative tests for it.
// Removing a customCheck rule? Delete its describe block AND its entry here.
// ════════════════════════════════════════════════════════════════════════════
// Regression: full-scan pathFilter vs EXCLUDED_DIRS collision
// ════════════════════════════════════════════════════════════════════════════
//
// A rule like `{ pathFilter: 'tests/', pattern: 'expect\\(true\\)' }` must
// scan the `tests/` directory on a full run even though 'tests' is in
// EXCLUDED_DIRS. Two silent-false-negative bugs were fixed here:
//
//   1. checkDirectory passed --exclude-dir="tests" to grep while invoking
//      `grep -r ... tests/`. grep excludes the starting dir when it matches
//      --exclude-dir, so the three `pathFilter: 'tests/'` rules caught zero
//      matches on --all for the entire lifetime of PR A. The fix strips the
//      pathFilter basename from the effective exclude list.
//
//   2. resolveCheckFileList's full-scan walker applied EXCLUDED_DIRS to every
//      file under `tests/` in the same way, producing zero files for any
//      customCheck rule with `pathFilter: 'tests/'` (none exist today, but
//      the bug would silently bite the moment one was added).
//
// Both fixes key off the pathFilter leaf basename. Both branches now behave
// as a proper superset of the diff-only branch (which already had the
// carve-out).

describe('Regression: pathFilter can opt into an EXCLUDED_DIRS directory', () => {
  // Use a synthetic token for the fixture body so this test file does not
  // itself trigger the real `Placeholder test assertion` rule on --all
  // (that rule now correctly scans tests/ after the pathFilter fix).
  const TOKEN = 'SYNTHETIC_PATHFILTER_REGRESSION_TOKEN_XYZ';
  const PATTERN = TOKEN;

  it('checkDirectory finds matches when pathFilter targets an otherwise-excluded dir', () => {
    // Write a fixture under <TMPDIR>/pathfilter-regression/tests/foo.ts —
    // the final path segment must literally be `tests` so grep's
    // --exclude-dir="tests" would normally reject it.
    write('pathfilter-regression/tests/foo.ts', `${TOKEN}\n`);
    const scanDir = path.join(TMPDIR, 'pathfilter-regression', 'tests');
    const fakeCheck: Check = {
      name: '__regression_placeholder__',
      pattern: PATTERN,
      fileGlobs: ['*.ts'],
      pathFilter: 'tests/',
      message: 'test',
      severity: 'error',
    };
    const matches = checkDirectory(scanDir, fakeCheck);
    // Before the fix: matches.length === 0 (grep silently excluded the
    // starting dir). After the fix: the violation is found.
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((m) => m.includes('foo.ts'))).toBe(true);
  });

  it('checkDirectory still honours EXCLUDED_DIRS for unrelated dirs', () => {
    // Sanity: the fix removes ONLY the pathFilter basename from the exclude
    // list. Other EXCLUDED_DIRS (node_modules, dist, etc.) must still be
    // filtered out so a rule with pathFilter:'tests/' doesn't accidentally
    // start scanning vendor code nested underneath tests/.
    write('pathfilter-sanity/tests/node_modules/vendor.ts', `${TOKEN}\n`);
    write('pathfilter-sanity/tests/real.ts', `${TOKEN}\n`);
    const scanDir = path.join(TMPDIR, 'pathfilter-sanity', 'tests');
    const fakeCheck: Check = {
      name: '__regression_placeholder_sanity__',
      pattern: PATTERN,
      fileGlobs: ['*.ts'],
      pathFilter: 'tests/',
      message: 'test',
      severity: 'error',
    };
    const matches = checkDirectory(scanDir, fakeCheck);
    expect(matches.some((m) => m.includes('real.ts'))).toBe(true);
    expect(matches.some((m) => m.includes('node_modules'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// buildWorkspaceScopedTables ALTER TABLE detection (B9 Step 8)
// ════════════════════════════════════════════════════════════════════════════
//
// A table created without `workspace_id` and later altered to add the column
// is workspace-scoped, but the original CREATE TABLE walker missed it. B9
// Step 8 added a second-pass scan for `ALTER TABLE ... ADD COLUMN
// workspace_id ...` statements. These tests pin the contract: the helper
// must include the altered table in its returned set.

describe('buildWorkspaceScopedTables ALTER TABLE workspace_id detection', () => {
  it('includes a table that gains workspace_id via ALTER TABLE ADD COLUMN', () => {
    // Synthetic migrations dir under TMPDIR. The first migration creates a
    // table without workspace_id; the second adds it via ALTER TABLE.
    const dir = path.join(TMPDIR, 'alter-table-fixture-1', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '001_create.sql'),
      'CREATE TABLE projects (\n  id TEXT PRIMARY KEY,\n  name TEXT NOT NULL\n);\n',
      'utf-8',
    );
    writeFileSync(
      path.join(dir, '002_alter.sql'),
      'ALTER TABLE projects ADD COLUMN workspace_id TEXT NOT NULL DEFAULT \'\';\n',
      'utf-8',
    );
    const tables = buildWorkspaceScopedTables(dir);
    expect(tables.has('projects')).toBe(true);
  });

  it('does not falsely include tables that have an unrelated ALTER TABLE', () => {
    const dir = path.join(TMPDIR, 'alter-table-fixture-2', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '001_create.sql'),
      'CREATE TABLE logs (\n  id TEXT PRIMARY KEY,\n  message TEXT\n);\n',
      'utf-8',
    );
    writeFileSync(
      path.join(dir, '002_alter_unrelated.sql'),
      'ALTER TABLE logs ADD COLUMN level TEXT;\n',
      'utf-8',
    );
    const tables = buildWorkspaceScopedTables(dir);
    expect(tables.has('logs')).toBe(false);
  });

  it('does not falsely match `workspace_id_idx` or other token-prefix collisions', () => {
    // The regex uses \bworkspace_id\b so a column whose name starts with
    // workspace_id (e.g. workspace_id_legacy) would match, but a different
    // identifier like workspace_idx must not.
    const dir = path.join(TMPDIR, 'alter-table-fixture-3', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '001_create.sql'),
      'CREATE TABLE events (\n  id TEXT PRIMARY KEY\n);\n',
      'utf-8',
    );
    writeFileSync(
      path.join(dir, '002_alter_idx.sql'),
      'ALTER TABLE events ADD COLUMN workspace_idx TEXT;\n',
      'utf-8',
    );
    const tables = buildWorkspaceScopedTables(dir);
    expect(tables.has('events')).toBe(false);
  });

  it('still includes tables whose CREATE TABLE block already contains workspace_id', () => {
    // Sanity: the second-pass ALTER TABLE walk must not regress the
    // first-pass CREATE TABLE behaviour.
    const dir = path.join(TMPDIR, 'alter-table-fixture-4', 'migrations');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, '001_create_with_ws.sql'),
      'CREATE TABLE assets (\n  id TEXT PRIMARY KEY,\n  workspace_id TEXT NOT NULL\n);\n',
      'utf-8',
    );
    const tables = buildWorkspaceScopedTables(dir);
    expect(tables.has('assets')).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: TabBar component without ?tab= deep-link support
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: TabBar component without ?tab= deep-link support', () => {
  const RULE = 'TabBar component without ?tab= deep-link support';

  it('flags a component with <TabBar> that does not read searchParams', () => {
    const file = write(
      uniqPath('rule-tabbar', 'src/components/TestTab.tsx'),
      lines(
        "import { TabBar } from './ui/TabBar';",                  // 1
        "export function TestTab() {",                             // 2
        "  const [tab, setTab] = useState('overview');",           // 3
        "  return <TabBar tabs={[]} active={tab} onChange={setTab} />;", // 4
        "}",                                                        // 5
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
  });

  it('does not flag a component that reads searchParams.get("tab")', () => {
    const file = write(
      uniqPath('rule-tabbar', 'src/components/WiredTab.tsx'),
      lines(
        "import { useSearchParams } from 'react-router-dom';",     // 1
        "import { TabBar } from './ui/TabBar';",                    // 2
        "const [searchParams] = useSearchParams();",                // 3
        "const param = searchParams.get('tab');",                   // 4
        "return <TabBar tabs={[]} active={tab} onChange={setTab} />;", // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag a file outside src/components/', () => {
    const file = write(
      uniqPath('rule-tabbar', 'src/pages/TestPage.tsx'),
      lines(
        "import { TabBar } from './ui/TabBar';",                    // 1
        "return <TabBar tabs={[]} active={tab} onChange={setTab} />;", // 2
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects {/* tab-deeplink-ok */} JSX comment on preceding line', () => {
    const file = write(
      uniqPath('rule-tabbar', 'src/components/HatchAbove.tsx'),
      lines(
        "export function HatchTab() {",                              // 1
        "  const [tab, setTab] = useState('overview');",             // 2
        "  return (",                                                 // 3
        "    <div>",                                                  // 4
        "      {/* tab-deeplink-ok — not navigated to via ?tab= */}",// 5
        "      <TabBar tabs={[]} active={tab} onChange={setTab} />", // 6
        "    </div>",                                                 // 7
        "  );",                                                       // 8
        "}",                                                          // 9
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // tab-deeplink-ok JS comment on preceding line', () => {
    const file = write(
      uniqPath('rule-tabbar', 'src/components/HatchJS.tsx'),
      lines(
        "export function HatchTab() {",                              // 1
        "  const [tab, setTab] = useState('overview');",             // 2
        "  // tab-deeplink-ok — not navigated to via ?tab=",         // 3
        "  return <TabBar tabs={[]} active={tab} onChange={setTab} />;", // 4
        "}",                                                          // 5
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: seo-context.ts import restriction (deprecated module)
// ════════════════════════════════════════════════════════════════════════════
//
// Prevents new imports of the deprecated seo-context.ts module. Existing
// callers are grandfathered via the exclude list. New code must use
// buildWorkspaceIntelligence() + formatForPrompt() from workspace-intelligence.ts.

describe('Rule: seo-context.ts import restriction (deprecated module)', () => {
  const RULE = 'seo-context.ts import restriction (deprecated module)';

  it('flags a single-quoted import of seo-context', () => {
    const file = write(
      uniqPath('rule-seo-context', 'server/new-feature.ts'),
      lines(
        "import { buildSeoContext } from './seo-context.js';",  // 1
        "export function doStuff() { return buildSeoContext(); }",  // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags a double-quoted import of seo-context', () => {
    const file = write(
      uniqPath('rule-seo-context', 'server/other-feature.ts'),
      lines(
        'import { buildPageAnalysisContext } from "./seo-context.js";',  // 1
        'export function run() { return buildPageAnalysisContext(); }',   // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('respects inline // seo-context-ok hatch on the import line', () => {
    const file = write(
      uniqPath('rule-seo-context', 'server/grandfathered-inline.ts'),
      lines(
        "import { buildSeoContext } from './seo-context.js'; // seo-context-ok",  // 1
        "export function doStuff() { return buildSeoContext(); }",                 // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });

  it('respects // seo-context-ok on the preceding line', () => {
    const file = write(
      uniqPath('rule-seo-context', 'server/grandfathered-above.ts'),
      lines(
        "// seo-context-ok — grandfathered caller awaiting migration",  // 1
        "import { buildSeoContext } from './seo-context.js';",          // 2
        "export function doStuff() { return buildSeoContext(); }",      // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });

  it('does not flag files that do not import seo-context', () => {
    const file = write(
      uniqPath('rule-seo-context', 'server/clean-feature.ts'),
      lines(
        "import { buildWorkspaceIntelligence } from './workspace-intelligence.js';",  // 1
        "export function doStuff() { return buildWorkspaceIntelligence('ws1'); }",    // 2
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: requireAuth usage outside allowed route files
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: requireAuth usage outside allowed route files', () => {
  const RULE = 'requireAuth usage outside allowed route files';

  it('flags requireAuth usage in a non-allowed server route file', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/some-feature.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",                    // 1
        "import { Router } from 'express';",                            // 2
        "const router = Router();",                                     // 3
        "router.get('/api/things', requireAuth, (req, res) => {",       // 4
        "  res.json({ ok: true });",                                    // 5
        "});",                                                          // 6
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
    expect(hits[0].file).toBe(file);
  });

  it('respects inline // auth-ok hatch on the usage line', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/special.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "const router = Router();",
        "router.get('/api/things', requireAuth, handler); // auth-ok",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // auth-ok hatch on the line above', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/special2.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "const router = Router();",
        "// auth-ok — intentionally JWT-only",
        "router.get('/api/things', requireAuth, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag requireAuth in routes/auth.ts (allowed)', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/auth.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "router.get('/api/auth/me', requireAuth, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag requireAuth in routes/users.ts (allowed)', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/users.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "router.get('/api/users', requireAuth, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag brand-engine routes (covered by their own rule)', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/voice-calibration.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "router.get('/api/voice', requireAuth, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag server/auth.ts definition file', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/auth.ts'),
      lines(
        "export function requireAuth(req, res, next) {",
        "  // JWT verification logic",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag import-only lines', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/other.ts'),
      lines(
        "import { requireAuth } from '../auth.js';",
        "// Just importing, not using",
        "const router = Router();",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag comment-only references', () => {
    const file = write(
      uniqPath('rule-requireauth', 'server/routes/client-signals.ts'),
      lines(
        "// Never add requireAuth to admin routes",
        "const router = Router();",
        "router.get('/api/signals', handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Duplicate globally-applied rate limiter in route file
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Duplicate globally-applied rate limiter in route file', () => {
  const RULE = 'Duplicate globally-applied rate limiter in route file';

  it('flags globalPublicLimiter import/usage in a route file', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-content.ts'),
      lines(
        "import { globalPublicLimiter } from '../middleware.js';",       // 1
        "const router = Router();",                                     // 2
        "router.get('/api/public/content', globalPublicLimiter, handler);", // 3
      )
    );
    const hits = runRule(RULE, [file]);
    // Should flag both the import line and the usage line
    // Actually, import lines are flagged too since they indicate intent to use
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].file).toBe(file);
  });

  it('flags publicApiLimiter in a route file', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-api.ts'),
      lines(
        "import { publicApiLimiter } from '../middleware.js';",          // 1
        "const router = Router();",                                     // 2
        "router.get('/api/public/data', publicApiLimiter, handler);",    // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('flags publicWriteLimiter in a route file', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-write.ts'),
      lines(
        "import { publicWriteLimiter } from '../middleware.js';",        // 1
        "const router = Router();",                                     // 2
        "router.post('/api/public/submit', publicWriteLimiter, handler);", // 3
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it('respects inline // limiter-ok hatch', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-special.ts'),
      lines(
        "import { globalPublicLimiter } from '../middleware.js'; // limiter-ok",
        "router.get('/api/public/special', globalPublicLimiter, handler); // limiter-ok",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // limiter-ok hatch on the line above', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-above.ts'),
      lines(
        "// limiter-ok — intentional double-apply",
        "import { globalPublicLimiter } from '../middleware.js';",
        "// limiter-ok",
        "router.get('/api/public/data', globalPublicLimiter, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag route-specific limiters (aiLimiter, loginLimiter, etc.)', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/ai.ts'),
      lines(
        "import { aiLimiter } from '../middleware.js';",
        "const router = Router();",
        "router.post('/api/admin-chat', aiLimiter, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag checkoutLimiter (not globally applied)', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/stripe.ts'),
      lines(
        "import { checkoutLimiter } from '../middleware.js';",
        "router.post('/api/stripe/checkout', checkoutLimiter, handler);",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag comments mentioning globally-applied limiters', () => {
    const file = write(
      uniqPath('rule-limiter', 'server/routes/public-safe.ts'),
      lines(
        "// Do NOT import globalPublicLimiter here — it is applied globally",
        "const router = Router();",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Port collision in integration tests
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Port collision in integration tests', () => {
  const RULE = 'Port collision in integration tests';

  it('flags duplicate port numbers across test files', () => {
    const file1 = write(
      uniqPath('rule-port', 'tests/integration/feature-a.test.ts'),
      lines(
        "import { createTestContext } from '../helpers';",
        "const ctx = createTestContext(19999);",
      )
    );
    const file2 = write(
      uniqPath('rule-port', 'tests/integration/feature-b.test.ts'),
      lines(
        "import { createTestContext } from '../helpers';",
        "const ctx = createTestContext(19999);",
      )
    );
    const hits = runRule(RULE, [file1, file2]);
    expect(hits).toHaveLength(2); // both files flagged
    expect(hits[0].file).toBe(file1);
    expect(hits[1].file).toBe(file2);
  });

  it('respects inline // port-ok hatch', () => {
    const file1 = write(
      uniqPath('rule-port', 'tests/integration/shared-a.test.ts'),
      lines(
        "const ctx = createTestContext(19998); // port-ok — shared with feature-b",
      )
    );
    const file2 = write(
      uniqPath('rule-port', 'tests/integration/shared-b.test.ts'),
      lines(
        "const ctx = createTestContext(19998); // port-ok — shared with feature-a",
      )
    );
    expect(runRule(RULE, [file1, file2])).toHaveLength(0);
  });

  it('respects // port-ok hatch on line above', () => {
    const file1 = write(
      uniqPath('rule-port', 'tests/integration/above-a.test.ts'),
      lines(
        "// port-ok — intentionally shared",
        "const ctx = createTestContext(19997);",
      )
    );
    const file2 = write(
      uniqPath('rule-port', 'tests/integration/above-b.test.ts'),
      lines(
        "// port-ok",
        "const ctx = createTestContext(19997);",
      )
    );
    expect(runRule(RULE, [file1, file2])).toHaveLength(0);
  });

  it('does not flag unique in-range port numbers', () => {
    const file1 = write(
      uniqPath('rule-port', 'tests/integration/unique-a.test.ts'),
      lines(
        "const ctx = createTestContext(13201);",
      )
    );
    const file2 = write(
      uniqPath('rule-port', 'tests/integration/unique-b.test.ts'),
      lines(
        "const ctx = createTestContext(13202);",
      )
    );
    expect(runRule(RULE, [file1, file2])).toHaveLength(0);
  });

  it('flags a single port outside the documented 13201–13319 range', () => {
    const file = write(
      uniqPath('rule-port', 'tests/integration/out-of-range.test.ts'),
      lines(
        "const ctx = createTestContext(50000);",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('does not flag files without createTestContext', () => {
    const file = write(
      uniqPath('rule-port', 'tests/unit/utils.test.ts'),
      lines(
        "import { describe, it, expect } from 'vitest';",
        "describe('utils', () => { it('works', () => expect(1).toBe(1)); });",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Inline React Query string key (use queryKeys.*)
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Inline React Query string key (use queryKeys.*)', () => {
  const RULE = 'Inline React Query string key (use queryKeys.*)';

  it('flags queryKey with inline string array', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/hooks/useItems.ts'),
      lines(
        "import { useQuery } from '@tanstack/react-query';",
        "export function useItems() {",
        "  return useQuery({",
        "    queryKey: ['items', workspaceId],",         // 4 — flagged
        "    queryFn: () => api.getItems(workspaceId),",
        "  });",
        "}",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(4);
  });

  it('does not flag queryKey using queryKeys.* factory', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/hooks/usePages.ts'),
      lines(
        "import { useQuery } from '@tanstack/react-query';",
        "import { queryKeys } from '../lib/queryKeys';",
        "export function usePages(wsId: string) {",
        "  return useQuery({",
        "    queryKey: queryKeys.pages.list(wsId),",
        "    queryFn: () => api.getPages(wsId),",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag queryKey with spread queryKeys.* pattern', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/hooks/useFiltered.ts'),
      lines(
        "import { useQuery } from '@tanstack/react-query';",
        "import { queryKeys } from '../lib/queryKeys';",
        "export function useFiltered(wsId: string, filter: string) {",
        "  return useQuery({",
        "    queryKey: [...queryKeys.pages.list(wsId), filter],",
        "    queryFn: () => api.getFiltered(wsId, filter),",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects inline // querykey-ok hatch', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/hooks/useSpecial.ts'),
      lines(
        "import { useQuery } from '@tanstack/react-query';",
        "export function useSpecial() {",
        "  return useQuery({",
        "    queryKey: ['special-one-off'], // querykey-ok — intentional one-off",
        "    queryFn: () => api.getSpecial(),",
        "  });",
        "}",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag files outside src/', () => {
    const file = write(
      uniqPath('rule-querykey', 'server/routes/items.ts'),
      lines(
        "const config = { queryKey: ['server-side'] };",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag the queryKeys definition file', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/lib/queryKeys.ts'),
      lines(
        "export const queryKeys = {",
        "  pages: { list: (wsId: string) => ({ queryKey: ['pages', wsId] }) },",
        "};",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag test files', () => {
    const file = write(
      uniqPath('rule-querykey', 'src/hooks/useItems.test.ts'),
      lines(
        "const wrapper = renderHook(() => useQuery({ queryKey: ['test'] }));",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Rule: Missing broadcastToWorkspace after DB write in route handler
// ════════════════════════════════════════════════════════════════════════════

describe('Rule: Missing broadcastToWorkspace after DB write in route handler', () => {
  const RULE = 'Missing broadcastToWorkspace after DB write in route handler';

  it('flags route handler with db.prepare().run but no broadcast', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/items.ts'),
      lines(
        "const router = Router();",
        "router.post('/api/items', (req, res) => {",              // 2 — flagged
        "  db.prepare('INSERT INTO items (name) VALUES (?)').run(req.body.name);",
        "  res.json({ ok: true });",
        "});",
      )
    );
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('does not flag route handler that calls broadcastToWorkspace', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/pages.ts'),
      lines(
        "const router = Router();",
        "router.post('/api/pages', (req, res) => {",
        "  db.prepare('INSERT INTO pages (title) VALUES (?)').run(req.body.title);",
        "  broadcastToWorkspace(req.workspaceId, 'pages:updated');",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag route handler that calls broadcast()', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/settings.ts'),
      lines(
        "const router = Router();",
        "router.put('/api/settings', (req, res) => {",
        "  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(req.body.value, req.body.key);",
        "  broadcast(req.workspaceId, 'settings:changed');",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects inline // broadcast-ok hatch', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/analytics.ts'),
      lines(
        "const router = Router();",
        "// broadcast-ok — analytics writes don't need real-time updates",
        "router.post('/api/analytics/track', (req, res) => {",
        "  db.prepare('INSERT INTO events (type) VALUES (?)').run(req.body.type);",
        "  res.json({ ok: true });",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag GET routes (read-only)', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/readonly.ts'),
      lines(
        "const router = Router();",
        "router.get('/api/items', (req, res) => {",
        "  const items = db.prepare('SELECT * FROM items').all();",
        "  res.json(items);",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag route without db.prepare', () => {
    const file = write(
      uniqPath('rule-broadcast', 'server/routes/proxy.ts'),
      lines(
        "const router = Router();",
        "router.post('/api/proxy', (req, res) => {",
        "  const result = await externalApi.send(req.body);",
        "  res.json(result);",
        "});",
      )
    );
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});

describe('Meta: customCheck rule name registry', () => {
  const EXPECTED_CUSTOM_CHECK_RULES = [
    'Global keydown missing isContentEditable guard',
    'Multi-step DB writes outside db.transaction()',
    'AI call before db.prepare without transaction guard',
    'UPDATE/DELETE missing workspace_id scope',
    'getOrCreate* function returns nullable',
    'Public-portal mutation without addActivity',
    'broadcastToWorkspace inside bridge callback',
    'Layout-driving state set in useEffect',
    'useGlobalAdminEvents import restriction',
    'Raw string literal in broadcastToWorkspace() event arg',
    'Raw string literal in broadcast() event arg',
    'Raw fetch() in components',
    // Migrated from inline blocks (PR #168 scaled-review I17)
    'Assembled-but-never-rendered slice fields',
    'callCreativeAI without json: flag in files that use parseJsonFallback',
    'requireAuth in brand-engine route files (should be requireWorkspaceAccess)',
    'useEffect external-sync dirty guard against the live prop',
    'Constants in sync (STUDIO_NAME, STUDIO_URL)',
    // PR #168 scaled-review follow-ups
    'Admin mutation on client_users missing expectedWorkspaceId param',
    'Bare brand-engine read in seo-context.ts (use safeBrandEngineRead)',
    // 2026-04-11 test audit follow-up
    'Test body has no assertion or explicit failure throw',
    // PR 2 deep-link guard
    'TabBar component without ?tab= deep-link support',
    // IG-4 seo-context deprecation
    'seo-context.ts import restriction (deprecated module)',
    // P0 expansion rules
    'requireAuth usage outside allowed route files',
    'Duplicate globally-applied rate limiter in route file',
    // P1 expansion rules
    'Port collision in integration tests',
    'Inline React Query string key (use queryKeys.*)',
    'Missing broadcastToWorkspace after DB write in route handler',
  ].sort();

  it('the set of customCheck rule names matches the harness exactly', () => {
    const actual = CHECKS
      .filter((c) => typeof c.customCheck === 'function')
      .map((c) => c.name)
      .sort();
    // A mismatch means either: (a) a new customCheck rule was added to
    // scripts/pr-check.ts without a harness entry, or (b) an existing rule
    // was renamed/deleted without updating this registry. Both are
    // regressions — the fix is to update both sides in the same commit.
    expect(actual).toEqual(EXPECTED_CUSTOM_CHECK_RULES);
  });

  // P1.4 load-bearing gate: the hardcoded EXPECTED_CUSTOM_CHECK_RULES list
  // above pins rule names, but it doesn't verify that a `describe('Rule: X',
  // ...)` block actually exists for each one. Without this check, a
  // reviewer could add a rule name to the registry without writing the
  // fixture tests, and the harness would silently pass on an empty
  // expectation. This test reads the test file and grep-matches for a
  // describe heading per customCheck rule, failing with an explicit
  // missing-rule list if any rule lacks coverage.
  it('every customCheck rule has a `describe(\'Rule: <name>\', ...)` block in this file', () => {
    const selfPath = fileURLToPath(import.meta.url);
    const src = readFileSync(selfPath, 'utf-8');
    const customCheckRules = CHECKS
      .filter((c) => typeof c.customCheck === 'function')
      .map((c) => c.name);
    const missing: string[] = [];
    for (const name of customCheckRules) {
      // Match `describe('Rule: <name>'` with either quote style. The
      // single/double quote is an author preference; neither is wrong.
      const singleQ = `describe('Rule: ${name}'`;
      const doubleQ = `describe("Rule: ${name}"`;
      if (!src.includes(singleQ) && !src.includes(doubleQ)) {
        missing.push(name);
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `The following customCheck rules have no fixture describe block:\n  - ${missing.join('\n  - ')}\n\n` +
        `Fix: add \`describe('Rule: <name>', () => { ... })\` in tests/pr-check.test.ts with at least ` +
        `a trigger, a negative, an inline hatch, and an above-line hatch test.`,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// Meta-test: pr-check --all status parity with verified-clean allowlist
// ════════════════════════════════════════════════════════════════════════════
//
// Round 2 Task P1.5. This is the load-bearing gate that catches silent
// rule failures — the four categories enumerated in
// `docs/rules/verified-clean-rules.md`:
//
//   A. file-list — resolveCheckFileList filters out all files before
//      customCheck runs, so the callback sees nothing.
//   B. regex-too-narrow — pattern only matches one quote/letter variant.
//   C. parser-lite — hand-rolled string scan truncates on legal syntax.
//   D. shell-quoting — embedded `"` or lookbehind collides with
//      `grep -E "${pattern}"` and `|| true` swallows the error.
//
// How it works: spawn `npx tsx scripts/pr-check.ts --all` as a subprocess,
// parse each status line (`  ✓ <name>`, `  ⚠ <name>`, `  ✗ <name>`), and
// require that the SET of rules reporting `✓` exactly matches the rows
// in `docs/rules/verified-clean-rules.md`. Any mismatch — a new rule
// silently landing at ✓, or an existing rule dropping from ⚠ to ✓ after
// an inadvertent break — fails the test with an explicit diff.
//
// Why this matters: Round 2 discovered FIVE simultaneous silent-failure
// rules (useGlobalAdminEvents, both broadcast* rules, getOrCreate*, and
// Raw fetch()) that had been reporting ✓ for weeks while the codebase
// carried 50+ real violations. A green CI line is worthless if the
// rules behind it are broken. This test makes "silently broken" as
// noisy as "legitimately clean" — a reviewer has to consciously accept
// every ✓ by adding a row to the allowlist.
//
// Performance: pr-check --all takes ~5s on the full repo. The test has
// a 30s timeout to absorb CI variance.

describe('Meta: pr-check --all status parity with verified-clean allowlist', () => {
  it('every rule reporting ✓ is listed in docs/rules/verified-clean-rules.md', () => {
    // 1. Spawn pr-check --all as a subprocess and capture stdout.
    //    We use execFileSync with the tsx binary directly to avoid
    //    shell interpretation of stdout (which contains box-drawing
    //    characters and ANSI status symbols).
    // vitest rewrites import.meta.url to a `file:///@fs/...` URL that
    // `new URL('..').pathname` cannot decode as a real filesystem path.
    // `fileURLToPath` handles both the native and vite-rewritten forms.
    // Fall back to process.cwd() (the repo root when tests run) if
    // fileURLToPath returns an obviously-wrong path.
    let repoRoot: string;
    try {
      const testFilePath = fileURLToPath(import.meta.url);
      repoRoot = path.resolve(path.dirname(testFilePath), '..');
      if (repoRoot.includes('@fs') || !repoRoot.startsWith('/')) {
        repoRoot = process.cwd();
      }
    } catch {
      repoRoot = process.cwd();
    }
    const tsxBin = path.join(repoRoot, 'node_modules', '.bin', 'tsx');
    let out: string;
    try {
      // Invoke tsx directly via node_modules/.bin — vitest's child
      // environment does not always inherit a PATH that resolves `npx`.
      out = execFileSync(tsxBin, ['scripts/pr-check.ts', '--all'], {
        cwd: repoRoot,
        encoding: 'utf-8',
        timeout: 30_000,
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch (err: unknown) {
      // execFileSync throws on non-zero exit; the subprocess output is
      // still attached to the error object. pr-check exits 1 when errors
      // exist — swallow that; we only care about the status lines in
      // stdout.
      const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number; message?: string };
      out = e.stdout ? e.stdout.toString() : '';
      if (!out.trim()) {
        const stderrStr = e.stderr ? e.stderr.toString() : '';
        throw new Error(
          `pr-check --all produced no stdout.\n` +
          `  status: ${e.status}\n` +
          `  message: ${e.message}\n` +
          `  stderr: ${stderrStr.slice(0, 500)}`,
        );
      }
    }

    if (!out.trim()) {
      throw new Error('pr-check --all produced no stdout — subprocess failed to start?');
    }

    // 2. Parse status lines. Format is `  <symbol> <name>` where symbol
    //    is one of ✓ / ⚠ / ✗. Exclude the summary line
    //    `  ✗ 3 error(s), 14 warning(s). ...` which starts with ✗ but
    //    is not a rule name.
    const cleanRules: string[] = [];
    for (const line of out.split('\n')) {
      const match = line.match(/^\s+([✓⚠✗])\s+(.+?)\s*$/);
      if (!match) continue;
      const [, symbol, name] = match;
      // Skip the summary line — it contains digits immediately after ✗.
      if (/^\d+\s+error/.test(name)) continue;
      if (symbol === '✓') cleanRules.push(name);
    }

    if (cleanRules.length === 0) {
      throw new Error(
        'pr-check --all produced no ✓ status lines. Either the output format changed (update the regex in this test) or every rule is now reporting matches (verify and update the allowlist).',
      );
    }

    // 3. Read the allowlist and extract rule names from the markdown table.
    //    Table format: `| Rule Name | Verified By | Justification |`
    //    We match rows that start with `| ` and skip the header/separator.
    const allowlistPath = path.resolve(repoRoot, 'docs/rules/verified-clean-rules.md');
    let allowlistSrc: string;
    try {
      allowlistSrc = readFileSync(allowlistPath, 'utf-8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to read allowlist at ${allowlistPath}.\n` +
        `  ${msg}\n\n` +
        `This file is the load-bearing gate for pr-check silent-failure detection. ` +
        `If it was deleted or renamed, restore it (see Round 2 Task P1.5) before ` +
        `this test can run.`,
      );
    }
    const allowedRules: string[] = [];
    let inTable = false;
    for (const line of allowlistSrc.split('\n')) {
      // Header row starts the table; stop at next blank after data rows.
      if (/^\|\s*Rule Name\s*\|/.test(line)) { inTable = true; continue; }
      if (/^\|[\s-]+\|[\s-]+\|[\s-]+\|\s*$/.test(line)) continue; // separator
      if (inTable) {
        if (!line.startsWith('|')) { inTable = false; continue; }
        const cells = line.split('|').map(c => c.trim());
        // Expect 5 cells: ['', ruleName, verifiedBy, justification, '']
        if (cells.length >= 4 && cells[1]) allowedRules.push(cells[1]);
      }
    }

    if (allowedRules.length === 0) {
      throw new Error(
        `No rule entries parsed from ${allowlistPath}. Check the table format — expected \`| Rule Name | Verified By | Justification |\` rows.`,
      );
    }

    // 4. Compute the set difference in both directions and fail loudly
    //    if either side has extras.
    const cleanSet = new Set(cleanRules);
    const allowedSet = new Set(allowedRules);

    const unlisted = cleanRules.filter(r => !allowedSet.has(r));
    const stale = allowedRules.filter(r => !cleanSet.has(r));

    const errors: string[] = [];
    if (unlisted.length > 0) {
      errors.push(
        `The following rules report ✓ in pr-check --all but are NOT in ` +
        `docs/rules/verified-clean-rules.md:\n  - ${unlisted.join('\n  - ')}\n\n` +
        `This is the silent-failure gate doing its job. For each rule, either:\n` +
        `  (a) manually verify it's genuinely clean (run its regex against src/, ` +
        `confirm the shell invocation works, spot-check 3 matches on a synthetic ` +
        `trigger), then add a row to docs/rules/verified-clean-rules.md, or\n` +
        `  (b) add a fixture describe block to tests/pr-check.test.ts so a ` +
        `regression in the rule's callback is caught by the harness directly ` +
        `(preferred for customCheck rules).\n\n` +
        `Do NOT add a row to the allowlist without verification. The whole point ` +
        `of this gate is that a ✓ without proof is indistinguishable from a ` +
        `silently-broken rule.`,
      );
    }
    if (stale.length > 0) {
      errors.push(
        `The following rules are listed in docs/rules/verified-clean-rules.md ` +
        `but are NOT currently reporting ✓ (they either moved to ⚠/✗ or were ` +
        `deleted):\n  - ${stale.join('\n  - ')}\n\n` +
        `Remove the stale rows from the allowlist in the same commit as the ` +
        `state change.`,
      );
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n\n─────\n\n'));
    }
  }, 30_000);
});
