-- Deployment root-region identity for the selector's no-filter state. NULL by default;
-- a configured root region borrows its short code + name for the synthetic all-data choice.
ALTER TABLE regions
  ADD COLUMN short_code TEXT,
  ADD COLUMN is_root BOOLEAN NOT NULL DEFAULT FALSE;
