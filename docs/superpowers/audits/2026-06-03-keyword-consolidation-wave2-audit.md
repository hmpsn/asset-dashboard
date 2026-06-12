# Keyword Surface Consolidation — Wave 2 Pre-Plan Audit

**Date:** 2026-06-03 · **Branch:** `feat/keyword-consolidation-wave1` (Wave 1 applied) · **Scope:** shared UI primitives consolidation (Wave 2)

**Total distinct call sites/definitions enumerated:** ~110 across 6 concerns (positionColor: ~24, formatters: ~40, KeywordTable bypasses: ~14, ContentGapRow: 9, CannibalizationAlert: 8, page-map leaf: 6 — with substantial file overlap).

**Wave 2 target state:** a new `KeywordTable` primitive subsuming `shared/RankTable`; ONE `positionColor` authority; ONE volume/KD formatter (`fmtNum` + `kdColor`/`kdLabel`); ONE audience-parameterized `ContentGapRow` (threads `ovGainActive`, flag-OFF byte-identical); ONE normalized `CannibalizationAlert` via `SectionCard`; ONE shared page-map leaf metric cell.

**Standing constraint:** the `seo-generation-quality` umbrella flag is **dark (default OFF)**. Wave 2 must preserve flag-OFF byte-identity (gen-quality Contract 3) — specifically the two `RecommendedForYou` `ovGainActive` deltas. Do NOT change generation-surface code.

---

## Findings by primitive

### positionColor (#4) — rank/position color authority

5 standalone definitions + ~9 inline 2-to-4-tier variants = ~14 distinct colorization expressions across ~10 files. The headline divergence is **emerald-vs-teal at the `≤10` band** (a genuine hue split confirmed in `src/index.css`: `.text-accent-brand`→`var(--teal)`, `.text-accent-success`→`var(--emerald)`). This is a Four-Laws violation: a read-only rank metric painted with the actions hue (teal).

