# Audit Drift Closure — Plan C: Helper Adoption Sweeps

> Source: Audit artifact [2026-05-27-audit-drift-closure.md](../audits/2026-05-27-audit-drift-closure.md) (four parallel Explore agents + verification pass)
> Sprint: `sprint-platform-health-wave8-audit-drift-closure`
> Platform: Claude/Anthropic
> Scope: Migrate ~150 frontend call sites onto existing or newly-introduced shared helpers, consolidate the server `slugify` + `dedupeBy` family, and lock every sweep with a pr-check rule. Independent of Plans A and B.

## Overview

The audit found that several shared primitives exist but are not adopted (`useToggleSet` 3 sites of ~30; `fmtNum` 78 unmigrated call sites; `scoreColor`/`scoreColorClass` ~15 bypasses) and a few helpers are missing entirely (`formatBytes`, `formatDate`/`formatDateTime`, `daysSince`, `useDebouncedValue`). This plan is mechanical, high call-site count, and ideal for parallel-agent execution with strict file ownership. Each sweep ends with a pr-check rule so adoption cannot regress.

The plan also rolls in the server-side `slugify` consolidation (P1) and the P2/P3 helper tails to avoid context-switching.

## Pre-requisites

- [x] Roadmap items added
- [ ] Branch: `audit-drift-closure-plan-c` cut from latest `staging`
- [x] Audit artifact committed: [docs/superpowers/audits/2026-05-27-audit-drift-closure.md](../audits/2026-05-27-audit-drift-closure.md) — equivalent to a `pre-plan-audit` skill run. Findings cross-verified against the codebase; corrections section records what was overturned. If subagents discover new sites beyond what the artifact lists, they must report `NEEDS_CONTEXT` and not silently expand scope.

## Bounded Context Ownership

| Concern | Owner |
|---|---|
| Number/money/bytes formatting | `src/utils/formatNumbers.ts` |
| Date formatting (new) | `src/utils/formatDates.ts` |
| Score color | `src/components/ui/constants.ts` |
| Set-toggle state | `src/hooks/useToggleSet.ts` |
| Debounce (new) | `src/hooks/useDebouncedValue.ts` |
| Relative time | `src/lib/timeAgo.ts` |
| Server slugify | `server/helpers.ts` (canonical) |
| Server dedupe | `server/utils/collections.ts` (new) |

---

## Task List

### Task 1 — Introduce new shared helpers (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `src/utils/formatNumbers.ts` (add `formatBytes`)
- `src/utils/formatDates.ts` (new — `formatDate`, `formatDateShort`, `formatDateTime`)
- `src/lib/timeAgo.ts` (add `daysSince(iso: string): number`)
- `src/hooks/useDebouncedValue.ts` (new)
- `server/helpers.ts` (add canonical `slugify(value: string, opts?: { keepWhitespace?: boolean }): string`)
- `server/utils/collections.ts` (new — `dedupeBy<T>(items, keyFn): T[]`, `dedupeByNormalizedKeyword(items: KeywordLike[]): KeywordLike[]`, `uniqStrings(values, opts?: { caseInsensitive?: boolean; trim?: boolean }): string[]`)
- Unit tests for each new helper

**Must not touch:** any call site files (Tasks 2–9 handle those).

**Steps:**
1. Author each helper with JSDoc covering edge cases (negative numbers, zero bytes, invalid dates, empty arrays).
2. Unit tests covering: empty input, edge cases, conventional inputs, locale stability.
3. **Crucially:** decide and document the canonical slugify regex. Match `entity-resolution-slice.ts:13` (`[^a-z0-9\s-]`) — this is the safer of the two; entity matching depends on whitespace preservation toggled via opts. Document the choice inline.

**Verification:**
```
npx vitest run tests/unit/format*.test.ts tests/unit/timeago.test.ts tests/unit/use-debounced-value.test.ts tests/unit/collections.test.ts tests/unit/slugify.test.ts
```

---

### Task 2 — Score-color adoption sweep (Platform: Claude/Anthropic; Model: Haiku)

**Owns:** the 15 sites listed below.

