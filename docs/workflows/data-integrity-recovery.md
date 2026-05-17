# Data Integrity & Recovery Drills

This workflow defines the repeatable runtime-confidence loop for SQLite-backed data integrity and recovery readiness.

## 1. Integrity report (routine check)

Run the integrity report against the active database:

```bash
npm run verify:data-integrity
```

Optional:

```bash
npm run verify:data-integrity -- --json
npm run verify:data-integrity -- --quick
npm run verify:data-integrity -- --db /absolute/path/to/dashboard.db
```

The report covers:

- `PRAGMA quick_check`
- `PRAGMA integrity_check` (unless `--quick`)
- `PRAGMA foreign_key_check` violations
- workspace-orphan scan for all tables with `workspace_id`
- explicit cross-table FK consistency joins
- artifact preserve-vs-rebuild map

## 2. Backup/restore drill (staging or local)

Use this drill before high-risk migrations or platform sweeps.

1. Verify backup roots:
   - DB: `${DATA_DIR:-~/.asset-dashboard}/dashboard.db`
   - Backups: `${BACKUP_DIR:-$DATA_DIR/backups}`
2. Identify the latest backup snapshot directory (`backup-YYYY-MM-DDTHH-mm-ss`).
3. Restore into a disposable drill path:
   - Copy `dashboard.db` from the backup into `/tmp/asset-dashboard-recovery-drill/dashboard.db`.
4. Run integrity report on restored DB:

```bash
npm run verify:data-integrity -- --db /tmp/asset-dashboard-recovery-drill/dashboard.db
```

5. Compare key counts vs current production/staging:
   - workspace count
   - client user count
   - content posts + briefs count
   - active subscriptions count
6. Document drift (expected vs unexpected), remediation owner, and next drill date.

## 3. Migration rollback notes

Migrations are forward-only. Rollback strategy is restore-based, not down-migration-based.

If a release migration causes data corruption risk:

1. Freeze writes (maintenance window or deploy gate).
2. Snapshot current state for forensics (do not overwrite evidence).
3. Restore latest known-good backup to a clean DB path.
4. Run `npm run verify:data-integrity` on restored DB.
5. Repoint runtime to restored DB and validate critical routes.
6. File post-incident notes:
   - failing migration file
   - affected tables/workspaces
   - recovery time
   - follow-up guardrail/test needed

## 4. Artifact classification policy

Use this policy during incident recovery triage:

- `preserve`: user-authored or compliance-critical history; restore from backup.
- `rebuildable`: deterministic derivations; safe to recompute from source systems.
- `partial`: recomputable baseline exists, but historical review/resolution context should be preserved.

Canonical map source: `scripts/platform-data-integrity-recovery.ts` (`ARTIFACT_RECOVERY_MAP`).

## 5. Recommended cadence

- Weekly: run routine integrity report in staging.
- Before risky deploys: run backup/restore drill.
- After any recovery event: run a post-restore integrity report and attach output to incident notes.
