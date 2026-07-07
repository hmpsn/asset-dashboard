# Wave 2 Build Ticket — Page Rewriter (`rewrite`, Optimization zone)

> **Status:** Cut for Wave 2 dispatch. Analysis + doc only — no code in this PR.
> **Read order (LAW):** `PHASE_A_DECISIONS.md` → `CROSS_SURFACE_CONTRACTS.md` → `BUILD_CONVENTIONS.md` → `surfaces/page-rewriter.json` → this ticket.
> **Surface class:** admin-only (no client route, no tier gate — Phase 0 §Server endpoints, all three routes behind `requireWorkspaceAccess`). AI-heavy (rewrite generation via `callAI` gpt-5.4). Effort **M** (surfaces/page-rewriter.json:367).
> **Reference implementation:** the merged Keywords pilot `src/components/keywords-rebuilt/` (BUILD_CONVENTIONS §7). When this ticket and the pilot disagree, the pilot wins.

---

## 1. ⚠ OWNER DELTAS

**None — all per-surface-dispatch proposedDefaults adopted.**

Every open question on this surface (Q1–Q5 + the block-model newly-found question) has a proposedDefault that is now *pre-ratified* by the AD walk-through: AD-017 resolves Q1/Q2 (export-only parity v1, write spine deferred behind flag), AD-020 resolves the 429 state, AD-010 resolves the block-model/machinery carry-over (T1 carry-over-then-reskin), and Q3/Q4/Q5 defaults are adopted verbatim below. No deviation and no load-bearing unresolved owner question remains.

Two items are recorded here only so no ticket resurrects them as questions — they are **decided, not deltas:**

- **Parity Ledger correction (not a question):** the ledger's `funcs` list claims "Apply back to CMS" for this surface. That function does **not** exist at HEAD (`server/routes/rewrite-chat.ts` performs zero Webflow/CMS writes — verify block, verdict CONFIRMED for sn-page-rewriter-1). AD-017 mandates correcting the over-claim in this surface's first build PR. **Action:** correct the ledger row to reflect export-only egress + push-to-draft-target; do not silently drop it.
- **Save-draft/Publish spine deferral (not a question):** AD-017 + kitNewFeatures (`defer-to-C3-style-followup`) defer #39/#40/#41/#42 behind a flag. Ship export-only v1. See §3 (SB-032/SB-030 defer) and §5 (flag disposition).

---

## 2. Capability checklist

43 capabilities audited (Phase 0: preserved 27, improved 3, new_proposed 5, at_risk 8). Dispositions below. `[carry]` = port machinery + reskin to tokens; `[reskin]` = rebuild on DS primitives; `[defer]` = behind flag / follow-up; `[fix]` = correct a program-level doc.

### Shell / navigation
- [x] **#1 Route `rewrite` + per-workspace remount key** `[carry]` — route survives (`src/routes.ts:12`); mount moves into `REBUILT_SURFACES` (§6). Preserve the per-workspace `key` remount.
- [x] **#2 Two-pane layout (chat left / document right, independent scroll)** `[reskin]` — `PageContainer` + `GroupBlock` two-pane grid (44%/1fr), each pane its own scroll region. Not `SectionCard`-wrapped twice.
- [x] **#3 Focus mode (rail collapse + Esc guard + nav auto-reset)** `[reskin — AppShell focusMode]` — **W0.7 AppShell `focusMode` is on staging (#1488); this surface is its FIRST consumer.** Wire AppShell's controlled `focusMode` / `onFocusModeChange` props for rail collapse + guarded Esc. **Do NOT hand-roll rail-collapse or an Esc handler** (this surface does not modify AppShell — it consumes the frozen prop). Nav-away auto-reset: clear `focusMode` on unmount / route change.
- [x] **#4 Back button → seo-audit, clears pending page URL** `[reskin]` — header back action; exact back-target may shift with new IA (minor design call, not owner-blocking). Keep the escape-hatch-to-audit behavior.
- [x] **#5 `needsSite` nav lock** `[carry]` — locked state via the four-states rule; `navRegistry` `needsSite` flag unchanged.
- [x] **#6 `initialPageUrl` deep-link prop (dead at HEAD)** `[reskin — Q3 carry]` — see §4. Wire the "Rewrite this page" sender from SEO Editor Research mode; receiver reads + validates the param (two-halves contract).

