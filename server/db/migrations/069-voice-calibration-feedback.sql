-- Per-variation user feedback captured during a calibration session.
-- Stored as JSON array of VoiceCalibrationVariationFeedback (shared/types/brand-engine.ts).
-- Reads MUST use parseJsonSafeArray(raw, schema, context) per CLAUDE.md
-- "Array validation from DB" rule — individual items, not the whole array.
ALTER TABLE voice_calibration_sessions
  ADD COLUMN variation_feedback_json TEXT;
