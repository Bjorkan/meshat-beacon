// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package routeplan

import (
	"context"
	"fmt"
	"testing"
	"time"

	db "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type stubSnapshotSource struct {
	rows  []db.GetRoutePlanGraphRow
	err   error
	calls int
}

func (s *stubSnapshotSource) GetRoutePlanGraph(context.Context) ([]db.GetRoutePlanGraphRow, error) {
	s.calls++
	if s.err != nil {
		return nil, s.err
	}
	return s.rows, nil
}

func (s *stubSnapshotSource) GetNodesByIDs(context.Context, []uuid.UUID) ([]db.GetNodesByIDsRow, error) {
	return nil, nil
}

func planRow(from, to uuid.UUID, direct bool, directSeen pgtype.Timestamptz) db.GetRoutePlanGraphRow {
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.61, 16.52
	now := time.Now()
	return db.GetRoutePlanGraphRow{
		FromID: from, FromPubkey: from[:], FromType: 2, FromLat: &lat, FromLng: &lng,
		ToID: to, ToPubkey: to[:], ToType: 2, ToLat: &lat2, ToLng: &lng2,
		ObservationCount: 2, FirstSeen: ts(now), LastSeen: ts(now),
		SnrWeightedSum: 16, SnrSampleCount: 2, SnrLastSeen: ts(now),
		FromLastSeen: ts(now), ToLastSeen: ts(now), EdgeLastSeen: ts(now),
		Direct: direct, DirectLastSeen: directSeen,
	}
}

func TestSnapshot_BuildAndPlanInMemory(t *testing.T) {
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	rows := []db.GetRoutePlanGraphRow{planRow(a, b, true, ts(now))}
	src := &stubSnapshotSource{rows: rows}
	h, err := NewHolder(context.Background(), src, testCfg(), 24*time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	if src.calls != 1 {
		t.Fatalf("expected 1 graph query at build, got %d", src.calls)
	}
	snap := h.Current()
	if snap == nil || len(snap.Graph.Nodes) != 2 {
		t.Fatalf("expected 2-node snapshot, got %+v", snap)
	}
	// In-memory planning must not touch the database again.
	paths := ShortestPaths(snap.Graph, testCfg(), a, b, 1, now)
	if len(paths) != 1 {
		t.Fatalf("expected 1 path from snapshot, got %d", len(paths))
	}
	if src.calls != 1 {
		t.Errorf("planning must not re-query the graph, calls=%d", src.calls)
	}
}

func TestSnapshot_RefreshFailureKeepsPrevious(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	now := time.Now()
	src := &stubSnapshotSource{rows: []db.GetRoutePlanGraphRow{planRow(a, b, false, pgtype.Timestamptz{})}}
	h, err := NewHolder(context.Background(), src, testCfg(), 24*time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	first := h.Current()
	src.err = fmt.Errorf("db down")
	if err := h.Refresh(context.Background()); err == nil {
		t.Fatal("expected refresh error")
	}
	if h.Current() != first {
		t.Error("failed refresh must keep the previous snapshot in service")
	}
	if got := h.Stats(now); got.Failures != 1 || got.Builds != 1 {
		t.Errorf("expected 1 initial build + 1 failure, got %+v", got)
	}
	src.err = nil
	if err := h.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	if got := h.Stats(now); got.Builds != 2 {
		t.Errorf("expected successful refresh to swap, got %+v", got)
	}
}

func TestSnapshot_StatsCounts(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	src := &stubSnapshotSource{rows: []db.GetRoutePlanGraphRow{
		planRow(a, b, false, pgtype.Timestamptz{}),
		planRow(b, c, false, pgtype.Timestamptz{}),
	}}
	h, err := NewHolder(context.Background(), src, testCfg(), 24*time.Hour, 0)
	if err != nil {
		t.Fatal(err)
	}
	st := h.Stats(now)
	if st.Nodes != 3 || st.Edges != 2 || st.Rows != 2 {
		t.Errorf("unexpected snapshot stats: %+v", st)
	}
}
