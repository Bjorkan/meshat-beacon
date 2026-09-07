-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- name: GetNodePathPublicKey :one
SELECT public_key FROM nodes WHERE id = $1;

-- name: ListNodePathPackets :many
-- Prefixes are resolved globally with ResolvePathHashes before this query.
-- First matching observation ID is an immutable ordering key. A snapshot excludes
-- newly arriving packets/observations from all later pages, avoiding duplicates.
WITH snapshot AS (
  SELECT COALESCE(NULLIF(@snapshot_id::bigint, 0),
                  (SELECT COALESCE(max(id), 0) FROM packet_observations))::bigint AS id
), matches AS MATERIALIZED (
  SELECT po.packet_hash, min(po.id)::bigint AS first_match_id,
         max(po.id)::bigint AS last_match_id, count(*)::bigint AS matching_observations
  FROM packet_observations po
  JOIN packets p ON p.packet_hash = po.packet_hash
  CROSS JOIN snapshot
  WHERE po.id <= snapshot.id
    AND (cardinality(@iatas::text[]) = 0 OR po.iata = ANY(@iatas::text[]))
    AND observation_path_hops(po.path_bytes, po.hash_size, po.hop_count) && @prefixes::bytea[]
    AND p.payload_type <> 9 -- TRACE observation path bytes are SNR, not hop hashes.
  GROUP BY po.packet_hash
  HAVING @before_id::bigint = 0 OR min(po.id) < @before_id::bigint
  ORDER BY first_match_id DESC
  LIMIT @page_limit::int
)
SELECT m.first_match_id, snapshot.id AS snapshot_id, m.matching_observations,
       p.packet_hash, p.payload_type, p.route_type, p.first_heard_at,
       po.heard_at AS last_heard_at, sc.name AS scope_name,
       po.observer_id, o.display_name AS observer_name, po.iata,
       po.path_length_byte, po.hash_size, po.hop_count, po.path_bytes
FROM matches m
JOIN packets p ON p.packet_hash = m.packet_hash
JOIN packet_observations po ON po.id = m.last_match_id
JOIN observers o ON o.id = po.observer_id
LEFT JOIN transport_scopes sc ON sc.id = p.scope_id
CROSS JOIN snapshot
ORDER BY m.first_match_id DESC;
