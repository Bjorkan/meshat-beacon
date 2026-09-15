-- Broker metadata timestamps prevent delayed updates from restoring an old owner.
ALTER TABLE observer_owners ADD COLUMN metadata_at TIMESTAMPTZ;
CREATE INDEX idx_observer_owners_pubkey ON observer_owners(owner_pubkey) WHERE owner_pubkey IS NOT NULL;
