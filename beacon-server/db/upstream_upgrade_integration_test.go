// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Exercise the deployed Meshat schema, not just a fresh upstream installation.
func TestUpstreamUpgradeIntegration(t *testing.T) {
	dsn := os.Getenv("BEACON_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set BEACON_TEST_DATABASE_URL for PostgreSQL integration tests")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := "upstream_upgrade_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec("CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())")
	files, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if file.Name()[:3] > "037" {
			continue
		}
		data, err := migrationFiles.ReadFile("migrations/" + file.Name())
		if err != nil {
			t.Fatal(err)
		}
		if err := applyMigration(ctx, pool, string(data)); err != nil {
			t.Fatalf("old migration %s: %v", file.Name(), err)
		}
		exec("INSERT INTO schema_migrations(filename) VALUES($1)", file.Name())
	}
	a, b, o := uuid.New(), uuid.New(), uuid.New()
	exec("INSERT INTO iata_codes(iata) VALUES('STO')")
	exec("INSERT INTO nodes(id,public_key,node_type,name,supports_multibyte_paths,supports_multibyte_traces) VALUES($1,decode(repeat('ab',32),'hex'),2,'Own repeater',TRUE,TRUE),($2,decode(repeat('cd',32),'hex'),2,'Neighbor',TRUE,TRUE)", a, b)
	exec("INSERT INTO observers(id,public_key,display_name) VALUES($1,decode(repeat('ef',32),'hex'),'Own observer')", o)
	exec("INSERT INTO observer_owners(observer_id,owner_node_id,owner_pubkey,metadata_at) VALUES($1,$2,decode(repeat('ab',32),'hex'),NOW())", o, a)
	exec("INSERT INTO observer_telemetry(observer_id,reported_at,airtime_tx_pct,airtime_rx_pct,uptime_seconds) VALUES($1,NOW(),12.5,25,300)", o)
	exec("INSERT INTO node_neighbors(node_id,neighbor_id,iata,direct,direct_last_seen,hash_width) VALUES($1,$2,'STO',TRUE,NOW(),3)", a, b)
	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatalf("restart: %v", err)
	}
	var tx, rx float32
	if err := pool.QueryRow(ctx, "SELECT airtime_tx_secs,airtime_rx_secs FROM observer_telemetry WHERE observer_id=$1", o).Scan(&tx, &rx); err != nil {
		t.Fatal(err)
	}
	if tx != 12.5 || rx != 25 {
		t.Fatalf("counter values changed: TX %v RX %v", tx, rx)
	}
	var owner uuid.UUID
	if err := pool.QueryRow(ctx, "SELECT owner_node_id FROM observer_owners WHERE observer_id=$1 AND metadata_at IS NOT NULL", o).Scan(&owner); err != nil {
		t.Fatal(err)
	}
	if owner != a {
		t.Fatal("owner linkage changed")
	}
	var direct bool
	var width int16
	if err := pool.QueryRow(ctx, "SELECT direct,hash_width FROM node_neighbors WHERE node_id=$1 AND neighbor_id=$2 AND direct_last_seen IS NOT NULL", a, b).Scan(&direct, &width); err != nil {
		t.Fatal(err)
	}
	if !direct || width != 3 {
		t.Fatalf("route provenance changed: direct %v width %v", direct, width)
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != len(files) {
		t.Fatalf("applied %d of %d migrations", count, len(files))
	}
}
