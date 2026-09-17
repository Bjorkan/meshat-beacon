// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"bytes"
	"context"
	"encoding/hex"
	"testing"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	mockdb "github.com/MeshCore-Beacon/beacon-server/db/sqlc/mock"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/mock/gomock"
)

func TestRoutePathKey_MatchesPostgresDigest(t *testing.T) {
	// Golden vector: Postgres computes
	//   decode(md5(array_to_string(node_ids, ',')), 'hex')
	// over lowercase-hyphenated UUIDs. Migration 024 backfilled with that
	// expression; this pins the Go side to the identical bytes.
	a := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	b := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	got := hex.EncodeToString(routePathKey([]uuid.UUID{a, b}))
	want := "f097439148601d9f3291c474f82fa64c"
	if got != want {
		t.Errorf("routePathKey = %s, want %s", got, want)
	}
}

func TestUpsertKnownRoute_ComputesPathKey(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}

	a := uuid.MustParse("00000000-0000-0000-0000-000000000001")
	b := uuid.MustParse("00000000-0000-0000-0000-000000000002")
	wantKey, _ := hex.DecodeString("f097439148601d9f3291c474f82fa64c")

	mock.EXPECT().UpsertKnownRoute(gomock.Any(), gomock.Cond(func(p sqlc.UpsertKnownRouteParams) bool {
		return bytes.Equal(p.PathKey, wantKey)
	})).Return(nil)

	if err := store.UpsertKnownRoute(context.Background(), []uuid.UUID{a, b}, [][]byte{{0x37}, {0xd8}}, "PRG", 2); err != nil {
		t.Fatal(err)
	}
}

func TestDeleteOldRoutes_PassesCutoffs(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}

	retention := time.Date(2026, 7, 23, 0, 0, 0, 0, time.UTC)
	grace := time.Date(2026, 7, 30, 0, 0, 0, 0, time.UTC)

	mock.EXPECT().DeleteOldRoutes(gomock.Any(), gomock.Cond(func(p sqlc.DeleteOldRoutesParams) bool {
		return p.LastSeen.Time.Equal(retention) && p.ObservationCount == 3 && p.LastSeen_2.Time.Equal(grace)
	})).Return(nil)

	if err := store.DeleteOldRoutes(context.Background(), retention, 3, grace); err != nil {
		t.Fatal(err)
	}
}

func TestPlanBestRoute_IsolatedLocatedIsNoRoute(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}
	store.SetRoutePlanConfig(DefaultRoutePlanConfig())

	from, to := uuid.New(), uuid.New()
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.7, 16.6

	// Empty graph: neither endpoint participates in any neighbor row.
	mock.EXPECT().GetRoutePlanGraph(gomock.Any()).Return([]sqlc.GetRoutePlanGraphRow{}, nil)
	// Fallback metadata lookup: both known and located -> no-route, not 422.
	mock.EXPECT().GetNodesByIDs(gomock.Any(), gomock.Any()).Return([]sqlc.GetNodesByIDsRow{
		{ID: from, Latitude: &lat, Longitude: &lng},
		{ID: to, Latitude: &lat2, Longitude: &lng2},
	}, nil)

	res, err := store.PlanBestRoute(context.Background(), from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Paths) != 0 || res.Reason != "no-route" {
		t.Errorf("isolated located pair must be no-route, got %+v", res)
	}
}

func TestPlanBestRoute_UnlocatedEndpointIsMissingPosition(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}
	store.SetRoutePlanConfig(DefaultRoutePlanConfig())

	from, to := uuid.New(), uuid.New()
	lat, lng := 59.6, 16.5

	mock.EXPECT().GetRoutePlanGraph(gomock.Any()).Return([]sqlc.GetRoutePlanGraphRow{}, nil)
	// from located, to known but without coordinates -> missing position.
	mock.EXPECT().GetNodesByIDs(gomock.Any(), gomock.Any()).Return([]sqlc.GetNodesByIDsRow{
		{ID: from, Latitude: &lat, Longitude: &lng},
		{ID: to},
	}, nil)

	res, err := store.PlanBestRoute(context.Background(), from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if res.Reason != "endpoint-missing-position" {
		t.Errorf("unlocated endpoint must be endpoint-missing-position, got %+v", res)
	}
}