- `src/components/AssetAudit.tsx:263`
- `src/components/MetricRing.tsx:21,22`
- `src/components/audit/AuditReportExport.tsx:79,132`
- `src/components/page-intelligence/PageIntelligencePagesHeader.tsx:163-164`
- `src/components/briefs/BriefDetail.tsx:242`
- `src/components/briefs/BriefList.tsx:110`
- `src/components/audit/CwvSummaryCard.tsx:53`
- `src/components/strategy/TopicClusters.tsx:21-22`
- `src/components/WorkspaceOverview.tsx:133`
- `src/components/SiteArchitecture.tsx:342`
- `src/components/TrafficDetail.tsx:477`
- `src/components/ui/AIContextIndicator.tsx:92,98`
- `src/hooks/useChat.ts:250`
- `src/components/PageSpeedPanel.tsx:63` (delete the local `scoreColor` shadow function)

**Must not touch:** `src/components/ui/constants.ts` (canonical home), other helpers.

**Steps:** Replace inline thresholds with `scoreColor(value)`, `scoreColorClass(value)`, or `scoreBgClass(value)` as appropriate. The hex-vs-class choice depends on usage (SVG attr vs Tailwind class). Run `npx tsc -b --noEmit` after each batch of 5 files.

**Then:** add pr-check rule flagging `score >= 80 ?` / `score >= 60 ?` color-string ternaries outside `src/components/ui/constants.ts`.

---

### Task 3 — `fmtNum` adoption sweep + `formatBytes` migration (Platform: Claude/Anthropic; Model: Haiku)

**Owns:**

- `fmtNum` migration (~78 sites): `ContentPerformance.tsx`, `TrafficDetail.tsx`, `SearchDetail.tsx`, `AnomalyAlerts.tsx`, `KeywordStrategy.tsx`, `RankTracker.tsx`, `AIUsageSection.tsx`, `ContentManager.tsx`, `PostEditor.tsx`, `SeoAudit.tsx`, `ChartPointDetail.tsx`, `SettingsPanel.tsx` — all sites in audit citations.
- Local reimplementations: delete `fmtNum` at `WorkspaceHome.tsx:46-47`, delete `fmtTokens` at `AIUsageSection.tsx:70`.
- `formatBytes` migration (3 sites): `AssetBrowser.tsx:40-41`, `AssetAudit.tsx:38-39`, `PageWeight.tsx:35-36`.

**Steps:** Mechanical replace. Visual spot-check each file against the styleguide afterward to catch any number that's intentionally raw (timestamps, IDs).

**Then:** add pr-check rule flagging `.toLocaleString()` on identifiers whose name suggests a count/number (`count`, `total`, `impressions`, `clicks`, `sessions`, `volume`) in files under `src/components/`.

---

### Task 4 — `fmtMoney` + `formatDate`/`formatDateTime` adoption sweep (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**

- `fmtMoney` migration: `client/InsightsEngine.tsx:44`, `client/FixRecommendations.tsx:13`, `client/SeoCart.tsx:8`, `ClientDashboard.tsx:601`.
- `formatDate*` migration (~25 sites): `AdminChat.tsx:249`, `RevenueDashboard.tsx:231`, `ContentManager.tsx:291`, `KeywordStrategy.tsx:315,387`, `PostEditor.tsx:398`, `ContentDecay.tsx:140`, `ContentSubscriptions.tsx:258,307`, `SalesReport.tsx:215`, `ContentBriefs.tsx:482`, `settings/FeaturesTab.tsx:114`, `cms-editor/CmsEditorCollections.tsx:450`, `settings/EeatAssetsTab.tsx:319`, `settings/ClientDashboardTab.tsx:466`, `RequestManager.tsx:394,487`, `WorkspaceOverview.tsx:96`, `ContentCalendar.tsx:68,317`, `RankTracker.tsx:38,133`, `LlmsTxtGenerator.tsx:123`, `SettingsPanel.tsx:360`, `SchemaSuggester.tsx:373`, `SiteArchitecture.tsx:306`, `PendingApprovals.tsx:121`.

**Steps:** This task needs more judgment than #2–3 (some sites format dates in two parts, some interleave date + relative-time). Use Sonnet, not Haiku. Pick the right helper variant per call site (`formatDate` for "Jun 12, 2026"; `formatDateShort` for "Jun 12"; `formatDateTime` for "Jun 12, 2026 3:24 PM").

**Then:** add pr-check rule flagging raw `new Date(*).toLocaleDateString(` or `Intl.NumberFormat(*, { style: 'currency' })` outside `src/utils/formatDates.ts` and `src/utils/formatNumbers.ts`.

---

### Task 5 — `useToggleSet` adoption sweep (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:** the ~30 sites from the audit (full list captured in roadmap item `audit-drift-use-toggle-set-adoption`).

**Steps:** Replace `useState<Set<X>>(new Set())` + matching add/delete callbacks with `useToggleSet(defaults, opts?)`. The hook signature already supports `{ min, max }` constraints — use them where the existing logic enforces such constraints (cms-editor, useHealthTabShell).

