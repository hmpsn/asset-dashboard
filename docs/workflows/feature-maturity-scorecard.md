---
description: Score major feature surfaces by delivery maturity to guide first-class navigation vs support-system placement
---

# Feature Maturity Scorecard

Use this scorecard when deciding whether a major capability should be first-class navigation, contextual, progressive-disclosure, or support-system/internal placement.

Pair this with `docs/rules/product-surface-rationalization.md`:
- that doc classifies product-surface placement and lifecycle;
- this doc scores maturity evidence so placement decisions are explicit and repeatable.

## When to run it

Run the scorecard when:
- adding a new major capability,
- promoting/demoting a major nav surface,
- reassessing legacy features for simplification,
- or preparing product-surface audits.

## Scoring dimensions (0-2 each)

Score each dimension as:
- `0` = absent
- `1` = partial / inconsistent
- `2` = complete and current

| Dimension | 0 | 1 | 2 |
|-----------|---|---|---|
| Shipped | Not live or incomplete rollout | Partially shipped / dark-launched only | Live and stable on intended surface |
| Documented | No reliable docs | Partial docs or stale docs | Current docs + usage/runbook clarity |
| Tested | No meaningful coverage | Narrow coverage (happy-path only) | Integration + contract/read-path coverage where applicable |
| Client-visible value | Internal only | Indirect client value | Direct client-visible outcome value |
| Monitored | No telemetry/alerts | Basic logs only | Observable via metrics/logs/jobs/events with actionable signals |
| Monetizable | No monetization tie | Adjacent/weak monetization tie | Clear tier, upsell, retention, or revenue linkage |
| Owner assigned | No clear owner | Owner implied but not explicit | Owning bounded context and maintainer are explicit |
| Intelligence/reporting integration (when relevant) | No integration where expected | Partial integration | Integrated into intelligence/reporting surfaces where relevant |

## Placement thresholds

Total score is out of `16`.

| Total | Default placement recommendation |
|-------|----------------------------------|
| 13-16 | First-class navigation candidate |
| 9-12 | Context-triggered or first-class (human review) |
| 5-8 | Progressive-disclosure / support-system placement |
| 0-4 | Internal-only / hold for maturity work |

## Hard-stop gates

Even with a high total score, do not promote to first-class navigation if any of these are true:
- `Owner assigned < 2`
- `Tested < 2` for client-visible routes
- `Documented < 2`
- `Shipped < 2`

## Scoring worksheet (copy/paste)

```md
## <Feature Name>

- Scope: [route/component/domain summary]
- Owning bounded context: [from docs/rules/platform-organization.md]
- Secondary integrations: [list]

Scores (0-2):
- Shipped:
- Documented:
- Tested:
- Client-visible value:
- Monitored:
- Monetizable:
- Owner assigned:
- Intelligence/reporting integration (if relevant):

Total: [x/16]
Recommended placement: [first-class | context-triggered | progressive-disclosure | internal-only]
Decision: [promote | keep | hide | deprecate]
Evidence links:
- [tests]
- [docs]
- [routes/components]
- [monitoring/telemetry]
```

