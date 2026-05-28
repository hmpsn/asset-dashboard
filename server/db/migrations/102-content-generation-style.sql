-- Persist the writing style selected for content briefs and generated posts.
ALTER TABLE content_briefs ADD COLUMN generation_style TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE content_posts ADD COLUMN generation_style TEXT NOT NULL DEFAULT 'standard';
