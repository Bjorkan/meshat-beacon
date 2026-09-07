// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a disposable PostgreSQL with BEACON_TEST_DATABASE_URL set.
// Each test owns a unique schema; it never changes existing application tables.
func TestNodePathPacketsIntegration(t *testing.T) {
	url := os.Getenv("BEACON_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set BEACON_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "paths_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("INSERT INTO iata_codes(iata) VALUES ('YVR'), ('YYJ')")
	selected, collision, companion := uuid.New(), uuid.New(), uuid.New()
	key, _ := hex.DecodeString("aabbccdd" + strings.Repeat("00", 28))
	exec("INSERT INTO nodes(id,public_key,node_type,name) VALUES ($1,$2,2,'Selected'), ($3,decode('aa112233','hex'),2,'Collision'), ($4,decode('aabbccddff','hex'),1,'Companion')", selected, key, collision, companion)
	exec("INSERT INTO node_short_ids(node_id,iata,prefix_4) VALUES ($1,'YVR',decode('aabbccdd','hex')), ($1,'YYJ',decode('aabbccdd','hex')), ($2,'YYJ',decode('aa112233','hex')), ($3,'YVR',decode('aabbccdd','hex'))", selected, collision, companion)
	observers := []uuid.UUID{uuid.New(), uuid.New(), uuid.New()}
	for i, id := range observers {
		exec("INSERT INTO observers(id,public_key,display_name) VALUES ($1,$2,$3)", id, []byte{byte(i)}, fmt.Sprintf("Observer %d", i))
	}
	addPacket := func(hash string, payload int, path string, width, hops int, iata string) {
		t.Helper()
		exec("INSERT INTO packets(packet_hash,payload_type,payload_version,route_type,raw_payload,raw_header,origin_pubkey,first_heard_at,last_heard_at) VALUES (decode($1,'hex'),$2,0,1,'','',$3,now(),now())", hash, payload, key)
		exec("INSERT INTO packet_observations(packet_hash,observer_id,iata,heard_at,path_length_byte,hash_size,hop_count,path_bytes,payload_type) VALUES (decode($1,'hex'),$2,$3,now(),$4,$5,$4,decode($6,'hex'),$7)", hash, observers[0], iata, hops, width, path, payload)
	}
	addPacket("01", 5, "aabb", 2, 1, "YVR")
	addPacket("02", 4, "", 1, 0, "YVR")         // origin alone never qualifies
	addPacket("03", 5, "aa", 1, 1, "YVR")       // globally ambiguous, even though collision is in YYJ
	addPacket("04", 5, "00aabb00", 2, 2, "YVR") // substring across hop boundary
	addPacket("05", 5, "aabbccdd", 4, 1, "YVR")
	addPacket("06", 9, "aabb", 2, 1, "YVR") // TRACE SNR bytes are not a canonical route
	addPacket("07", 5, "aabb", 2, 1, "YYJ")
	addPacket("08", 5, "aabbcc", 2, 1, "YVR") // malformed length
	addPacket("09", 5, "fe", 1, 1, "YVR")     // unresolved
	addPacket("10", 5, "aabbcc", 3, 1, "YVR")
	exec("INSERT INTO packet_observations(packet_hash,observer_id,iata,heard_at,path_length_byte,hash_size,hop_count,path_bytes) VALUES (decode('01','hex'),$1,'YVR',now(),1,2,1,decode('aabb','hex'))", observers[1])
	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour)
	page, err := store.ListNodePathPackets(ctx, selected, []string{"YVR"}, nil, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || page.HasMore {
		t.Fatalf("expected 3 unique matching packets, got %+v", page)
	}
	seen := map[string]bool{}
	for _, item := range page.Items {
		seen[item.PacketHash] = true
		if item.LatestObserver.IATA != "YVR" {
			t.Fatal("unfiltered observation context")
		}
		if item.LatestObserver.ResolvedPath[0].Confidence != "high" {
			t.Fatal("not a resolved hop")
		}
		if item.PacketHash == "01" && item.ObservationCount != 2 {
			t.Fatalf("matching observation count = %d", item.ObservationCount)
		}
	}
	for _, hash := range []string{"01", "05", "10"} {
		if !seen[hash] {
			t.Errorf("missing %s", hash)
		}
	}
	all, err := store.ListNodePathPackets(ctx, selected, nil, nil, 50)
	if err != nil || len(all.Items) != 4 {
		t.Fatalf("all regions: %+v, %v", all, err)
	}
	first, err := store.ListNodePathPackets(ctx, selected, []string{"YVR"}, nil, 1)
	if err != nil || first.NextPageToken == nil {
		t.Fatalf("first page: %+v, %v", first, err)
	}
	addPacket("11", 5, "aabb", 2, 1, "YVR") // new traffic after snapshot
	exec("INSERT INTO packet_observations(packet_hash,observer_id,iata,heard_at,path_length_byte,hash_size,hop_count,path_bytes) VALUES (decode($1,'hex'),$2,'YVR',now(),1,2,1,decode('aabb','hex'))", first.Items[0].PacketHash, observers[2])
	got := map[string]bool{first.Items[0].PacketHash: true}
	for first.NextPageToken != nil {
		token, err := api.DecodePageToken(*first.NextPageToken)
		if err != nil {
			t.Fatal(err)
		}
		first, err = store.ListNodePathPackets(ctx, selected, []string{"YVR"}, token, 1)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range first.Items {
			if got[item.PacketHash] {
				t.Fatalf("duplicate page item %s", item.PacketHash)
			}
			got[item.PacketHash] = true
		}
	}
	if len(got) != 3 || got["11"] {
		t.Fatalf("unstable pagination: %v", got)
	}
	// The index is usable for the exact predicate, rather than a whole-feed substring scan.
	exec("SET enable_seqscan = off")
	rows, err := pool.Query(ctx, "EXPLAIN SELECT id FROM packet_observations WHERE observation_path_hops(path_bytes,hash_size,hop_count) && ARRAY[decode('aabb','hex')]")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	plan := ""
	for rows.Next() {
		var line string
		if err := rows.Scan(&line); err != nil {
			t.Fatal(err)
		}
		plan += line
	}
	if !strings.Contains(plan, "idx_observations_path_hops") {
		t.Fatalf("path index unused: %s", plan)
	}
}