func TestPlanBestRoute_StaleDirectGrantsNoBonusOrBadge(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}
	store.SetRoutePlanConfig(DefaultRoutePlanConfig())

	from, to := uuid.New(), uuid.New()
	now := time.Now()
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.61, 16.52
	// Neighbor=true but DirectLastSeen 30d old (freshness window is 7d):
	// the shared IsFreshNeighbor definition must deny both bonus and badge.
	stale := now.Add(-30 * 24 * time.Hour)
	mock.EXPECT().GetRoutePlanGraph(gomock.Any()).Return([]sqlc.GetRoutePlanGraphRow{{
		FromID: from, FromPubkey: from[:], FromType: 2, FromLat: &lat, FromLng: &lng,
		ToID: to, ToPubkey: to[:], ToType: 2, ToLat: &lat2, ToLng: &lng2,
		ObservationCount: 5,
		FirstSeen:        pgtype.Timestamptz{Time: stale, Valid: true},
		LastSeen:         pgtype.Timestamptz{Time: now, Valid: true},
		EdgeLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
		FromLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
		ToLastSeen:       pgtype.Timestamptz{Time: now, Valid: true},
		SnrWeightedSum:   40, SnrSampleCount: 5,
		SnrLastSeen:    pgtype.Timestamptz{Time: now, Valid: true},
		Direct:         true,
		DirectLastSeen: pgtype.Timestamptz{Time: stale, Valid: true},
	}}, nil)

	res, err := store.PlanBestRoute(context.Background(), from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Paths) != 1 {
		t.Fatalf("expected 1 path, got %+v", res)
	}
	leg := res.Paths[0].Legs[0]
	if leg.Neighbor {
		t.Error("stale direct confirmation must not set leg.neighbor=true")
	}
	// Strong measured SNR (8dB mean) with no bonus costs exactly base 1.0.
	if res.Paths[0].TotalCost != 1.0 {
		t.Errorf("stale direct must grant no bonus (cost 1.0), got %v", res.Paths[0].TotalCost)
	}
}

func TestPlanBestRoute_ConnectedUnchanged(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}
	store.SetRoutePlanConfig(DefaultRoutePlanConfig())

	from, mid, to := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.61, 16.52
	lat3, lng3 := 59.62, 16.54
	row := func(f, tt uuid.UUID, flat, flng, tlat, tlng float64) sqlc.GetRoutePlanGraphRow {
		return sqlc.GetRoutePlanGraphRow{
			FromID: f, FromPubkey: f[:], FromType: 2, FromLat: &flat, FromLng: &flng,
			ToID: tt, ToPubkey: tt[:], ToType: 2, ToLat: &tlat, ToLng: &tlng,
			ObservationCount: 3,
			FirstSeen:        pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
			LastSeen:         pgtype.Timestamptz{Time: now, Valid: true},
			EdgeLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
			FromLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
			ToLastSeen:       pgtype.Timestamptz{Time: now, Valid: true},
			SnrWeightedSum:   24, SnrSampleCount: 3,
			SnrLastSeen: pgtype.Timestamptz{Time: now, Valid: true},
		}
	}
	mock.EXPECT().GetRoutePlanGraph(gomock.Any()).Return([]sqlc.GetRoutePlanGraphRow{
		row(from, mid, lat, lng, lat2, lng2),
		row(mid, to, lat2, lng2, lat3, lng3),
	}, nil)
	// Both endpoints are in the graph: no metadata fallback lookup.
	res, err := store.PlanBestRoute(context.Background(), from, to, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Paths) != 1 || res.Reason != "" {
		t.Errorf("connected pair must return one path with no reason, got %+v", res)
	}
	if len(res.Paths[0].Nodes) != 3 {
		t.Errorf("expected 3-node path, got %+v", res.Paths[0])
	}
}

func TestPlanBestRoute_SnapshotServesWithoutPerRequestAggregate(t *testing.T) {
	ctrl := gomock.NewController(t)
	defer ctrl.Finish()
	mock := mockdb.NewMockQuerier(ctrl)
	store := &Store{q: mock}
	store.SetRoutePlanConfig(DefaultRoutePlanConfig())

	from, mid, to := uuid.New(), uuid.New(), uuid.New()
	now := time.Now()
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.61, 16.52
	lat3, lng3 := 59.62, 16.54
	row := func(f, tt uuid.UUID, flat, flng, tlat, tlng float64) sqlc.GetRoutePlanGraphRow {
		return sqlc.GetRoutePlanGraphRow{
			FromID: f, FromPubkey: f[:], FromType: 2, FromLat: &flat, FromLng: &flng,
			ToID: tt, ToPubkey: tt[:], ToType: 2, ToLat: &tlat, ToLng: &tlng,
			ObservationCount: 3,
			FirstSeen:        pgtype.Timestamptz{Time: now.Add(-time.Hour), Valid: true},
			LastSeen:         pgtype.Timestamptz{Time: now, Valid: true},
			EdgeLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
			FromLastSeen:     pgtype.Timestamptz{Time: now, Valid: true},
			ToLastSeen:       pgtype.Timestamptz{Time: now, Valid: true},
			SnrWeightedSum:   24, SnrSampleCount: 3,
			SnrLastSeen: pgtype.Timestamptz{Time: now, Valid: true},
		}
	}
	// Exactly ONE aggregate: the production refresh. The two PlanBestRoute
	// calls below must not trigger another.
	mock.EXPECT().GetRoutePlanGraph(gomock.Any()).Times(1).Return([]sqlc.GetRoutePlanGraphRow{
		row(from, mid, lat, lng, lat2, lng2),
		row(mid, to, lat2, lng2, lat3, lng3),
	}, nil)

	if err := store.RefreshRouteSnapshot(context.Background()); err != nil {
		t.Fatal(err)
	}
	st, ok := store.RouteSnapshotStats(time.Now())
	if !ok || st.Nodes != 3 || st.Edges != 2 || st.Builds != 1 {
		t.Fatalf("expected healthy snapshot stats, got %+v ok=%v", st, ok)
	}
	for i := 0; i < 2; i++ {
		res, err := store.PlanBestRoute(context.Background(), from, to, 0)
		if err != nil {
			t.Fatal(err)
		}
		if len(res.Paths) != 1 {
			t.Fatalf("request %d: expected 1 path, got %+v", i, res)
		}
	}
}

