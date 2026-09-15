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

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/ingest"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Run against a disposable PostgreSQL with BEACON_TEST_DATABASE_URL set.
// Each test owns a unique schema; it never changes existing application tables.
func TestMeshCoreRegionIntegration(t *testing.T) {
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
	schema := "mcr_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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
	exec(`INSERT INTO iata_codes (iata) VALUES ('YVR'), ('YYJ')`)

	// ── Nodes: alpha (self-confirms "SE"), bravo (confirmed via neighbor by
	// alpha), charlie (stale confirmation), delta (timeout must not confirm) ──
	alpha, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{PublicKey: bytes.Repeat([]byte{0x01}, 32), NodeType: 1, Name: "alpha"}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	bravo, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{PublicKey: bytes.Repeat([]byte{0x02}, 32), NodeType: 1, Name: "bravo"}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	charlie, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{PublicKey: bytes.Repeat([]byte{0x03}, 32), NodeType: 1, Name: "charlie"}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	delta, _, err := store.UpsertNode(ctx, ingest.UpsertNodeParams{PublicKey: bytes.Repeat([]byte{0x04}, 32), NodeType: 1, Name: "delta"}, ingest.RadioSettings{})
	if err != nil {
		t.Fatal(err)
	}
	// observer rows exist for the observers that report /neighbors
	alphaObserver, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{0x01}, 32))
	if err != nil {
		t.Fatal(err)
	}
	charlieObserver, _, err := store.UpsertObserver(ctx, bytes.Repeat([]byte{0x03}, 32))
	if err != nil {
		t.Fatal(err)
	}

	// alpha's own self-report confirms "SE" (with a second token "no" mixed in
	// to prove comma-splitting and exact matching).
	if err := store.UpdateObserverRegionScope(ctx, alphaObserver, "SE,no"); err != nil {
		t.Fatal(err)
	}

	// alpha queried bravo's OTA scope successfully: "se" confirmed for bravo.
	if err := store.UpsertNodeNeighbor(ctx, alpha, bravo, "YVR", nil, strPtr("se")); err != nil {
		t.Fatal(err)
	}
	// A later timeout (NULL scope) must preserve bravo's value AND timestamp.
	if err := store.UpsertNodeNeighbor(ctx, alpha, bravo, "YVR", nil, nil); err != nil {
		t.Fatal(err)
	}

	// charlie was confirmed but that confirmation is now stale.
	if err := store.UpdateObserverRegionScope(ctx, charlieObserver, "SE"); err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE observers SET region_scope_last_seen = NOW() - INTERVAL '8 days' WHERE id = $1`, charlieObserver)

	// delta never had a successful OTA answer (no region_scope rows at all).

	// ── Filtering: only alpha and bravo match "se" ───────────────────────────
	page, err := store.ListNodes(ctx, api.NodeListParams{MeshCoreRegion: "se", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	ids := map[uuid.UUID]bool{}
	for _, n := range page.Items {
		ids[n.ID] = true
	}
	if !ids[alpha] {
		t.Error("expected alpha (observer self-confirmed) to match 'se'")
	}
	if !ids[bravo] {
		t.Error("expected bravo (fresh neighbor confirmation) to match 'se'")
	}
	if ids[charlie] {
		t.Error("expected charlie's stale confirmation not to match")
	}
	if ids[delta] {
		t.Error("expected delta (timeout only) not to match")
	}

	// Case-insensitivity: "SE" matches the same set.
	upper, err := store.ListNodes(ctx, api.NodeListParams{MeshCoreRegion: "SE", Limit: 50})
	if err != nil || len(upper.Items) != len(page.Items) {
		t.Fatalf("expected case-insensitive match, got %d vs %d items (err=%v)", len(upper.Items), len(page.Items), err)
	}

	// "no" matches alpha only (exact token from "SE,no"; "se" must not match it).
	noPage, err := store.ListNodes(ctx, api.NodeListParams{MeshCoreRegion: "no", Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(noPage.Items) != 1 || noPage.Items[0].ID != alpha {
		t.Fatalf("expected only alpha for token 'no', got %d items", len(noPage.Items))
	}

	// "*" is a literal token: nobody reports it, so nothing matches.
	wild, err := store.ListNodes(ctx, api.NodeListParams{MeshCoreRegion: "*", Limit: 50})
	if err != nil || len(wild.Items) != 0 {
		t.Fatalf("expected '*' to match nothing (literal token), got %d items (err=%v)", len(wild.Items), err)
	}

	// Composes with the geographic IATA filter (intersection): bravo is heard
	// on YVR; restricting to YYJ leaves only... alpha has no IATA memberships,
	// so the intersection is empty.
	exec(`INSERT INTO node_iatas (node_id, iata, first_heard, last_heard) VALUES ($1, 'YVR', NOW(), NOW())`, bravo)
	both, err := store.ListNodes(ctx, api.NodeListParams{MeshCoreRegion: "se", IATAs: []string{"YVR"}, Limit: 50})
	if err != nil {
		t.Fatal(err)
	}
	if len(both.Items) != 1 || both.Items[0].ID != bravo {
		t.Fatalf("expected the IATA x MeshCore intersection to leave only bravo, got %d items", len(both.Items))
	}

	// ── Discovery: se, no and their counts ──────────────────────────────────
	regions, err := store.ListMeshCoreRegions(ctx)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int64{}
	for _, r := range regions {
		counts[r.Token] = r.NodeCount
	}
	if counts["se"] != 2 {
		t.Errorf("expected 'se' confirmed by 2 nodes (alpha+bravo), got %d (%v)", counts["se"], regions)
	}
	if counts["no"] != 1 {
		t.Errorf("expected 'no' confirmed by 1 node (alpha), got %d", counts["no"])
	}
	if _, ok := counts["n"]; ok {
		t.Error("expected exact tokens only — 'n' must not appear from 'se,no'")
	}
}

func strPtr(s string) *string { return &s }
