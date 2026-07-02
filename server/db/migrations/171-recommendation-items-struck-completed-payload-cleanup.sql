-- Reconcile C4 — one-time cleanup of struck+completed recommendation payloads.
--
-- WHY THIS EXISTS: recommendation_items is the row-authoritative store, but reads parse
-- the `payload` JSON ONLY (itemRowToRecommendation in
-- server/domains/recommendations/storage.ts). The `status` and `lifecycle` columns are
-- derived on write FROM the payload; readers never consult them.
--
-- Migration 168 added the struck≠completed trigger pair AND a one-time cleanup that reset
-- `status = 'pending'` on the COLUMN for any lifecycle='struck' + status='completed' row —
-- but it did NOT rewrite the payload JSON. So a legacy row could still SERVE as completed
-- (the payload still says status:'completed') on a struck rec, and would ABORT the whole
-- delete-then-reinsert (writeItems) transaction on the next regen/backfill, because the
-- reinserted column is re-derived from the stale payload and re-trips the INSERT trigger.
--
-- This migration finishes the job: it rewrites the payload's $.status to 'pending' (and
-- keeps the column consistent) for every remaining struck+completed row, matching the
-- app-level coerce-and-continue safety net (coerceStruckCompleted / itemParams). Struck recs
-- must never read as "done"; 'pending' is the neutral non-terminal state and a legal backward
-- edge (completed -> pending) per RECOMMENDATION_TRANSITIONS in server/state-machines.ts.
--
-- Currently affects zero known rows (168 + the A4 backfill sweep ran clean on staging), but
-- this must ship before the prod promotion so no mis-stored payload can survive.
--
-- Single UPDATE statement (single-exec migration path). strftime formats an ISO-8601-shaped
-- UTC timestamp matching new Date().toISOString() used by every other writer of this column.
UPDATE recommendation_items
SET payload = json_set(payload, '$.status', 'pending'),
    status = 'pending',
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE lifecycle = 'struck' AND json_extract(payload, '$.status') = 'completed';
