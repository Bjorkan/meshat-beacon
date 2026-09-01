-- Keep a stable link-quality estimate instead of exposing whichever packet happened last.
ALTER TABLE node_neighbors
  ADD COLUMN snr_sample_count BIGINT NOT NULL DEFAULT 0;

-- Legacy rows stored a last sample only; seed their confidence without inventing measurements.
UPDATE node_neighbors
SET snr_sample_count = CASE WHEN snr IS NULL THEN 0 ELSE 1 END
WHERE snr_sample_count = 0;
