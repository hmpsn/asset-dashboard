-- Enforce one deliverable row per (workspace_id, deliverable_type).
--
-- generateDeliverable() in brand-identity.ts does `AI call → check if exists →
-- insert/update`. Two concurrent requests for the same deliverable type can both
-- find no existing row (the existence check runs after a ~5s AI call) and both
-- INSERT fresh rows. The `getByType` read path defends with `ORDER BY updated_at
-- DESC LIMIT 1`, but the duplicates linger forever, waste rows, and split the
-- version history between two deliverable ids.
--
-- Step 1 — collapse any pre-existing duplicates to the most recently-updated
-- row per (workspace_id, deliverable_type). We keep the row with the MAX updated_at
-- and delete the rest. The version snapshot table (`brand_identity_versions`)
-- cascades on delete, which is the correct behavior here: the losing row's
-- history was never user-visible because `getByType` was already serving the
-- winner's content.
--
-- Step 2 — add a UNIQUE index so future writes fail fast under contention. The
-- application code in generateDeliverable catches the resulting constraint
-- error and retries the update path.
DELETE FROM brand_identity_deliverables
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY workspace_id, deliverable_type
             ORDER BY updated_at DESC, created_at DESC, id DESC
           ) AS rn
    FROM brand_identity_deliverables
  )
  WHERE rn = 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brand_identity_workspace_type
  ON brand_identity_deliverables(workspace_id, deliverable_type);
