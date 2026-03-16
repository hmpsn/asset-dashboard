-- Migration 011: Add rewrite_playbook column to workspaces
-- Stores per-workspace instructions for AI-assisted page rewriting.
ALTER TABLE workspaces ADD COLUMN rewrite_playbook TEXT;
