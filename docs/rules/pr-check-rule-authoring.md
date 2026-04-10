# PR-Check Rule Authoring Guide

> How to write, tune, and retire rules in `scripts/pr-check.ts`. Companion to `docs/rules/automated-rules.md` (the generated rule reference).

---

## When to write a new rule

A new rule earns its keep when all four of these are true:

1. **The bug has a grep-able symptom.** A pattern in the source code—a function name, a regex fragment, a missing token—distinguishes wrong from right. If the symptom is "the wrong number ends up in the database," that's a test, not a pr-check rule.
2. **The bug cannot be caught by TypeScript.** If `tsc -b` can reject it, make the types stricter instead. Rules are for semantic constraints the compiler cannot see (e.g. "this field must be nonzero before the effect runs," "this string must be a constant, not a literal").
3. **The bug has happened ≥2 times.** One bug is a mistake. Two is a pattern. Rules added after a single incident tend to over-fit and produce false positives on unrelated code.
4. **The CLAUDE.md rule already exists** or you are writing one in the same commit. Every pr-check rule must cite its CLAUDE.md anchor in the `claudeMdRef` field. A rule without a rationale is noise.

If all four are true, write the rule. If any are false, write a test, tighten a type, or extend CLAUDE.md instead.

---

## Regex rule vs customCheck rule

`scripts/pr-check.ts` supports two rule shapes.

### Regex rule (the common case)

```ts
{
  name: 'Human-readable rule name',
  pattern: 'regex escaped for ripgrep',
  fileGlobs: ['*.ts', '*.tsx'],
  pathFilter: 'server/',          // optional — only scan files under this prefix
  exclude: ['server/foo.ts'],     // optional — file-level exclusions
  excludeLines: ['// foo-ok'],    // optional — per-line exclusions (your escape hatch)
  message: 'Why this is wrong and how to fix it',
  severity: 'error' | 'warn',
  rationale: 'One sentence: the bug class this prevents',
  claudeMdRef: '#code-conventions',
}
```

The runner feeds `pattern` to `rg` with the globs, filters out `exclude` and `excludeLines`, and reports the remaining matches. Regex rules run in milliseconds.

**Write a regex rule when:**
- The violation is visible on a single line
- The regex can be tested against 5–10 files and confirmed to have <20% false-positive rate
- The matched token is distinctive (not a bare identifier like `result` or `data`)

### customCheck rule (the fallback)

```ts
{
  name: 'Multi-step DB writes outside db.transaction()',
  fileGlobs: ['*.ts'],
  pathFilter: 'server/',
  severity: 'warn',
  message: 'Multi-step writes must be wrapped in db.transaction().',
  rationale: 'Partial failure leaves inconsistent state.',
  claudeMdRef: '#code-conventions',
  customCheck: (files) => {
    const hits = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf-8');
      // walk the file, find consecutive db.prepare().run() calls,
      // verify they're inside a db.transaction() block
      // ...
      hits.push({ file, line, text });
    }
    return hits;
  },
}
```

The runner calls `customCheck(files)` and uses its output instead of ripgrep. Slower (reads files into memory) but expressive.

**Write a customCheck rule when:**
- The violation requires cross-line context (e.g. "this call, followed within 10 lines by that call")
- The regex is so permissive it would fire on every file
- You need to walk the AST (import `typescript` and use the compiler API)

Do not use customCheck for single-line violations — ripgrep is 10× faster.

---

## False-positive allowlist pattern

Two mechanisms control which matches are reported.

**`exclude: string[]`** — file paths (relative to the project root) to skip entirely. The runner tests each resolved file path against every entry using `file.includes(entry)`, so a partial path like `server/db/migrations` skips every file under that directory. Use `exclude` for well-understood exceptions that apply to an entire file: the definition site of the hook being restricted, a migration directory, or a module that legitimately does the thing the rule prohibits (e.g. `server/db/json-validation.ts` for the bare `JSON.parse` rule).

**`excludeLines: string[]`** — inline comment tokens that suppress a single matched line. If a line contains any string in `excludeLines`, the runner filters it out before reporting. Use `excludeLines` for per-call overrides where the violation is deliberate at that exact site (see the escape hatch convention below).

**Keep `exclude` as short as possible.** Every entry in `exclude` is a blanket bypass — it suppresses all future violations in that file, including ones that haven't been written yet. Prefer `excludeLines` for site-specific overrides. Only add a file to `exclude` when the entire file is a structurally different context that the rule was never intended to cover.

---

## Escape hatch convention: `// <short-name>-ok`

