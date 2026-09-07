-- Single-broker deployment: Beacon ingests from one MQTT broker ("meshat.se")
-- instead of the historical mqtt1/mqtt2 pair. Rewrite stored broker labels so
-- observer badges, source_broker values and the /brokers view agree with the
-- single live worker. New rows are unaffected (the worker writes "meshat.se"
-- directly); this only heals history written by the old deployment.
-- Both updates are idempotent rewrites and safe to re-run.
UPDATE observer_brokers SET broker_name = 'meshat.se' WHERE broker_name IN ('mqtt1', 'mqtt2');
UPDATE packet_observations SET source_broker = 'meshat.se' WHERE source_broker IN ('mqtt1', 'mqtt2');
