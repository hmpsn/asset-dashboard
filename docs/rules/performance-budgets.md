# Platform Performance Budgets

Wave 5 item: `platform-reliability-performance-budgets`

Source of truth: `scripts/performance-budgets.ts`

## What this governs

Each high-traffic or high-cost workflow should carry explicit budgets for:

- max AI calls
- max external fetches
- route response target
- query count limit
- expected background-job duration (when applicable)
- cache expectation
- escalation rule when budgets are exceeded

## Operating contract

Every registry entry must include:

1. ownership (`owner`, `boundedContext`)
2. concrete workflow/route scope (`routeOrWorkflow`)
3. numeric budgets (non-negative integer caps + positive response/query targets)
4. escalation trigger + action
5. real code evidence and automated test evidence references

Background-job entries must define `expectedJobDurationMs`. Non-job entries must omit it.

## Verification commands

```bash
npm run verify:performance-budgets
npm run verify:performance-budgets -- --json
npx vitest run tests/unit/performance-budgets.test.ts
```

Exit behavior:

- **fails** when policy gaps exist (missing evidence paths, invalid budget fields, duplicate ids, missing escalation data)
- **passes** with a markdown/json report when the contract is complete
