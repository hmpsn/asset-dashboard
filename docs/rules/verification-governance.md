# Verification Governance

`verify:*` scripts are classified by `scripts/report-verification-governance.ts`.
The registry is the source of truth for which checks belong in PR CI, push CI,
local verification, release readiness, or manual operator review.

Run:

```bash
npm run verify:governance
```

## Classification Buckets

| Bucket | CI posture | Use for |
| --- | --- | --- |
| `pr-ci-blocking` | Runs in the PR quality job | Cheap deterministic checks that protect every branch |
| `push-ci-blocking` | Runs on selected push paths | Checks that are heavier than PR gates but still appropriate for automated push/release CI |
| `local-required` | Local platform verification | Developer-machine gates that are useful before PRs but too broad for PR CI |
| `release-check` | Release readiness | Staging-to-main safety checks and cadence/freshness audits |
| `secret-backed` | Manual only unless explicitly provisioned | Checks that require credentials or external account state |
| `scenario-probe` | Manual/targeted only | Browser or scenario-specific probes |
| `manual-advisory` | Manual/reporting | Audit reports and planning inventories |

## Current CI Policy

PR quality CI blocks on:

- `npm run pr-check`
- `npm run check:circular-deps`
- `npm run verify:feature-flags`
- `npm run verify:governance`
- `npm run verify:style-drift`
- `npm run verify:staging-merge-integrity`

Main/release coverage CI blocks on:

- `npm run test:coverage`
- `npm run verify:coverage-ratchet`

Staging push CI does not run full-suite coverage on every merge. The coverage
ratchet remains available locally and on the release path, where its slower
single-summary artifact generation is appropriate.

Do not wire every verifier into PR CI. Credentialed checks such as
`verify:stripe-prices`, browser scenario probes, release-readiness audits, and
advisory reports stay manual unless a later audit proves they are cheap,
deterministic, and safe without secrets.

## Adding A New Verifier

1. Add the `verify:*` script in `package.json`.
2. Add a matching entry to `VERIFICATION_GOVERNANCE_REGISTRY` in
   `scripts/report-verification-governance.ts`.
3. Pick the narrowest bucket that matches the script's cost, determinism, and
   credential needs.
4. If the bucket is `pr-ci-blocking` or `push-ci-blocking`, wire the command into
   `.github/workflows/ci.yml` in the matching job.
5. Run `npm run verify:governance`.

The governance check fails when a new verifier is unclassified, when a blocking
verifier is not wired into CI, when a secret-backed verifier is accidentally
wired into CI, or when active docs/tooling reference a deleted verifier.
