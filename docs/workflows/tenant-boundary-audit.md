# Tenant Boundary Audit

## Purpose

Run a recurring, fast audit over high-risk tenant-boundary and permission surfaces so cross-workspace leaks/regressions are caught early.

Primary surfaces covered:

- Workspace-scoped route guard coverage (`requireWorkspaceAccess` / site access variants / client portal auth).
- File upload route protection.
- Stripe webhook trust boundary (raw body + signature verification).
- Public serialization hygiene in `public-portal` responses.
- Known foreign-ID regression test coverage.
- Client-user mutation guard contract (`expectedWorkspaceId` + `assertUserInWorkspace`).

## Commands

```bash
npm run verify:tenant-boundary
npm run verify:tenant-boundary -- --json
npm run report:tenant-boundary
```

## Output interpretation

- `PASS` means the audited surface has no detected gaps.
- `WARN` means advisory drift/risk that should be manually reviewed (for example, public serialization spread patterns).
- `FAIL` means a contract break or high-risk gap; treat as release-blocking for platform-health work.

The CLI exits non-zero when one or more `FAIL` findings are present.

## Recurrence guidance

Run this audit:

1. Before merging any auth/route/serialization touching PR.
2. As part of weekly platform-health sweeps.
3. Before staging → main promotions for high-risk backend releases.

Pair with:

- `npm run verify:release-safety -- --days 14`
- `npm run verify:platform:quick`
- `npx tsx scripts/platform-domain-smoke-matrix.ts`
