-- Per-workspace billing mode toggle.
-- 'platform' (default) — payment is collected via Stripe Checkout / Payment Intent.
-- 'external'           — billing is handled outside the platform; client portal skips
--                        the payment step and creates content requests directly.
ALTER TABLE workspaces ADD COLUMN billing_mode TEXT DEFAULT 'platform';
