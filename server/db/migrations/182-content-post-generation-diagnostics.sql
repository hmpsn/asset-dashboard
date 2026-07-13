-- C1 truthful content generation: retain sanitized, typed diagnostics only for
-- incomplete initial generation. Public serializers deliberately omit this column.
ALTER TABLE content_posts ADD COLUMN generation_diagnostics TEXT;
