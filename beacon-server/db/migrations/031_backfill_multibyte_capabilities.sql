-- Firmware that supports multibyte path hashes (1.14+) necessarily supports
-- multibyte traces, introduced in 1.11. Repair rows created when these flags
-- were inferred independently.
UPDATE nodes
SET supports_multibyte_traces = TRUE
WHERE supports_multibyte_paths
  AND NOT supports_multibyte_traces;

-- Older ingest attributed an advert's path mode only to resolved relays, not
-- to the signed advertiser. Recover exact origins from stored advert packets
-- and their observations, including zero-hop adverts.
UPDATE nodes AS n
SET supports_multibyte_paths = TRUE,
    supports_multibyte_traces = TRUE
WHERE EXISTS (
  SELECT 1
  FROM packets AS p
  JOIN packet_observations AS po ON po.packet_hash = p.packet_hash
  WHERE p.payload_type = 4
    AND p.origin_pubkey = n.public_key
    AND po.hash_size IN (2, 3)
);
