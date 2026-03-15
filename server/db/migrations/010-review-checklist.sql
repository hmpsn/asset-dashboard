-- Review checklist for human-in-the-loop quality gate before sending posts to review
ALTER TABLE content_posts ADD COLUMN review_checklist TEXT;
