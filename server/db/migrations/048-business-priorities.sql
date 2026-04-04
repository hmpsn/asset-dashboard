-- Add admin-set business priorities JSON column to workspaces.
-- Stores an array of strategic goal strings set by the admin for AI context,
-- e.g. ["Grow patient appointments by 25% in Q3"].
-- NOTE: Distinct from the client_business_priorities table (server/routes/public-portal.ts)
-- which stores client-entered priorities submitted via the portal questionnaire.

ALTER TABLE workspaces ADD COLUMN business_priorities TEXT;
