# Platform Observability Workflow

This workflow is the platform-health answer to: "What happened in this workspace?"

## What It Covers

- Per-workspace operation traces (AI calls, integration calls, job lifecycle, slow routes)
- Failed job/error dashboard signal
- External API failure rates and latency (SEMRush + DataForSEO)
- AI cost and latency by feature
- Slow route tracking
- Last-success timestamps for critical sync paths

## Commands

Run markdown report:

```bash
npm run verify:observability -- --workspace <workspaceId> --days 14
```

Run JSON report:

```bash
npm run verify:observability -- --workspace <workspaceId> --days 14 --json
```

## API Surface

Workspace-scoped endpoint:

- `GET /api/observability/:workspaceId?days=14`

The route is protected by `requireWorkspaceAccess('workspaceId')`.

## Interpreting The Report

- `failedJobs`: most recent terminal failures/cancellations and duration
- `externalApiFailureRates`: provider call volume, failed calls, success %, avg/p95 latency
- `aiByFeature`: token + cost + latency profile by feature key
- `slowRoutes`: route leaderboard for high-latency paths
- `criticalSyncs`: last known success markers for audit, strategy, schema, page analysis, provider telemetry
- `operationTraces`: recent timeline for correlated debugging

## Operational Notes

- Telemetry is append-only and file-backed under `DATA_DIR/platform-observability/`.
- Existing telemetry prior to this workflow launch is not retroactively reconstructed.
- If a workspace has no workspace-scoped slow-route events yet, the report falls back to global slow-route telemetry for context.
