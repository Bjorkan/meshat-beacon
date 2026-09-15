-- Observer retention: decouple historical packet observations from the active
-- observer row so the cleanup task can delete observers that have not been
-- heard from in 14 days without silently shortening the separate 30-day
-- packet-retention window.

-- Snapshot the observer's identity into each packet observation at insert
-- time. Once the active observer row is aged out, observer_id becomes NULL
-- (ON DELETE SET NULL below) and these snapshots keep the historical
-- observation useful to the packet/detail API.
ALTER TABLE packet_observations
  ADD COLUMN observer_public_key BYTEA,
  ADD COLUMN observer_display_name TEXT,
  ADD COLUMN observer_type TEXT;

UPDATE packet_observations po
SET observer_public_key    = o.public_key,
    observer_display_name  = o.display_name,
    observer_type          = o.observer_type
FROM observers o
WHERE o.id = po.observer_id;

-- Historical observations must survive their observer's 14-day retention
-- expiry; the packets table keeps its own 30-day policy untouched.
ALTER TABLE packet_observations
  DROP CONSTRAINT packet_observations_observer_id_fkey;

ALTER TABLE packet_observations
  ALTER COLUMN observer_id DROP NOT NULL;

ALTER TABLE packet_observations
  ADD CONSTRAINT packet_observations_observer_id_fkey
  FOREIGN KEY (observer_id) REFERENCES observers(id) ON DELETE SET NULL;

-- mv_top_observers_by_iata must not drop still-retained (14-30 day)
-- observation counts just because the observer row expired; fall back to the
-- per-observation snapshot columns.
DROP MATERIALIZED VIEW mv_top_observers_by_iata;

CREATE MATERIALIZED VIEW mv_top_observers_by_iata AS
SELECT
  po.iata,
  po.observer_id,
  COALESCE(o.display_name, po.observer_display_name) AS display_name,
  COALESCE(o.observer_type, po.observer_type) AS observer_type,
  date_trunc('hour', po.heard_at)::timestamptz AS bucket,
  COUNT(*) AS observation_count
FROM packet_observations po
LEFT JOIN observers o ON o.id = po.observer_id
WHERE po.heard_at > NOW() - INTERVAL '30 days'
GROUP BY po.iata, po.observer_id,
  COALESCE(o.display_name, po.observer_display_name),
  COALESCE(o.observer_type, po.observer_type),
  date_trunc('hour', po.heard_at);

CREATE UNIQUE INDEX idx_mv_top_observers
  ON mv_top_observers_by_iata(iata, observer_id, bucket);
