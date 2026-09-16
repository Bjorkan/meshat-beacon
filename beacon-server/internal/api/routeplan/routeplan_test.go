// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package routeplan

import (
	"testing"
	"time"

	db "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func testCfg() Config {
	return Config{
		UnmeasuredPenalty: 2.5,
		SNRGoodDB:         5.0,
		SNRBadDB:          -15.0,
		SNRMaxPenalty:     2.0,
		NeighborBonus:     0.4,
		SNRFreshness:      7 * 24 * time.Hour,
		MaxHops:           12,
		MaxAlternatives:   2,
		MaxDistanceKm:     150,
	}
}

func f32(v float32) *float32 { return &v }
func f64(v float64) *float64 { return &v }
func strp(s string) *string  { return &s }

func ts(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func TestLegCost_MeasuredBeatsUnmeasured(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	measured := Edge{SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now.Add(-time.Hour)}
	unmeasured := Edge{}
	mc, mu := cfg.LegCost(measured, now)
	uc, uu := cfg.LegCost(unmeasured, now)
	if mu || !uu {
		t.Errorf("measured unmeasured=%v, unmeasured unmeasured=%v", mu, uu)
	}
	if mc != 1.0 {
		t.Errorf("strong SNR should cost base 1.0, got %v", mc)
	}
	if uc != 1.0+cfg.UnmeasuredPenalty {
		t.Errorf("unmeasured should cost 1+penalty, got %v", uc)
	}
}

func TestLegCost_StaleCountsAsUnmeasured(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	stale := Edge{SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now.Add(-30 * 24 * time.Hour)}
	c, u := cfg.LegCost(stale, now)
	if !u {
		t.Error("stale SNR should count as unmeasured")
	}
	if c != 1.0+cfg.UnmeasuredPenalty {
		t.Errorf("stale should pay unmeasured penalty, got %v", c)
	}
}

func TestLegCost_Interpolation(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	mid := Edge{SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now}
	c, u := cfg.LegCost(mid, now)
	// (-5) is halfway between good=5 and bad=-15 -> 1 + 0.5*2 = 2.0
	if u || c != 2.0 {
		t.Errorf("mid SNR should cost 2.0 measured, got %v unmeasured=%v", c, u)
	}
	worst := Edge{SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now}
	wc, _ := cfg.LegCost(worst, now)
	if wc != 1.0+cfg.SNRMaxPenalty {
		t.Errorf("worst SNR should cap at 1+maxPenalty, got %v", wc)
	}
}

func TestLegCost_NeighborBonusBeatsOverheard(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	// Same strong reading: the explicitly marked neighbor leg must win...
	marked := Edge{Neighbor: true, SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	overheard := Edge{SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	mc, mu := cfg.LegCost(marked, now)
	oc, ou := cfg.LegCost(overheard, now)
	if mu || ou {
		t.Errorf("both measured: marked unmeasured=%v, overheard unmeasured=%v", mu, ou)
	}
	if mc != 1.0-cfg.NeighborBonus || oc != 1.0 {
		t.Errorf("marked should cost %v, overheard 1.0; got %v / %v", 1.0-cfg.NeighborBonus, mc, oc)
	}
	// ...but the bonus must never promote an unmeasured leg above a measured one.
	unmarkedWorst := Edge{SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now}
	markedUnmeasured := Edge{Neighbor: true}
	wc, _ := cfg.LegCost(unmarkedWorst, now)
	uc, uu := cfg.LegCost(markedUnmeasured, now)
	if !uu {
		t.Error("marked leg without readings must still count as unmeasured")
	}
	if uc <= wc {
		t.Errorf("marked unmeasured (%v) must stay costlier than worst measured (%v)", uc, wc)
	}
}

func TestShortestPaths_PrefersMarkedNeighbor(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	// Two equal-length (2-hop), equally-measured alternatives: via-b uses
	// explicitly marked neighbor legs, via-d merely overheard ones. The bonus
	// (0.4/leg) must break the tie toward the marked route.
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			a: {
				{From: a, To: b, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now, Neighbor: true},
				{From: a, To: d, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now},
			},
			b: {{From: b, To: c, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now, Neighbor: true}},
			d: {{From: d, To: c, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}},
		},
	}
	paths := ShortestPaths(g, cfg, a, c, 1, now)
	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d", len(paths))
	}
	if len(paths[0].Nodes) != 3 || paths[0].Nodes[1] != b {
		t.Errorf("best path should prefer marked neighbor legs, got %v", paths[0].Nodes)
	}
}

func TestShortestPaths_PrefersStrongSignal(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c)},
		Edges: map[uuid.UUID][]Edge{
			// direct leg exists but is unmeasured (cost 3.5)
			a: {{From: a, To: c}, {From: a, To: b, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}},
			// two measured legs (cost 1+1)
			b: {{From: b, To: c, SNR: f32(6), SNRSampleCount: 2, SNRLastSeen: now}},
		},
	}
	paths := ShortestPaths(g, cfg, a, c, 2, now)
	if len(paths) != 2 {
		t.Fatalf("expected 2 paths, got %d", len(paths))
	}
	if len(paths[0].Nodes) != 3 || paths[0].Nodes[1] != b {
		t.Errorf("best path should route via measured legs, got %v", paths[0].Nodes)
	}
	if paths[0].Cost != 2.0 {
		t.Errorf("best cost should be 2.0, got %v", paths[0].Cost)
	}
	if len(paths[0].Unmeasured) != 2 || paths[0].Unmeasured[0] || paths[0].Unmeasured[1] {
		t.Errorf("best path legs should be measured, got %v", paths[0].Unmeasured)
	}
	// alternative is the direct unmeasured leg
	if len(paths[1].Nodes) != 2 || !paths[1].Unmeasured[0] {
		t.Errorf("alternative should be the direct unmeasured leg, got %+v", paths[1])
	}
}

