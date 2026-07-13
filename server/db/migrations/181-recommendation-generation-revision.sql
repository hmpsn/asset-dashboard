ALTER TABLE recommendation_sets ADD COLUMN generation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recommendation_sets ADD COLUMN generation_provenance TEXT;
