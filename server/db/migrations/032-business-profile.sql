-- Add business_profile column to workspaces for verified business data used in schema generation
ALTER TABLE workspaces ADD COLUMN business_profile TEXT;
