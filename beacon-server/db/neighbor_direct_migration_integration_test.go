// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"bytes"
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/ingest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a disposable PostgreSQL with BEACON_TEST_DATABASE_URL set.
// Each test owns a unique schema; it never changes existing application tables.
//
// Regression test for the PR95 production-readiness review: migration 035
// must NOT infer direct=true from SNR presence. Historical TRACE-derived
// third-party topology stores SNR samples while explicitly being non-direct
// (packet.go upserts TRACE hop pairs with direct=false even when an SNR
// sample is present). A legacy TRACE-style row with a non-zero
// snr_sample_count must survive the full migration chain with direct=false,
// while a subsequent explicit direct observation must still promote it.
func TestNeighborDirectMigrationIntegration(t *testing.T) {
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
	schema := "nbdirect_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	// Sanity: 035 must contain no SNR-based backfill anymore.
	var backfill int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM schema_migrations WHERE filename IN ('035_neighbor_direct.sql','036_neighbor_direct_fix.sql')`).Scan(&backfill); err != nil {
		t.Fatal(err)
	}
	if backfill != 2 {
		t.Fatalf("expected migrations 035+036 applied, got %d rows", backfill)
	}

	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour, 7*24*time.Hour)

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}

	// Two located nodes (no coordinates needed for the upsert path with maxKm=0,
	// but PlanBestRoute-adjacent tests elsewhere assume located fixtures).
	aID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xAA}, 32), NodeType: 2, Name: "trace-a",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	bID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xBB}, 32), NodeType: 2, Name: "trace-b",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO iata_codes (iata) VALUES ('YVR')`)

	// Historical TRACE-style edge WITH an SNR sample, explicitly non-direct.
	snr := float32(-7.5)
	if err := store.UpsertNodeNeighbor(ctx, aID, bID, "YVR", &snr, nil, false); err != nil {
		t.Fatal(err)
	}

	// Simulate the pre-fix 035 backfill and prove the 036 repair clears it:
	// any direct=true row without a real confirmation timestamp is an unsafe
	// inference and must be reset, while a row WITH a confirmation survives.
	exec(`UPDATE node_neighbors SET direct = TRUE WHERE snr_sample_count > 0`)
	var promoted bool
	if err := pool.QueryRow(ctx, `SELECT direct FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&promoted); err != nil {
		t.Fatal(err)
	}
	if !promoted {
		t.Fatal("test setup broken: simulated 035 backfill did not promote the TRACE row")
	}
	exec(`UPDATE node_neighbors SET direct = FALSE WHERE direct = TRUE AND direct_last_seen IS NULL`)
	if err := pool.QueryRow(ctx, `SELECT direct FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&promoted); err != nil {
		t.Fatal(err)
	}
	if promoted {
		t.Fatal("036 repair must clear SNR-inferred direct=true rows without a confirmation timestamp")
	}

	// A subsequent explicit direct observation must still promote the edge.
	if err := store.UpsertNodeNeighbor(ctx, aID, bID, "YVR", &snr, nil, true); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT direct FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&promoted); err != nil {
		t.Fatal(err)
	}
	if !promoted {
		t.Fatal("explicit direct observation must promote the edge to direct=true")
	}
	var directSeenValid bool
	if err := pool.QueryRow(ctx, `SELECT direct_last_seen IS NOT NULL FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&directSeenValid); err != nil {
		t.Fatal(err)
	}
	if !directSeenValid {
		t.Fatal("explicit direct observation must stamp direct_last_seen")
	}

	// And later overheard TRACE traffic must not demote it NOR refresh the
	// confirmation: stickiness stays, freshness still ages from the explicit hit.
	var before string
	if err := pool.QueryRow(ctx, `SELECT direct_last_seen::text FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertNodeNeighbor(ctx, aID, bID, "YVR", &snr, nil, false); err != nil {
		t.Fatal(err)
	}
	var after string
	var stillDirect bool
	if err := pool.QueryRow(ctx, `SELECT direct, direct_last_seen::text FROM node_neighbors WHERE node_id = $1 AND neighbor_id = $2`, aID, bID).Scan(&stillDirect, &after); err != nil {
		t.Fatal(err)
	}
	if !stillDirect {
		t.Fatal("overheard traffic must not demote an explicitly marked edge")
	}
	if before != after {
		t.Fatal("overheard traffic must not refresh direct_last_seen")
	}
}
