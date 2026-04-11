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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { CHECKS, checkDirectory, type Check, type CustomCheckMatch } from '../scripts/pr-check.js';

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
  it('every customCheck rule has a `describe(\'Rule: <name>\', ...)` block in this file', async () => {
    const { readFileSync } = await import('fs');
    const selfPath = new URL(import.meta.url).pathname;
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
