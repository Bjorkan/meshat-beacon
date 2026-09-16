-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- Marks which node_neighbors rows are explicit neighbor claims (device says
-- "this is my neighbor") versus overheard third-party topology derived from
-- packet paths. The /routes/best planner discounts explicitly marked legs:
-- a node that marked its peer as a neighbor is the mesh's own statement that
-- the hop is real, so it outranks an equally-measured overheard leg.
--
-- direct=true: /neighbors reports, zero-hop advert RX, DISCOVER_RESP RX —
-- the reporter itself heard the neighbor over RF.
-- direct=false: TRACE hop pairs and generic path-derived adjacency — a third
-- party observed the pair in sequence, neither endpoint claimed the other.
ALTER TABLE node_neighbors ADD COLUMN direct BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill from provenance: rows WITH an SNR sample came with a signal
-- reading, which only direct receptions produce (see 005/025). Rows from
-- path-derived adjacency (snr NULL) stay false.
UPDATE node_neighbors SET direct = TRUE WHERE snr_sample_count > 0;