### Page selection & loading
- [x] **#7 Sitemap page combobox (`GET /pages`, `admin-rewrite-pages` key, 5-min staleTime)** `[reskin]` — rebuild as a `SearchField`-based combobox. Query key + staleTime unchanged (`usePageRewriteChatShell.ts:62-64`, `queryKeys.ts:98`).
- [x] **#8 Filter by slug/title + hierarchical indent** `[carry]` — client-side filter logic ports as-is.
- [x] **#9 Paste arbitrary URL load** `[carry]` — http/https detection ports into the new picker.
- [x] **#10 Combobox keyboard nav + ARIA combobox/option semantics** `[reskin — a11y hard floor]` — prototype has NO keyboard model; re-spec on the DS combobox (ArrowUp/Down/Enter/Escape, `role=combobox/option`, roving via `useRovingTabindex` where applicable).
- [x] **#11 Empty-sitemap fallback + no-match state** `[reskin]` — `EmptyState` copy carries ("No sitemap — paste a full URL above").
- [x] **#12 Server page load (`fetchPublicWebText`, 15s timeout, 50k html cap)** — **backend untouched** (`rewrite-chat.ts:175-214`). UI must not touch this contract.
- [x] **#13 Section extraction (balanced-div tokenizer, li/blockquote, preamble)** — **backend untouched**; tokenizer tests exist.
- [x] **#14 Per-page audit issues resolved from snapshot by slug** — **backend untouched** (`rewrite-chat.ts:193-201`); display half is #28.
- [x] **#15 Load states (empty / loading / error 502 detail)** `[reskin — four-states rule]` — prototype omits them; rebuild mandates them. Contextual loading copy ("Loading page…"), fetch-error with HTTP status detail + Retry.

### Chat pane
- [x] **#16 Chat empty state + 6 quick prompts → always-visible playbook chips** `[reskin — quick-win]` — render static `QUICK_PROMPTS` as `FilterChip`s (adopt-in-rebuild). Full playbook-sourced chips = SB-031 follow-up (§3, deferred).
- [x] **#17 Send message (Enter / Shift+Enter, disabled states, sending indicator)** `[carry]` — ports unchanged.
- [x] **#18 Markdown-rendered answers + Copy** `[carry]` — ports unchanged.
- [x] **#19 Rewrite-answer parsing (BEGIN/END_REWRITE delimiters → editor-safe prose)** `[carry — must not regress]` — `src/lib/rewriteResponse.ts` contract co-designed with the prompt (`rewrite-chat.ts:275-278`). Output-format contract; UI/UX rule 10 applies.
- [x] **#20 Inline edit of AI rewrite before applying (contentEditable bubble)** `[carry — additive-parity floor, Q5]` — at_risk (no prototype slot) but pure client machinery. Keep the editable rewrite bubble.
- [x] **#21 Apply to named section (data-section match, highlight, fallback + toast)** `[carry — Q5]` — port HEAD's `data-section` mechanism unchanged (trade-off table: "none material" risk — quick win IS full parity). Arbitrary-section targeting + fallback insert-at-end + info toast all carry.
- [x] **#22 Copy message / rewrite (2s Copied state + failure toast)** `[carry]` — uses existing `useToast`.
- [x] **#23 Per-mount session id feeding server chat memory** `[carry]` — backend contract unchanged; transcript stays ephemeral (fresh on remount, same as HEAD/prototype).

### AI generation (server) — all backend untouched
- [x] **#24 Chat endpoint (`callAI` gpt-5.4, `feature: 'rewrite-chat'`, key-missing 400)** — untouched.
- [x] **#25 System prompt (SEO copywriter + AEO + output contract)** — untouched.
- [x] **#26 Page-assist intelligence context (keyword / voice / personas / knowledge / playbook blocks)** — untouched (`page-assist-context-builder.ts:98-155`).
- [x] **#27 Voice DNA layering, history, persistence, auto-summary, `chat_session` activity log** — untouched; **no WS broadcasts on this surface** (do not add `useWorkspaceEvents` machinery — there is nothing to invalidate).

