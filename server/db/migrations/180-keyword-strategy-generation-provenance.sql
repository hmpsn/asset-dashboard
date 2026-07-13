ALTER TABLE workspaces ADD COLUMN keyword_strategy_generation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN keyword_strategy_input_fingerprint TEXT;
ALTER TABLE workspaces ADD COLUMN keyword_strategy_generation_provenance TEXT;
