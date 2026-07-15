-- Version snapshots must carry the attribution of the content they preserve.
-- Legacy snapshots intentionally remain NULL so reverting them cannot borrow
-- provenance from the post's newer content.
ALTER TABLE content_post_versions ADD COLUMN generation_provenance TEXT;
