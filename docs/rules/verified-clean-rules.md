# Verified-Clean pr-check Rules

> Load-bearing allowlist of rules in `scripts/pr-check.ts` that currently
> report `✓` (zero matches) on a full-repo scan. Enforced by the
> `pr-check --all status parity with allowlist` meta-test in
> `tests/pr-check.test.ts`. See Round 2 Task P1.5 of the
> `2026-04-10-pr-check-audit-and-backfill` plan for the motivation.

---

## Why this file exists

A rule in `scripts/pr-check.ts` can silently fail in four ways:

1. **Category A (file-list)** — `resolveCheckFileList` applies a filter that
   excludes all files before `customCheck` runs, so the callback sees an
   empty array and returns zero hits.
2. **Category B (regex-too-narrow)** — the regex only matches one variant
   (e.g. single quotes) while real violations use the other (double
   quotes).
3. **Category C (parser-lite)** — a hand-rolled string scan (`search(/[{=]/)`,
   brace counting without depth tracking) truncates on a perfectly legal
   syntactic construct.
4. **Category D (shell-quoting)** — a regex with an embedded `"` or a
   lookbehind/lookahead collides with the outer `grep -E "${pattern}"`
   shell invocation. `grep` errors, `|| true` swallows it, the runner
   reports `✓`.

A `✓` in `pr-check --all` output means one of:

- the rule is genuinely finding zero violations (codebase is clean), or
- the rule is silently broken.

This file pins the first case. Every entry is a rule that has been
**manually spot-checked** to confirm its pattern is reachable, its shell
invocation runs without error, and its `✓` reflects a genuinely-clean
codebase.

If a rule moves from `⚠`/`✗` back to `✓` after a backfill, add it here in
the same commit. If a new rule lands at `✓` on day one, either backfill a
fixture that forces a positive match (preferred) or add it here with an
explicit justification.

---

## How to add a rule to this file

1. Run `npx tsx scripts/pr-check.ts --all` and confirm the rule reports `✓`.
2. Run the rule's regex manually against the repo to confirm the shell
   invocation succeeds (no `grep: repetition-operator operand invalid`,
   no `sh: syntax error near unexpected token`, no exit-code-2 errors).
   For customCheck rules, confirm the callback is reachable on a
   representative file (write a minimal trigger and pass it via a
   fixture test).
3. Add an entry to the table below with: rule name (exact), verification
   method (`regex-shell`, `regex-manual`, `customCheck-fixture`,
   `backfill-complete`), and a one-line justification.
4. The P1.5 meta-test will fail until your entry matches the rule name
   exactly — that failure is the gate doing its job.

---

## Allowlist

