-- 134-content-brief-superseded-by.sql
-- W2.5 (Bug 3 fix) — lineage tracking for regenerated content briefs.
-- Before this, each regenerateBrief call created a new brief row but left the old
-- one without any superseded marker, so N regenerations produced N+1 equal-looking
-- entries. The superseded_by column records the ID of the replacement brief so:
--   (a) listBriefs can exclude superseded briefs by default (includeSuperseded option).
--   (b) the lineage remains traceable (old_brief.superseded_by → new_brief.id).
--
-- DB column + mapper lockstep (CLAUDE.md): ships in the same commit as
-- BriefRow.superseded_by + rowToBrief mapper update + upsertBrief + briefToParams +
-- the regenerateBrief write path and the updated listBriefs query.
-- Not serialized on any public-portal route (admin-only briefs list).

ALTER TABLE content_briefs ADD COLUMN superseded_by TEXT REFERENCES content_briefs(id);
