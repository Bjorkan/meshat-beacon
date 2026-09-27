// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"os"
	"testing"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/jackc/pgx/v5"
)

// The packet and its observation are separate ingest writes. A list request
// between them must return the packet without inventing an observer or failing.
func TestListPacketsBeforeObservationPostgres(t *testing.T) {
	dsn := os.Getenv("BEACON_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set BEACON_TEST_POSTGRES_DSN for the PostgreSQL regression test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(context.Background())
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(context.Background())
	for _, table := range []string{"packets", "packet_observations", "observers", "transport_scopes"} {
		if _, err := tx.Exec(ctx, "CREATE TEMP TABLE "+table+" (LIKE public."+table+" INCLUDING ALL) ON COMMIT DROP"); err != nil {
			t.Fatal(err)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO packets (packet_hash, payload_type, payload_version, route_type, raw_payload, raw_header, first_heard_at, last_heard_at)
VALUES ('\x01', 4, 0, 1, '\x00', '\x00', NOW(), NOW())`)
	if err != nil {
		t.Fatal(err)
	}
	store := &Store{q: sqlc.New(tx)}
	page, err := store.ListPackets(ctx, api.PacketListParams{IATAs: nil, Limit: 50})
	if err != nil {
		t.Fatalf("packet without observation must remain readable: %v", err)
	}
	if len(page.Items) != 1 || page.Items[0].PacketHash != "01" {
		t.Fatalf("packet missing: %+v", page)
	}
	if page.Items[0].LatestObserver != nil || page.Items[0].ObservationCount != 0 {
		t.Fatalf("invented observation: %+v", page.Items[0])
	}
	_, err = tx.Exec(ctx, `
INSERT INTO observers (id, public_key) VALUES ('00000000-0000-0000-0000-000000000001', '\x02');
INSERT INTO packet_observations (id, packet_hash, observer_id, iata, heard_at, path_length_byte, hash_size, hop_count, path_bytes)
VALUES (1, '\x01', '00000000-0000-0000-0000-000000000001', 'YVR', NOW(), 2, 1, 2, '\x1122');`)
	if err != nil {
		t.Fatal(err)
	}
	for _, iatas := range [][]string{nil, {"YVR"}} {
		page, err := store.ListPackets(ctx, api.PacketListParams{IATAs: iatas, Limit: 50})
		if err != nil {
			t.Fatal(err)
		}
		if len(page.Items) != 1 || page.Items[0].ObservationCount != 1 {
			t.Fatalf("observed packet missing for %v: %+v", iatas, page)
		}
		observer := page.Items[0].LatestObserver
		if observer == nil || observer.IATA != "YVR" || observer.PathLength == nil || observer.PathBytes == nil {
			t.Fatalf("observation metadata missing: %+v", observer)
		}
		if observer.PathLength.Raw != "02" || observer.PathLength.HashSize != 1 || observer.PathLength.HopCount != 2 || *observer.PathBytes != "1122" {
			t.Fatalf("observation path changed: %+v", observer)
		}
	}
	// Known regions match exact transport names. '*' is only ordinary traffic,
	// never an unknown transport code; exercise both list query paths.
	_, err = tx.Exec(ctx, `
INSERT INTO transport_scopes (id, name, transport_key, key_fingerprint) VALUES (680, 'se0680', '\x00', '\x00');
INSERT INTO packets (packet_hash, payload_type, payload_version, route_type, scope_id, raw_payload, raw_header, first_heard_at, last_heard_at) VALUES
('\x02', 4, 0, 3, 680, '\x00', '\x00', NOW(), NOW()),
('\x03', 4, 0, 0, NULL, '\x00', '\x00', NOW(), NOW());
INSERT INTO packet_observations (id, packet_hash, observer_id, iata, heard_at, path_length_byte, hash_size, hop_count, path_bytes) VALUES
(2, '\x02', '00000000-0000-0000-0000-000000000001', 'YVR', NOW(), 0, 1, 0, '\x'),
(3, '\x03', '00000000-0000-0000-0000-000000000001', 'YVR', NOW(), 0, 1, 0, '\x');`)
	if err != nil {
		t.Fatal(err)
	}
	for _, iatas := range [][]string{nil, {"YVR"}} {
		for _, tc := range []struct {
			scopes []string
			hashes []string
		}{
			{[]string{"*"}, []string{"01"}},
			{[]string{"se0680"}, []string{"02"}},
			{[]string{"se06"}, nil},
			{[]string{"*", "se0680"}, []string{"01", "02"}},
		} {
			page, err := store.ListPackets(ctx, api.PacketListParams{IATAs: iatas, Scopes: tc.scopes, Limit: 50})
			if err != nil {
				t.Fatal(err)
			}
			if len(page.Items) != len(tc.hashes) {
				t.Fatalf("iatas=%v scopes=%v: got %+v", iatas, tc.scopes, page.Items)
			}
			for _, hash := range tc.hashes {
				found := false
				for _, packet := range page.Items {
					if packet.PacketHash == hash {
						found = true
					}
				}
				if !found {
					t.Fatalf("missing %s for %v/%v", hash, iatas, tc.scopes)
				}
			}
		}
	}
}
