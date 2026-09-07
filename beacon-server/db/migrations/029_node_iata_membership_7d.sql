-- Node-to-IATA membership now expires after 7 days without a refresh instead of 30.
-- Matches the new nodes.iata_membership_ttl default; the cleanup job prunes past the
-- configured horizon. Run once so existing rows older than a week stop counting as
-- current membership immediately instead of lingering until the next refresh cycle.
DELETE FROM node_iatas WHERE last_heard < NOW() - INTERVAL '7 days';
