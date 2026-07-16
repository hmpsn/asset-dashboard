# Admin UI Rebuild vs Legacy — Fresh Evaluative Audit (Persona + Parity + Complexity)

> **ADVISORY ONLY. No code was changed. Every finding is input to an owner decision.**
>
> Date: 2026-07-16 · Branch audited: `audit/admin-ui-rebuild-vs-legacy` (= `origin/staging` @ `5a2641b21`)
> Question under review: the owner's five — (1) Is the new UI clean and functional? (2) Where is it confusing or difficult? (3) Do we lose functionality from the OG version? (4) What should we extend or improve? (5) Where have we overcomplicated?
>
> Method: 20 code-grounded surface parity agents (rebuilt vs **legacy**, not vs prototype — parity contracts treated as claims to verify) → real-browser walk of 12 rebuilt + 3 legacy surfaces on a data-rich workspace (Expero, flag ON/OFF, zero console errors) → 7-seat evaluative persona panel (3 seats recurring from the 2026-07-03 prototype panel) → 3 complexity lanes (UX ceremony, maintenance debt, extension synthesis) → adversarial validation of all 44 blocker/major claims by independent refuter agents. ~9M tokens, 74 agents. Full structured outputs in the companion `.verdicts.json`.

---

## 1. HEADLINE

**Verdict: the rebuild is directionally right and nobody wants legacy back — but it is not safe to flip on for production until a narrow, well-defined cluster of "truth-in-labels" defects is fixed, and the single highest-leverage action is not a fix at all: it is banking the 82-commit closure branch that staging never received.**

Two structural findings dominate everything else:

### 1a. Staging is auditing as "visually approved but functionally unclosed" because the closure wave never landed

`origin/codex/ui-visual-parity` holds **82 commits that are not ancestors of staging** (~7.6K lines), including the entire post-parity closure record the parity docs cite as complete: the `AUD-D1`–`AUD-D7` implementation commits, the stacked-overlay coordination fix, admin refresh-wiring repair, workspace-state isolation, and `69a686583` — an 11-defect fix wave (Roadmap shipping-velocity metric, Published trend arrow sign, cockpit Refresh/source-chip scoping, ConfirmDialog Enter, and more) that resolves several defects this audit independently re-found on staging. The branch also rewrites the exact files where our biggest confirmed losses live (`SiteAuditSurface.tsx` 908 lines changed, `SeoEditorWorksheet.tsx` 637, `PageSpeedLens.tsx` 382). Verified first-hand: `git merge-base --is-ancestor 69a686583 origin/staging` → NO.

**Consequence:** part of this audit's finding set is *already fixed, one unmerged branch away*. Before actioning any individual finding below, cross-check it against that branch — and the owner's first decision should be authorizing the per-cohort extraction to staging that the shipping manifest already specifies (it requires explicit owner authorization, which is why it is stranded).

### 1b. The risk that remains is concentrated in one theme: labels that don't tell the truth

All 20 surface audits scored the rebuild **6 better / 14 mixed / 0 worse** than legacy. All 7 personas returned `builtToMySpec: partially` — zero "no" verdicts — and every seat praised the same wins (verdict-first Cockpit, URL-persisted state, honest empty/error/stale states, table-first worksheets). What three seats independently rated **blocker-grade** is a single failure family: controls and numbers whose stated scope, meaning, or window does not match their behavior. A "Send" button that only navigates; a drawer badged "14 pages" whose Accept acts on one; a client send that fails silently; a success toast over a fabricated red-zero score; "Rolling 90 days" stamped on all-time data; "$0" where the honest answer is "unavailable". Individually small; jointly they are exactly the "one bad reconciliation and I stop trusting the whole instrument" pattern the prototype-stage panel warned about — now confirmed in shipped code rather than mockups.

---

## 2. The owner's five questions, answered

### Q1 — Is the new UI clean and functional?

**Yes, with conviction — at the surface level.** Every walked surface rendered clean at 1440×900 with zero console errors on real data. The verdict-first Cockpit fits one viewport; Search & Traffic leads with a plain-English narrative; Site Audit opens with a verdict and a repair path; Brand & AI explains how AI uses its inputs; empty states teach instead of apologize. The 20 code audits unanimously found the rebuilt data-state lifecycle (skeleton → typed error with retry → stale-kept-visible → "Data as of" stamps) better than legacy's silent `console.error` swallowing. Functional gaps exist (Q3) but the frame is genuinely good.

### Q2 — Where does it get confusing or difficult?

Five convergent confusion clusters (each raised independently by 3+ personas and confirmed in code):

