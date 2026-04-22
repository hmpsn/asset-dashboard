# pr-check Mechanization — Provider Abstraction + WS Event Discipline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Encode four bug patterns surfaced during PR #218 review cycles as `scripts/pr-check.ts` rules, so the same mistakes trip CI next time instead of a human reviewer.

**Architecture:** Add three new `customCheck` rules + promote one existing pair from `warn` to `error`. Each rule gets a named hatch, a positive + negative test in `tests/pr-check.test.ts`, and a regenerated entry in `docs/rules/automated-rules.md`.

**Tech Stack:** TypeScript, vitest, the existing pr-check harness (`CHECKS[]`, `customCheck`, `hasHatch`, test fixtures via `mkdtempSync`).

---

## Context (why these four)

Patterns extracted from PR #218 review cycles (DataForSEO parity):

1. **Provider abstraction leak** — `server/content-brief.ts:978` and `server/routes/keyword-strategy.ts:1045,1376` had hard-coded "SEMRush" in AI-prompt template literals despite a `providerLabel` helper existing. Reviewer caught it three separate times. Today no rule flags a literal provider name in a prompt.
2. **Partial WS_EVENTS migration** — `server/routes/public-content.ts` used raw `'content-request:update'` / `'content-request:created'` strings. Rule exists at `warn`; 36 legacy violations block the promotion, but 34 of them sit in 3 unchanged files (`server/feedback.ts`, `server/routes/content-posts.ts`, `server/routes/requests.ts`) with constants already defined in `server/ws-events.ts` or trivially addable.
3. **Dead error-string check** — `src/components/strategy/BacklinkProfile.tsx` had `error.includes('SEMRush not configured')` while the server emits `'No SEO data provider configured'`. Drift silently bypassed the user-facing CTA. Today nothing links string literals consumed by `error.includes(...)` in client code to the server source.
4. **`as any` masking fixture drift** — `tests/component/BacklinkProfile-link-types.test.tsx` used `{ ... } as any` for `BacklinkOverview` fixtures, hiding the fact that new fields (`formLinks`, `frameLinks`) never got added to tests. The cast bypasses every compiler check that would otherwise flag interface drift.

All four are grep-able, TypeScript can't see them, and each has happened ≥2× during this PR alone. They earn their keep per `docs/rules/pr-check-rule-authoring.md`.

---

## File Structure

**Modified:**
- `scripts/pr-check.ts` — three new `customCheck` rules, two rule severity upgrades
- `server/ws-events.ts` — add `FEEDBACK_NEW`, `FEEDBACK_UPDATE`, `POST_UPDATED` to `WS_EVENTS`
- `server/feedback.ts` — migrate 3 raw strings → `WS_EVENTS.*`
- `server/routes/content-posts.ts` — migrate 1 raw string → `WS_EVENTS.POST_UPDATED`
- `server/routes/requests.ts` — migrate 7 raw strings → `ADMIN_EVENTS.*` / `WS_EVENTS.REQUEST_CREATED`
- `tests/pr-check.test.ts` — add `describe(...)` blocks for each of the three new rules (trigger / hatch-inline / hatch-above / negative)
- `docs/rules/automated-rules.md` — regenerated via `npm run rules:generate`
- `docs/rules/pr-check-rule-authoring.md` — append three new hatches to the hatch reference table
- `CLAUDE.md` — remove/link-out the provider-abstraction and WS-event bullets that are now mechanized

**Not touched:**
- Any frontend `useWorkspaceEvents` handlers — those already map events by the string value, not the constant
- Any test besides `tests/pr-check.test.ts`

---

## Task Dependencies

```
Task 1 (constants)  ─┐
Task 2 (backfill) ───┼──▶ Task 3 (promote to error)
                     │
Task 4 (provider-literal rule)
Task 5 (error-includes-literal rule)
Task 6 (test-as-any rule)
                     │
Task 7 (hatch table + CLAUDE.md update) ◀── Tasks 3,4,5,6
Task 8 (regenerate automated-rules.md)   ◀── Task 7
Task 9 (pr-check:all + typecheck + vitest) ◀── Task 8
```

Tasks 4, 5, 6 are independent — can parallelize. Tasks 1 + 2 are sequential (Task 2 imports from Task 1). Task 3 depends on Task 2 passing with zero matches.

