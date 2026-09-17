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

-- Deliberately no backfill: no existing column can prove direct provenance
-- for legacy rows. TRACE-derived third-party topology stores SNR samples
-- while explicitly being non-direct (see internal/ingest/packet.go, which
-- upserts TRACE hop pairs with direct=false even when an SNR sample is
-- present), so inferring direct from snr_sample_count > 0 would permanently
-- promote overheard topology -- and the upsert's OR semantics would make such
-- false positives uncorrectable. Legacy rows stay direct=false; fresh
-- /neighbors, zero-hop advert, and DISCOVER_RESP observations promote edges
-- after deployment.