**Every rule must provide an escape hatch.** No exceptions.

The hatch is a line-level comment the author adds to intentionally suppress the rule on a single line:

```ts
// keydown-ok — the handler below only fires on button role='button' with no text input possible
window.addEventListener('keydown', handleEscape);
```

The rule's `excludeLines` field lists the hatch string:

```ts
excludeLines: ['// keydown-ok']
```

### Hatch naming rules

1. **Kebab-case, short form of the rule name**, followed by `-ok`. Examples: `// keydown-ok`, `// txn-ok`, `// ai-race-ok`, `// record-unknown-ok`.
2. **One hatch per rule.** Never share hatches across rules. If a line is simultaneously a keydown exception AND a dynamic-import exception, it needs both comments.
3. **Must be commented with a justification.** The hatch by itself is meaningless without context. PR reviewers should reject any hatch that doesn't explain *why*.
4. **Document the hatch in the rule's `message` field.** The rule's error message must tell the reader which hatch to add:

```ts
message: 'State machine transitions must use validateTransition(). Direct SET status = ? skips the guard. Add // status-ok if this is a non-state-machine column.',
```

### Why escape hatches matter

No rule is perfect. Every rule has cases where the "violation" is deliberate (a test fixture, a migration guard, a legacy integration). Without a hatch, contributors either disable the rule entirely (losing coverage) or work around it with creative refactors (losing readability). The hatch is a pressure valve that lets the rule stay strict while acknowledging reality.

**A rule without a hatch is a rule that will be deleted within 3 months of landing.** Design for the long term.

### Hatch reference table (2026-04-10 audit)

All eleven rules added in the 2026-04-10 audit and their corresponding hatches:

| Rule | Hatch | When to use |
|------|-------|-------------|
| useGlobalAdminEvents import restriction | `// global-events-ok` | Only if the import is to the hook definition itself or a verified global-fanout site |
| Global keydown missing isContentEditable guard | `// keydown-ok` | The handler has been reviewed and does include the isContentEditable guard, or it intentionally does not intercept editing keys |
| Multi-step DB writes outside db.transaction() | `// txn-ok` | The two writes are idempotent or the partial-failure case is explicitly handled |
| AI call before db.prepare without transaction guard | `// ai-race-ok` | The handler is rate-limited to one concurrent request or the DB write is an upsert with ON CONFLICT REPLACE |
| UPDATE/DELETE missing workspace_id scope | `// ws-scope-ok` | Rare admin-cross-workspace bulk operations with explicit authorization |
| getOrCreate* function returns nullable | `// getorcreate-nullable-ok` | The function genuinely needs to return null and throws on fatal errors |
| Record<string, unknown> in shared/types | `// record-unknown-ok` | The type is a discriminated union leaf and a specific type is not yet known |
| PATCH spread without nested merge | `// patch-spread-ok` | The PATCH endpoint operates only on flat (non-nested) JSON columns |
| Public-portal mutation without addActivity | `// activity-ok` | The endpoint is a GET-as-POST or the activity is logged by the caller |
| broadcastToWorkspace inside bridge callback | `// bridge-broadcast-ok` | The broadcast is intentional and the bridge does not return `{ modified: N }` |
| Layout-driving state set in useEffect | `// effect-layout-ok` | The useEffect is not driving layout (data fetch, event listener, animation) |

---

## Severity: warn vs error

| | Warn | Error |
|---|------|-------|
| Blocks CI | No (unless upgraded) | Yes |
| Appears in PR comment | Yes | Yes |
| Can be ignored by reviewer | Reluctantly | No |
| Use for | Fuzzy rules, new rules not yet backfilled, rules with >5% false-positive rate | Proven rules with zero false positives, rules corresponding to data-corrupting bugs |

### Ship new rules at warn

Any rule with matches in the current codebase must ship at `warn` first. Once the backfill is clean and `npx tsx scripts/pr-check.ts --all` reports zero hits, promote to `error` in a follow-up commit.

This is the same rhythm as "gradually typed" TypeScript: strictness is free once you're clean.

### Rules that should stay at warn forever

Some rules are so fuzzy they cannot be error without unacceptable false positives:

- Rules that detect "intent" (e.g. "this useState looks like it should be derived state")
- Rules that scan prose or string content (e.g. "this log message looks like it should be structured")
- Rules with cross-file context where false positives depend on runtime state

These are still valuable—they surface patterns for reviewer attention—but promoting them to error would break CI on legitimate code.

---

## Testing a new rule before commit