func TestShortestPaths_NoRoute(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	g := Graph{
		Nodes: map[uuid.UUID]Node{
			a: {ID: a, Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5},
			b: {ID: b, Type: NodeTypeRepeater, Lat: 59.7, Lng: 16.6},
		},
	}
	if paths := ShortestPaths(g, cfg, a, b, 3, now); len(paths) != 0 {
		t.Errorf("expected no paths, got %v", paths)
	}
}

func TestShortestPaths_MidNodeTypeGate(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	a, mid, c := uuid.New(), uuid.New(), uuid.New()
	mk := func(id uuid.UUID, typ int16) Node {
		return Node{ID: id, Type: typ, Lat: 59.6, Lng: 16.5}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: mk(a, NodeTypeRepeater), mid: mk(mid, 1 /* companion */), c: mk(c, NodeTypeRepeater)},
		Edges: map[uuid.UUID][]Edge{
			a:   {{From: a, To: mid}},
			mid: {{From: mid, To: c}},
		},
	}
	if paths := ShortestPaths(g, cfg, a, c, 2, now); len(paths) != 0 {
		t.Errorf("companion mid-node must not route, got %v", paths)
	}
}

func TestBuildGraph_DropsUnlocatedAndFarLegs(t *testing.T) {
	now := time.Now()
	a, b, far, c := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	row := func(from, to uuid.UUID, flat, flng, tlat, tlng *float64) db.GetRoutePlanGraphRow {
		return db.GetRoutePlanGraphRow{
			FromID: from, FromPubkey: from[:], FromType: 2, FromLat: flat, FromLng: flng,
			ToID: to, ToPubkey: to[:], ToType: 2, ToLat: tlat, ToLng: tlng,
			ObservationCount: 1, FirstSeen: ts(now), LastSeen: ts(now),
		}
	}
	rows := []db.GetRoutePlanGraphRow{
		row(a, b, f64(59.6), f64(16.5), f64(59.61), f64(16.52)),  // kept
		row(a, c, f64(59.6), f64(16.5), nil, nil),                // unlocated -> dropped
		row(a, far, f64(59.6), f64(16.5), f64(40.0), f64(-74.0)), // >150km -> dropped
	}
	g := BuildGraph(rows, 24*time.Hour, 150, now)
	if len(g.Edges[a]) != 1 || g.Edges[a][0].To != b {
		t.Errorf("expected only the near located leg, got %+v", g.Edges)
	}
	if _, ok := g.Nodes[c]; ok {
		t.Error("unlocated node must not enter the graph")
	}
}

func TestBuildGraph_MergesDirectedSNR(t *testing.T) {
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	// One pre-aggregated dump row per directed pair: SQL already summed the
	// pieces, so the row carries weightedSum = sum(snr*count) = 10*2 + 0*2.
	row := db.GetRoutePlanGraphRow{
		FromID: a, FromPubkey: a[:], FromName: strp("A"), FromType: 2,
		FromLat: f64(59.6), FromLng: f64(16.5),
		ToID: b, ToPubkey: b[:], ToName: strp("B"), ToType: 2,
		ToLat: f64(59.61), ToLng: f64(16.52),
		ObservationCount: 4, FirstSeen: ts(now), LastSeen: ts(now),
		SnrWeightedSum: 20, SnrSampleCount: 4, SnrLastSeen: ts(now),
		Direct: true,
	}
	g := BuildGraph([]db.GetRoutePlanGraphRow{row}, 24*time.Hour, 0, now)
	if len(g.Edges[a]) != 1 {
		t.Fatalf("expected one merged edge, got %+v", g.Edges)
	}
	e := g.Edges[a][0]
	if e.SNR == nil || *e.SNR != 5.0 {
		t.Errorf("expected merged SNR 5.0, got %v", e.SNR)
	}
	if e.SNRSampleCount != 4 || e.Observations != 4 {
		t.Errorf("expected 4 samples/obs, got %d/%d", e.SNRSampleCount, e.Observations)
	}
	if !e.Neighbor {
		t.Error("expected direct mark to survive aggregation")
	}
}

func TestBuildGraph_UnmeasuredWhenNoSamples(t *testing.T) {
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	row := db.GetRoutePlanGraphRow{
		FromID: a, FromPubkey: a[:], FromType: 2,
		FromLat: f64(59.6), FromLng: f64(16.5),
		ToID: b, ToPubkey: b[:], ToType: 2,
		ToLat: f64(59.61), ToLng: f64(16.52),
		ObservationCount: 2, FirstSeen: ts(now), LastSeen: ts(now),
		SnrWeightedSum: 0, SnrSampleCount: 0, SnrLastSeen: ts(now),
	}
	g := BuildGraph([]db.GetRoutePlanGraphRow{row}, 24*time.Hour, 0, now)
	e := g.Edges[a][0]
	if e.SNR != nil {
		t.Errorf("zero samples must stay nil SNR (never fabricated 0 dB), got %v", *e.SNR)
	}
}
