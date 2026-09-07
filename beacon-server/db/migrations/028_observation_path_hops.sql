-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Index canonical, boundary-aligned hop prefixes for node traversal history.
-- TRACE is excluded by the packet query: its observation path holds SNR samples.
-- The expression index also covers existing observations without a backfill job.
CREATE FUNCTION observation_path_hops(path bytea, width smallint, hops smallint)
RETURNS bytea[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN width BETWEEN 1 AND 4 AND hops > 0
                   AND octet_length(path) = width::int * hops::int
    THEN ARRAY(SELECT substring(path FROM i * width + 1 FOR width)
               FROM generate_series(0, hops - 1) AS i)
    ELSE ARRAY[]::bytea[] END
$$;

CREATE INDEX idx_observations_path_hops ON packet_observations
USING gin (observation_path_hops(path_bytes, hash_size, hop_count));
