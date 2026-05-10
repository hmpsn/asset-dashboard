-- Add optional note field to approval_batches for send-to-client convention
ALTER TABLE approval_batches ADD COLUMN note TEXT;