func TestExtractFromNode_Found(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	hops := []api.RouteHop{
		{NodeID: a},
		{NodeID: b},
		{NodeID: c},
	}
	result := extractFromNode(hops, b)
	if len(result) != 2 {
		t.Fatalf("expected 2 hops, got %d", len(result))
	}
	if result[0].NodeID != b {
		t.Errorf("expected first hop to be b, got %s", result[0].NodeID)
	}
	if result[1].NodeID != c {
		t.Errorf("expected second hop to be c, got %s", result[1].NodeID)
	}
}

func TestExtractFromNode_FirstNode(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	hops := []api.RouteHop{{NodeID: a}, {NodeID: b}}
	result := extractFromNode(hops, a)
	if len(result) != 2 {
		t.Fatalf("expected 2 hops, got %d", len(result))
	}
}

func TestExtractFromNode_NotFound(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	hops := []api.RouteHop{{NodeID: a}}
	result := extractFromNode(hops, b)
	// not found returns full slice
	if len(result) != 1 {
		t.Fatalf("expected full slice returned, got %d hops", len(result))
	}
}

func TestExtractFromNode_Empty(t *testing.T) {
	result := extractFromNode(nil, uuid.New())
	if len(result) != 0 {
		t.Errorf("expected empty result for nil hops")
	}
}

func TestListKnownRoutes_UsesKeysetSortAndIATAFilter(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)
	first := time.Date(2026, 8, 1, 10, 0, 0, 0, time.UTC)
	last := first.Add(time.Hour)

	mock.EXPECT().ListKnownRoutes(gomock.Any(), gomock.Any()).DoAndReturn(
		func(_ context.Context, params sqlc.ListKnownRoutesParams) ([]sqlc.ListKnownRoutesRow, error) {
			if len(params.Column1) != 2 || params.Column1[0] != "YVR" || params.Column1[1] != "YYJ" {
				t.Fatalf("unexpected IATA filter: %v", params.Column1)
			}
			if params.Column4 != api.RouteSortHops || params.Column5 != string(api.SortAsc) || params.Limit != 2 {
				t.Fatalf("unexpected sort/page params: %#v", params)
			}
			return []sqlc.ListKnownRoutesRow{
				{ID: 11, Iata: "YVR", HopCount: 1, FirstSeen: pgtype.Timestamptz{Time: first, Valid: true}, LastSeen: pgtype.Timestamptz{Time: last, Valid: true}, PageSortKey: "00000000000000000001"},
				{ID: 12, Iata: "YYJ", HopCount: 2, FirstSeen: pgtype.Timestamptz{Time: first, Valid: true}, LastSeen: pgtype.Timestamptz{Time: last, Valid: true}, PageSortKey: "00000000000000000002"},
			}, nil
		},
	)
	mock.EXPECT().GetNodesByIDs(gomock.Any(), gomock.Cond(func(ids []uuid.UUID) bool { return len(ids) == 0 })).Return([]sqlc.GetNodesByIDsRow{}, nil)

	store := &Store{q: mock}
	page, err := store.ListKnownRoutes(context.Background(), api.RouteListParams{
		IATAs: []string{"YVR", "YYJ"}, Sort: api.RouteSortHops, Direction: api.SortAsc, Limit: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || !page.HasMore || page.NextPageToken == nil {
		t.Fatalf("unexpected page: %#v", page)
	}
	token, err := api.DecodePageToken(*page.NextPageToken)
	if err != nil {
		t.Fatal(err)
	}
	if token.Collection != api.PageCollectionRoutes || token.Sort != api.RouteSortHops || token.Direction != api.SortAsc || token.Key != "00000000000000000001" || token.NumericID != 11 {
		t.Fatalf("unexpected token: %#v", token)
	}
}
