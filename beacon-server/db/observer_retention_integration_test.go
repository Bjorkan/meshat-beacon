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
func TestObserverRetentionIntegration(t *testing.T) {
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
	schema := "obsret_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	// Minimal rows the observer-owned cascade tables need.
	exec(`INSERT INTO iata_codes (iata) VALUES ('YVR')`)
	exec(`INSERT INTO transport_scopes (name, transport_key, key_fingerprint) VALUES ('#test', decode(repeat('01', 16), 'hex'), decode(repeat('02', 8), 'hex'))`)

	// ── 13d23h59m old observer must survive cleanup ─────────────────────────
	youngID, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{0x11}, 32))
	if err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE observers SET last_seen = NOW() - INTERVAL '13 days 23 hours 59 minutes' WHERE id = $1`, youngID)

	// ── >14d observer with full metadata and a retained packet observation ──
	staleID, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{0x22}, 32))
	if err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO observer_brokers (observer_id, broker_name) VALUES ($1, 'meshat.se')`, staleID)
	exec(`INSERT INTO observer_scopes (observer_id, scope_id) SELECT $1, id FROM transport_scopes WHERE name = '#test'`, staleID)
	exec(`INSERT INTO observer_locations (observer_id, iata, latitude, longitude) VALUES ($1, 'YVR', 49.2, -123.1)`, staleID)
	exec(`INSERT INTO observer_telemetry (observer_id, reported_at, battery_voltage_mv) VALUES ($1, NOW(), 4200)`, staleID)
	exec(`INSERT INTO observer_owners (observer_id, contact_name) VALUES ($1, 'op')`, staleID)

	exec(`INSERT INTO packets (packet_hash, payload_type, payload_version, route_type, raw_payload, raw_header, first_heard_at, last_heard_at) VALUES (decode('aa', 'hex'), 1, 1, 1, decode('00', 'hex'), decode('00', 'hex'), NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days')`)
	inserted, err := store.InsertObservation(ctx, ingest.InsertObservationParams{
		PacketHash: []byte{0xaa},
		ObserverID: staleID,
		IATA:       "YVR",
		HeardAt:    time.Now(),
	})
	if err != nil || !inserted {
		t.Fatalf("InsertObservation: inserted=%v err=%v", inserted, err)
	}

	exec(`UPDATE observers SET last_seen = NOW() - INTERVAL '15 days' WHERE id = $1`, staleID)

	// ── Cleanup: young survives, stale is deleted, metadata cascades ────────
	deleted, err := store.DeleteOldObservers(ctx, time.Now().Add(-14*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if len(deleted) != 1 || deleted[0] != staleID {
		t.Fatalf("expected exactly the stale observer deleted, got %v", deleted)
	}
	if !store.IsObserverByPubkey(ctx, bytes.Repeat([]byte{0x11}, 32)) {
		t.Error("expected the 13d23h59m observer to survive cleanup")
	}
	var childCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM observer_brokers WHERE observer_id = $1`, staleID).Scan(&childCount); err != nil {
		t.Fatal(err)
	}
	if childCount != 0 {
		t.Error("expected observer_brokers to cascade-delete with the observer")
	}
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM observer_locations WHERE observer_id = $1`, staleID).Scan(&childCount); err != nil {
		t.Fatal(err)
	}
	if childCount != 0 {
		t.Error("expected observer_locations to cascade-delete with the observer")
	}

	// ── Retained packet history must survive with the identity snapshot ────
	var obsID uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT observer_id FROM packet_observations WHERE packet_hash = decode('aa', 'hex')`).Scan(&obsID); err != nil {
		t.Fatal(err)
	}
	if obsID != uuid.Nil {
		t.Errorf("expected observation observer_id to be NULL after observer deletion, got %v", obsID)
	}
	var pubkey []byte
	if err := pool.QueryRow(ctx, `SELECT observer_public_key FROM packet_observations WHERE packet_hash = decode('aa', 'hex')`).Scan(&pubkey); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pubkey, bytes.Repeat([]byte{0x22}, 32)) {
		t.Errorf("expected observation to snapshot the observer public key, got %x", pubkey)
	}
	pkt, err := store.GetPacket(ctx, []byte{0xaa})
	if err != nil {
		t.Fatalf("expected the historical packet to remain queryable: %v", err)
	}
	if len(pkt.Observations) != 1 {
		t.Fatalf("expected 1 retained observation, got %d", len(pkt.Observations))
	}

	// ── A returning public key is recreated cleanly by ingest ───────────────
	recreatedID, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{0x22}, 32))
	if err != nil {
		t.Fatal(err)
	}
	if recreatedID == staleID {
		t.Error("expected a fresh observer row for the returning public key")
	}
	var orphanCount int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM observer_brokers WHERE observer_id = $1`, recreatedID).Scan(&orphanCount); err != nil {
		t.Fatal(err)
	}
	if orphanCount != 0 {
		t.Error("expected the recreated observer to start without stale child data")
	}

	// ── Status/neighbors activity resets the retention clock ────────────────
	oldSeen := time.Now().Add(-15 * 24 * time.Hour)
	if _, err := store.UpdateObserverStatus(ctx, ingest.UpdateObserverStatusParams{PublicKey: bytes.Repeat([]byte{0x11}, 32)}); err != nil {
		t.Fatal(err)
	}
	var seen time.Time
	if err := pool.QueryRow(ctx, `SELECT last_seen FROM observers WHERE id = $1`, youngID).Scan(&seen); err != nil {
		t.Fatal(err)
	}
	if !seen.After(oldSeen) {
		t.Errorf("expected last_seen to be refreshed by status activity, got %v", seen)
	}

	// ── Materialized view still counts retained history ─────────────────────
	// The retained observation's observer row is gone, so it surfaces under a
	// nil observer ID with its identity snapshot; its count must not vanish.
	if err := store.RefreshTopObservers(ctx); err != nil {
		t.Fatalf("refresh top observers: %v", err)
	}
	top, err := store.GetStatsTopObservers(ctx, nil, time.Now().Add(-30*24*time.Hour), 10)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, trow := range top {
		if trow.ObserverID == uuid.Nil {
			found = true
			if trow.ObservationCount < 1 {
				t.Errorf("expected retained observation count in top observers stats, got %d", trow.ObservationCount)
			}
		}
	}
	if !found {
		t.Error("expected the stale observer's retained history to appear in top observers stats")
	}
}
