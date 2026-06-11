-- C4 (audit #16): persist AI review verdicts + scraped source text.
-- content_posts.ai_review      — StoredAIReview JSON (verdicts survive editor close).
-- content_briefs.source_evidence — BriefSourceEvidence JSON (scraped SERP/reference
--                                  source text; enables the real-text evidence ledger #27).
ALTER TABLE content_posts ADD COLUMN ai_review TEXT;
ALTER TABLE content_briefs ADD COLUMN source_evidence TEXT;