---

## Task 1: Add missing WS_EVENTS / ADMIN_EVENTS constants

**Files:**
- Modify: `server/ws-events.ts:14-103` (WS_EVENTS block) and `109-120` (ADMIN_EVENTS block)

- [ ] **Step 1: Add three new WS_EVENTS values**

In `server/ws-events.ts`, inside the `WS_EVENTS = { ... } as const` block, add after the "Work orders" group:

```ts
  // Feedback (client → admin)
  FEEDBACK_NEW: 'feedback:new',
  FEEDBACK_UPDATE: 'feedback:update',

  // Content posts
  POST_UPDATED: 'post-updated',
```

- [ ] **Step 2: Verify `ADMIN_EVENTS` already covers all `broadcast()` strings in `server/routes/requests.ts`**

Current `ADMIN_EVENTS` block at lines 109-120 already has `REQUEST_CREATED`, `REQUEST_UPDATED`, `REQUEST_BATCH_CREATED`, `REQUEST_BULK_UPDATED` — no additions needed.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: zero errors. New keys are additive; no consumer regression.

- [ ] **Step 4: Commit**

```bash
git add server/ws-events.ts
git commit -m "feat(ws-events): add FEEDBACK_NEW, FEEDBACK_UPDATE, POST_UPDATED constants"
```

---

## Task 2: Backfill raw broadcast strings in three legacy files

**Files:**
- Modify: `server/feedback.ts` lines 148, 165, 187
- Modify: `server/routes/content-posts.ts` line 401
- Modify: `server/routes/requests.ts` lines 44, 45, 56, 75, 102, 132 (+ any others surfaced by `pr-check --all`)

- [ ] **Step 1: Run pr-check to list every violation**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | awk '/Raw string literal in broadcast/,/^  [⚠✓]/' | grep -E "^      server/" > /tmp/raw-broadcast-hits.txt
cat /tmp/raw-broadcast-hits.txt
```

Capture the exhaustive list — the pr-check summary truncates after 5 per rule.

- [ ] **Step 2: Ensure each affected file imports the constants**

Add at the top of `server/feedback.ts`:

```ts
import { WS_EVENTS } from './ws-events.js';
```

Add at the top of `server/routes/content-posts.ts`:

```ts
import { WS_EVENTS } from '../ws-events.js';
```

Verify `server/routes/requests.ts` imports both `WS_EVENTS` and `ADMIN_EVENTS` (the route file likely imports one but may be missing the other).

- [ ] **Step 3: Migrate `server/feedback.ts`**

Replace:
```ts
broadcastToWorkspace(workspaceId, 'feedback:new', item);
broadcastToWorkspace(workspaceId, 'feedback:update', item);
```
with:
```ts
broadcastToWorkspace(workspaceId, WS_EVENTS.FEEDBACK_NEW, item);
broadcastToWorkspace(workspaceId, WS_EVENTS.FEEDBACK_UPDATE, item);
```

Use `replace_all` on the `:update` variant since it appears twice.

- [ ] **Step 4: Migrate `server/routes/content-posts.ts`**

Replace the single occurrence:
```ts
broadcastToWorkspace(req.params.workspaceId, 'post-updated', { postId: req.params.postId });
```
with:
```ts
broadcastToWorkspace(req.params.workspaceId, WS_EVENTS.POST_UPDATED, { postId: req.params.postId });
```

- [ ] **Step 5: Migrate `server/routes/requests.ts`**

For every remaining line in `/tmp/raw-broadcast-hits.txt` that points at `requests.ts`, swap the raw string for its `ADMIN_EVENTS.*` or `WS_EVENTS.*` constant. Canonical mapping:

| Raw string | Constant |
|---|---|
| `broadcast('request:created', ...)` | `ADMIN_EVENTS.REQUEST_CREATED` |
| `broadcast('request:updated', ...)` | `ADMIN_EVENTS.REQUEST_UPDATED` |
| `broadcast('request:batch_created', ...)` | `ADMIN_EVENTS.REQUEST_BATCH_CREATED` |
| `broadcast('request:bulk_updated', ...)` | `ADMIN_EVENTS.REQUEST_BULK_UPDATED` |
| `broadcastToWorkspace(ws, 'request:created', ...)` | `WS_EVENTS.REQUEST_CREATED` |
| `broadcastToWorkspace(ws, 'request:update', ...)` | `WS_EVENTS.REQUEST_UPDATE` |

- [ ] **Step 6: Run pr-check and typecheck**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -E "Raw string literal in broadcast"
```
Expected: `✓` for both rules (zero matches).

