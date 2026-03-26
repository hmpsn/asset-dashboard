-- Phase 3C: Brand Voice Scoring columns for generated content posts
ALTER TABLE content_posts ADD COLUMN voice_score INTEGER;
ALTER TABLE content_posts ADD COLUMN voice_feedback TEXT;
