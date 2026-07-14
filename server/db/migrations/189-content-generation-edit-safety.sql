ALTER TABLE content_briefs ADD COLUMN generation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_briefs ADD COLUMN generation_provenance TEXT;

ALTER TABLE content_posts ADD COLUMN generation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE content_posts ADD COLUMN generation_provenance TEXT;

ALTER TABLE copy_sections ADD COLUMN generation_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE copy_sections ADD COLUMN generation_provenance TEXT;

CREATE UNIQUE INDEX idx_jobs_id_workspace
  ON jobs(id, workspace_id);

CREATE TABLE job_resource_claims (
  job_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  released_at TEXT,
  PRIMARY KEY (job_id, resource_type, resource_id),
  FOREIGN KEY (job_id, workspace_id)
    REFERENCES jobs(id, workspace_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_job_resource_claims_active_resource
  ON job_resource_claims(workspace_id, resource_type, resource_id)
  WHERE active = 1;

CREATE INDEX idx_job_resource_claims_job
  ON job_resource_claims(job_id, active);