```bash
npm run typecheck && npx vitest run tests/ws-events
```
Expected: zero errors, tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/feedback.ts server/routes/content-posts.ts server/routes/requests.ts
git commit -m "refactor(server): replace raw WS event strings with WS_EVENTS/ADMIN_EVENTS constants"
```

---

## Task 3: Promote the two broadcast-raw-string rules from `warn` to `error`

**Files:**
- Modify: `scripts/pr-check.ts:1037-1080` (WS_EVENTS rule) and `1082-1126` (broadcast rule)

- [ ] **Step 1: Change `severity: 'warn'` to `severity: 'error'` in both rules**

For the rule at lines 1037-1080 (`name: 'Raw string literal in broadcastToWorkspace() event arg'`), change line 1056 from `severity: 'warn',` to `severity: 'error',` and delete the two explanatory comment lines immediately above (`// warn not error: ...` and `// once the Task B12 backfill is done.`).

For the rule at lines 1082-1126 (`name: 'Raw string literal in broadcast() event arg'`), change line 1095 from `severity: 'warn',` to `severity: 'error',`.

- [ ] **Step 2: Verify the upgrade**

```bash
npx tsx scripts/pr-check.ts --all
```
Expected: exit code 0, both rules show `✓` (zero matches).

```bash
# Sanity: introduce a synthetic violation and confirm it fails
echo "broadcastToWorkspace('w', 'test:raw', {});" > /tmp/raw-sanity.ts
npx tsx scripts/pr-check.ts --all 2>&1 | grep -c "test:raw" # should be > 0 if sanity is picked up
rm /tmp/raw-sanity.ts
```

- [ ] **Step 3: Run the pr-check harness**

```bash
npx vitest run tests/pr-check.test.ts
```
Expected: all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts
git commit -m "chore(pr-check): promote raw broadcast string rules from warn to error"
```

---

## Task 4: New rule — provider literal in AI-prompt template without `providerLabel`

**Files:**
- Modify: `scripts/pr-check.ts` — add new rule to `CHECKS[]` array (after the existing broadcast raw-string rules at line 1126)
- Modify: `tests/pr-check.test.ts` — add test block for the new rule

### Rule semantics

- **Scope:** `server/**/*.ts` (exclude `tests/`, `scripts/`, `server/providers/` — the provider modules themselves legitimately use the brand names)
- **Flag:** any line inside a template literal (backtick-delimited string) containing the literal tokens `SEMRush` or `DataForSEO`, unless the surrounding file references `providerLabel` somewhere.
- **Hatch:** `// provider-label-ok` (inline or preceding line)
- **Severity:** `warn` initially. Promote to `error` in a follow-up PR once `--all` reports zero.

### Detection strategy (customCheck)

1. Load the file. Skip if `/providerLabel/.test(content)` — the file already uses the abstraction.
2. Skip if file path matches `/server\/providers\//`.
3. Walk lines. Detect a template-literal context by tracking an `inBacktick` boolean: toggle it at each unescaped `` ` `` (simplistic but sufficient — AI prompts are long multi-line backticks, not inline `${...}` interpolations).
4. If `inBacktick && /(SEMRush|DataForSEO)/.test(line)`, and neither the line nor the one above has `// provider-label-ok`, record a hit.

- [ ] **Step 1: Write the failing test in `tests/pr-check.test.ts`**

Append to the file a new `describe` block. Fixture layout follows the harness convention:

