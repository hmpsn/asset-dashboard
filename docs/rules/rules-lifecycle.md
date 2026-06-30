# Rules Documentation Lifecycle

`docs/rules/` is reserved for durable platform contracts that should influence
future implementation and review. Point-in-time audits, migration maps, and
pattern reviews belong in `docs/rules/archive/` or `docs/superpowers/**`.

## Active Rule Docs

Keep a document in `docs/rules/` only when it is still an active source of
truth for one of these:

- an implementation contract;
- an automated guardrail or authoring guide;
- a bounded-context ownership rule;
- a recurring workflow or release-safety policy.

Active rule docs should avoid dated audit language in the title, such as
`pre-plan-audit`, `migration-map`, or `pattern-review`. If a durable contract
emerges from one of those artifacts, extract the stable rule into a new or
existing active doc and archive the original artifact.

## Archived Rule Docs

Archived files live under `docs/rules/archive/` and must start with frontmatter:

```yaml
---
status: archived
archivedAt: YYYY-MM-DD
reason: Short explanation of why this is no longer an active rule source.
---
```

Archived docs may remain useful historical evidence, but they are not active
instructions for new implementation work.

## Verification

`npm run verify:platform-health-cadence` checks the lifecycle:

- active `docs/rules/*.md` files must not look like point-in-time audits,
  migration maps, or pattern reviews;
- archived rule docs must declare `status: archived`;
- platform-health reports include these gaps alongside cadence, roadmap-link,
  and evidence-path policy gaps.
