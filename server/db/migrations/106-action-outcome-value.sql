-- 106-action-outcome-value.sql
-- Add attributed_value (REAL, nullable) and value_basis (TEXT, nullable) to
-- action_outcomes and its archive twin.
-- These columns form the shared contract for the ROI dollar loop (Phase 2).
-- NULL means value was not computed (inconclusive or no CPC data).

ALTER TABLE action_outcomes ADD COLUMN attributed_value REAL;
ALTER TABLE action_outcomes ADD COLUMN value_basis TEXT;

ALTER TABLE action_outcomes_archive ADD COLUMN attributed_value REAL;
ALTER TABLE action_outcomes_archive ADD COLUMN value_basis TEXT;
