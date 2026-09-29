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
// Regression test for issue #100: node_neighbors rows carry the receive SNR the
// row's node measured, so a node's neighbor view must show only its OWN receive
// SNR per neighbor — never a sample-weighted average with the reverse direction,
// and never the neighbor's receive SNR. Adjacency stays symmetric: a link known
// only from the neighbor's reports still lists the neighbor, with no SNR.
func TestGetNodeNeighbors_DirectionalSNR(t *testing.T) {
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
	schema := "snrdir_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	store := New(pool, 5*time.Minute, time.Hour, 0, 24*time.Hour, 7*24*time.Hour)

	if _, err := pool.Exec(ctx, `INSERT INTO iata_codes (iata) VALUES ('YVR'), ('SEA')`); err != nil {
		t.Fatal(err)
	}

	aID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xA1}, 32), NodeType: 2, Name: "snr-a",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	bID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xB2}, 32), NodeType: 2, Name: "snr-b",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}

	// Asymmetric link: b hears a at -10 dB, a hears b at +10 dB (YVR) and +12 dB (SEA).
	// Seed order controls last_seen: a's YVR row is the freshest own row, b's reverse
	// row is the freshest row overall.
	if err := store.UpsertNodeNeighbor(ctx, bID, aID, "YVR", f32(-10), nil, true, i16(32)); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertNodeNeighbor(ctx, aID, bID, "SEA", f32(12), nil, true, i16(32)); err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertNodeNeighbor(ctx, aID, bID, "YVR", f32(10), nil, true, i16(32)); err != nil {
		t.Fatal(err)
	}

	// ── a's view: only a's own receive samples (+10 YVR, +12 SEA) may merge ──
	aNeighbors, err := store.GetNodeNeighbors(ctx, aID)
	if err != nil {
		t.Fatal(err)
	}
	if len(aNeighbors) != 1 {
		t.Fatalf("expected one neighbor for a, got %d", len(aNeighbors))
	}
	aView := aNeighbors[0]
	if aView.ID != bID {
		t.Fatalf("expected neighbor b, got %s", aView.ID)
	}
	if aView.SNR == nil {
		t.Fatal("expected a's view to carry a's own receive SNR")
	}
	if *aView.SNR != 11 {
		t.Errorf("expected a's own samples averaged to 11, got %v", *aView.SNR)
	}
	if aView.SNRSampleCount != 2 {
		t.Errorf("expected 2 own samples, got %d", aView.SNRSampleCount)
	}
	if aView.ObservationCount != 3 {
		t.Errorf("expected observations summed across directions (3), got %d", aView.ObservationCount)
	}
	if aView.IATA != "YVR" {
		t.Errorf("expected the node's own freshest region (YVR), got %s", aView.IATA)
	}

	// ── b's view: only b's own receive sample (-10) — not a's +11 average ──
	bNeighbors, err := store.GetNodeNeighbors(ctx, bID)
	if err != nil {
		t.Fatal(err)
	}
	if len(bNeighbors) != 1 {
		t.Fatalf("expected one neighbor for b, got %d", len(bNeighbors))
	}
	bView := bNeighbors[0]
	if bView.SNR == nil || *bView.SNR != -10 {
		t.Errorf("expected b's own receive SNR -10, got %v", bView.SNR)
	}
	if bView.SNRSampleCount != 1 {
		t.Errorf("expected 1 own sample, got %d", bView.SNRSampleCount)
	}
	if bView.ObservationCount != 3 {
		t.Errorf("expected observations summed across directions (3), got %d", bView.ObservationCount)
	}

	// ── reverse-only link: c heard d, d never reported hearing c ──
	cID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xC3}, 32), NodeType: 2, Name: "snr-c",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	dID, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{
		PublicKey: bytes.Repeat([]byte{0xD4}, 32), NodeType: 2, Name: "snr-d",
	}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.UpsertNodeNeighbor(ctx, cID, dID, "YVR", f32(5), nil, true, i16(32)); err != nil {
		t.Fatal(err)
	}

	dNeighbors, err := store.GetNodeNeighbors(ctx, dID)
	if err != nil {
		t.Fatal(err)
	}
	if len(dNeighbors) != 1 {
		t.Fatalf("expected d to still list c from c's report, got %d neighbors", len(dNeighbors))
	}
	if dNeighbors[0].SNR != nil {
		t.Errorf("expected no SNR on d's reverse-only view, got %v", *dNeighbors[0].SNR)
	}
	if dNeighbors[0].SNRSampleCount != 0 {
		t.Errorf("expected 0 own samples on d's reverse-only view, got %d", dNeighbors[0].SNRSampleCount)
	}

	cNeighbors, err := store.GetNodeNeighbors(ctx, cID)
	if err != nil {
		t.Fatal(err)
	}
	if len(cNeighbors) != 1 || cNeighbors[0].SNR == nil || *cNeighbors[0].SNR != 5 {
		t.Fatalf("expected c's own receive SNR 5, got %+v", cNeighbors)
	}
}
