-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Corrects the 035 backfill heuristic. 035 assumed an SNR sample proves a
-- direct reception, but pre-PR TRACE ingest wrote consecutive path-hop pairs
-- to node_neighbors WITH an SNR sample (see internal/ingest/packet.go). Those
-- rows are overheard third-party topology, not explicit neighbor claims.
--
-- No existing column can prove direct provenance for legacy rows, so the
-- conservative fix is to reset every row to direct=false and let fresh
-- /neighbors, zero-hop advert, or DISCOVER_RESP observations promote the edge
-- after deployment. The upsert keeps direct sticky (OR semantics), so without
-- this reset a wrongly promoted row could never be corrected by future
-- direct=false TRACE observations.
UPDATE node_neighbors SET direct = FALSE WHERE direct = TRUE;

-- Provenance freshness for the direct mark (see PR95 review item 6): one old
-- direct observation must not discount the edge forever while only overheard
-- traffic keeps the row alive. direct_last_seen advances only on explicit
-- direct confirmations; the planner applies the neighbor bonus only while the
-- confirmation is within the freshness window.
ALTER TABLE node_neighbors ADD COLUMN direct_last_seen TIMESTAMPTZ;