**Risk:** some sites use the `Set` with custom semantics (e.g. clear-on-tab-change). Audit each migration; if a site's behavior diverges from `useToggleSet`'s API, leave it and report.

**Then:** add pr-check rule flagging `useState<Set<` in `src/components/` and `src/hooks/`.

---

### Task 6 — Server slugify + dedupeBy migration (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**
- `server/intelligence/entity-resolution-slice.ts:13` (delete local `slugify`, import canonical)
- `server/mcp/tools/keyword-actions.ts:49` (delete local `slugify`, import canonical)
- `server/cannibalization-issues.ts:131`, `server/keyword-gaps.ts:74`, `server/topic-clusters.ts:102`, `server/keyword-strategy-sanitizer.ts:103`, `server/keyword-recommendations.ts:137` (replace local dedupe with `dedupeByNormalizedKeyword` / `dedupeBy`)
- `server/keyword-strategy-ux.ts:85`, `server/schema/data-sources.ts:255`, `server/webflow-seo-rewrite-utils.ts:36`, `server/schema-suggester.ts:223` (replace `uniq*` variants with `uniqStrings(values, opts)`)

**Risk:** the two `slugify` regexes produce different output. Run the existing fixture tests for entity resolution and keyword actions; if any change shape, that's a fixture update task. Document any regression in the PR description.

**Then:** add pr-check rule flagging `function slugify(` or `const slugify =` outside `server/helpers.ts`.

---

### Task 7 — P2 helper consolidation tail (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**

- Migrate 4 custom relative-time formatters onto `src/lib/timeAgo.ts`: `LlmsTxtGenerator.tsx:25-27`, `WorkspaceHome.tsx:207`, `client/Briefing/WinsSurface.tsx:30-37` (delete `relativeTime` local), `admin/MeetingBrief/BriefHeader.tsx:10` (delete `formatRelativeTime` local).
- Move status→badge ternaries into `<Badge>`/`<StatusBadge>` props or `lib/copyStatusConfig.ts`: `PendingApprovals.tsx:186`, `RankTracker.tsx:507`, `ContentBriefs.tsx:479`, `cms-editor/CmsEditorShellPanels.tsx:163-164`, `brand/BatchGenerationPanel.tsx:98`, `workspace-home/SeoWorkStatus.tsx:40,46`.
- Collapse `sanitizeForPrompt` duplicates: delete the local in `server/briefing-prompt.ts:169`, route through `server/helpers.ts:278,294`.
- Add typed shape in `shared/types/schema-suggester.ts` for `matchedPage`/`meta`. Replace the 8+ `(matchedPage as Record<string, unknown>)` casts in `server/schema-suggester.ts:692-876` with the typed interface.
- **Lock `callAI()` adoption.** All ~50 server-side AI sites already route through `server/ai.ts:callAI()`; zero direct `callOpenAI`/`callAnthropic` callers exist outside the dispatcher. Two cleanups to make the convention durable: (1) delete the stale comment at `server/copy-generation.ts:116` (`// Parse response — callAnthropic returns { text, ... }`) — the actual call at line 106 already uses `callAI()`. (2) Add a pr-check rule blocking new `import { callOpenAI } from .*openai-helpers` or `import { callAnthropic } from .*anthropic-helpers` outside `server/ai.ts` and the helper files themselves. Allow inline hatch `// direct-ai-helper-ok: <reason>` for any future justified exception. This converts a now-true invariant into an enforced one.

> **Originally proposed item rescoped:** the audit agent flagged `server/copy-generation.ts:116` as a direct `callAnthropic` caller and we initially dropped the migration entirely based on the (then-stale) CLAUDE.md note permitting direct `callAnthropic` for creative prose. Re-verification showed (a) line 116 is a stale comment, not a call — the actual call at line 106 already uses `callAI()`; (b) the CLAUDE.md note itself was stale and has been updated; (c) the unified dispatcher is already fully adopted. The rescoped item above turns "fully adopted" into "fully enforced" instead.

---

### Task 8 — P3 residual consolidation (Platform: Claude/Anthropic; Model: Sonnet)

**Owns:**