1. **Three naming systems for the same destinations.** Sidebar says "Insights Engine / Keywords / Asset Manager"; the nav registry (breadcrumb + `document.title`) says "Strategy / Keyword Hub / Assets"; the ⌘K palette still groups by *legacy* zone names ("Monitoring", "Site Health"). `RebuiltSidebar` hard-codes label overrides that bypass the registry. A new hire's literal first distrust trigger, shipped.
2. **The send model is undiscoverable and its vocabulary lies.** The Engine's real send button only mounts when `stagedCount > 0` — at rest there is no send affordance or hint (legacy always showed "Send update · 0 staged · stage moves below"). Meanwhile Cockpit queue buttons labeled "Send"/"Propose" only navigate. An account manager mid-call cannot find the one true send path.
3. **Global surfaces impersonate a workspace.** `/settings`, `/roadmap`, `/revenue` render under "Command Center → Expero 2023 → …" because the shell substitutes `workspaces[0]` as context; AdminChat inherits it too. At 19 workspaces it's confusing; at 40 it's how you read or send the wrong client's data.
4. **Work homes were demoted to unlabeled icons.** Requests ("a human is waiting"), Action Results, Diagnostics, Roadmap have no labeled sidebar home flag-ON — icon-only footer strip or in-surface links. Legacy listed Requests and Action Results as labeled rail items.
5. **Drawer/queue scope ambiguity.** The Site Audit issue drawer is titled with a group and badged "14 pages" while its actions operate on the first page; "Accept all 785" is one click with no preview/undo affordance; the missing-metadata banner counts CMS rows while its Fix buttons draft static pages only.

### Q3 — Do we lose functionality from the OG version?

**Yes — real but bounded, and now precisely mapped.** The 20 surface audits logged 30 blocker/major capability losses (plus ~96 minor); independent refuters then validated every blocker/major claim: of 44 severe claims (losses + regressions), **the confirmed set after adversarial validation is summarized in §5** (roughly 60% confirmed as stated, most of the rest downgraded to minor because the capability moved homes or was owner-documented). The ones that matter most:

