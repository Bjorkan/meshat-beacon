-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- MeshCore Region freshness: the OTA "region scope" strings stored by
-- migration 022 were confirmed at some point in time, but that timestamp was
-- not kept. A neighbor edge's last_seen keeps advancing with ordinary packet
-- activity while its region_scope may be a stale OTA answer, so filtering
-- must not trust region_scope forever.

ALTER TABLE observers ADD COLUMN region_scope_last_seen TIMESTAMPTZ;
ALTER TABLE node_neighbors ADD COLUMN region_scope_last_seen TIMESTAMPTZ;

-- Baseline existing values: an observer's own scope was confirmed when the
-- observer was last heard; a neighbor's scope when its edge was last
-- refreshed. Real confirmation timestamps are recorded from now on.
UPDATE observers SET region_scope_last_seen = last_seen WHERE region_scope IS NOT NULL;
UPDATE node_neighbors SET region_scope_last_seen = last_seen WHERE region_scope IS NOT NULL;

CREATE INDEX idx_observers_region_scope ON observers(region_scope_last_seen)
  WHERE region_scope_last_seen IS NOT NULL;
CREATE INDEX idx_node_neighbors_region_scope ON node_neighbors(region_scope_last_seen)
  WHERE region_scope_last_seen IS NOT NULL;

-- Exact-token matching for comma-separated OTA region scope strings, with one
-- documented case/whitespace normalization policy: both sides lowercased and
-- whitespace-trimmed. "se,no" matches "se" and "no" independently; "se" never
-- matches a longer token. "*" is matched literally only -- it is NOT silently
-- interpreted as confirming every named region.
CREATE FUNCTION region_scope_has_token(scope text, token text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT scope IS NOT NULL AND lower(token) = ANY(
    SELECT lower(btrim(x)) FROM unnest(string_to_array(scope, ',')) AS x
  ) $$;
