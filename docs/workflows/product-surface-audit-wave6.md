# Wave 6 Product Surface Area Audit

Generated from:
- `FEATURE_AUDIT.md` inventory scan
- `scripts/product-surface-map.ts`
- `data/product-surface-audit.json`

Date: 2026-05-18

## Coverage Snapshot

- Feature-audit headline count: `481`
- Product-surface mapped capabilities: `18`
- Human-verification queue size: `5`

## Prioritization Summary

### Promote

- **Search & Traffic Hub** (`analytics-intelligence`)
  - Recommendation: `promote`
  - Why: direct client-differentiator with monetizable narrative value.

### Keep (no placement demotion)

- `11` capabilities are in a stable `keep` state across first-class, context-triggered, and progressive-disclosure placements.
- Includes core client differentiators: Client Inbox, Content Pipeline, Schema Workbench, SEO Strategy, Site Health cluster.

### Hide Behind Progressive Disclosure

- **AI Usage Ledger** (`platform-foundation`) — human review required
- **Prospect Tooling** (`workspace-command-center`) — human review required
- **Team Outcomes Overview** (`workspace-command-center`) — human review required
- **Deep Diagnostics** (`platform-foundation`) — already dark-launched, keep hidden

### Deprecate After Redirect Window

- **Legacy Client Inbox Aliases** (`inbox`) — human review required
- **Standalone Schema Review Tab Retirement** (`inbox`) — human review required

## Human Verification Queue

The following must be explicitly approved before rollout:

1. `ai-usage-ledger` — hide behind progressive disclosure
2. `prospect-tooling` — hide behind progressive disclosure
3. `team-outcomes-overview` — hide behind progressive disclosure
4. `client-inbox-legacy-aliases` — deprecate after redirect window
5. `schema-review-standalone-tab-retirement` — deprecate after redirect window

## Implementation Notes

- This audit is **classification-only** for Wave 6.
- No routes or user-facing paths were removed in this pass.
- Follow-up execution should ship one change class at a time:
  1. disclosure demotions (with review approvals),
  2. alias deprecation telemetry window,
  3. final alias removal after cool-down.

## Re-run Commands

```bash
npm run verify:product-surface
npm run verify:product-surface -- --markdown
npm run report:product-surface-audit
```
