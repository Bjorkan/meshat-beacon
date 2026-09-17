-- Copyright 2026 Beacon Contributors
-- SPDX-License-Identifier: AGPL-3.0-or-later

-- The unsafe 035 backfill was removed before any deployment (035 now adds the
-- column with no UPDATE), so there is nothing to reset: this migration only
-- adds provenance freshness for the direct mark (see PR95 review item 6). One
-- old direct observation must not discount the edge forever while only
-- overheard traffic keeps the row alive. direct_last_seen advances only on
-- explicit direct confirmations; the planner applies the neighbor bonus only
-- while the confirmation is within the freshness window.
--
-- Kept as a separate migration (rather than folding into 035) so databases
-- that already applied the pre-fix 035+036 pair migrate cleanly: the reset
-- below is a no-op there (035 set no rows, 036 already added the column via
-- IF NOT EXISTS).
ALTER TABLE node_neighbors ADD COLUMN IF NOT EXISTS direct_last_seen TIMESTAMPTZ;

-- No-op on databases where the old 035 backfill ran: defensively clear any
-- direct=true rows that cannot be tied to a fresh explicit confirmation.
-- direct_last_seen is NULL for such rows (the old upsert never set it), so
-- only rows with a real confirmation timestamp survive.
UPDATE node_neighbors SET direct = FALSE WHERE direct = TRUE AND direct_last_seen IS NULL;
