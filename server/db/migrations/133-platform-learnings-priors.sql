-- 133-platform-learnings-priors.sql
-- A6 (audit #22) — anonymized cross-workspace win-rate priors. The FALLBACK tier
-- for the Outcome Learning default path: when a workspace's own
-- LearningsSlice.availability is `no_data` or `degraded`, consumers may receive a
-- platform-level prior (a clearly-labeled cross-workspace benchmark) instead of
-- nothing. Recomputed by the weekly cron in server/outcome-crons.ts
-- (server/platform-learnings-priors.ts).
--
-- Pattern precedent: keyword_metrics_cache — a shared, cross-workspace store that is
-- anonymized BY CONSTRUCTION. There is NO workspace_id column, no page URL, no title,
-- no keyword. A row is a pure platform aggregate keyed only on action_type. A single
-- workspace's outcomes cannot be reverse-identified from these rows.
--
-- ANONYMIZATION FLOORS (enforced in server/platform-learnings-priors.ts; the table
-- only ever HOLDS rows that already cleared them):
--   - cohort floor: a prior is published only when >= MIN_COHORT_WORKSPACES distinct
--     workspaces contributed scored outcomes for that action type. Below the floor the
--     row is simply NOT inserted (FM-2: insufficient cohort -> absent, never a
--     fabricated baseline).
--   - sample floor: >= MIN_PRIOR_SAMPLES total scored actions behind the rate.
--
-- A1 honesty inputs (mirrors computeWorkspaceLearnings): aggregation excludes
-- attribution='not_acted_on' and only counts the latest qualifying 30/60/90-day
-- outcome per action whose score is conclusive (not insufficient_data / inconclusive).
--
-- DERIVED snapshot table — every cron run fully recomputes ALL rows inside one
-- transaction (delete-all + reinsert; no user-authored metadata to preserve).
--
-- DB column + mapper lockstep (CLAUDE.md): ships in the same commit as
-- PlatformLearningsPriorRow + rowToPlatformPrior + the recompute write path in
-- server/platform-learnings-priors.ts. NOT workspace-scoped and never serialized on a
-- public route directly (surfaced only as a labeled fallback through the intelligence
-- slice / default-path helpers) — no public-portal field list to update.

CREATE TABLE IF NOT EXISTS platform_learnings_priors (
  action_type TEXT NOT NULL PRIMARY KEY,
  win_rate REAL NOT NULL,                      -- 0..1 win rate across all contributing workspaces
  contributing_workspaces INTEGER NOT NULL,    -- distinct workspaces behind the rate (>= MIN_COHORT_WORKSPACES)
  scored_actions INTEGER NOT NULL,             -- total scored actions behind the rate (>= MIN_PRIOR_SAMPLES)
  computed_at TEXT NOT NULL
);
