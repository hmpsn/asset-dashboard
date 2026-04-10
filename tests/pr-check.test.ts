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
import { CHECKS, type CustomCheckMatch } from '../scripts/pr-check.js';

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
// File must NOT contain `const effective\w* =` — that's the documented
// correct-pattern escape hatch, and the rule skips any file that has it.
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
});
