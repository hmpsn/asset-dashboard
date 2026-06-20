-- The Issue (Client) P0/P1: typed-JSON segment classification + the dollar-verdict outcome value.
-- Both optional; absent = resolveSegmentProfile() falls back to deterministic location detection
-- or the safe non-local default, and computeROI omits outcomeVerdict. parseJsonSafe at the read boundary.
ALTER TABLE workspaces ADD COLUMN segment_config TEXT;
ALTER TABLE workspaces ADD COLUMN outcome_value TEXT;