### Document pane
- [x] **#28 Audit issue chips strip (first 20, severity-coded)** `[reskin — Q5]` — at_risk (no prototype slot) but issues already arrive on the load-page response. Render as `Badge`/`IntentTag` severity-coded chips (error/warning/info) in a strip above the document.
- [x] **#29 Document from extracted sections + pageKey re-init guard** `[carry]` — guard prevents clobbering user edits; carry regardless of block model.
- [x] **#30 contentEditable document (`role=textbox`, aria-label)** `[carry — T1]` — bespoke editor carried via T1 carry-over-then-reskin (AD-010). NOT an F3 primitive.
- [x] **#31 Formatting B/I/H2/H3 with data-section re-slugging** `[reskin]` — promote to a fixed `Toolbar` (prototype upgrade). `data-section` re-slugging on H2/H3 must carry (feeds #21).
- [x] **#32 Clear formatting action** `[carry — Q5]` — add to the fixed toolbar (trivial carry).
- [x] **#33 Floating selection toolbar** `[superseded]` — replaced by the fixed toolbar; function kept via #31/#32.
- [x] **#34 Open live page in new tab** `[carry — Q5]` — make the header URL a link (trivial carry).
- [x] **#35 Export: Copy as Markdown + .md download** `[carry]` — keep verbatim; **add Copy-as-HTML** (Q2 default).
- [x] **#36 Export: .docx download** `[carry — hard floor, Q5]` — FEATURE_AUDIT #449; "no export drops" hard floor. Carry.
- [x] **#37 Export: PDF (print root, scoped CSS)** `[carry — hard floor, Q5]` — same hard floor. Carry.
- [x] **#38 Export popover outside-click / Escape close** `[reskin]` — rebuild on DS `ui/overlay/overlayUtils.ts`, not hand-rolled listeners.

### Prototype-only proposals — DEFERRED under AD-017 (export-only parity v1)
- [ ] **#39 Save draft** `[defer]` — server-persisted drafts = SB-030 (deferred). localStorage draft is the quick-win (Q4 default = status-quo for v1; localStorage draft optional — see §7 DEF row). Buttons hidden behind the write-spine flag.
- [ ] **#40 Publish rewrite to Webflow** `[defer]` — SB-032 (deferred, flag-gated). No CMS write path at HEAD.
- [ ] **#41 Draft-status line** `[defer]` — wholly dependent on #39/#40.
- [ ] **#42 Export "push to a new draft"** `[defer]` — destination undefined; defers with SB-032. Ship **push-to-draft-target** as the v1 output only once the write spine lands.
- [x] **#43 Seeded AI greeting naming the target keyword** `[reskin — adopt, consume SB-005]` — **W1.3 SB-005 is MERGED (#1495): the load-page row now carries `PageKeywordProjection` (primaryKeyword/rank/optimizationScore/monthlyTraffic).** Consume `primaryKeyword` for the seeded greeting — **do NOT re-derive it** and do NOT ride sn-page-rewriter-3 (superseded by the merged projection; see §3).

---

## 3. Server tickets (ride vs defer)