Every new rule must be tested against the current codebase before it lands.

### 1. Positive test (must match)

Find or create one file that should trigger the rule, and verify it triggers:

```bash
# Example: testing a new "no toFixed() in rendering code" rule
rg "toFixed\(" src/components/ | head -3
# Open one of the matches, confirm it looks like what you want to catch
```

### 2. Negative test (must not match)

Find one file where the same pattern is deliberate/correct, and verify the rule does NOT trigger (or add it to the exclude list):

```bash
# Example: toFixed() in a currency formatter is deliberate
rg "toFixed\(" src/lib/format-currency.ts
# Add src/lib/format-currency.ts to the rule's exclude list
```

### 3. Full-codebase false-positive check

Run the rule against the entire codebase and count matches:

```bash
# Temporarily set severity: 'error' and run:
npx tsx scripts/pr-check.ts --all 2>&1 | grep -A2 "Your rule name"
```

Interpret the count:

| Matches | Interpretation |
|---------|----------------|
| 0 | Rule doesn't catch anything — is the regex right? Does the pattern actually exist? |
| 1–10 | Small backlog — fix in the same PR as the rule |
| 10–50 | Medium backlog — fix in a follow-up PR before promoting to error |
| 50–200 | Large backlog — ship at warn, plan a dedicated backfill PR |
| 200+ | Refine the regex — false-positive rate is too high |

### 4. Spot-check 3 matches manually

Open 3 random matches in the editor and confirm each is a genuine violation (not a comment, a string literal in a test fixture, a type declaration you didn't intend to catch). If any is a false positive, tighten the regex or add to `exclude`.

---

## Pre-PR checklist for rule authors

Before committing a new rule, verify:

- [ ] Rule has a clear `name`, `message`, `rationale`, and `claudeMdRef`
- [ ] Regex or customCheck tested against ≥10 real files
- [ ] Positive test confirmed: rule triggers on at least one known violation
- [ ] Negative test confirmed: rule does not trigger on at least one deliberate case
- [ ] False-positive rate on `--all` is below 20% (or backfill plan exists)
- [ ] `excludeLines` hatch is defined and documented in the rule's `message`
- [ ] `claudeMdRef` points to an actual anchor in `CLAUDE.md`
- [ ] Severity is `warn` unless the rule has zero matches in the current codebase
- [ ] `npm run typecheck` passes
- [ ] `npm run rules:generate && git diff --exit-code docs/rules/automated-rules.md` passes

---

## Retiring a rule

Rules should be deleted when:

- The underlying bug class can now be caught at compile time (TypeScript got stricter)
- The rule has had >5 hatch additions in the last 6 months (signals the rule is too broad)
- The rule has not caught a real bug in 12 months (signals the pattern is no longer active)
- Refactoring eliminated the entire bug class (e.g. a module was deleted)

To retire a rule:

1. Delete the entry from `CHECKS` in `scripts/pr-check.ts`.
2. Delete its hatch comments (`// <rule>-ok`) from any files that still carry them (`rg '<rule>-ok' .`).
3. Run `npm run rules:generate` to update `docs/rules/automated-rules.md`.
4. Commit with a message explaining why the rule is no longer needed.

---

## The relationship between CLAUDE.md, this doc, and pr-check.ts

```
CLAUDE.md (philosophical, human-readable)
    ↓ rules that can be mechanized
scripts/pr-check.ts (CHECKS array — source of truth for automation)
    ↓ generated at build time
docs/rules/automated-rules.md (machine-readable summary table)
```

- **CLAUDE.md** is the constitutional document. It declares intent and explains the reasoning behind each rule class. Read by humans and agents at session start.
- **`scripts/pr-check.ts`** is the enforcement layer. Every rule CLAUDE.md describes that can be mechanically checked lives here as a `CHECKS` entry.
- **`docs/rules/automated-rules.md`** is the generated reference — a lookup table mapping rule names to severities, scopes, escape hatches, and rationale. Never hand-edited.
- **This file (`pr-check-rule-authoring.md`)** is the how-to for authors adding new rules.

When a CLAUDE.md rule becomes mechanizable, the workflow is:

1. Add the rule to `scripts/pr-check.ts` at `warn` severity
2. Backfill the existing violations in a follow-up PR
3. Promote to `error`
4. Update the CLAUDE.md bullet to say "see automated-rules.md"
5. Re-run `npm run rules:generate` and commit

See `docs/superpowers/plans/2026-04-10-pr-check-audit-and-backfill.md` for the canonical example of this workflow applied at scale.
