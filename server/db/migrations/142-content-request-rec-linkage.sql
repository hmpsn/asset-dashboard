-- Migration 142: add recommendation linkage columns to content_topic_requests
-- These fields thread the originating recommendation through to the content request
-- created by "Act on this" (client greenlight), enabling the greenlight→result
-- attribution join (spec §7 C2) and seeding the brief generator (spec §7 C3).
--
-- recommendation_id    — the in-blob Recommendation.id that triggered this request (nullable;
--                        absent on operator-created or legacy requests). NOT a foreign key:
--                        recommendation_sets is a JSON blob, so there is no FK target — the id
--                        is the globally-unique natural key, scoped by workspace_id on every read.
-- strategy_card_context — JSON blob carrying the StrategyCardContext fields captured at
--                         act-on time (rationale, volume, difficulty, trendDirection,
--                         serpFeatures, competitorProof, impressions, intent, priority).
--                         NULL when no strategy context is available. Parsed via
--                         parseJsonSafe with the strategyCardContextSchema.

ALTER TABLE content_topic_requests ADD COLUMN recommendation_id TEXT;
ALTER TABLE content_topic_requests ADD COLUMN strategy_card_context TEXT;

CREATE INDEX IF NOT EXISTS idx_content_topic_requests_rec_id
  ON content_topic_requests(recommendation_id)
  WHERE recommendation_id IS NOT NULL;