```ts
describe('Rule: Hard-coded provider name in AI prompt', () => {
  const RULE = 'Hard-coded provider name in AI prompt';

  it('flags SEMRush literal inside a backtick prompt', () => {
    const file = write('server/prompt-fixture.ts', lines(
      "const prompt = `",
      "  Analyze SEMRush data for the following keywords:",
      "  ${keywords}",
      "`;",
    ));
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(2);
  });

  it('flags DataForSEO literal inside a backtick prompt', () => {
    const file = write('server/prompt-fixture2.ts', lines(
      "const prompt = `",
      "  DataForSEO returns the following metrics:",
      "`;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(1);
  });

  it('respects // provider-label-ok on the flagged line', () => {
    const file = write('server/prompt-fixture3.ts', lines(
      "const prompt = `",
      "  Analyze SEMRush data for the following keywords: // provider-label-ok",
      "`;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // provider-label-ok on the preceding line', () => {
    const file = write('server/prompt-fixture4.ts', lines(
      "const prompt = `",
      "  // provider-label-ok",
      "  Analyze SEMRush data",
      "`;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag when file uses providerLabel', () => {
    const file = write('server/prompt-fixture5.ts', lines(
      "const providerLabel = context.providerLabel ?? 'SEMRush';",
      "const prompt = `",
      "  ${providerLabel} shows the following data",
      "`;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag SEMRush in a string literal outside backticks', () => {
    const file = write('server/prompt-fixture6.ts', lines(
      "const errorMsg = 'SEMRush not available';",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag files under server/providers/', () => {
    const file = write('server/providers/semrush-provider.ts', lines(
      "const prompt = `Analyze SEMRush data`;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});
```

Run:
```bash
npx vitest run tests/pr-check.test.ts -t "Hard-coded provider name"
```
Expected: FAIL with "Rule not found: Hard-coded provider name in AI prompt".

- [ ] **Step 2: Implement the rule in `scripts/pr-check.ts`**

Add after the broadcast rules (after line 1126):

```ts
  {
    name: 'Hard-coded provider name in AI prompt',
    pattern: '',
    fileGlobs: ['*.ts'],
    pathFilter: 'server/',
    exclude: [
      'server/providers/',
      'tests/',
      'scripts/',
    ],
    excludeLines: ['// provider-label-ok'],
    message:
      'AI-prompt template literals must use ${providerLabel} (from getProviderDisplayName) instead of ' +
      'hard-coded "SEMRush" or "DataForSEO". Literals leak the wrong brand when the feature runs on ' +
      'the other provider. Add // provider-label-ok on the flagged line or the line above if the ' +
      'literal is intentional (e.g. error message naming a specific provider).',
    severity: 'warn',
    rationale:
      'Silent provider-brand drift: a prompt baked with "SEMRush" leaks when the backend is configured ' +
      'to use DataForSEO, confusing the AI and producing incorrect citations.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const providerRe = /(SEMRush|DataForSEO)/;
      for (const file of files) {
        if (!file.endsWith('.ts')) continue;
        if (!file.includes('/server/')) continue;
        if (/\/server\/providers\//.test(file)) continue;
        if (/\/tests\//.test(file) || /\/scripts\//.test(file)) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        if (!providerRe.test(content)) continue;
        // If the file already uses providerLabel, trust it — the abstraction is in play.
        if (/\bproviderLabel\b/.test(content)) continue;
        const lines = content.split('\n');
        let inBacktick = false;
        for (let i = 0; i < lines.length; i++) {
          // Toggle inBacktick at each unescaped backtick.
          // NOTE: ignores the case of ``` in a comment — acceptable for a warn-level rule.
          const ticks = (lines[i].match(/`/g) || []).length;
          // Odd number of ticks on a line flips the state mid-line, but we
          // still want to flag the line if a provider name appears after the
          // opening tick. Simplest: evaluate BEFORE toggling for this line.
          const enteredBacktickThisLine = !inBacktick && ticks > 0;
          if ((inBacktick || enteredBacktickThisLine) && providerRe.test(lines[i])) {
            if (!hasHatch(lines, i, '// provider-label-ok')) {
              hits.push({ file, line: i + 1, text: lines[i].trim() });
            }
          }
          if (ticks % 2 === 1) inBacktick = !inBacktick;
        }
      }
      return hits;
    },
  },
```

- [ ] **Step 3: Verify the test passes**

```bash
npx vitest run tests/pr-check.test.ts -t "Hard-coded provider name"
```
Expected: PASS.

- [ ] **Step 4: Run `pr-check --all` to measure the backlog**

```bash
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A20 "Hard-coded provider name"
```
Expected: small match count. Triage each hit — either migrate to `providerLabel` or add a hatch. If count is > 20, keep rule at `warn` and open a follow-up issue instead of backfilling in this PR.

- [ ] **Step 5: Commit**

```bash
git add scripts/pr-check.ts tests/pr-check.test.ts
git commit -m "feat(pr-check): flag hard-coded provider name in AI prompt templates"
```

---

## Task 5: New rule — frontend `error.includes('literal')` discipline

**Files:**
- Modify: `scripts/pr-check.ts` — add new rule
- Modify: `tests/pr-check.test.ts` — add test block

### Rule semantics

- **Scope:** `src/**/*.ts`, `src/**/*.tsx` (frontend only — Node code doesn't route errors this way)
- **Flag:** any `error.includes('literal')` or `err.message.includes('literal')` where the literal is a string token. Hatch allows legitimate cases (e.g. matching a known HTTP status phrase).
- **Hatch:** `// error-includes-ok` (inline or preceding line)
- **Severity:** `warn`

### Detection strategy

Plain regex catches the common shape without needing backtick tracking:
```
\b(error|err|err\.message|error\.message)\.includes\(\s*['"]
```

- [ ] **Step 1: Write failing test in `tests/pr-check.test.ts`**

```ts
describe('Rule: error.includes with string literal', () => {
  const RULE = 'Frontend error.includes with string literal';

  it('flags error.includes with a string literal', () => {
    const file = write('src/components/SomeComponent.tsx', lines(
      "if (error.includes('SEMRush not configured')) {",
      "  showCta();",
      "}",
    ));
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags err.message.includes', () => {
    const file = write('src/pages/Other.tsx', lines(
      "if (err.message.includes('timeout')) retry();",
    ));
    expect(runRule(RULE, [file])).toHaveLength(1);
  });

  it('respects // error-includes-ok on the flagged line', () => {
    const file = write('src/components/Hatched.tsx', lines(
      "if (error.includes('rate limit')) wait(); // error-includes-ok",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('respects // error-includes-ok on the preceding line', () => {
    const file = write('src/components/HatchedAbove.tsx', lines(
      "// error-includes-ok",
      "if (error.includes('rate limit')) wait();",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag includes with a variable arg', () => {
    const file = write('src/components/VarArg.tsx', lines(
      "if (error.includes(knownMessage)) retry();",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag server code', () => {
    const file = write('server/routes/foo.ts', lines(
      "if (error.includes('whatever')) {}",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});
```

```bash
npx vitest run tests/pr-check.test.ts -t "error.includes"
```
Expected: FAIL.

- [ ] **Step 2: Implement the rule**

Append to `CHECKS[]`:

```ts
  {
    name: 'Frontend error.includes with string literal',
    pattern: '',
    fileGlobs: ['*.ts', '*.tsx'],
    pathFilter: 'src/',
    excludeLines: ['// error-includes-ok'],
    message:
      'Matching an error message via error.includes(\'literal\') drifts silently when the ' +
      'server rewords the message. Either move the literal to a shared constant both sides import, ' +
      'or add // error-includes-ok with a one-line comment explaining why the literal is stable. ' +
      'Hatch accepted on the flagged line or the line immediately above.',
    severity: 'warn',
    rationale:
      'Server→client error-string drift: user-facing CTAs gated on error.includes(\'X\') go dead ' +
      'when the server changes X, and no compiler or test will tell you.',
    claudeMdRef: '#code-conventions',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const re = /\b(?:error|err|err\.message|error\.message)\.includes\(\s*['"]/;
      for (const file of files) {
        if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
        if (!file.includes('/src/')) continue;
        const content = readFileOrEmpty(file);
        if (!content || !content.includes('.includes(')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!re.test(lines[i])) continue;
          if (hasHatch(lines, i, '// error-includes-ok')) continue;
          hits.push({ file, line: i + 1, text: lines[i].trim() });
        }
      }
      return hits;
    },
  },
```

- [ ] **Step 3: Verify test + backlog**

```bash
npx vitest run tests/pr-check.test.ts -t "error.includes"
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A20 "Frontend error.includes"
```

Expected: test passes; backlog listed. Triage and either migrate or hatch. If >20 violations, keep at `warn`.

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts tests/pr-check.test.ts
git commit -m "feat(pr-check): flag frontend error.includes with string literal"
```

---

## Task 6: New rule — `as any` double-cast in test fixtures

**Files:**
- Modify: `scripts/pr-check.ts` — add new rule
- Modify: `tests/pr-check.test.ts` — add test block

### Rule semantics

- **Scope:** `tests/**/*.test.ts`, `tests/**/*.test.tsx`
- **Flag:** any occurrence of `as any as PascalCaseType` or `as unknown as PascalCaseType` — the compound cast used to force-fit an incomplete mock into a typed interface. Also flag trailing `} as any` on its own line inside a test file (the shorthand form).
- **Hatch:** `// mock-cast-ok` (inline or preceding line)
- **Severity:** `warn`

### Detection strategy

Two regexes, both cheap:
```
\bas\s+(?:any|unknown)\s+as\s+[A-Z][A-Za-z0-9_]*
\}\s*as\s+any\s*[;),]
```

- [ ] **Step 1: Write failing test in `tests/pr-check.test.ts`**

```ts
describe('Rule: Test fixture as-any cast to shared type', () => {
  const RULE = 'Test fixture as any cast to shared type';

  it('flags `as any as Foo` compound cast', () => {
    const file = write('tests/component/mock-fixture.test.tsx', lines(
      "const overview = { total: 1 } as any as BacklinkOverview;",
    ));
    const hits = runRule(RULE, [file]);
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it('flags `as unknown as Foo` compound cast', () => {
    const file = write('tests/component/mock-fixture2.test.tsx', lines(
      "const overview = { total: 1 } as unknown as BacklinkOverview;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(1);
  });

  it('flags trailing `} as any;`', () => {
    const file = write('tests/component/mock-fixture3.test.tsx', lines(
      "const overview = {",
      "  total: 1,",
      "} as any;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(1);
  });

  it('respects // mock-cast-ok', () => {
    const file = write('tests/component/mock-fixture4.test.tsx', lines(
      "const overview = { total: 1 } as any as BacklinkOverview; // mock-cast-ok",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag simple `as Foo`', () => {
    const file = write('tests/component/mock-fixture5.test.tsx', lines(
      "const overview = { total: 1, ... } as BacklinkOverview;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });

  it('does not flag non-test files', () => {
    const file = write('src/utils/something.ts', lines(
      "const x = {} as any as Foo;",
    ));
    expect(runRule(RULE, [file])).toHaveLength(0);
  });
});
```

```bash
npx vitest run tests/pr-check.test.ts -t "as-any cast to shared type"
```
Expected: FAIL.

- [ ] **Step 2: Implement the rule**

Append to `CHECKS[]`:

```ts
  {
    name: 'Test fixture as any cast to shared type',
    pattern: '',
    fileGlobs: ['*.test.ts', '*.test.tsx'],
    pathFilter: 'tests/',
    excludeLines: ['// mock-cast-ok'],
    message:
      '`as any as Foo` / `as unknown as Foo` / `} as any` in tests bypasses every compiler check ' +
      'that keeps fixtures in sync with the real interface. When the interface gains a field, the ' +
      'fixture silently lies. Build a real fixture (use the factories in tests/fixtures/) or cast to ' +
      'the interface directly. Add // mock-cast-ok if the escape hatch is genuinely needed.',
    severity: 'warn',
    rationale:
      'Silent fixture drift: `as any` hid missing formLinks/frameLinks fields in BacklinkOverview ' +
      'mocks during PR #218, producing a test that passed while the production code paths it claimed ' +
      'to cover were actually untested.',
    claudeMdRef: '#test-conventions-mandatory-for-feature-work',
    customCheck: (files) => {
      const hits: CustomCheckMatch[] = [];
      const doubleCastRe = /\bas\s+(?:any|unknown)\s+as\s+[A-Z][A-Za-z0-9_]*/;
      const trailingAnyRe = /\}\s*as\s+any\s*[;),]/;
      for (const file of files) {
        if (!file.endsWith('.test.ts') && !file.endsWith('.test.tsx')) continue;
        if (!file.includes('/tests/')) continue;
        const content = readFileOrEmpty(file);
        if (!content) continue;
        if (!content.includes('as any') && !content.includes('as unknown')) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (!doubleCastRe.test(line) && !trailingAnyRe.test(line)) continue;
          if (hasHatch(lines, i, '// mock-cast-ok')) continue;
          hits.push({ file, line: i + 1, text: line.trim() });
        }
      }
      return hits;
    },
  },
```

- [ ] **Step 3: Verify test + backlog**

```bash
npx vitest run tests/pr-check.test.ts -t "as-any cast to shared type"
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A20 "Test fixture as any"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/pr-check.ts tests/pr-check.test.ts
git commit -m "feat(pr-check): flag as-any double-cast in test fixtures"
```

---

## Task 7: Update hatch reference table and CLAUDE.md

**Files:**
- Modify: `docs/rules/pr-check-rule-authoring.md:110-122` (hatch table)
- Modify: `CLAUDE.md` — link out mechanized rules

- [ ] **Step 1: Append three rows to the hatch table**

In `docs/rules/pr-check-rule-authoring.md`, extend the markdown table:

```md
| Hard-coded provider name in AI prompt | `// provider-label-ok` | Literal is intentional (error message about a specific provider, not a prompt) |
| Frontend error.includes with string literal | `// error-includes-ok` | Literal is sourced from a stable HTTP/SDK contract (comment required) |
| Test fixture as any cast to shared type | `// mock-cast-ok` | The escape hatch is genuinely needed (one-off smoke test, not a fixture) |
```

- [ ] **Step 2: Update CLAUDE.md to point at mechanized rules**

Nothing currently in CLAUDE.md enumerates these patterns, but confirm the "Data Flow Rules" section (`broadcast after mutation` bullet) still reads correctly now that the WS raw-string rule is at `error`.

No edit needed unless you find a bullet now fully mechanized — if so, either delete the redundant text or shorten to a pointer to `docs/rules/automated-rules.md`.

- [ ] **Step 3: Commit**

```bash
git add docs/rules/pr-check-rule-authoring.md
git commit -m "docs(rules): document three new pr-check hatches"
```

---

## Task 8: Regenerate `docs/rules/automated-rules.md`

- [ ] **Step 1: Run the generator**

```bash
npm run rules:generate
```

- [ ] **Step 2: Verify diff reflects only intended changes**

```bash
git diff docs/rules/automated-rules.md
```

Expected: three new rule entries added, two rule severities flipped from `warn` to `error`. No unrelated churn.

- [ ] **Step 3: Commit**

```bash
git add docs/rules/automated-rules.md
git commit -m "docs(rules): regenerate automated-rules.md"
```

---

## Task 9: Final verification

- [ ] **Step 1: Full quality gate**

```bash
npm run typecheck
npx vite build
npx vitest run
npx tsx scripts/pr-check.ts --all
```

All four must pass. `pr-check --all` must exit 0 (the two promoted rules must have zero matches; the three new rules may still have matches but only at `warn`).

- [ ] **Step 2: Invoke scaled-code-review skill**

Multiple `customCheck` rules written in parallel — per CLAUDE.md Quality Gates, invoke `scaled-code-review` before merging. Fix Critical/Important issues.

- [ ] **Step 3: Open PR against `staging`**

```bash
gh pr create --base staging --title "pr-check: mechanize provider + WS event + fixture discipline" --body "..."
```

---

## Self-Review Notes

- **Spec coverage:** four rules × (impl + test + hatch + doc) = 16 deliverables, mapped to tasks 1–9.
- **No placeholders:** every code block is concrete; regexes are spelled out; exact file paths and line ranges cited.
- **Type consistency:** new `WS_EVENTS` values follow the existing `UPPER_SNAKE_CASE` naming; new hatch comments follow the `<short-name>-ok` convention; new rule fields match the `Check` type at `scripts/pr-check.ts:211`.
- **Risk callouts:** Task 2 may surface extra violations beyond the 10 visible in the truncated `--all` output. Task 1 `/tmp/raw-broadcast-hits.txt` makes those visible. If Task 4's backlog is large, park the promotion-to-error for a follow-up PR instead of backfilling.
