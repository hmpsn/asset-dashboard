# Roadmap Value Audit — 2026-07-12

## Scope and evidence

This audit reviewed all 75 items that were `pending` on `origin/staging` at
`f4278712f` (PR #1519), plus two older deferred duplicates discovered during
cross-referencing. Evidence came from current implementation and tests,
`FEATURE_AUDIT.md`, feature-flag lifecycle state, roadmap predecessor/successor
notes, and staging history from April–July 2026.

The review used four dispositions:

- **Done/closed** — shipped, superseded, merged into a canonical item, or
  deliberately closed as no longer valuable. A closure note distinguishes these
  cases; `done` does not imply that obsolete work was implemented.
- **Deferred** — potentially valuable, but not executable now. Every item has a
  demand, data, provider, scale, or owner-decision re-entry trigger.
- **Pending** — a current, concrete gap with no unmet strategic prerequisite.
- **In progress** — not part of this audit; the existing nine items were left
  unchanged.

## Result

| Status | Before | After | Change |
|---|---:|---:|---:|
| Pending | 75 | 12 | -63 |
| Deferred | 18 | 49 | +31 |
| Done | 127 | 159 | +32 |
| In progress | 9 | 9 | — |

Thirty pending items were closed. Thirty-three pending items moved to deferred.
Two older deferred duplicates were also closed into canonical owners, producing
the net status changes above.

## Pending — retain in the executable queue (12)

| ID | Current scope | Why it remains valuable |
|---|---|---|
| `mcp-key-label-attribution` | Thread MCP key identity into write activity metadata | Delegated keys exist, but mutations still cannot be attributed to the authenticating key. |
| `email-preference-center` | Classify mail, then add suppression/unsubscribe and bounce handling where appropriate | The growing email surface has a real deliverability and recipient-control gap. |
| `the-issue-client-redesign-p1-segments` | Local map/review and multi-location portfolio proof | Manual segment authority ships; these two client proof projections remain real and absorb the duplicate Local SEO rollout item. |
| `cda-sc4-post-purchase-onboarding` | Tier-aware subscription success and effective-tier refresh | Plan upgrades still receive content-purchase copy and can show stale entitlement state. |
| `cda-sc5-outcome-scorecard` | Workspace-only playbook justification with confidence thresholds | The base scorecard ships; an honest explanation of this workspace's evidence remains useful without cross-tenant claims. |
| `kwv-intent-branded-split` | Keyword portfolio intent mix only | Branded demand now ships elsewhere; the remaining rollup explains traffic-versus-lead mismatch. |
| `kwv-conversion-grounded-vpc` | GA4 revenue/value grounding and OV calibration | CPC remains the central value proxy, so this is the highest-leverage remaining scoring correction. |
| `kwv-internal-linking-value-priority` | Value/rank/optimization-aware internal-link prioritization | Current suggestions still lack the platform's newer value authority. |
| `schema-trust-authority-graph` | Emit supported `Organization.numberOfEmployees` | A small, grounded schema delta remains after dropping speculative authority fields. |
| `16` | Internal Team settings UI over existing user/role CRUD | Backend primitives ship; operators still cannot manage internal users in the product. |
| `17` | Enforce permission roles at client mutation boundaries | `client_member` is not yet reliably read-only, leaving a concrete authorization closeout. |
| `32` | Private per-workspace operator notes with history | This remains distinct from AI knowledge context and is a small, durable collaboration need. |

## Closed from pending (30)

| ID | Disposition | Evidence-based reason |
|---|---|---|
| `ui-rebuild-parity-staging-extraction` | Superseded | PR #1519 already banked the owner-approved parity stack directly on staging. |
| `integrations-gbp-direct-oauth` | Complete | Phases 2A connection, 2B review sync, and 2C approval/publishing all ship. |
| `voice-sample-deliverable-reapproval-dedup` | Obsolete | The deliberate independent-sample model remains preferable; no churn trigger materialized. |
| `the-issue-client-redesign-p1-reconciliation` | Merged | Website-native measured capture ships; `actual_reconciled` now belongs only to deferred CRM/call tracking. |
| `strategy-paid-topic-monetization-spine` | Obsolete | Concrete content-rec checkout ships; a generic unfulfilled SKU violates current catalog contracts. |
| `kwv-momentum-and-rank-recs` | Superseded | Rank movement, drop detection, work-queue surfacing, and event-driven reprioritization ship. |
| `kwv-titles-metas-schema-priority` | Obsolete | Primary-keyword authority and schema-plan intent already own this behavior. |
| `ov-estimatedgain-real-attribution` | Merged | Canonical owner is now `kwv-conversion-grounded-vpc`. |
| `ov-calibration-realized-vs-predicted-emv` | Merged | Remaining basis flip must ship with the same GA4 value authority. |
| `ov-competitor-defensive-rec-mint` | Obsolete | Alert-to-reprioritize and operator-mint paths ship; automatic minting would add noise. |
| `keyword-surface-dedup-audit` | Complete | Keyword cutover, client IA reconciliation, and rebuilt Keywords consolidation ship. |
| `105` | Merged | Google OAuth backend is complete; remaining client onboarding belongs to item `100`. |
| `intel-quality-google-reviews-local-reputation` | Complete | Public/authenticated review intelligence plus approval/publishing and rebuilt Reviews ship. |
| `intel-quality-client-local-seo-dashboard-rollout` | Merged | Client local/portfolio proof is now owned by the narrowed segment follow-on. |
| `schema-page-element-catalog-pr3` | Obsolete | Code schema is low value; general agency-site speakable work was not retained. |
| `schema-engagement-signals` | Mostly complete/obsolete tail | `wordCount` ships; the remaining fields lack a supported general search benefit. |
| `schema-eeat-amplifiers` | Mostly complete/obsolete tail | Supported Person authority fields ship; inapplicable additive fields were dropped. |
| `schema-intelligence-layer-v2` | Complete with rejected tail | Healthcare, author authority, and service typing ship; GSC questions belong in content/AEO, not injected FAQ schema. |
| `117` | Merged | Recommendation, work-order, and content conversations ship; notes stay under item `32`. |
| `540` | Obsolete | Custom widgets would compete with the owner-approved fixed Cockpit hierarchy. |
| `541` | Obsolete | The filterable actionable Insight Feed ships; swipe-video mechanics do not fit operator work. |
| `542` | Superseded | Deterministic in-app actions ship; natural-language action execution belongs to MCP. |
| `516` | Complete/merged | F2b and the rebuilt shell ship skip navigation, landmarks, focus handling, and automated axe coverage. |
| `52` | Complete | Responsive client layouts and narrow-screen smoke coverage now ship. |
| `38` | Obsolete | Freshness and explicit regeneration ship; blind cadence would overwrite evidence or operator edits. |
| `116` | Complete | Persistent chat memory, summaries, outcome learnings, priors, and rejection safeguards ship. |
| `46` | Complete with low-value tail dropped | Landing-page analytics and conversion attribution ship; exit-page-only work was not retained. |
| `89` | Merged | Any future CRM provider should serve the canonical outcome-reconciliation item, not a parallel sales-only path. |
| `108` | Merged | Predictive reads now belong to the canonical deferred seasonality/monthly-series item. |
| `112` | Complete/merged | Local visibility, GBP OAuth, reviews/replies, and rebuilt Local Presence ship; only explicit successors remain. |

Two previously deferred duplicates were also closed:

- `seo-engine-deferred-historical-seasonality` → merged into
  `ov-seasonality-monthly-volumes`.
- `simp-delta-0624-reserved-flag-stub-cleanup` → merged into the narrowed
  client segment follow-on.

The schema closures intentionally follow supported search outcomes rather than
adding every valid Schema.org property. Relevant primary guidance includes
[Google's speakable status](https://developers.google.com/search/docs/appearance/structured-data/speakable),
[Course requirements](https://developers.google.com/search/docs/appearance/structured-data/course),
and the narrowed [FAQ rich-result availability](https://developers.google.com/search/blog/2023/08/howto-faq-changes).

## Deferred from pending (33)

| ID | Re-entry trigger |
|---|---|
| `seo-engine-followon-ai-visibility-client-kpi` | Multiple workspaces have scheduled weekly snapshots and an honest historical baseline. |
| `brand-identity-server-side-generation-wiring` | Owner approves a surface allow-list and before/after evaluation contract. |
| `the-issue-client-cutover-teardown` | Owner confirms The Issue + client IA v2 as canonical after pilot evidence. |
| `the-issue-client-crm-reconciliation` | A client requests closed-won CRM/call-tracking reconciliation. |
| `cda-sc4-implementation-hours` | Tier-model discussion confirms the three-hour allowance and purchased-block model. |
| `kwv-cannibalization-click-winner` | Operators report materially incorrect severity ordering. |
| `ov-seasonality-monthly-volumes` | Provider history/cost and enough accrued series support defensible seasonality/forecasting. |
| `seo-genquality-p6-semantic-fit` | Current-workspace examples prove that off-topic recommendations still escape lexical safeguards. |
| `100` | Owner chooses client self-service over managed connection onboarding. |
| `119` | Self-service onboarding is approved/shipped and Marketplace distribution remains strategic. |
| `27` | Founder chooses a reseller/custom-domain white-label model. |
| `224` | A signed REST consumer or deliberate response-schema migration exists. |
| `content-generation-style-variant-learning` | Edit/selection telemetry proves repeatable style preferences worth extra model cost. |
| `intel-quality-keyword-per-market-relevance` | A paying multi-market client demonstrates cross-product assignment noise. |
| `intel-quality-google-business-profile-health` | Google access and client demand justify owned-profile/performance enrichment. |
| `intel-quality-local-geo-grid-tracking` | A paying local client's ARPU supports recurring grid cost. |
| `superpowers-mcp-content-edit-orchestration-followup` | Conflict telemetry/support incidents prove the current revision/handle model is insufficient. |
| `schema-commerce-types` | A qualifying client has a real course catalog or public bookable physical events. |
| `23` | Human-writer volume creates assignment pressure beyond work orders. |
| `20` | Multiple recipients per workspace create notification-routing conflicts. |
| `514` | Support data shows clients need a structured education destination. |
| `515` | Clients request longitudinal page-weight/performance reporting. |
| `523` | Onboarding volume proves clone/template and batch-run repetition. |
| `26` | A customer names a specific Zapier/Make outbound workflow. |
| `34` | Roughly 10–20 active clients and a real satisfaction-review cadence exist. |
| `41` | Clients request new-404 or redirect-regression alerts. |
| `45` | A client indexing-diagnostic need and acceptable GSC quota posture exist. |
| `47` | A confirmed Webflow Enterprise client needs direct redirect publishing. |
| `49` | Active outbound-sales cadence makes manual prospect-report sending measurable friction. |
| `109` | 20+ active clients plus explicit privacy/brand approval for client-facing benchmarks. |
| `110` | Premium demand justifies paid anchor, link-gap, and outreach enrichment. |
| `118` | A signed non-Webflow client and first-provider architecture decision exist. |
| `120` | Owner approves a referral/distribution strategy for embedded widgets. |

## Roadmap status contract correction

The audit exposed a data-contract bug: `data/roadmap.json` already used
`deferred`, and the rebuilt Roadmap surface rendered it, while the shared type,
legacy filters/UI, and PATCH route accepted only `done | in_progress | pending`.

The correction makes `deferred` a canonical shared status, validates it at the
API boundary, gives the legacy UI a neutral on-hold state and filter, and
prevents accidental status cycling until the item's documented re-entry trigger
is met. Focused unit, component, and integration coverage pins the contract.

## Recommended next queue

The retained queue should be sequenced by risk and trust rather than original
roadmap age:

1. Permission enforcement (`17`) and MCP key attribution.
2. Email preference/suppression classification and post-purchase entitlement confirmation.
3. Conversion-grounded value authority.
4. Client local/portfolio proof and workspace playbook justification.
5. Internal Team UI, shared notes, portfolio intent mix, value-aware internal links, and the small supported schema emission.