- **Site Audit per-page repair depth** (the audit's only blocker-rated loss, validated at *major*): legacy's per-page action rows and page-level inventory (score, traffic badge, per-page issue list) have no rebuilt home; drawer actions act on the first affected page while reading as group-scoped.
- **AI Visibility (LLM mentions) is marooned**: its only mount is legacy Keyword Hub; the feature's own flag was retired globally-ON, so flag-ON hides a live production feature and deleting legacy would delete it outright.
- **SEO Editor CMS depth** (4 validated majors): extra SEO fields beyond the first, the full bulk-preview diff, the missing-metadata banner counting CMS rows its Fix buttons don't draft, and the confirmed silent-failure CMS send. (Per-item approval history and per-field AI rewrite validated as minor — partially relocated.)
- **Engine analytics strip**: the CTR-weighted visibility score ring + 4-stat delta strip. (The related content-gaps claim was downgraded on validation: the gap→brief workflow *survives in thinner form* via Engine backing moves and the Keyword drawer's "Generate brief" handoff — what's lost is the dedicated full-context evidence card.)
- **Cross-workspace triage**: the `/` Command Center (with the book-level "Needs attention" strip and presence) is *not rebuilt* — flag-ON operators bounce between two shells. (The Outcomes Book attention claim validated as demoted-not-lost: badge + reason survive behind per-row expansion, the declining-trend trigger stays visible collapsed, but attention-first sorting is gone.)
- **Home-surface anomaly visibility**: legacy home showed 21 anomaly alerts (4 red) with AI narratives; the rebuilt Cockpit compresses to "1 risk signal / Risk (0)" and no one could identify a flag-ON home for the alert stream. Either the classification is smarter or the operator is blind — unproven either way.
- **Small-but-daily affordances**: open-in-new-tab anchors across the Links surface, per-row keyword quick actions, GBP competitor review benchmark, empty-bulk PageSpeed guard (now a *fabricated* red-zero average + success toast — validated CONFIRMED).

Counterweight: the audits also logged substantial **gains** legacy never had (§7) — and several "losses" were refuted or downgraded because the capability moved to a documented home.

### Q4 — What should we extend or improve?

The extension lane collapsed 116 opportunities into 9 themes; the striking result is that **the highest-leverage work is overwhelmingly small** (§6). Top of the ranked list: render data already fetched (cockpit money frame, keyword drawer evidence), defuse the trust landmines (one shared unknown-vs-zero formatter, window labels on every aggregate, empty-bulk guard), surface silent failures on the send/approval spine, finish the half-built cross-surface handoff mesh (fixContext receiver robustness; page-rewriter/links receivers have no senders), and give the anomaly stream + Requests labeled homes. The three genuinely large items (keywords read models DEF-kw-001..003, GO-004 book rollup, `/` Command Center rebuild) are *already-ledgered deferrals* — the ask is scheduling, not scoping. Personas add one more with one voice: **a book-level Cockpit** — the verdict/stream model rolled up across all workspaces.

### Q5 — Have we overcomplicated?

**At the mid-level of surfaces, yes — measurably.** The ceremony census: ~30 visible top-level lens/mode options across 10 surfaces, 29 Drawer mounts, 11+ Segmented controls, up to four stacked filter layers on one dataset (Keywords, where two of five lenses differ only by column set). Six surfaces carry URL lens vocabulary larger than their visible UI — two vocabularies are fully dead code. Dead scaffolding shipped as prototype-parity ceremony: a permanently-empty "Queued" board column forcing a 920px min-width, a hidden fourth "overview" lens with zero senders, navigate-only "Send"/"Propose" buttons kept as "explicit exceptions". Hierarchy inversions: the Action Results surface leads with a data-entry form above its actual daily readback; global surfaces under workspace breadcrumbs. And beneath the UI, the deeper complexity: **two full admin UIs (27.0K legacy-only LOC + 39.1K rebuilt LOC) behind a flag that has never been ON in production**, with 89 open deferred-ledger entries (zero scheduled, 49 sharing one 2026-08-18 review date), ~70 semantic drift findings already shipped between the shells, and at least six rebuilt surfaces mounting legacy components wholesale — meaning the CLAUDE.md flag-retirement rule ("delete the OFF branch") is structurally impossible today without deleting load-bearing parts of the ON branch.

---

## 3. Launch-blockers (independently raised by ≥3 personas, code-confirmed)

| # | Blocker | Seats | Status |
|---|---------|-------|--------|
| B1 | **Truth-in-labels on client-facing actions** — Site Audit drawer group-badge vs first-page-only actions; Cockpit "Send"/"Propose" navigate-only; SEO Editor CMS send fails silently (error renders only in an unopened drawer); "Accept all 785" with no preview/undo | 1, 2, 3, 4 | Validated: CMS silent send CONFIRMED-major; drawer scope validated major; navigate-only Send confirmed in source |
| B2 | **Fabricated or false-window numbers** — rate-limited bulk PageSpeed → success toast + fabricated red-0 average (CONFIRMED ×2); Outcomes Book "Rolling 90 days" over all-time/28d/30d data; Keyword Hub "$0 Monthly value" vs Cockpit "— Unavailable" for the same absent provider; Site Audit 2215-vs-4187 warnings on one screen; Roadmap Completion % denominator excludes deferred/closed while Total doesn't | 1, 5, 7 (2, 3 echo) | Fabrication + mislabel claims CONFIRMED; several have fixes on the stranded branch |
| B3 | **Global tabs adopt `workspaces[0]` as context** — breadcrumb, sidebar selector, and AdminChat all claim the first workspace on /settings, /roadmap, /revenue. Validation nuance: the *mechanism* is an owner-approved shell-mount fix (`global-ops-contract.md`, 2026-07-10) — but the approval never enumerated these three operator-visible consequences, and four personas independently flagged them. First-hand: bare `/settings` rendered "Command Center → cascade-debug-1783977240399 → Settings" with that junk workspace active in the selector | 2, 3, 5, 7 (blocker for 7) | Mechanism approved; consequences unapproved — owner circle-back, not a regression |
| B4 | **Anomaly alert stream has no flag-ON home** — 21 legacy alerts compress to "1 risk signal / Risk (0)" with no provable classification story | 1, 5, 7 | Confirmed in walk; work-queue ingests all severities incl. `positive` under "Risk" |
| B5 | **Send-model discoverability** — no send affordance at 0 staged on the Engine; three surfaces, three send behaviors; the client "wins worth saying / what I'd flag" talking points now live only inside the Edit drawer | 1, 2 | Confirmed `EngineSurface.tsx:381,407` |
| B6 | **Nav demotions and triple taxonomy** — Requests/Action Results/Diagnostics/Roadmap unlabeled; sidebar vs registry vs palette naming | 1, 2, 3, 7 | Confirmed (`GROUP_PRESENTATION` overrides bypass registry) |
| B7 | **Flag retirement structurally blocked** — six rebuilt surfaces wrap legacy components; `/` and `/subscriptions` never mount rebuilt chrome; AI Visibility marooned in legacy; 89/89 open deferrals with `roadmapItemId: null` | 6 (7 for `/`) | Confirmed by maintenance lane with LOC/file counts |

**The transversal blocker: bank `codex/ui-visual-parity` first** — it demonstrably fixes a subset of B1/B2 items and rewrites the files behind others; fixing on staging without it guarantees conflicts and double work.

---

## 4. Per-persona verdicts

| Seat | Built to my spec | How much the gaps matter | One line |
|------|------------------|--------------------------|----------|
| 1 · Solo founder-operator (Joshua-proxy) | partially | **blocker** | "First version that understands my morning — I'd run flag-ON tomorrow, but all three of my distrust triggers fired; the send-and-repair spine quietly lies to me, and that's the one mistake a solo agency can't survive." |
| 2 · Account manager on a live call | partially | a lot | "Verdict-first and honest about stale — but my two make-or-break call moments (talking points, 'just send it') are buried in an edit drawer and a send button that doesn't exist at rest." |
| 3 · Junior SEO, week one | partially | a lot | "Best first hour this platform has ever had; then the labels stop meaning what they say — two taxonomies for one nav, guides that dead-end, Sends that navigate." |
| 4 · Efficiency power-user | partially | **blocker** | "Half was made for me (URL state, inline worksheet, table-first hub) and the other half took away what my hands do all day. Faster on good days, silently wrong on bulk days — and silently wrong is worse than slow." |
| 5 · Skeptical numbers auditor | partially | **blocker** | "The rebuild heard my ask — provenance, dating, attribution honesty — but an instrument earns trust by reconciling, and I found fabrications, not just inconsistencies. The fix is narrow and mostly labeling." |
| 6 · Operator six months out (maintenance) | partially | a lot | "Best process discipline I've inherited — and the thing I was promised (retire the flag) is structurally impossible as built: legacy is load-bearing *inside* the rebuilt shell, and the ledger has 89 open entries with no exits." |
| 7 · Multi-client scale operator | partially | a lot | "Per client, the best cockpit I've ever had. My job is forty of these, and the rebuild stopped one level below where I live — the book-level home is still the legacy shell." |

Pattern: **unanimous "partially" with zero rejections** — the same "trust-but-not-compelled with named blockers" signature as the prototype-stage panel, but the blockers have migrated from *design posture* (invented scores, estimate-led money) to *implementation truthfulness* (scope, labels, windows, silent failures). That migration is progress: these are cheaper to fix than design misframings.

## 5. Validated severe-claim table

Adversarial validation of all 44 blocker/major claims (each claim independently re-verified against both code trees, with an active search for relocated capabilities and owner-approval records):

| Verdict | Count | Meaning |
|---------|------:|---------|
| CONFIRMED (major) | 22 | Accurate as stated, evidence re-verified in both trees |
| OVERSTATED → still major | 1 | Site Audit per-page repair scope (#14): real, downgraded from blocker — legacy per-page action rows confirmed; rebuilt drawer acts on the first affected page while presenting group scope |
| OVERSTATED → minor | 19 | Real but weaker: capability relocated (e.g. content-gap→brief survives via Engine backing moves + Keyword drawer), demoted-not-lost (Outcomes attention triage), or owner-documented (the `workspaces[0]` global-tab mechanism is approved in `global-ops-contract.md` — though its three operator-visible consequences were never enumerated there) |
| REFUTED | 2 | Both fixContext cold-chunk handoff claims (#21, #25): React Router 7 wraps navigation in `startTransition`, so the lazy-chunk "Draft brief" handoff works on cold mounts |

Net answer to "do we lose functionality?": **23 validated major losses/regressions, zero surviving blockers** — concentrated in SEO Editor CMS depth (4), truth-in-labels/fabrication (6), Brand & AI cockpit wiring (3), schema pre-scan homes + silent failures (2), and one live marooned feature (AI Visibility). Several have fixes waiting on the stranded branch (§1a).

Full per-claim verdicts with corrected severities and file:line evidence are in the companion `.verdicts.json`. Reading guide: CONFIRMED = accurate as stated; OVERSTATED = real but downgraded (capability relocated, partially present, or owner-documented); REFUTED = wrong or the capability exists elsewhere.

## 6. Ranked extension/improvement queue (advisory)

Small (days, high leverage):
1. **Trust-landmine hotfix sweep** — empty-bulk PageSpeed guard (stop caching fabricated zero), remove/replace the false "Rolling 90 days" labels, one shared unknown-vs-zero formatter (server-side null, never 0, for absent provider evidence), reconcile the Site Audit warning aggregations, Roadmap % denominator = Total tile denominator.
2. **Silent-failure surfacing on the send/approval spine** — CMS approvalError toast at the toolbar, Schema add-page error banner, links sent-state latch.
3. **Truth-in-labels pass** — rename Cockpit "Send"/"Propose" to what they do (or wire them), always-rendered disabled Engine send with "0 staged — stage moves below" helper, per-page scope statements on Site Audit drawer actions, confirm-with-preview on "Accept all N".
4. **Nav coherence** — one name per surface everywhere (delete the sidebar label overrides or move them into the registry); skip the workspace breadcrumb segment for `GLOBAL_TABS`; remember last-visited workspace instead of `workspaces[0]`; labeled homes for Requests/Action Results.
5. **Render what's already fetched** — cockpit money frame, keyword drawer evidence slices, computed-but-unrendered deltas.

Medium:
6. **Handoff-mesh completion** — validation refuted the "cold-chunk drop" concern (React Router 7's `startTransition` makes the fixContext handoff reliable), so this is purely about wiring the senders/receivers that exist one-sided (Site Audit → Page Rewriter, links `?detail=`, decay → brief).
7. **Keywords lens diet** — fold Opportunities into a column preset, Pages/Clusters into a "Group by" control; restore per-row quick actions.
8. **Scale ergonomics** — cap Search & Traffic's 500-row detail table, board search on the Pipeline, drop the dead Queued column.
9. **Anomaly home** — a flag-ON anomaly stream (Search & Traffic anomalies section + Cockpit risk-stream pointer) with a provable mapping from the legacy 21-alert strip.

Large (already-ledgered; the ask is scheduling):
10. **Bank the stranded branch** (first, before everything above — much of 1–3 may come for free).
11. **Book-level Cockpit at `/`** — rebuild the Command Center with the cross-workspace verdict/stream rollup (server-side classification already exists per workspace); restores presence + "Needs attention" triage and closes the dual-shell seam.
12. **Keywords server-owned read models** (DEF-kw-001..003) and the **GO-004 Outcomes Book rollup** (kills the false "Rolling 90 days" label with real windowed data).
13. **Flag-retirement plan (Phase Z)** — port-or-except triage over the confirmed losses (AI Visibility first: live feature), rebuild-or-fold `/subscriptions`, inventory the six legacy-inside-rebuilt mounts, then the CLAUDE.md retirement template. Tighten `verify:deferred-ledger` (open entries must gain `roadmapItemId` or expire).

## 7. Gains to protect (do not regress these)

1. URL-persisted, validated, deep-linkable state as the default on every surface.
2. The honest data-state lifecycle (skeleton → typed error+retry → stale-kept-visible → "Data as of").
3. Universal mutation feedback on shared `useToast` with truthful refresh.
4. Surface-owned `useWorkspaceEvents` invalidation (engine 10 events, pipeline 8, schema 5…).
5. No-fabrication rendering & attribution honesty (— /Establishing instead of zeros; measured-only claims).
6. Verdict-first heroes with plain-English narratives (Cockpit, Site Audit, Search & Traffic, Engine POV).
7. The client trust-spine preview on the Engine (multiple seats: "the artifact I always needed").
8. Rich self-describing nav (aria/tooltips), rail collapse, mobile drawer, a11y floor + ratchet.

## 8. Fast-follows (recorded, deliberately deferred)

Global Settings SC-DOMAIN chip wall → searchable summary; onboarding modal stale "Run your first SEO audit" step; `document.title` not following route; palette toggle first-click no-op; Asset Manager permanent narrative banners + triple quota notices; "Guide" appearing as lens/drawer/disclosure on three surfaces (pick one pattern); "Content Health" meaning two different views in two homes; Local Presence "Authenticated profile aggregate" mislabel; per-request status badges in the Cockpit client rail; `SUB_TAB_LABELS_BY_PAGE` hand-maintained duplicate; descendant-selector CSS surgery on DS primitives (candidate pr-check rule); ConfirmDialog `isPending` prop.

---

*Synthesized 2026-07-16 from 20 surface parity agents + 7-seat persona panel + 3 complexity lanes + 44 adversarial validations + a real-browser flag-ON/flag-OFF walk. Advisory only — no code changed; the owner decides. Companion data: `2026-07-16-admin-ui-rebuild-vs-legacy-persona-audit.verdicts.json`.*
