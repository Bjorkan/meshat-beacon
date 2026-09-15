// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"

	"os"
	"strings"
	"testing"
	"time"

	"bytes"
	"encoding/json"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a disposable PostgreSQL with BEACON_TEST_DATABASE_URL set.
// Each test owns a unique schema; it never changes existing application tables.
func TestObserverOwnerIntegration(t *testing.T) {
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
	schema := "owners_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour, 7*24*time.Hour)
	observerID, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{1}, 32))
	if err != nil {
		t.Fatal(err)
	}
	ownerA, ownerB := bytes.Repeat([]byte{2}, 32), bytes.Repeat([]byte{3}, 32)
	at := time.Unix(1700000000, 0)
	update := func(key []byte, stamp time.Time) bool {
		t.Helper()
		accepted, err := store.UpsertObserverOwner(ctx, observerID, key, "mqtt-internal:test", stamp)
		if err != nil {
			t.Fatal(err)
		}
		return accepted
	}
	get := func() []byte {
		t.Helper()
		obs, err := store.GetObserver(ctx, observerID)
		if err != nil {
			t.Fatal(err)
		}
		b, err := json.Marshal(obs)
		if err != nil {
			t.Fatal(err)
		}
		for _, secret := range []string{"jwt_payload", "private@example.test", "contact_email", "owner_pubkey", "token-secret"} {
			if bytes.Contains(b, []byte(secret)) {
				t.Fatalf("private metadata leaked: %s", secret)
			}
		}
		return b
	}
	if bytes.Contains(get(), []byte("ownerNode")) {
		t.Fatal("owner present before mapping")
	}
	// Owner-before-node: persist a private unresolved claim with no public relationship.
	if !update(ownerA, at) {
		t.Fatal("initial owner rejected")
	}
	exec("UPDATE observer_owners SET contact_email='private@example.test',notes='token-secret' WHERE observer_id=$1", observerID)
	if bytes.Contains(get(), []byte("ownerNode")) {
		t.Fatal("unresolved owner exposed")
	}
	nodeA := uuid.New()
	exec("INSERT INTO nodes(id,public_key,node_type,name) VALUES($1,$2,1,'Owner A')", nodeA, ownerA)
	related, err := store.ReconcileObserverOwners(ctx, nodeA)
	if err != nil || len(related) != 1 || related[0] != observerID {
		t.Fatalf("reconcile=%v err=%v", related, err)
	}
	if !bytes.Contains(get(), []byte("Owner A")) {
		t.Fatal("owner not projected")
	}
	exec("UPDATE nodes SET name='Renamed owner' WHERE id=$1", nodeA)
	related, err = store.ReconcileObserverOwners(ctx, nodeA)
	if err != nil || len(related) != 1 {
		t.Fatal("rename did not return related observers", err)
	}
	if !bytes.Contains(get(), []byte("Renamed owner")) {
		t.Fatal("rename missing")
	}
	// Node-before-owner, then an ownership change resolves immediately.
	nodeB := uuid.New()
	exec("INSERT INTO nodes(id,public_key,node_type,name) VALUES($1,$2,1,'Owner B')", nodeB, ownerB)
	update(ownerB, at.Add(time.Second))
	if !bytes.Contains(get(), []byte("Owner B")) {
		t.Fatal("owner change missing")
	}
	if update(ownerA, at) {
		t.Fatal("stale metadata accepted")
	}
	if !bytes.Contains(get(), []byte("Owner B")) {
		t.Fatal("stale event changed owner")
	}
	update(nil, at.Add(2*time.Second))
	if bytes.Contains(get(), []byte("ownerNode")) {
		t.Fatal("removed owner exposed")
	}
	if update(ownerA, at.Add(time.Second)) {
		t.Fatal("stale metadata restored removed owner")
	}
	var nodeID *uuid.UUID
	var key []byte
	if err := pool.QueryRow(ctx, "SELECT owner_node_id,owner_pubkey FROM observer_owners WHERE observer_id=$1", observerID).Scan(&nodeID, &key); err != nil {
		t.Fatal(err)
	}
	if nodeID != nil || key != nil {
		t.Fatal("removal left a private owner mapping")
	}
}
