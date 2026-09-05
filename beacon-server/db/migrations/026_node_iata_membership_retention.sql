-- Stale node-to-IATA memberships must stop counting as current regional membership. Rows are
-- pruned by the cleanup job past the nodes.iata_membership_ttl horizon; nothing else changes.
-- Existing rows keep their last_heard values so the first cleanup pass expires exactly the
-- associations that have not been refreshed within the window.
DELETE FROM node_iatas WHERE last_heard < NOW() - INTERVAL '30 days';