| SB row | Title | Disposition | Rationale |
|--------|-------|-------------|-----------|
| **SB-005** | Per-page keyword/rank/traffic/optimization-score projection | **CONSUME (already merged, #1495)** | Load-page row now carries `PageKeywordProjection`. Consume `primaryKeyword` for #43 seeded greeting + surface rank/score where useful. Supersedes the old sn-page-rewriter-3 (targetKeyword field) — **do not re-build or re-derive.** |
| **SB-032** | Save-draft / publish spine (full-page Webflow write-back) | **DEFER (flag-gated, owner-signed follow-up)** | AD-017 export-only parity v1. New `rewrite-drafts` table + migration + draft/publish lifecycle + Webflow static-DOM/CMS write-target resolution (`docs/rules/seo-editor-write-targets.md`) + activity/broadcast. Verify verdict CONFIRMED (`existsToday=no`, effort L). Backs #40/#42; shares the write-target contract with seo-editor. Ships behind the write-spine flag. |
| **SB-031** | Rewrite-playbook patterns read | **DEFER (follow-up; may be zero-net-new)** | Full playbook-sourced chips (#16 full version). Verify verdict ADJUSTED: the RAW `rewritePlaybook` string is **already** serialized to the admin UI via `admin-workspace-view.ts:41` (`toAdminWorkspaceView`, `workspaces.ts:67`), and `patterns = string.split('\n')` (`content-pipeline-slice.ts:258-264`). **Before building a GET endpoint, confirm the rewriter UI can consume the existing workspace-view `rewritePlaybook` field client-side** — that reduces this to zero net-new backend. v1 ships **static `QUICK_PROMPTS` chips** (#16 quick-win); this follow-up upgrades them to real playbook patterns. |
| **SB-030** | Server-persisted per-page drafts | **DEFER** | seo-editor-scoped `seo_drafts` table (SB-030, owner-gated). Page-rewriter's draft persistence follows the same "defer server tier" posture — localStorage is the v1 quick-win (§7 DEF row). Not built in this surface PR. |

**Net server work in this surface PR: ZERO net-new backend.** All three routes (`GET /pages`, `POST /load-page`, `POST /` chat) are UI-consumed unchanged. SB-005 already delivers the projection consumed by #43. Everything else defers behind the write-spine flag.

---

## 4. Deep-link receiver matrix

| Link | Sender (today) | Receiver | Disposition |
|------|----------------|----------|-------------|
| **"Rewrite this page" (`initialPageUrl`)** | **DEAD at HEAD** — only `setRewritePageUrl(null)` is ever called; the SEO-Audit-era entry point is vestigial (Phase 0 #6, `App.tsx:186,438`, `usePageRewriteChatShell.ts:89-92`). | Page Rewriter surface — must **read + validate** the inbound page-URL param and auto-load on mount (two-halves contract, CLAUDE.md UI rule 12 + BUILD_CONVENTIONS §7 URL-state). | **CARRY (Q3 default).** Wire the sender from **SEO Editor Research mode** (D3 home of Page Intelligence) and/or audit rows — cheap, makes the dead contract live. Retiring-by-omission is forbidden (Phase 0 Q3). Receiver initializes from the validated param via the surface's `useState(() => …)` param-read (pilot `readHubDeepLink` pattern). Add both halves to `tests/contract/tab-deep-link-wiring.test.ts` + a runtime receiver test (BUILD_CONVENTIONS §8). |

**Note on param naming:** do NOT overload the shared `tab` param for a page-URL deep-link (pilot review finding, BUILD_CONVENTIONS §7). Use a dedicated param (e.g. `?pageUrl=`), read through a validating type-guard with a default.

---

## 5. Flag disposition

Per **AD-006** (full per-flag mapping in the plan; retire nothing outside the mapping).

- **`ui-rebuild-shell` (A-lane shell flag):** the rebuilt surface mounts flag-gated on `ui-rebuild-shell` inside the F4 RebuiltAppChrome, Page `rewrite` under the Optimization NavGroup (surfaces/page-rewriter.json:357). Admin-only surface → rides the A-lane shell flag (AD-005 operator/admin half). **UI-shell flag → rebuild retirement track** once the surface is live and green on staging.
- **Write-spine flag (net-new, dark-launch):** the Save-draft/Publish/push-to-draft spine (SB-032) ships **behind a new dark-launch flag** — AD-017 owner-signed follow-up. Add the flag to `shared/types/feature-flags.ts` (own group, `lifecycle: 'active'`, dated removal target) **before the first commit that introduces the OFF branch.** Its OFF branch = export-only v1 (the shipped state). This flag is backend-phase-governed (stays lifecycle-governed), NOT on the rebuild retirement track.
- **No existing flag is retired by this surface** — page-rewriter has no pre-existing UI-shell flag of its own to sunset; it only *adopts* `ui-rebuild-shell`.

---

## 6. File ownership

**Owned (this ticket creates/edits):**
- `src/components/page-rewriter-rebuilt/**` — new surface directory. Every file carries `// @ds-rebuilt` (seven pr-check gates). Expected members mirror the pilot skeleton (BUILD_CONVENTIONS §7):
  - `PageRewriterSurface.tsx` (page skeleton: `PageContainer` + two-pane `GroupBlock` grid, header `Toolbar`, focus-mode wiring to AppShell)
  - the chat pane, document pane, page-picker combobox, fixed formatting toolbar, export menu (rebuilt on DS overlay), audit-chips strip
  - `usePageRewriterSurfaceState.ts` (URL state: validated param reads incl. the `?pageUrl=` deep-link receiver)
  - mutation-feedback helper (re-uses `useToast` + `mutationErrorMessage`; do NOT fork `extractErrorMessage`, do NOT build a second Toast)
- **T1 carry-over machinery** (AD-010, carried + token-reskinned, never redesigned): the bespoke contentEditable document editor + `pageRewriteChatActions`/`pageRewriteChatDocument` logic + `src/lib/rewriteResponse.ts` (imported unchanged) — carried from `src/components/page-rewrite-chat/`, reskinned to tokens in the new directory (or imported from the legacy dir like the pilot imports `KeywordBulkConfirmDialog`).
- `src/components/layout/rebuiltSurfaces.ts` — **one line** in `REBUILT_SURFACES` keyed by Page `rewrite` (`lazyWithRetry(() => import(...))`, `{ workspaceId }` props). Never a new hardcoded `App.tsx` branch.
- `tests/component/page-rewriter-rebuilt/**` — flag-transition test (real `useFeatureFlag`, seeded `QueryClient` — never mock the hook; BUILD_CONVENTIONS §8), a11y-floor assertion, runtime deep-link receiver test.
- `tests/contract/tab-deep-link-wiring.test.ts` — add the `?pageUrl=` sender↔receiver entry (edit, shared file — coordinate).
- `data/ui-rebuild-deferred-ledger.json` — DEF rows (§7).
- **Parity Ledger** (`Platform Parity Ledger.html`) — correct the "Apply back to CMS" over-claim row (AD-017).
- **D5 icon:** the `WandSparkles` nav icon (lucide) → `<Icon name=…>` ICON_NAMES key if one exists; else `<Icon as={WandSparkles}>` bridge (sanctioned migration path). Any in-surface lucide icon follows the same rule. No emoji-as-icon, no raw `fa-*`.

**Consumed, NOT modified (frozen / cross-surface):**
- **AppShell `focusMode` / `onFocusModeChange`** (W0.7, #1488) — consumed via the controlled prop; **this surface does NOT modify AppShell** (frozen post-F3). If a shell hook is missing, that is a shell-team ticket, not a fork here.
- **SB-005 `PageKeywordProjection`** on the load-page row (#1495) — consumed, not re-derived.
- Backend routes `server/routes/rewrite-chat.ts` (all three) + `page-assist-context-builder.ts` + `rewriteResponse.ts` output contract — untouched.

**Cross-surface coordination (senders live elsewhere):** the "Rewrite this page" deep-link *sender* lives on SEO Editor / SEO Audit (D3) — coordinate that half with those surfaces' tickets; this ticket owns the *receiver* half only.

---

## 7. D8 / deferred-ledger entries

No D8 route-redirect entries (route `rewrite` is preserved unchanged — no rename/removal). D8 redirect map is untouched by this surface.

**Deferred-ledger (`DEF-*`) rows to add in the surface PR** (BUILD_CONVENTIONS §7 — every quick-win trade-off ships a row; `npm run verify:deferred-ledger` enforces schema/expiry/roadmap links):

| DEF id (suggested) | Item | Decision / class | Upgrade trigger |
|--------------------|------|------------------|-----------------|
| `DEF-page-rewriter-001` | Save-draft / Publish / push-to-draft spine hidden behind the write-spine flag | Export-only parity v1 (AD-017); write path deferred, class `deferred-capability` | Owner approves SB-032 (write-target contract work) |
| `DEF-page-rewriter-002` | Playbook chips are static `QUICK_PROMPTS`, not workspace playbook patterns | Quick-win chips (#16); class `quick-win` | SB-031 lands (confirm zero-net-new via existing workspace-view field first) |
| `DEF-page-rewriter-003` | Document edits lost on navigation (no draft persistence); localStorage draft optional | Status-quo v1 (Q4 default), class `quick-win` | SB-030 server-persisted drafts, or localStorage quick-win adopted |

(429/quota state per AD-020 + BUILD_CONVENTIONS §4 is a shipped requirement, not a deferral — disabled AI actions with quota tooltip, first-429 dismissible banner, partial-run tally on any bulk/stream run; detect via `ApiError.status === 429`, the 402/403-lock twin.)

---

### Standing gates (per-PR, BUILD_CONVENTIONS §8)
`npm run typecheck && npx vite build && npx vitest run` (full suite) + `npm run pr-check` + `npm run lint:hooks` + `npm run verify:bundle-budget` + `npm run verify:deferred-ledger` + flag-ON real-render smoke (env-flag local mechanism, live DB workspace with sitemap/page data, click through real states, screenshot in PR).
