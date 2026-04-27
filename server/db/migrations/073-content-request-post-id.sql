-- Migration 073: add post_id to content_topic_requests
-- Links a request to the GeneratedPost produced from its brief.
-- Nullable because post_id is only set when the post exists.
ALTER TABLE content_topic_requests ADD COLUMN post_id TEXT;