| File:line | What |
|---|---|
| `src/components/shared/RankTable.tsx:6` | **DEF A** `positionColor(pos:number)` — bands 3/10/20, **bare tailwind** `text-emerald-400/80` (with /80 opacity, unique), `font-semibold` baked into ≤3, NO undefined guard. Emerald for BOTH ≤3 and ≤10. *(verified)* |
| `src/components/shared/RankTable.tsx:100` | CALL of A inside RankTable row. |
| `src/components/page-intelligence/pageIntelligenceDisplay.ts:3` | **DEF B** `positionColor(pos?)` — bands 3/10/20, **accent tokens**, undefined/0→muted; ≤3 `accent-success` (emerald), ≤10 `accent-brand` (**TEAL**), ≤20 `accent-warning`, else `accent-danger`. *(verified)* |
| `src/components/page-intelligence/PageIntelligenceStrategySection.tsx:5,138` | CALL of B (`Avg position:`). |
| `src/components/page-intelligence/PageIntelligencePageRow.tsx:18,162` | CALL of B (leaf metric `#NN`). |
| `src/components/KeywordStrategy.tsx:240` | **DEF C** inline `positionColor(pos?)` — **byte-identical to B** (teal ≤10). Zero-risk merge with B. |
| `src/components/KeywordStrategy.tsx:702` | CALL of C (`StatCard valueColor`, Avg Position hero). |
| `src/components/KeywordStrategy.tsx:750` | CALL of C — **prop-injected** into `<LowHangingFruit positionColor={...}/>`. |
| `src/components/strategy/LowHangingFruit.tsx:21,24,42` | CONSUMER (prop) — should import the authority directly, not take a prop. |
| `src/components/client/PageKeywordMapContent.tsx:69` | **DEF D** inline `positionColor(pos:number)` — UNIQUE 4-band 3/10/20/**50**; ≤10 emerald (NOT teal); adds `font-semibold`; tail = muted. |
| `src/components/client/PageKeywordMapContent.tsx:77` | **DEF E** `positionTone(pos):'emerald'\|'amber'\|'zinc'` — 2-band 10/50, returns **Badge tone strings**. |
| `src/components/client/PageKeywordMapContent.tsx:258` | CALL of E (`<Badge tone={positionTone(...)}>`). |
| `src/components/client/PageKeywordMapContent.tsx:327` | CALL of D (leaf keyword metric cell — Wave 2 page-map leaf target). |
| `src/components/client/SearchTab.tsx:222`, `:233` | INLINE 2-tier (10/20, accent, emerald ≤10, no ≤3 tier) — query + page rows. |
| `src/components/SearchDetail.tsx:321`, `:348` | INLINE 2-tier **bare tailwind** `text-emerald-400` (no /80) — query + page. |
| `src/components/ContentPerformance.tsx:301`, `:353` | INLINE 2-tier; tail diverges (`brand-text` / `brand-text-bright`, NOT danger). |
| `src/components/client/ContentTab.tsx:704` | INLINE 2-tier (10/20), tail `brand-text`. |
| `src/components/client/strategy/StrategyKeywordDrawer.tsx:143` | INLINE 3-tier bare tailwind, UNIQUE **10/30** bands; separate label string at :148-149. |
| `src/components/RankTracker.tsx:500` | INLINE 4-tier bare tailwind, has **TEAL** tier (emerald ≤3 / teal ≤10 / amber ≤20 / brand-text) — only inline variant reproducing the emerald/teal split. |
| `tests/unit/page-intelligence-display.test.ts:25-30` | **MIGRATION LOCK** — pins DEF B's exact tokens: `()/(0)`→muted, `(3)`→success, `(10)`→accent-brand, `(20)`→warning, `(21)`→danger. |

**Divergences:** (1) emerald-vs-teal at ≤10 (B/C/RankTracker = teal; A/D/SearchTab/SearchDetail/ContentPerformance/ContentTab = emerald); (2) accent tokens vs bare tailwind (+ RankTable's unique /80 opacity); (3) band boundaries 3/10/20 vs 3/10/20/**50** (D) vs **10/30** (drawer) vs 2-tier-no-≤3 (inline); (4) tail/else bucket differs 5 ways; (5) undefined/0 guard present (B/C) vs absent (A/D); (6) `font-semibold` baked into ≤3 in A/D, color-only elsewhere.

**Canonical home:** `src/components/ui/constants.ts` (beside `scoreColorClass`/`aeoScoreColorClass`; pure leaf, React-free, import-neutral for shared+client, decoupled from RankTable which `KeywordTable` subsumes). Expose `positionColor(pos?:number):string` → **accent tokens, emerald at ≤10** (resolve the Four-Laws teal bug), undefined/0→muted as the superset; sibling `positionTone(pos?):BadgeTone` for the Badge path. `pageIntelligenceDisplay.positionColor` re-exports/delegates (keeps the unit-test contract + barrel imports working); `shared/RankTable` consumes, does not host.

---

### Formatters (#16/#17) — volume `fmtNum` + KD `kdColor`/`kdLabel`

ONE canonical volume formatter + 6 named dups + ~9 inline `.toLocaleString()+'/mo'` sites + 5 bare matrix sites. KD color has 6 named helpers across FIVE threshold schemes + 4 inline bands. `kdLabel` has 1 authority + the shared `kdFraming` labels.

| File:line | What |
|---|---|
| `src/utils/formatNumbers.ts:7-11` | **CANONICAL `fmtNum`** — `1.2K`/`1.5M` (UPPERCASE, `.toFixed(1)`), else `toLocaleString`. Non-null param (no undefined guard). Already imported by ~10 analytics components + CompetitiveIntel, RecommendedForYou, StrategyContentOpportunitiesSection, useInsightFeed. |
| `src/components/client/strategy/strategyKeywordDisplay.ts:62` | DUP `fmtNum` — **lowercase `k`, NO M tier**. Re-imported by StrategyKeywordDrawer/StrategyContentOpportunitiesSection. |
| `src/components/keyword-command-center/kccDisplayHelpers.ts:55-60` | DUP `compactNumber(value?)` — UPPERCASE `1.2K`/`1.2M`, rounds sub-1000, returns `'-'` sentinel on null. |
| `src/components/strategy/ContentGaps.tsx:27` | DUP `fmtNum` — lowercase `k`, no M (byte-identical to strategyKeywordDisplay's). |
| `src/components/client/InsightsEngine.tsx:51` | DUP `num(n)` — lowercase `k`, no M. |
| `src/components/client/FixRecommendations.tsx:16` | DUP `num(n)` — lowercase `k`, no M. |
| `src/components/client/strategy/StrategyKeywordsSection.tsx:34`,`:232` | INLINE volume (twice) — `(v/1000).toFixed(1)+'k/mo'`, lowercase, no M. |
| `src/components/KeywordStrategy.tsx:802` | INLINE `volume.toLocaleString()+'/mo'` — raw comma-grouped `1,234/mo`. |
| `src/components/page-intelligence/PageIntelligenceStrategySection.tsx:115`,`:147` | INLINE raw `1,234/mo` (:115); bare `{metric.volume}/mo` no format (:147). |
| `src/components/page-intelligence/PageIntelligencePageRow.tsx:156` | INLINE raw `1,234/mo`. |
| `src/components/client/PageKeywordMapContent.tsx:293` | INLINE raw `1,234/mo`. |
| `src/components/strategy/KeywordGaps.tsx:36` | INLINE raw `1,234/mo`. |
| `src/components/client/InsightCards.tsx:438`,`:482` | INLINE raw `1,234 searches/mo`. |
| `src/components/matrix/MatrixGrid.tsx:144,345` + `CellDetailPanel.tsx:141,168,203` | BARE integer `{volume}/mo` — 5 matrix sites, no formatting. |
| `src/components/strategy/CompetitiveIntel.tsx:252,286` · `client/Briefing/RecommendedForYou.tsx:140,159,174` · `StrategyContentOpportunitiesSection.tsx:148,159` · `hooks/admin/useInsightFeed.ts:100,115,135,147` | **ALREADY canonical `fmtNum`.** |
| `src/components/page-intelligence/pageIntelligenceDisplay.ts:12-18` | **CANONICAL `kdColor(kd?)`** — bands 30/50/70, undefined→muted (kd=0→success). |
| `src/components/page-intelligence/pageIntelligenceDisplay.ts:20-26` | **CANONICAL `kdLabel(kd?)`** — 30/50/70 → Easy/Medium/Hard/Very Hard. *(verified)* |
| `src/components/KeywordStrategy.tsx:248-254` | DUP `difficultyColor(kd?)` — **byte-identical to canonical kdColor** (30/50/70, tokens). Prop-drilled into `<KeywordGaps difficultyColor=...>` (:756). Zero-risk merge. |
| `src/components/client/strategy/strategyKeywordDisplay.ts:74-81` | DUP `kdColor` — 3-band 30/60, `!kd`→muted (kd=0→muted, diverges). |
| `src/components/strategy/ContentGaps.tsx:26` | DUP `kdColor` — 4-band 30/60/80, **RAW tailwind** (`emerald-400`…). |
| `src/components/strategy/CompetitiveIntel.tsx:66-70` | DUP `difficultyColor(kd:number)` — 2-band 30/60, raw tailwind, required param. |
| `src/components/client/Briefing/RecommendedForYou.tsx:45-52` | DUP `kdColor` — 3-band 30/60, tokens (comment "ported verbatim" but bands differ from ContentGaps). |
| `src/components/client/PageKeywordMapContent.tsx:300-301` | INLINE KD band 30/60 token; form `Difficulty {n}`. |
| `src/components/matrix/MatrixGrid.tsx:145,346` + `CellDetailPanel.tsx:145` | INLINE KD band (3×) — `>60`/`>35` raw tailwind, `>` semantics. |
| `src/components/strategy/KeywordGaps.tsx:14,17,37` · `StrategyContentOpportunitiesSection.tsx:152,418` · `StrategyPageImprovementsSection.tsx:166-168` · `StrategyKeywordsSection.tsx:36,233` · `KeywordRow.tsx:100` · `InsightCards.tsx:486` | KD render call-sites — forms split `KD NN%` / `KD NN` / `Difficulty NN` / `NN/100`. |
| `src/lib/kdFraming.ts:11-28`,`:34-38` | **EXISTING SHARED** `kdFraming`/`kdTooltip` (bands 30/60/80/100, plain-language). Imported by RecommendedForYou, ContentGaps, StrategyContentOpportunities, StrategyKeywordDrawer. **Build `kdLabel` ON this — do not reinvent framing.** |

**Divergences:** volume output splits 4 ways (UPPERCASE-K/M canonical · lowercase-k-no-M · raw `1,234/mo` · bare integer); KD thresholds split 5 ways (30/50/70 · 30/60 · 30/60/80 · 30/60-2band · 35/60-`>`); KD null/zero (`undefined`-guard→kd=0 green vs `!kd`→kd=0 muted); KD numeric form (`KD NN%` / `KD NN` / `Difficulty NN` / `NN/100`); token vs raw-tailwind.

**Canonical home:** volume = `src/utils/formatNumbers.ts:fmtNum` (standardize on UPPERCASE K/M). KD = lift `pageIntelligenceDisplay.kdColor+kdLabel` (4-band 30/50/70, tokens) into the shared keyword-display util; delete `KeywordStrategy.difficultyColor` (byte-identical). `kdFraming`/`kdTooltip` stay shared, reused. Provide a **null-safe table-cell wrapper** (the `'—'`/`'-'` sentinel) for the KeywordTable volume column to preserve KCC parity.

---

### KeywordTable (#3) — new shared primitive subsuming `shared/RankTable`

Absorbs every hand-rolled keyword/rank table, grid, and flex-row across admin + client. `shared/RankTable` is the base to grow (semantic `<table>` + `renderActions` slot + `RankChange` + `RankTrackingSection`), not replace.

| File:line | What |
|---|---|
| `src/components/shared/RankTable.tsx:1-149` | **SOURCE to subsume** — `positionColor` (A), `RankRow` (61-67), `RankTable` (78-114, semantic table, `renderActions` slot, `limit`/`showClicks`/`showImpressions`, **returns null on empty**), `RankChange` (117-125), `RankHistoryChart` (22-58, keep as sibling), `RankTrackingSection` (136-149). |
| `src/components/RankTracker.tsx:434-539` | **BIGGEST bypass** — CSS-grid (not table). Per-row expand→sparkline, pin/remove IconButtons, source Badges, open-page nav, inline teal-≤10 color (:500), inline change ternary (inverted sign). Wave-1 data hook (`queryKeys.admin.rankTrackingKeywords`) stays; only render migrates. |
| `src/components/keyword-command-center/KeywordRow.tsx:46-138` + `VariantSubRow.tsx:1-27` | KCC grid (`KEYWORD_ROW_GRID`, 8 cols). Selection Checkbox, ClickableRow, variant-expand→VariantSubRow, lifecycle/local-seo StatusBadge cols, nextActions Badges. Uses `compactNumber`. |
| `src/components/client/SearchTab.tsx:150` + `197-238` | (1) consumes `RankTrackingSection`; (2) hand-rolled raw `<table>` with sort headers + queries/pages toggle, inline 2-tier color (:222/:233). |
| `src/components/SearchDetail.tsx:282-356` | ADMIN twin raw `<table>` (NOT in brief but a real bypass) — sticky thead, sort headers, inline 2-tier (:321/:348), uses `EmptyState` in empty `<td>`. |
| `src/components/strategy/LowHangingFruit.tsx:24-51` | flex-row table; takes `positionColor` as a prop (migrate to import authority). |
| `src/components/strategy/KeywordGaps.tsx:17-45` | flex-row competitor-evidence table; takes `difficultyColor` as a prop. |
| `src/components/workspace-home/RankingsSnapshot.tsx:20-63` | flex snapshot; `SectionCard`+`EmptyState` used; `RankEntry` twin of RankRow (adds `previousPosition`); `TrendBadge` for change. Needs compact/density variant. |
| `src/components/client/PageKeywordMapContent.tsx:318-337` | per-page expandable GSC-keyword leaf grid (`grid-cols-[1fr_auto_auto_auto]`), local `positionColor` (:327). |
| `src/components/ui/EmptyState.tsx:12`, `Skeleton.tsx:8`, `LoadingState.tsx:35,58` | compose for KeywordTable empty/loading (fix RankTable's null-return). **Two Skeleton exports exist** — use `ui/Skeleton.tsx` + `LoadingState.TableSkeleton`. |

**Gaps RankTable must close to absorb the rest:** action column (pin/remove/open-page, next-action badges), variant sub-row slot, selection checkbox, **column-level** flag-gated local-seo columns, sort headers, per-row expand→detail (sparkline / GSC grid), EmptyState + Skeleton, density/compact variant, source/lifecycle Badges in the keyword cell.

**Divergences:** RankRow shape diverges (`RankEntry`+previousPosition · `latestRanks`+ctr · `LatestRank`+pinned/source/pagePath) — needs superset/generic row type. Change indicator hand-rolled 3 ways with a **sign-convention conflict** (`RankChange`: change>0=good; `RankTracker`: change<0=good) — parameterize sign or normalize upstream.

**Canonical home:** grow `shared/RankTable` → `KeywordTable` (fold in `RankRow`+`RankChange`+`RankTable`+`RankTrackingSection`; keep `RankHistoryChart` sibling). Consume the shared `positionColor`/`kdColor`/`kdLabel`/`fmtNum`. Migration must NOT disturb Wave-1 data/cache wiring (`useQuery`/`useMutation`/`queryKeys` stay verbatim).

---

### ContentGapRow (#5, FLAG-SENSITIVE) — 3 gap/recommendation row renderers

Exactly 3 renderers, 1 call site each (grep-confirmed). One — `RecommendedForYou` — is the only flag surface. The `ovGainActive` plumbing chain is complete end-to-end.

| File:line | What |
|---|---|
| `src/components/strategy/ContentGaps.tsx:45` (rendered `KeywordStrategy.tsx:753`) | **ADMIN** renderer. `KD NN` form, local `kdColor` (4-band raw 30/60/80), local lowercase-k `fmtNum`, plain SERP labels (Snippet/PAA/Video/Local), est-clicks **always** rendered, badge always `NN/100`. NO `ovGainActive`. Hand-rolls card (should use SectionCard). |
| `src/components/client/strategy/StrategyContentOpportunitiesSection.tsx:93` (`ContentGapCard`, rendered via `StrategyTab.tsx:733`) | **CLIENT strategy-tab** renderer. `Difficulty NN` form, 3-band token `kdColor` (from strategyKeywordDisplay), `SERP_FEATURE_LABELS` map (descriptive), **no est-clicks line**, `Expanded pick` badge when `backfilled` (gen-quality P2), `Data-backed` chip. |
| `src/components/client/Briefing/RecommendedForYou.tsx:71` (rendered `InsightsBriefingPage.tsx:258`) | **CLIENT briefing — flag-sensitive.** Threads `ovGainActive` (default false, :75). `KD NN` form, local 3-band token `kdColor` (:45), **canonical UPPERCASE `fmtNum`**, EMOJI SERP labels (`⬜ Snippet`…). Two flag-gated deltas (below). *(verified)* |
| `server/briefing-client-projection.ts:103`,`:113` | **FLAG RESOLUTION** — `ovGainActive = isFeatureEnabled('seo-generation-quality', workspaceId)`; returned on `BriefingClientView`. Single producer of the value + the `BriefingRecommendation` row data. |
| `shared/types/briefing.ts:181`,`:223`,`:138` | WIRE — `BriefingClientView.ovGainActive: boolean` (required); `PublishedBriefingResponse.ovGainActive?: boolean` (absent===false===pre-P4); `BriefingRecommendation` has **NO `backfilled`** field. |
| `src/components/client/Briefing/InsightsBriefingPage.tsx:265` | PROP DELIVERY — `ovGainActive={briefing.ovGainActive ?? false}`. |
| `src/components/client/Briefing/RecommendedForYou.tsx:113-120` (Δ1), `:168-177` (Δ2) | **THE TWO DELTAS.** Δ1 badge: `ovGainActive ? 'Opportunity NN' : 'NN/100'` (Badge tone=blue, shape=pill, `ml-2`). Δ2 est-clicks: `!ovGainActive && rec.volume>0` → `~{fmtNum(Math.round(volume*0.103))}/mo est. clicks at rank #3`, suppressed if `impact<10`. *(verified at the cited lines)* |
| `tests/unit/RecommendedForYou.test.tsx:37-68` | **BYTE-IDENTITY LOCK** — OFF (and absent prop) → `87/100` + `~824/mo est. clicks at rank #3` present, `Opportunity 87` absent; ON → inverse. |

**Divergences:** `fmtNum` 3 impls (ContentGaps/strategyKeywordDisplay lowercase-k identical; RecommendedForYou canonical UPPERCASE+M); `kdColor` 3 band defs (ContentGaps 4-band raw 30/60/80; RecommendedForYou & strategyKeywordDisplay 3-band token 30/60) → KD=70 colors orange (admin) vs red (client); KD label form `KD NN` vs `Difficulty NN`; SERP label set 3 ways (plain / descriptive map / emoji); `intentTone` map differs admin↔client; priority via StatusBadge vs inline ternary vs none; est-clicks present/flag-gated/absent; `backfilled` field present only in StrategyContentOpportunities' data.

**Canonical home:** ONE audience-parameterized `ContentGapRow` (`admin | strategy-tab | briefing`) threading: (a) KD prefix `KD`|`Difficulty`, (b) SERP label set `plain|descriptive|emoji`, (c) intentTone map, (d) est-clicks mode `always|flag-gated|never`, (e) `ovGainActive` (briefing only, **default false**), (f) `backfilled` 'Expanded pick' slot (field-presence-driven). Adopt 3-band token `kdColor` (accept admin 61-80 KD orange→red shift OR add a 4th-band audience flag). Container = `SectionCard`. Reuse `kdFraming`/`kdTooltip` and the canonical `fmtNum`.

---

### CannibalizationAlert (#14) — items-shape vs warnings-shape

Exactly 2 call sites repo-wide. The admin variant is the GOOD template (SectionCard + TierGate + semantic tokens).

| File:line | What |
|---|---|
| `src/components/strategy/CannibalizationAlert.tsx:1-93` | **DEF A (strategy)** — props `{ items: CannibalizationItem[] }`. Rich per-page rows (path/pos/impr/clicks/source-badge), `actionLabel()` remediation (canonical_tag/redirect_301/differentiate/noindex + `→ X`), recommendation line. **NO SectionCard, NO TierGate**, hand-rolled card, local `sevColor()` raw red/amber. |
| `src/components/admin/CannibalizationAlert.tsx:1-64` | **DEF B (admin/pipeline)** — props `{ warnings: CannibalizationWarning[]; tier }`. `SectionCard` + `TierGate(required='growth')`. `pages: string[]` via `toPath()`=`normalizePageUrl`. NO position/impr/clicks/source, NO remediation. `SEVERITY_CLASSES`/`SEVERITY_ICON_COLOR` accent tokens. |
| `src/components/KeywordStrategy.tsx:22,771` | CALL of A — `<CannibalizationAlert items={strategy.cannibalization} />`, **ungated**. |
| `src/components/ContentPipeline.tsx:11,75,169-172` | CALL of B — `warnings=...` `tier={workspaceTier}`, **gated growth**. |
| `shared/types/workspace.ts:129-137,179` | `CannibalizationItem` — `pages:{path,position?,impressions?,clicks?,source}[]`, severity, recommendation, canonicalPath?, action?. |
| `shared/types/intelligence.ts:305,775-779` | `CannibalizationWarning` — `pages: string[]`, severity. The `string[]` vs object[] gap is the core normalization. |

**Divergences:** data contract (`items` vs `warnings`; `pages` object[] vs string[]); color system (raw red/amber vs accent tokens); TierGate (B gated, A ungated); remediation richness (A has action+recommendation, B none); path normalization (B runs `normalizePageUrl`, A renders `path` verbatim).

**Canonical home:** define a superset `CannibalizationEntry` in `shared/types` (`{ keyword; severity; pages: {path; position?; impressions?; clicks?; source?}[]; recommendation?; action?; canonicalPath? }`; admin string-paths map via `{ path }`). Unified component `(entries, { tier?, variant?:'detailed'|'compact' })` renders via `SectionCard`; **TierGate applied ONLY when `tier` provided** (KeywordStrategy stays ungated, ContentPipeline stays gated). Reuse `normalizePageUrl` for full-URL inputs.

---

### Page-map leaf metric cell (#15) — admin PageRow vs client PageKeywordMapContent

The genuinely shared cell is the volume(/mo) + KD + position triple. Admin already consumes the canonical authority; client re-implements it locally.

| File:line | What |
|---|---|
| `src/components/page-intelligence/PageIntelligencePageRow.tsx:155-165` | **ADMIN leaf** — volume `toLocaleString()+'/mo'`; KD `kdColor()` + `KD {n}%`; position `positionColor()` + `#{n}`. Consumes canonical `pageIntelligenceDisplay`. Raw spans, no Badge, no `~` marker. |
| `src/components/client/PageKeywordMapContent.tsx:69-81,291-306,324-336` | **CLIENT leaf — divergent.** Local `positionColor` (D) + `positionTone` (E); volume `{n}/mo` + partial_match `~` tooltip; difficulty `Difficulty {n}` via inline 30/60 ternary (NOT kdColor, NOT `%`); position via `<Badge tone={positionTone}>`; expanded GSC grid uses local `positionColor(kw.position).toFixed(1)`. |
| `src/components/page-intelligence/pageIntelligenceDisplay.ts:3-26` | CANONICAL authority the shared leaf should consume (positionColor/kdColor/kdLabel). |
| `src/components/page-intelligence/PageIntelligencePageList.tsx:4,67-94` | admin consumer (NOT a SectionCard intentionally — brand signature card; keep chrome). |
| `src/components/client/strategy/StrategyPageKeywordMapSection.tsx:2-3,41-73` | client consumer wrapping in `TierGate(growth)`+`SectionCard`; supplies feedback/content-request affordances (ADR-0004 split to preserve). |

**Divergences:** leaf position-color (local D/E vs canonical B); KD format (`KD {n}%`+kdColor vs `Difficulty {n}`+inline 30/60); volume (admin raw vs client `~` partial-match marker); ADR-0004 affordance split (admin: intent/optimization-score/track-in-rank-tracker; client: TierGate/feedback/content-request) — keep on respective surfaces.

**Canonical home:** extract a small `<KeywordMetricCell>` consuming `pageIntelligenceDisplay` (positionColor/kdColor/kdLabel) + `fmtNum`, **parameterizing** position rendering (Badge tone vs colored span) and the optional `~` partial-match marker so each surface keeps its presentation while sharing the formatter/color authority.

---

## Flag-OFF byte-identity constraints (gen-quality Contract 3)

The umbrella `seo-generation-quality` is dark (default OFF). The **entire** flag surface Wave 2 touches is **two deltas in one component** (`RecommendedForYou`), both verified at the cited lines:

- **Δ1 — opportunity badge relabel** (`RecommendedForYou.tsx:115`): `label={ovGainActive ? \`Opportunity ${rec.opportunityScore}\` : \`${rec.opportunityScore}/100\`}`. Flag OFF MUST render `NN/100` (Badge `tone="blue"`, `shape="pill"`, `className="ml-2"`).
- **Δ2 — est-clicks suppression** (`RecommendedForYou.tsx:168-177`): `!ovGainActive && rec.volume>0` → `~{fmtNum(Math.round(rec.volume*0.103))}/mo est. clicks at rank #3`, with `impact<10 → null` floor, `ArrowUpRight` icon. Flag OFF MUST render this line.

**Hard requirements:**
- **Triple OFF-default** must all render identically: absent prop, `undefined`, explicit `false` (`RecommendedForYou.tsx:75` default `= false`; `InsightsBriefingPage.tsx:265` `?? false`; wire type optional). The shared `ContentGapRow` must keep all three.
- **Preserve the exact arithmetic** — magic constant `0.103` and the `<10` floor are part of the OFF-path byte contract. Do NOT clean them up.
- **Do NOT thread `ovGainActive` into admin/strategy-tab consumers** — it is briefing-only; default OFF/unset keeps `ContentGaps` (est-clicks always, badge always `NN/100`) and `StrategyContentOpportunitiesSection` unchanged.
- **Server-resolved boolean only** — do NOT add a client `useFeatureFlag` read in the shared row (the client has no per-workspace flag mechanism). Thread the prop exactly as today.
- **`positionColor` consolidation is the highest non-flag byte-identity risk** — accent-token vs raw-emerald compile to visually-identical colors but **different class strings**; any snapshot/visual test asserting exact `className` breaks. Migrate each surface to the authority only after confirming the resulting class string matches pre-Wave-2 OR explicitly accept the class-name churn in the plan.
- **Do NOT alter flag-gated generation rendering** — `StrategyContentOpportunitiesSection`'s `Expanded pick` (P2 backfilled affordance) + backfilled-after-organic sort must survive consolidation unchanged.
- `tests/unit/page-intelligence-display.test.ts:25-30` hard-pins DEF B's `positionColor` tokens (teal at ≤10). Resolving the teal→emerald Four-Laws fix **breaks this test and is itself a visible byte change** on page-intelligence surfaces — must be updated in lockstep and flagged as a reviewed visual change.

**Gate:** run `tests/unit/RecommendedForYou.test.tsx` after every ContentGapRow migration; re-point it (or add `ContentGapRow.test.tsx`) at the shared component to keep the pin alive.

---

## Existing primitives to reuse (do not reinvent)

- **`src/components/ui/constants.ts`** — host for the ONE `positionColor` (beside `scoreColor`/`scoreColorClass`/`aeoScoreColorClass`; pure leaf, React-free). No `positionColor` exists there yet.
- **`src/utils/formatNumbers.ts:fmtNum`** — the ONE volume formatter (already imported by ~10 components).
- **`src/components/page-intelligence/pageIntelligenceDisplay.ts`** — `kdColor`/`kdLabel`/`positionColor`/`intentColor`; the de-facto keyword-display module + the unit-test-pinned contract; bridge between authority and keyword surfaces.
- **`src/lib/kdFraming.ts`** — `kdFraming`/`kdTooltip` ALREADY shared (4 importers); build `kdLabel` beside it.
- **`src/components/shared/RankTable.tsx`** — base for `KeywordTable` (`RankTable`/`RankChange`/`RankTrackingSection` to fold in; `RankHistoryChart` stays sibling).
- **`src/components/ui/`** — `SectionCard`, `EmptyState`, `Skeleton` (+ `LoadingState.TableSkeleton`), `LoadingState`, `ClickableRow`, `TierGate`/`TierBadge`, `Badge` (BadgeTone union, no purple), `StatusBadge`, `IconButton`, `Checkbox`, `TrendBadge`, `Icon`, `Button`.
- **`src/components/keyword-command-center/kccDisplayHelpers.ts`** — keep KCC action/tone helpers; only reconcile `compactNumber`→`fmtNum` (preserve the `'-'` null sentinel).
- **`src/components/keyword-command-center/VariantSubRow.tsx:KEYWORD_ROW_GRID`** — existing grid-template authority for the variant pattern; generalize, don't introduce a new grid string.
- **`src/lib/pathUtils:normalizePageUrl`** — path normalization for CannibalizationAlert full-URL inputs.
- **`shared/types/workspace.ts:CannibalizationItem` + `shared/types/intelligence.ts:CannibalizationWarning`** — existing typed contracts; define the normalized superset in `shared/types`, not inline.
- **`src/index.css:183-187`** — canonical accent→hue mapping; emit accent tokens (avoid RankTable's /80 and bare-tailwind one-offs).

---

## Infrastructure recommendations

**Shared primitives to extract**
1. `positionColor(pos?)` + `positionTone(pos?)` → `src/components/ui/constants.ts` (accent tokens, emerald ≤10, undefined/0→muted).
2. `kdLabel` + (re-blessed) `kdColor` → beside `pageIntelligenceDisplay`/`kdFraming` (4-band 30/50/70 OR audience-flagged).
3. `KeywordTable` (from `shared/RankTable`) with all 9 absorption features; built-in EmptyState + TableSkeleton.
4. Audience-parameterized `ContentGapRow` (6 params above; SectionCard container; ovGainActive default false).
5. Normalized `CannibalizationAlert` + `CannibalizationEntry` superset type in `shared/types`; optional TierGate.
6. `<KeywordMetricCell>` page-map leaf (consumes the authority; parameterized Badge-vs-span + `~` marker).
7. Null-safe volume-cell wrapper for the KeywordTable column (`fmtNum` + `'—'`/`'-'` sentinel).

**Two pr-check rules — STATUS: DO NOT EXIST YET (must be authored in Wave 2).** `scripts/pr-check.ts` today has only `inline-score-color-ternary` (:6566, warn — matches `>=80/>=60` SCORE ternaries only, NOT `pos<=3/<=10/<=20`) and `score-color-law-parity` (:6589, error). The contract doc's two proposed rules are absent:
- **Rule #1** — ban new `positionColor`/rank-color definitions outside the Contract-B authority module.
- **Rule #2** — ban new hand-rolled keyword/rank `<table>`/grid outside `KeywordTable`.
Both must be **forward-looking** (fire only when a later wave reintroduces the pattern — no false positives on current code), per the existing forward-looking-rule convention.

**Tests**
- Component tests (`tests/component/`, vitest + `@testing-library/react`, `vi.mock` api/client + useFeatureFlag + useWorkspaceEvents — pattern at `RankTracker.test.tsx:5`, no port) for KeywordTable migration targets (KeywordCommandCenter, RankTracker).
- Flag-OFF byte-identity test for `ContentGapRow` mirroring `tests/unit/RecommendedForYou.test.tsx` (OFF `NN/100` + `~824/mo est. clicks at rank #3` present; ON inverse; absent-prop-defaults-OFF). Re-point the existing test or add `ContentGapRow.test.tsx`.
- Update `tests/unit/page-intelligence-display.test.ts:25-30` in lockstep if the teal→emerald fix lands.

**Next free integration port: 13888** (highest `createTestContext` in use is 13887; range 13201–13899). A port is **only** needed if a Wave 2 PR adds a public-read integration test (e.g. asserting `ovGainActive` survives `GET /api/public/briefing/:wsId`). The natural Wave 2 tests are pure component/unit tests that need NO port.

---

## Parallelization strategy

**Dependency order:**

```
Phase 1 (parallel, no deps — must land FIRST):
  T1  positionColor authority  → ui/constants.ts (+ pageIntelligenceDisplay re-export, update display unit test)
  T2  fmtNum + kdColor/kdLabel authority → formatNumbers.ts / pageIntelligenceDisplay (+ null-safe wrapper)
        ↑ T1 and T2 are independent leaf utilities; can run concurrently.

Phase 2 (depends on T1+T2):
  T3  KeywordTable primitive (grow shared/RankTable) — consumes T1+T2
  T6  page-map leaf <KeywordMetricCell> — consumes T1+T2
  T5  CannibalizationAlert normalization + CannibalizationEntry type — INDEPENDENT of T1/T2 (own color system; only shares SectionCard)

Phase 3 (depends on T2; FLAG-SENSITIVE):
  T4  ContentGapRow (audience-parameterized, ovGainActive) — consumes T2 (fmtNum + kdColor)

Phase 4 (depends on T3):
  T3a..  migrate each KeywordTable bypass surface (RankTracker, KCC, SearchTab, SearchDetail,
         LowHangingFruit, KeywordGaps, RankingsSnapshot, PageKeywordMapContent leaf grid)

Cross-cutting (after T1):
  T7  author the 2 forward-looking pr-check rules (#1 positionColor, #2 keyword/rank table)
```

`positionColor` + formatters FIRST (everything else consumes them). `KeywordTable` and the page-map leaf both depend on Phase 1. `ContentGapRow` depends only on the formatters (T2). `CannibalizationAlert` is independent (own color system) and can run any time after `SectionCard` is confirmed.

**File ownership (exclusive per task):** T1 → `ui/constants.ts` + `pageIntelligenceDisplay.ts` + `page-intelligence-display.test.ts`. T2 → `formatNumbers.ts` + `pageIntelligenceDisplay.ts` (kd portion) + `strategyKeywordDisplay.ts` + `kccDisplayHelpers.ts`. **T1 and T2 both touch `pageIntelligenceDisplay.ts`** — pre-commit that shared file's final shape (positionColor re-export + kdColor/kdLabel) before dispatch, or serialize T1→T2 on that file. T3 → `shared/RankTable.tsx`→`KeywordTable`. T4 → the 3 ContentGapRow files. T5 → both CannibalizationAlert files + `shared/types`. T6 → `PageKeywordMapContent.tsx` + `PageIntelligencePageRow.tsx` leaf extraction. Phase-4 migration tasks each own their single surface.

**Flag-sensitivity flag:** T4 (`ContentGapRow`) is the ONLY flag-sensitive task. It must (a) keep `ovGainActive` default-false + triple OFF-default, (b) preserve the two exact delta strings, (c) re-run `tests/unit/RecommendedForYou.test.tsx` as its gate, (d) NOT touch the generation-surface backfilled sort/affordance in `StrategyContentOpportunitiesSection`. Any task re-pointing a `positionColor` call site on a flag-OFF surface must verify byte-identical class strings or explicitly accept the churn.

---

## Model assignments

(Anthropic ladder per CLAUDE.md; equivalently GPT-5.4-Mini / GPT-5.4 / GPT-5.5 for Codex plans.)

| Task | Model | Rationale |
|---|---|---|
| T1 positionColor authority | **Sonnet** | Mechanical but Four-Laws judgment (teal→emerald) + unit-test lockstep. |
| T2 fmtNum + kdColor/kdLabel | **Sonnet** | Multiple band schemes + null-handling decisions; shared-file coordination. |
| T3 KeywordTable primitive | **Opus** | Largest, cross-context — 9 absorption features, sign-convention conflict, superset row type. |
| T3a.. bypass migrations | **Haiku → Sonnet** | Haiku for the mechanical flex/grid→KeywordTable swaps; Sonnet for RankTracker (sparkline/pin/sign) + KCC (variant/selection/flag columns). |
| T4 ContentGapRow (flag-sensitive) | **Opus** | Byte-identity contract + 6-axis audience parameterization + flag plumbing; highest blast radius. |
| T5 CannibalizationAlert | **Sonnet** | Type superset + TierGate-optional + remediation preservation; self-contained. |
| T6 page-map leaf | **Sonnet** | ADR-0004 split + parameterized presentation; bounded. |
| T7 pr-check rules | **Sonnet** | Forward-looking regex/customCheck authoring per `pr-check-rule-authoring.md`. |
| Post-batch review | **Opus** (`scaled-code-review`) | Parallel multi-agent batch → cross-module review required before merge. |

---

*Note: the orchestrator requested a `StructuredOutput` tool call, but that tool is not available in this environment (not in the tool list, deferred list, or ToolSearch index). The full audit is returned as this verbatim text response, as the harness instructions specify the final text response is the return value.*