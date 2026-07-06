-- Meeting Brief retirement — PR N of the rename-to-archive contract
-- (docs/rules/destructive-migrations.md). The Meeting Brief surface was retired by owner
-- decision 2026-07-05: UI + routes + broadcast chain removed in PR #1487, and the server
-- unit (generator/store/schemas/type) is deleted in this PR — its last "consumer" was a
-- discarded `void assembleMeetingBriefMetrics(intel)` call in strategy-pov-generator.ts.
-- No live code path reads or writes meeting_briefs after this PR.
--
-- The actual DROP TABLE ships in a follow-up PR only after staging verify + one backup
-- retention window (BACKUP_RETENTION_DAYS / BACKUP_S3_RETENTION_DAYS in server/backup.ts).
-- The forward-only migration runner applies this exactly once; a rollback is the reverse
-- rename (new forward migration) or a backup restore.

ALTER TABLE meeting_briefs RENAME TO meeting_briefs_archive;
