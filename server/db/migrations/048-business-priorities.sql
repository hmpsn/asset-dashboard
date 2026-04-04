-- Add client-editable business priorities JSON column to workspaces.
-- Stores an array of goal strings, e.g. ["Grow patient appointments by 25% in Q3"].

ALTER TABLE workspaces ADD COLUMN business_priorities TEXT;
