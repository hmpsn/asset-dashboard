# Platform Domain Smoke Matrix

This is the fast ownership spine for platform health work. It does not replace deeper integration, E2E, or coverage work; it names the minimum smoke signal each bounded context should keep visible before larger feature work merges.

Source of truth: `scripts/platform-domain-smoke-matrix.ts`

Run:

```bash
npx tsx scripts/platform-domain-smoke-matrix.ts
npx tsx scripts/platform-domain-smoke-matrix.ts --json
npx vitest run tests/unit/platform-domain-smoke-matrix.test.ts
```

The report is advisory. Structural gaps are printed and tested, but the script exits successfully so teams can use it during planning without turning Wave 2 into a new PR gate.

## Matrix

| Bounded context | Core smoke path | Fast test command | Known gap |
| --- | --- | --- | --- |
| `workspace-command-center` | Admin workspace overview, settings, reports, and health summary stay readable after workspace setup. | `npx vitest run tests/integration/workspaces.test.ts tests/integration/e2e-workspace-reports.test.ts` | Mobile/admin UI smoke remains a Wave 2b workflow coverage target. |
| `client-portal` | Client token login reaches public workspace data, client analytics, and tier-aware portal surfaces. | `npx vitest run tests/integration/public-portal-auth.test.ts tests/integration/public-analytics.test.ts tests/contract/client-intelligence-tiers.test.ts` | High-value public serialization expansion stays pending in `platform-confidence-api-contract-tests`. |
| `inbox` | Admin sends an item, client decides or replies, and admin/client views converge on the updated state. | `npx vitest run tests/integration/client-actions-routes.test.ts tests/integration/approvals-routes.test.ts tests/integration/public-approval-broadcasts.test.ts` | End-to-end admin-to-client-to-admin journey coverage belongs in Wave 2b. |
| `content-pipeline` | Brief, post, review, publish, and content-plan paths preserve lifecycle state and public review access. | `npx vitest run tests/integration/content-brief-routes.test.ts tests/integration/content-posts-workflow.test.ts tests/integration/content-plan-review-routes.test.ts` | More external publishing failure modes remain in the critical coverage sprint. |
| `schema` | Schema generation, validation, review, and CMS publish paths preserve generated schema and validation status. | `npx vitest run tests/integration/schema-entity-graph.test.ts tests/integration/schema-plan-public-routes.test.ts tests/unit/schema-validation-pipeline.test.ts` | Full Google validator and CMS publish failure matrix remains a Wave 2b target. |
| `seo-health` | SEO audits, recommendations, page health, and rewrite workflows read current page/provider data without stale enrichment. | `npx vitest run tests/integration/seo-audit-routes.test.ts tests/integration/recommendations-routes.test.ts tests/integration/webflow-seo-writes.test.ts` | Provider outage and stale-cache failure cases stay with critical coverage hardening. |
| `analytics-intelligence` | Insights hydrate from analytics/intelligence slices and render typed insight data for admin and client consumers. | `npx vitest run tests/integration/insights-routes.test.ts tests/unit/workspace-intelligence.test.ts tests/contract/insight-data-shapes.test.ts` | Cross-slice coverage thresholds are tracked in the Wave 2b coverage baseline. |
| `brand-engine` | Voice calibration, brandscript, copy generation, and prompt assembly inject the resolved brand context once. | `npx vitest run tests/integration/brand-engine-routes.test.ts tests/integration/voice-calibration-hardening.test.ts server/__tests__/prompt-assembly.test.ts` | More prompt-render contract tests can be added when the AI operation registry is planned. |
| `outcomes-roi` | Tracked actions, attribution, ROI summaries, and learnings remain consistent across outcome reads and writes. | `npx vitest run tests/integration/roi-attribution.test.ts tests/integration/outcome-pipeline.test.ts tests/unit/outcome-tracking.test.ts` | Client narrative ROI workflow tests remain part of Wave 2b client workflow coverage. |
| `billing-monetization` | Checkout, webhook, subscription, trial, tier, and entitlement paths agree on the same workspace billing state. | `npx vitest run tests/integration/stripe-api.test.ts tests/integration/stripe-checkout-flow.test.ts tests/integration/tier-gate-enforcement.test.ts` | More webhook and cancellation edge cases remain in the Wave 2b auth/billing contract suite. |
| `integrations` | Provider adapters return normalized data and degrade safely when Webflow, Google, SEMrush, DataForSEO, Stripe, or AI providers fail. | `npx vitest run tests/integration/semrush-routes.test.ts tests/integration/webflow-cms-writes.test.ts tests/unit/dataforseo-provider.test.ts` | Unified external failure classification is a future base-layer recommendation. |
| `platform-foundation` | Auth, validation, logging, background jobs, broadcasts, route guards, and PR checks keep shared infrastructure reliable. | `npx vitest run tests/integration/jobs-routes.test.ts tests/integration/broadcast-handler-pairs.test.ts tests/unit/ws-events-constants.test.ts` | Full platform verification remains `npm run verify:platform`; this matrix is the fast ownership spine. |

## Completion Rule

`platform-confidence-domain-smoke-tests` is complete when:

- every canonical bounded context has exactly one matrix entry,
- every entry names a core path, read path, write path, cache/realtime dependency, test command, coverage groups, and known gap,
- `tests/unit/platform-domain-smoke-matrix.test.ts` passes,
- and the roadmap item is marked done with notes that P2 contract-test expansion remains pending.
