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

Use this drill before high-risk migrations or platform sweeps. It is now automated —
`scripts/restore-drill.ts` (`npm run backup:restore-drill`) performs all of the manual steps
below and exits non-zero on any mismatch, so it can gate CI or a pre-flight check.

### Automated drill

```bash
npm run backup:restore-drill
```

Restore source precedence (first available wins):

1. **Local backup directory** (`${BACKUP_DIR:-$DATA_DIR/backups}`) — the newest `backup-*`
   directory containing a `_manifest.json`.
2. **S3 (or S3-compatible, e.g. Cloudflare R2 via `BACKUP_S3_ENDPOINT`)** — downloads and
   extracts the newest `backup-*.tar.gz` archive when `BACKUP_S3_BUCKET` is set.
3. **`/api/admin/db-export`** — pulls the live DB export directly from a running instance
   (`APP_URL` + `APP_PASSWORD`). This source has no manifest, so table-count diffing is skipped
   and only the integrity report runs.

The drill:
1. Locates the restored database. For the **local** source it reads the backup directory in
   place (no copy). For **S3/R2** it downloads and extracts the archive into a scratch path, and
   for the **db-export** fallback it writes the pulled DB into the scratch path. The scratch path
   is a fresh `mkdtemp` dir by default (auto-deleted when the drill finishes) or `--scratch-dir`
   if supplied (left intact for inspection).
2. Runs `runDataIntegrityRecoveryReport` against the restored database (same engine as
   `npm run verify:data-integrity`).
3. When a manifest is available, diffs every table's restored row count against the manifest's
   recorded `tableCounts` and reports any mismatch (`diffManifestCounts` in
   `scripts/restore-drill.ts` — unit-tested in `tests/unit/restore-drill.test.ts`).
4. Exits non-zero on integrity failure OR any count mismatch.

**Mandatory before any destructive migration wave** (a migration or migration series that drops
a table per the PR N+1 step of `docs/rules/destructive-migrations.md`, or any bulk
delete/backfill sweep): re-run `npm run backup:restore-drill` immediately before and attach the
output to the PR/incident notes as evidence the current backup is restorable.

### Manual steps (equivalent, if you need to inspect intermediate state by hand)

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

### Backup posture without SSH

`GET /api/admin/storage-stats` surfaces `lastBackupAt` (ISO timestamp of the most recent
successful backup, read from disk — survives process restarts) and `offsiteConfigured`
(`true` when `BACKUP_S3_BUCKET` is set) so backup posture is checkable over HTTP without
shelling into the box.

## 3. Migration rollback notes

Migrations are forward-only. Rollback strategy is restore-based, not down-migration-based. For
destructive migrations specifically (anything that would `DROP TABLE`), see the mandatory
rename-to-archive contract in `docs/rules/destructive-migrations.md` — pr-check mechanically
enforces it.

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
- Before risky deploys: run `npm run backup:restore-drill`.
- Before any destructive migration wave (see `docs/rules/destructive-migrations.md`): drill is
  mandatory, not just recommended.
- After any recovery event: run a post-restore integrity report and attach output to incident notes.