- Retire `server/db/json-column.ts:parseJsonColumn` in favor of `server/db/json-validation.ts:parseJsonFallback`. Migrate any callers, delete the module.
- Collapse `titleCaseWord` (`server/insight-enrichment.ts:37`), `capitalize` (`server/schema/data-sources.ts:146`), `capitalizeSlugSegment` (`server/schema/data-sources.ts:324`) into one `capitalizeWord` in `server/helpers.ts`.
- Collapse `compact()` siblings in `server/keyword-strategy-context.ts:36` and `server/keyword-strategy-ux.ts:85` into `server/keyword-strategy-utils.ts` (new or existing).
- Migrate inline `setTimeout` debounces (`KeywordCommandCenter.tsx:116-131`, `useAutoSave.ts`, `ui/overlay/Tooltip.tsx:110`) onto `useDebouncedValue` from Task 1. Note `useAutoSave` may keep its own implementation if shared-timer contract differs — audit before migrating.
- Add `daysSince(iso)` callers: `schema/SchemaPageCard.tsx:95`, `client/Briefing/WinsSurface.tsx:32`.
- Parity-fix `quickWins` shape: `public-content.ts:216-221` should return the same fields the admin route does (or, if that's privacy-sensitive, document the deliberate omission and add a pr-check rule preventing accidental field bypasses).
- Promote `sleep(ms)` to `server/helpers.ts` from `server/local-seo.ts:156`.

---

### Task 9 — Final pr-check rule sync + verification (Platform: Claude/Anthropic; Model: Opus)

**Owns:**
- `scripts/pr-check.ts` (audit all rules added in Tasks 2–8 are present, consistent, and tested)
- `docs/rules/automated-rules.md` (regenerate)
- `tests/unit/pr-check-adoption-rules.test.ts` (new fixture-based test for each rule added)

**Steps:**
1. Confirm every adoption sweep has a paired pr-check rule.
2. For each rule, add a positive fixture (matches rule) and negative fixture (matches but with hatch comment) to the test file.
3. Run `npm run rules:generate`; commit the regenerated file.
4. Run `npm run pr-check:all` (covers unchanged files too) and ensure zero violations remain.

**Verification:**
```
npm run pr-check:all
npx vitest run tests/unit/pr-check-adoption-rules.test.ts
```

---

## Task Dependencies

```
Task 1 (helpers) → all other tasks (they import from it)

Parallel after Task 1:
  Task 2 (score color)  ∥  Task 3 (fmtNum)  ∥  Task 4 (money+date)  ∥
  Task 5 (useToggleSet) ∥  Task 6 (server slugify/dedupe)

Sequential tail:
  Task 7 (P2 tail)
  Task 8 (P3 tail)
  Task 9 (pr-check sync + verify)
```

## File Ownership Conflicts

- `src/components/WorkspaceOverview.tsx` is touched by Task 2 (line 133), Task 4 (line 96), Task 5 (none). Resolve by giving Task 4 strict ownership and having Task 2 rebase, or merge the two edits sequentially within the same task batch.
- `src/components/RankTracker.tsx` touched by Tasks 3, 4, 7 — same resolution.
- `src/components/KeywordStrategy.tsx` touched by Tasks 3 and 4.

**Recommendation:** when dispatching subagents in parallel, run a quick `git diff --name-only $(git merge-base HEAD staging) HEAD` across batches to surface multi-touched files and serialize them.

## Systemic Improvements

**Shared utilities to extract (Task 1):**
- `formatBytes`, `formatDate`, `formatDateShort`, `formatDateTime`, `daysSince`
- `useDebouncedValue`
- canonical `slugify`, `dedupeBy`, `dedupeByNormalizedKeyword`, `uniqStrings`

**pr-check rules to add:** at minimum one per adoption sweep (Tasks 2, 3, 4, 5, 6). Task 9 enforces.

**New tests required:**
- Unit tests for every new helper in Task 1
- pr-check rule fixture tests in Task 9
- No new integration tests — this plan is behavior-preserving

**Feature-class gates:** Behavior-preserving refactor — applies the [refactor / migration](../../workflows/feature-class-definition-of-done.md) gate, which is lighter than the feature gate (no new flag, no FEATURE_AUDIT entry, no roadmap-shipped narrative).

## Verification Strategy

- After each task batch, run `npm run typecheck && npx vite build && npx vitest run` before dispatching the next batch.
- Visual diff check on staging for the top 3 most-touched components (`ContentPerformance`, `TrafficDetail`, `KeywordStrategy`) — confirm formatted numbers, dates, and money render identically.
- `npm run pr-check:all` at the end of Task 9 — every adopted call site must satisfy the matching rule.
- DOM-probe screenshot of `WorkspaceOverview` and `ClientDashboard` overview cards to confirm no number/date regressions.
