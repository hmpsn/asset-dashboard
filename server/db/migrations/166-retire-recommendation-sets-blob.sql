-- 166-retire-recommendation-sets-blob.sql
-- Reconcile R7-PR2 (Task B5) — CONTRACT cutover of the recommendation blob→rows migration.
--
-- WHY THIS MIGRATION EXISTS
-- ──────────────────────────────────────────────────────────────────────────
-- Migration 158 created recommendation_items + the trg_recommendation_sets_delete_items
-- trigger and declared the legacy recommendation_sets.recommendations JSON column "retained
-- as fallback/seed data during cutover". The A4 backfill sweep (materializeAllRecommendationItems)
-- has since materialized every workspace's blob into rows (verified prod: rows==blob for all
-- workspaces, zero drops; staging: rows populated). storage.ts now reads rows ONLY — the blob
-- fallback is deleted. This migration blanks the now-orphaned archive blob so nothing downstream
-- can accidentally revive the retired shape.
--
-- WHY BLANK, NOT DROP (destructive-migration safety — docs/rules/destructive-migrations.md)
-- ──────────────────────────────────────────────────────────────────────────
-- Per R0's rename-to-archive + delayed-drop contract, the COLUMN stays as an archive
-- placeholder. The actual `ALTER TABLE ... DROP COLUMN recommendations` is a SEPARATE future
-- migration, scheduled one full release cycle later (after a clean prod run confirms nothing
-- reads the blob). Migrations are forward-only under a 3-day backup retention window, so a
-- premature column drop would be unrecoverable.
--
-- WHY GUARDED (do NOT destroy an unpopulated workspace's blob)
-- ──────────────────────────────────────────────────────────────────────────
-- We ONLY blank the blob for workspaces whose recs are safely materialized into
-- recommendation_items. If some hypothetical workspace slipped through the backfill and holds
-- recs in the blob but ZERO rows, blanking its blob would be the exact data loss the guard
-- exists to prevent. The WHERE clause blanks a set's blob only when EITHER:
--   (a) the workspace has at least one recommendation_items row (its recs are materialized), OR
--   (b) the set already carries no real recs (blob is NULL / '' / '[]' — nothing to lose).
-- A blob-carrying, zero-row workspace is left UNTOUCHED (and storage.ts logs a loud warn on read).

UPDATE recommendation_sets
SET recommendations = '[]'
WHERE recommendations IS NOT NULL
  AND recommendations != '[]'
  AND (
    workspace_id IN (SELECT DISTINCT workspace_id FROM recommendation_items)
    OR recommendations = ''
  );
