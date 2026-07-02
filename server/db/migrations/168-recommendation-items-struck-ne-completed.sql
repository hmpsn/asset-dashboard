-- Reconcile R4-PR2 — DB-level backstop for the struck≠completed invariant.
--
-- R4-PR1 (already applied) added an APP-LEVEL guard (StruckRecCompletionError in
-- server/domains/recommendations/status-service.ts) that refuses to complete a struck
-- (or sent/discussing/approved) recommendation. This migration adds the DB-level trigger
-- pair that makes the invariant unbypassable even by a direct SQL write, matching the
-- BEFORE INSERT/UPDATE + RAISE(ABORT) pattern used by migration 067's
-- discovery_sources_raw_content_size triggers.
--
-- SQLite cannot add a CHECK constraint to an existing table, so this is enforced with
-- an INSERT + UPDATE trigger pair instead.
--
-- SCOPE: this trigger enforces ONLY the `struck` leg of the exemption invariant
-- (lifecycle='struck' AND status='completed'). The other exempt legs the app guard covers
-- (clientStatus in sent/discussing/approved — see isExemptFromAutoResolve) remain APP-GUARD-ONLY
-- and are NOT enforced at the DB level here; the DB backstop is intentionally narrow to the one
-- axis (lifecycle) that has a dedicated column and an unambiguous, order-independent rule.
--
-- Data-safety step (MUST run before the triggers exist): writeItems() in
-- server/domains/recommendations/storage.ts persists a workspace's recommendation set with
-- a delete-then-reinsert inside ONE transaction (saveRecommendationSet), so every row is
-- re-INSERTed on every regen save. If any existing row already violates the invariant
-- (lifecycle='struck' AND status='completed' — possible only for a row written before the
-- R4-PR1 app guard existed), the new INSERT trigger would ABORT the entire regen save for
-- that workspace, not just the bad row. So we resolve any pre-existing violations FIRST.
--
-- Resolution status chosen: 'pending'. RecStatus is the internal admin triage axis
-- (pending | in_progress | completed | dismissed), largely orthogonal to the lifecycle axis
-- (active | throttled | struck). The live strike path (strikeRecommendation) now performs the
-- SAME completed->pending reset for a rec struck while already completed, so the app and the
-- migration converge on one resolution value (see server/recommendation-lifecycle.ts).
-- A struck rec must never read as "done" to the client, so 'completed' must be undone.
-- RECOMMENDATION_TRANSITIONS in server/state-machines.ts declares completed -> pending as
-- a valid backward edge ("issue re-detected"), and 'pending' is the neutral non-terminal
-- state consistent with "the operator decided not to do this (yet)" for a struck rec.
-- strftime formats an ISO-8601-shaped UTC timestamp (matching new Date().toISOString(), used by
-- every other writer of this TEXT column) rather than CURRENT_TIMESTAMP's 'YYYY-MM-DD HH:MM:SS'.
UPDATE recommendation_items
SET status = 'pending',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE lifecycle = 'struck' AND status = 'completed';

CREATE TRIGGER IF NOT EXISTS trg_recommendation_items_struck_ne_completed_insert
BEFORE INSERT ON recommendation_items
FOR EACH ROW
WHEN NEW.lifecycle = 'struck' AND NEW.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'recommendation_items: a struck recommendation cannot have status=completed');
END;

CREATE TRIGGER IF NOT EXISTS trg_recommendation_items_struck_ne_completed_update
BEFORE UPDATE ON recommendation_items
FOR EACH ROW
WHEN NEW.lifecycle = 'struck' AND NEW.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'recommendation_items: a struck recommendation cannot have status=completed');
END;