| Rule Name | Verified By | Justification |
|-----------|-------------|---------------|
| Purple in client components | regex-shell | Simple literal `purple-`; grep succeeds; zero hits in `src/components/client/` confirmed. |
| Forbidden hues (violet/indigo) in components | regex-shell | Pattern `(violet-\|indigo-)`; grep succeeds; zero hits in `src/components/` confirmed via manual grep. |
| Bare JSON.parse on server | regex-shell | Pattern `JSON\.parse\(`; pathFilter `server/`; 22 exclusions for legitimate non-DB parse sites; zero remaining hits confirmed via manual grep. |
| Hard-coded studio name | regex-shell | Pattern `hmpsn[ .]studio`; two excludes (`server/constants.ts`, `src/constants.ts`); three excludeLines for SVG alt text; `tests/` dir in EXCLUDED_DIRS so test fixtures don't count; zero hits in scanned dirs. |
| formatBrandVoiceForPrompt reintroduction | regex-manual | Pattern `\bformatBrandVoiceForPrompt\b`; verified both directions: (a) `grep -rn --include='*.ts' --include='*.tsx' -E '\bformatBrandVoiceForPrompt\b' server/ src/` returns zero hits (the function was deleted in PR #168); (b) regex matches the synthetic trigger `const x = formatBrandVoiceForPrompt("test");`. Excludes cover `tests/` (legitimate "this was deleted" comments), `.codesight/` (auto-generated), and `scripts/pr-check.ts` (the rule itself references the name in its error message). Do-not-reintroduce rule; the only way this flips from ✓ to a match is if someone re-adds the helper, which is exactly what we want to block. |
| Unguarded recordAction() call | regex-shell | Pattern `recordAction\s*\(\s*\{`; pathFilter `server/`; `server/outcome-tracking.ts` excluded as the definition site; zero remaining hits confirmed via manual grep. |
| Local prepared statement caching | regex-shell | Literal `let stmt`; grep succeeds; zero hits outside `server/db/`. |
| z.array(z.unknown()) on server | regex-shell | Fully-escaped literal `z\.array\(z\.unknown\(\)\)`; exclude list `server/db/json-validation.ts`; grep succeeds. |
| Bare SUM() without COALESCE in db.prepare | regex-shell | Pattern `(^\|[^(])SUM\(`; standard alternation; grep succeeds; zero hits outside `server/`. |
| as any on dynamic import results | regex-shell | Pattern `(\([a-z]+:\s*any\)\|as any[);,.])`; standard alternation with char class; grep succeeds. |
| Hardcoded dark hex in inline styles | regex-shell | Pattern `style=\{[^}]*(#0f1219\|...)`; brace char class; grep succeeds; only Styleguide.tsx (excluded) would match. |
| SVG with hardcoded dark fill/stroke | regex-shell | Pattern contains `\"` inside outer shell double-quotes; manually confirmed shell escape works (returns 3 Styleguide.tsx matches, all excluded). **Fragile — prefer customCheck if edited.** |
| Direct listPages() outside workspace-data | regex-shell | Literal function name; grep succeeds; workspace-data.ts and webflow-pages.ts are excluded as the only legitimate call sites. |
| Direct buildSeoContext() call | regex-shell | Literal function name; grep succeeds. |
| buildWorkspaceIntelligence() without slices (assembles all 8 slices) | regex-shell | Literal function name; grep succeeds. |
| formatForPrompt with inline sections literal (use buildIntelPrompt or sections: slices) | regex-shell | Literal function name with nested match; grep succeeds. |
| Placeholder test assertion — expect(true).toBe(true) | regex-shell | Fully-escaped literal; grep succeeds; `tests/` pathFilter correctly opted in after the EXCLUDED_DIRS fix. |
| Bare JSON.parse on DB row column | regex-shell | Literal `JSON\.parse\(row\.`; grep succeeds; json-validation.ts and migrate-json.ts are excluded. |
| Unguarded SET status = ? (state machine transition) | regex-shell | Pattern `SET\s+(status\|batch_status)\s*=\s*[?@]`; standard alternation; grep succeeds. |
| Raw bulk_lookup string outside keywords type file | regex-shell | Literal `'bulk_lookup'`; grep succeeds. |
| Raw ai_estimate string in server files | regex-shell | Literal `'ai_estimate'`; grep succeeds. |
| replaceAllPageKeywords called outside keyword-strategy route | regex-shell | Literal function name; grep succeeds. |
| getBacklinksOverview called outside workspace-intelligence | regex-shell | Literal function name; grep succeeds. |
| Silent bare catch in workspace-intelligence assemblers | regex-shell | Pattern `\} catch \{$`; end-anchor; grep succeeds. |
| useGlobalAdminEvents import restriction | customCheck-fixture | P1.1 Round 2 fix — converted to customCheck with dual-quote regex and inline+above-line hatch. 6 fixture tests cover all paths. |
| getOrCreate* function returns nullable | customCheck-fixture | P1.2 Round 2 fix — depth-tracked `findReturnRegionEnd()` walker replaced fragile `.search(/[{=]/)`. 11 fixture tests cover object-literal, Promise, Array, arrow, intersection, and non-null return shapes. |
| Record<string, unknown> in shared/types | regex-shell | Pattern `Record<string,\s*unknown>`; grep succeeds. |
| PATCH spread without nested merge | regex-shell | Pattern `\.\.\.(existing\|current),\s*\.\.\.req\.body([^.\w]\|$)`; standard alternation; grep succeeds. |
| Assembled-but-never-rendered slice fields | customCheck-fixture | PR #168 I17 migration from inline block. Pure helper `findUnrenderedSliceFields()` extracted so the harness can exercise it without monkeypatching ROOT. 5 describe tests cover trigger (widgetCount unreferenced), dot-access negative, bracket-access negative, missing-formatter short-circuit, and empty-input short-circuit. |
| callCreativeAI without json: flag in files that use parseJsonFallback | customCheck-fixture | PR #168 I17 migration from inline block. customCheck walks each `callCreativeAI(` call and flags any whose argument block lacks `json:` in files that also use `parseJsonFallback`. 4 describe tests cover trigger, `json: true` negative, no-`parseJsonFallback` negative, and mixed (some safe, one unsafe) trigger. |
| requireAuth in brand-engine route files (should be requireWorkspaceAccess) | customCheck-fixture | PR #168 I17 migration from inline block. Basename-matched against `BRAND_ENGINE_ROUTE_BASENAMES` (6 brand-engine route filenames) for harness testability. Regex is `\brequireAuth\b` with import-line and JSDoc-line exclusions. 5 describe tests cover trigger, inline `// auth-ok` hatch, above-line `// auth-ok` hatch, non-brand-engine route negative, and `requireWorkspaceAccess` negative. |
| useEffect external-sync dirty guard against the live prop | customCheck-fixture | PR #168 I17 migration from inline block. customCheck walks every useEffect body, finds `if (!isDirty) setX(...)` guards, and flags when `isDirty` is defined against the live prop (not a useRef). Uses `hasHatch()` so both inline and above-line `// sync-ok` comments suppress. 4 describe tests cover trigger, inline hatch, above-line hatch, and ref-based negative. |
| Constants in sync (STUDIO_NAME, STUDIO_URL) | customCheck-fixture | PR #168 I17 migration from inline block. Pure helper `compareStudioConstants()` extracted so the harness can exercise it without monkeypatching ROOT. 5 describe tests cover STUDIO_NAME drift, STUDIO_URL drift, both-drift, both-match negative, and empty-input short-circuit. |
| Source-sniffing in tests (readFileSync on .ts/.tsx source) | backfill-complete | 37 violations hatched in B4 backfill task; tab-deep-link contract test adds 4 more (all inline readFile-ok hatches). Rule reports ✓ on full-repo scan. |
| Untyped dynamic import (missing import type) | backfill-complete | 44 violations fixed in B6 backfill task: `import type * as ModName` added at file top for each imported module; `: typeof ModName` annotation added at each `await import()`; `// dynamic-import-ok` comment on every typed line; sharp module typed via `import type { default as SharpConstructor } from 'sharp'`. Rule now reports ✓ on full-repo scan. |
| UPDATE/DELETE missing workspace_id scope | backfill-complete | 39 violations fixed in B8 backfill task. Default fix threaded `workspaceId` through callers and added `AND workspace_id = ?` to UPDATE/DELETE WHERE clauses (defence-in-depth multi-tenancy). UUID-unique row IDs (`randomUUID()`, `crypto.randomBytes(32)`) and global retention sweeps (`cleanupOldSends`, `pruneOldest`, `deleteExpiredTokens`, etc.) hatched with `// ws-scope-ok` and an inline justification comment. Rule now reports ✓ on full-repo scan. |
| Vacuous .every() in tests (no length guard) | backfill-complete | 91 violations fixed in B5 backfill task. Default fix wrapped each `arr.every(predicate)` in `arr.length > 0 && arr.every(predicate)` so the assertion fails on an empty array instead of vacuously passing. One `// every-ok` hatch in `tests/integration/client-signals-routes.test.ts:57` where vacuous-truthy is intentional. Rule now reports ✓ on full-repo scan. |
| Public-portal mutation without addActivity | customCheck-fixture | B9 polish surfaced a single false-positive: the onboarding handler at `server/routes/public-portal.ts:83` calls `addActivity()` 101 lines below its `router.post(...)` opener. The rule's `PUBLIC_PORTAL_ROUTE_BODY_LOOKAHEAD` was 60 lines, silently truncating the scan window before reaching the call. B9 bumped the constant to 250 lines (defensive cap; routes in the wild range 5–110 lines). 4 fixture tests in tests/pr-check.test.ts cover trigger, inline hatch, above-line hatch, and addActivity-present negative. The rule's `pathFilter` was also removed in the same B9 polish: the customCheck self-filters via an explicit `endsWith('public-portal.ts')` guard, so the rule is no longer dependent on the file-list pipeline (Category A immunity). |
| broadcastToWorkspace inside bridge callback | backfill-complete | 4 violations fixed in B9b backfill task. (1) `server/reports.ts:206` Bridge #12 (audit-page-health) and `:243` Bridge #15 (audit-site-health): both rewritten to return `{ modified }` from the async callback so `executeBridge()` auto-broadcasts `INSIGHT_BRIDGE_UPDATED` via the bridge-infrastructure auto-dispatch path; inline `broadcastToWorkspace()` removed; unused `WsEvents`/`Broadcast` type imports cleaned up. (2) `server/outcome-tracking.ts:189` Bridge #13 (action-annotation) and `server/routes/content-decay.ts:48` Bridge #2 (decay-suggested-brief): both hatched with `// bridge-broadcast-ok` because they dispatch domain-specific events (`ANNOTATION_BRIDGE_CREATED`, `SUGGESTED_BRIEF_UPDATED`) with custom payloads that the auto-dispatch path can't carry — the auto path always emits `INSIGHT_BRIDGE_UPDATED` with a `{ bridge }` body, but these handlers need richer payloads (`date`, `label`, `count`). The inline broadcasts are intentional and correct. Rule now reports ✓ on full-repo scan. |
| Global keydown missing isContentEditable guard | backfill-complete | 2 violations fixed in B9b backfill task. (1) `src/components/CommandPalette.tsx:106` hatched with `// keydown-ok` and a 12-line rationale comment block: the Cmd/Ctrl+K toggle must fire from input fields (Slack/Linear/Notion convention), and the Escape branch is gated on `open === true` with focus captured by the modal's own input — adding the standard `isContentEditable` guard would break both behaviours. (2) `src/components/NotificationBell.tsx:23` fixed with the canonical guard pattern (`HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | isContentEditable` early-return) since the drawer can be opened via mouse click while focus is still in an unrelated input elsewhere. Rule now reports ✓ on full-repo scan. |
| Multi-step DB writes outside db.transaction() | backfill-complete | 2 violations fixed in B9b backfill task. (1) `server/routes/keyword-strategy.ts:2018` strategy-history INSERT + prune-DELETE wrapped in `db.transaction(() => { ... })` to make the save atomic; without it, an INSERT that succeeds followed by a DELETE that fails would leave the table over-quota and corrupt history ordering on the next generation. The narrowing of `ws.keywordStrategy` was hoisted into a local `previousStrategy` const so the closure preserves the type narrowing across the transaction boundary. (2) `server/routes/public-portal.ts:592` content_gap_votes if/else (DELETE for clear, INSERT/UPDATE for set) wrapped in a single `db.transaction(() => { ... })` — even though the two branches are mutually exclusive (only one runs per request), the transaction adds defence-in-depth so any future expansion of either branch (e.g. an audit-log INSERT) inherits atomicity automatically. Rule now reports ✓ on full-repo scan. |
| AI call before db.prepare without transaction guard | backfill-complete | 1 violation hatched in B9b backfill task. `server/voice-calibration.ts:264` `generateCalibrationVariations()` flagged because it `await`s `callCreativeAI()` and then runs `stmts().insertSession.run(...)`. Hatched with `// ai-race-ok` plus a 6-line rationale comment: this handler is provably single-writer per request — each call generates a fresh `cal_<randomUUID>` primary key AFTER the AI returns, with no existence check beforehand. Two concurrent requests create two distinct sessions (different random IDs), so there is no shared natural-key INSERT to race on. Sessions are intentionally append-only per call. Rule now reports ✓ on full-repo scan. |
| Admin mutation on client_users missing expectedWorkspaceId param | customCheck-fixture | Post-PR #168 scaled-review cleanup (2026-04-11). customCheck walks `export function update*\|delete*\|change*` declarations in `server/client-users.ts`, parses the multi-line param list with paren-depth + string-literal tracking (`PARAM_LIST_MAX_SPAN = 20`), and flags any signature missing `\bexpectedWorkspaceId\b`. Hatch is `// ws-authz-ok` on the declaration line or the line immediately above. 8 fixture tests in tests/pr-check.test.ts cover: single-line trigger, multi-line trigger, `change*` verb trigger, inline hatch, above-line hatch, multi-line negative with the param present, non-mutation verb (`recordClientLogin`) negative, and out-of-scope file negative. Rule already ✓ at ship time — the 3 existing mutations (`updateClientUser`, `changeClientPassword`, `deleteClientUser`) all carry the param from PR #168 commit 293485d; this rule exists to catch a future mutation function added without the guard. |
| Inline voice-profile authority check (use isVoiceProfileAuthoritative helper) | regex-manual | Post-PR #168 scaled-review cleanup (2026-04-11). Pattern `voiceProfileBlock\.length`; verified manually that `grep -rn --include='*.ts' -E 'voiceProfileBlock\.length' server/` returns exactly one hit — `server/seo-context.ts:115`, the helper body itself — which is suppressed by a `// voice-authority-ok` comment placed on the same line with the justification "helper body is the canonical authority site". Do-not-reintroduce rule scoped to `server/seo-context.ts`; the only way this flips from ✓ to a match is if someone re-inlines the authority check at a new call site, which is exactly what we want to block. The `isVoiceProfileAuthoritative(profile, voiceProfileBlock)` helper in the same file encodes the full `hasExplicitConfig` gate that the shadow-mode copy had drifted away from. |
| Bare brand-engine read in seo-context.ts (use safeBrandEngineRead) | customCheck-fixture | Post-PR #168 scaled-review cleanup (2026-04-11). customCheck scans `server/seo-context.ts` for `\b(getVoiceProfile\|listBrandscripts\|listDeliverables)\s*\(` calls, skipping imports (`^\s*import\b`), JSDoc lines (`^\s*\*`), and line comments (`^\s*\/\/`). A call is treated as wrapped when `safeBrandEngineRead(` appears earlier on the SAME line as the match — a deliberate single-line-only check that forces cross-line layouts to hatch. Hatch is `// safe-read-ok` on the call line or the line immediately above. 9 fixture tests cover: `getVoiceProfile` trigger, `listBrandscripts` trigger, `listDeliverables` trigger, inline hatch, above-line hatch, wrapped negative (safeBrandEngineRead on same line), JSDoc negative, line-comment negative, and out-of-scope file negative. The 6 real call sites (lines 215, 272, 337, 596, 650, 701 in server/seo-context.ts) all use the wrapper as of PR #168 commit 3c8a6cd plus the 2 follow-up wraps added in this commit (lines 331 shadow-mode and 650 fallback). |
| Test body has no assertion or explicit failure throw | customCheck-fixture | 2026-04-11 test audit stop-gap. customCheck first masks string literals, line/block comments, and template literal contents (preserving `${...}` interpolations) via a position-preserving `maskNonCode()` helper so line numbers stay aligned with the raw file for error reporting. It then regex-matches `(^|[^\w.$])(it\|test)\s*\(` on the masked content, brace-walks each matching test body (up to `}` at depth 0), and checks for any of 23 assertion tokens: `expect(`, `assert(`, `.toBe`, `.toEqual`, `.toMatch`, `.toThrow`, `.toHaveLength`, `.toContain`, `.toHaveBeenCalled`, `.toHaveProperty`, `.toBeDefined`, `.toBeUndefined`, `.toBeNull`, `.toBeTruthy`, `.toBeFalsy`, `.toBeGreaterThan`, `.toBeLessThan`, `.toBeInstanceOf`, `.rejects`, `.resolves`, `throw new Error`, `throw new TypeError`, `throw new RangeError`. Scoped to `*.test.ts` / `*.test.tsx`; `/e2e/` paths are excluded because Playwright action-throws (`page.click`) replace explicit assertions. A `(i === 0 \|\| src[i-1] !== '\\')` guard on both `//` and `/*` comment detection prevents regex literals like `/\/assets\//` (used by `mockWebflowSuccess()` in `webflow-id-semantics.test.ts`) from being mis-parsed as line comments — the bug that caused 4 false positives during rule development. Hatch is `// no-assertion-ok` on the `it(` line or the line immediately above, with a one-line rationale naming the helper the body delegates to. 12 fixture tests cover: `it(...)` trigger, `test(...)` trigger, expect() negative, .toEqual negative, .rejects negative, `throw new Error` negative, inline hatch, above-line hatch, non-test file filter, Playwright e2e exclusion, multi-`it` partial flagging, and the string-literal masking regression. 13 real helper-delegation sites hatched in the same commit: 6 in `tests/unit/format-edge-cases.test.ts` delegating to `noGarbage()` (3 `expect().not.toMatch(...)` per call) and 7 in `tests/integration/content-lifecycle.test.ts` delegating to `walkStatuses()` (4 `expect(...)` per transition step). Catches the silent-pass class that the 2026-04-11 test audit found in 3 stripe webhook/config test bodies. |
| requireAuth usage outside allowed route files | customCheck-fixture | P0 expansion rule. customCheck scans all `server/**/*.ts` files for `\brequireAuth\b` usage, skipping imports, comments, and function definitions. Allowed basenames (`auth.ts`, `users.ts`) and brand-engine route basenames (covered by their own dedicated rule) are excluded. Hatch is `// auth-ok` on the flagged line or the line immediately above. 8 fixture tests in tests/pr-check.test.ts cover: trigger in non-allowed route, inline hatch, above-line hatch, routes/auth.ts negative, routes/users.ts negative, brand-engine route negative, server/auth.ts definition negative, import-only negative, and comment-only negative. Currently clean — only `routes/auth.ts` and `routes/users.ts` use `requireAuth`, both on the allowlist. |
| Duplicate globally-applied rate limiter in route file | customCheck-fixture | P0 expansion rule. customCheck scans `server/routes/**/*.ts` files for `\b(globalPublicLimiter\|publicApiLimiter\|publicWriteLimiter)\b` references, skipping comments. These three limiters are applied globally in `server/app.ts` to all `/api/public/` routes; re-applying them in a route file increments the same shared in-memory bucket twice, silently halving the effective rate limit. Hatch is `// limiter-ok` on the flagged line or the line immediately above. 8 fixture tests in tests/pr-check.test.ts cover: globalPublicLimiter trigger, publicApiLimiter trigger, publicWriteLimiter trigger, inline hatch, above-line hatch, aiLimiter negative (not globally applied), checkoutLimiter negative, and comment-only negative. Currently clean — no route file imports any of the three globally-applied limiters. |
| Port collision in integration tests | customCheck-fixture | P1 expansion rule. customCheck collects all `createTestContext(NNNN)` port allocations across every `*.test.ts` file in `tests/`, builds a port→usages map, and flags any port that appears in two or more files. Hatch is `// port-ok` on the `createTestContext()` line or the line immediately above. 5 fixture tests in tests/pr-check.test.ts cover: duplicate port trigger (both files flagged), inline hatch, above-line hatch, unique ports negative, and no-createTestContext negative. Currently clean — every integration test file uses a unique port in the 13201–13319 range. |

**Count: 49 verified-clean rules.**

---

## What "verified by" means

- **regex-shell** — the rule's regex pattern has been manually invoked via
  `grep -rn ... -E "${pattern}" src/` (or the relevant root) and confirmed
  to produce either the expected matches or a clean zero with no shell
  error. This catches Categories B and D (regex too narrow, shell
  quoting).
- **regex-manual** — the regex was run manually in `node -e` or similar
  to confirm it matches at least one synthetic trigger and rejects at
  least one synthetic negative.
- **customCheck-fixture** — the rule has a `describe('Rule: <name>', ...)`
  block in `tests/pr-check.test.ts` with at least trigger, negative, and
  hatch tests. This is the strongest guarantee — a regression in the
  customCheck callback will be caught by the harness, not by silent
  passage through `pr-check --all`.
- **backfill-complete** — the rule was previously `⚠` with real
  violations, the violations have been fixed, and re-running
  `pr-check --all` shows `✓`. Prefer this over manual spot-checks.

When a rule's verification method changes (e.g., a `regex-shell` rule is
converted to `customCheck`), update the row in the same commit as the
refactor.

---

## Removing a rule

If a rule should no longer report `✓` (e.g., a new backfill item surfaces
violations, or the rule is deleted), remove its row from the table
**before** the commit that causes the state change. The meta-test will
otherwise fail with a mismatch error that points at this file.
