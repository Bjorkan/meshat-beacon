// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"

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
func TestChannelListingIntegration(t *testing.T) {
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
	schema := "channels_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	exec("INSERT INTO iata_codes(iata) VALUES ('YVR'), ('YYJ'), ('YOW')")
	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour)
	list := func(limit int32, hash []byte, iatas []string, cursor int64, key string) api.ChannelPage {
		t.Helper()
		page, err := store.ListChannels(ctx, limit, hash, iatas, cursor, key)
		if err != nil {
			t.Fatal(err)
		}
		return page
	}
	if page := list(2, nil, nil, 0, "known"); page.UnknownCount != 0 || len(page.Items) != 0 {
		t.Fatalf("empty: %+v", page)
	}
	// 80 unknown channels, newer than two known channels and older than another.
	exec(`INSERT INTO channels(channel_hash,last_seen) SELECT decode(lpad(to_hex(i),2,'0'),'hex'), '2026-01-02'::timestamptz + i * interval '1 second' FROM generate_series(1,80) i`)
	exec(`INSERT INTO channel_iatas(channel_hash,iata) SELECT channel_hash, CASE WHEN get_byte(channel_hash,0)<=60 THEN 'YVR' ELSE 'YYJ' END FROM channels`)
	for i := 81; i <= 83; i++ {
		hash := []byte{byte(i)}
		exec("INSERT INTO channels(channel_hash,key_fingerprint,key_known,name,last_seen) VALUES($1,$1,true,'Named', '2026-01-01'::timestamptz + $2 * interval '1 day')", hash, i-81)
		exec("INSERT INTO channel_iatas(channel_hash,iata) VALUES($1,'YVR')", hash)
	}
	page := list(2, nil, nil, 0, "known")
	if page.UnknownCount != 80 || len(page.Items) != 2 || !page.HasMore {
		t.Fatalf("first page: %+v", page)
	}
	for _, ch := range page.Items {
		if !ch.KeyKnown {
			t.Fatal("unknown channel crowded out known channel")
		}
	}
	next := list(2, nil, nil, *page.NextCursor, "known")
	if len(next.Items) != 1 || next.HasMore || next.UnknownCount != 80 {
		t.Fatalf("next page: %+v", next)
	}
	if page := list(2, nil, []string{"YVR"}, 0, "known"); page.UnknownCount != 60 || len(page.Items) != 2 {
		t.Fatalf("YVR: %+v", page)
	}
	if page := list(2, nil, []string{"YYJ"}, 0, "known"); page.UnknownCount != 20 || len(page.Items) != 0 {
		t.Fatalf("YYJ: %+v", page)
	}
	if page := list(2, nil, []string{"YOW"}, 0, "known"); page.UnknownCount != 0 || len(page.Items) != 0 {
		t.Fatalf("YOW: %+v", page)
	}
	if page := list(2, nil, []string{"YVR", "YYJ"}, 0, "known"); page.UnknownCount != 80 {
		t.Fatalf("combined: %+v", page)
	}
	unknown := list(2, nil, nil, 0, "unknown")
	if unknown.UnknownCount != 80 || len(unknown.Items) != 2 || !unknown.HasMore {
		t.Fatalf("diagnostics: %+v", unknown)
	}
	exact := list(2, []byte{1}, []string{"YVR"}, 0, "all")
	if exact.UnknownCount != 1 || len(exact.Items) != 1 || exact.Items[0].ChannelHash != "01" {
		t.Fatalf("exact hash: %+v", exact)
	}
	historicalID := exact.Items[0].ID
	if page := list(2, []byte{1}, []string{"YYJ"}, 0, "all"); page.UnknownCount != 0 || len(page.Items) != 0 {
		t.Fatalf("scoped exact hash: %+v", page)
	}
	// Configured key shares a hash with unresolved traffic: keep counting the unknown.
	exec("INSERT INTO packets(packet_hash,payload_type,payload_version,route_type,raw_payload,raw_header,channel_hash,decrypted,first_heard_at,last_heard_at) VALUES ('\\x01',5,0,1,'','',$1,false,now(),now())", []byte{1})
	exec("INSERT INTO channels(channel_hash,key_fingerprint,key_known,name) VALUES($1,'\\x01020304',true,'New key')", []byte{1})
	if page := list(10, []byte{1}, nil, 0, "all"); page.UnknownCount != 1 || len(page.Items) != 2 {
		t.Fatalf("unresolved collision: %+v", page)
	}
	// Backfill completes: known channel stays visible, historical placeholder leaves count/list.
	exec("UPDATE packets SET decrypted=true WHERE channel_hash=$1", []byte{1})
	if page := list(10, []byte{1}, nil, 0, "all"); page.UnknownCount != 0 || len(page.Items) != 1 || !page.Items[0].KeyKnown {
		t.Fatalf("resolved: %+v", page)
	}
	if page := list(2, nil, []string{"YVR"}, 0, "known"); page.UnknownCount != 59 {
		t.Fatalf("resolved count: %+v", page)
	}
	if _, err := store.GetChannel(ctx, int32(historicalID)); err != nil {
		t.Fatal("historical row removed", err)
	}
	// Fresh undecryptable collision becomes diagnosable again.
	exec("UPDATE packets SET decrypted=false WHERE channel_hash=$1", []byte{1})
	if page := list(10, []byte{1}, nil, 0, "unknown"); page.UnknownCount != 1 || len(page.Items) != 1 {
		t.Fatalf("new collision: %+v", page)
	}
}
