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
	// (a fresh direct confirmation is required for the bonus).
	marked := Edge{Neighbor: true, DirectLastSeen: now, SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
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
	markedUnmeasured := Edge{Neighbor: true, DirectLastSeen: now}
	wc, _ := cfg.LegCost(unmarkedWorst, now)
	uc, uu := cfg.LegCost(markedUnmeasured, now)
	if !uu {
		t.Error("marked leg without readings must still count as unmeasured")
	}
	if uc <= wc {
		t.Errorf("marked unmeasured (%v) must stay costlier than worst measured (%v)", uc, wc)
	}
}

func TestLegCost_StaleDirectLosesBonus(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	// One old direct observation plus fresh overheard traffic: the row stays
	// alive (last_seen fresh) but the direct confirmation is stale, so the
	// bonus must stop applying.
	staleDirect := Edge{
		Neighbor: true, DirectLastSeen: now.Add(-30 * 24 * time.Hour),
		SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now,
	}
	overheard := Edge{SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	sc, _ := cfg.LegCost(staleDirect, now)
	oc, _ := cfg.LegCost(overheard, now)
	if sc != oc {
		t.Errorf("stale direct (%v) must cost the same as overheard (%v)", sc, oc)
	}
	// A new direct confirmation restores the bonus.
	fresh := staleDirect
	fresh.DirectLastSeen = now
	fc, _ := cfg.LegCost(fresh, now)
	if fc != 1.0-cfg.NeighborBonus {
		t.Errorf("fresh direct should cost %v, got %v", 1.0-cfg.NeighborBonus, fc)
	}
}

func TestLegCost_AllBranchesPositive(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	cases := map[string]Edge{
		"strong":           {SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now},
		"strong+bonus":     {Neighbor: true, DirectLastSeen: now, SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now},
		"mid":              {SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now},
		"mid+bonus":        {Neighbor: true, DirectLastSeen: now, SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now},
		"bad":              {SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now},
		"bad+bonus":        {Neighbor: true, DirectLastSeen: now, SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now},
		"unmeasured":       {},
		"unmeasured+bonus": {Neighbor: true, DirectLastSeen: now},
		"stale":            {SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now.Add(-30 * 24 * time.Hour)},
	}
	for name, e := range cases {
		c, _ := cfg.LegCost(e, now)
		if c <= 0 {
			t.Errorf("%s: cost must be strictly positive for Dijkstra, got %v", name, c)
		}
	}
}

func TestShortestPaths_HopBoundKeepsLowHopArrival(t *testing.T) {
	// A cheaper arrival at X with no hop budget left must not dominate a
	// slightly more expensive arrival that can still reach the destination.
	// With MaxHops=2 the only valid route is A -> X -> D.
	cfg := testCfg()
	cfg.MaxHops = 2
	cfg.NeighborBonus = 0 // keep review's exact leg costs
	cfg.UnmeasuredPenalty = 1.5
	now := time.Now()
	a, b, x, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	strong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), x: loc(x), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			// A->B 1.0, B->X 1.0 (2 hops, budget exhausted at X),
			// A->X unmeasured 1+1.5=2.5, X->D 1.0: valid A->X->D costs 3.5.
			a: {strong(a, b), {From: a, To: x}},
			b: {strong(b, x)},
			x: {strong(x, d)},
		},
	}
	paths := ShortestPaths(g, cfg, a, d, 1, now)
	if len(paths) != 1 {
		t.Fatalf("expected 1 path A->X->D within 2 hops, got %d (%v)", len(paths), paths)
	}
	got := paths[0].Nodes
	if len(got) != 3 || got[0] != a || got[1] != x || got[2] != d {
		t.Errorf("expected A->X->D, got %v", got)
	}
	if len(paths[0].Nodes)-1 > cfg.MaxHops {
		t.Errorf("returned path exceeds MaxHops: %d > %d", len(paths[0].Nodes)-1, cfg.MaxHops)
	}
}

func TestShortestPaths_YenHonorsRemainingBudget(t *testing.T) {
	// MaxHops=2. Best path A->B->D (2 hops, cheap). For the alternative, Yen
	// splits at spur node B with root A->B (1 hop), leaving 1 hop. The
	// cheapest spur from B is B->C->D (2 hops, too long); a pricier direct
	// spur B->E->... no -- B->D is banned (used by the best path via this
	// root), so the valid spur is B->E->D? That is 2 hops too. Construct
	// instead: spur candidates from B are B->C->D (cheap, 2 hops) and B->D
	// via a DIFFERENT root split... Simplest faithful shape: increase the
	// budget split -- best A->B->D with MaxHops=3, spur at C with root
	// A->B->C (2 hops, remaining 1): cheapest C->X->D (2 hops) over limit,
	// pricier C->D (1 hop) fits. Yen must return A->B->C->D (3 hops), not
	// discard it because Dijkstra first found the cheaper over-limit spur.
	cfg := testCfg()
	cfg.MaxHops = 3
	cfg.NeighborBonus = 0
	now := time.Now()
	a, b, c, x, d := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	strong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), x: loc(x), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			a: {strong(a, b)},
			b: {strong(b, c), strong(b, d)},                                                           // direct B->D: alternative spur target
			c: {{From: c, To: x, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}, {From: c, To: d}}, // C->X cheap, C->D pricey unmeasured
			x: {strong(x, d)},
		},
	}
	// Sanity: best must be A->B->C->X->D? No -- that is 4 hops > 3. Best
	// within 3 hops: A->B->D (2 hops, cost 2.0). Alternatives: Yen splits
	// best at i=0 (root [A], spur A, remaining 3): bans A->B, spur A->...
	// nothing else from A -> no candidate. At i=1 (root [A,B], spur B,
	// remaining 2): bans B->D, spur B->C->? C->X->D is 3 hops > 2 (skip),
	// C->D pricey 1 hop fits -> candidate A->B->C->D (3 hops, cost
	// 1+1+3.5=5.5). With the OLD code (spur searched with full MaxHops=3),
	// Dijkstra from B would return B->C->X->D (3 hops, cost 3.0), combined
	// A->B->C->X->D (4 hops) discarded by the guard -> NO alternative.
	// With the fix, Dijkstra from B honors remaining=2 and returns B->C->D.
	paths := ShortestPaths(g, cfg, a, d, 2, now)
	if len(paths) != 2 {
		t.Fatalf("expected best + 1 bounded alternative, got %d: %v", len(paths), paths)
	}
	alt := paths[1].Nodes
	if len(alt) != 4 || alt[0] != a || alt[1] != b || alt[2] != c || alt[3] != d {
		t.Errorf("expected alternative A->B->C->D, got %v", alt)
	}
	if len(alt)-1 > cfg.MaxHops {
		t.Errorf("alternative exceeds MaxHops: %v", alt)
	}
}

func TestShortestPaths_YenRejectsOverBudgetCombined(t *testing.T) {
	// Best A->B->D (2 hops). A Yen spur B->C->D is individually within a
	// 2-hop budget from B, but combined A->B->C->D is 3 hops and must not be
	// returned when MaxHops=2.
	cfg := testCfg()
	cfg.MaxHops = 2
	cfg.NeighborBonus = 0
	now := time.Now()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	strong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			a: {strong(a, b)},
			b: {strong(b, d), strong(b, c)},
			c: {strong(c, d)},
		},
	}
	paths := ShortestPaths(g, cfg, a, d, 3, now)
	if len(paths) == 0 {
		t.Fatal("expected at least the best path")
	}
	for _, p := range paths {
		if len(p.Nodes)-1 > cfg.MaxHops {
			t.Errorf("path %v exceeds MaxHops=2", p.Nodes)
		}
	}
	// The only 2-hop route here is A->B->D; anything else would be 3 hops.
	if len(paths) != 1 {
		t.Errorf("expected only A->B->D within budget, got %d paths", len(paths))
	}
}

func TestShortestPaths_AllPathsRespectMaxHops(t *testing.T) {
	cfg := testCfg()
	cfg.MaxHops = 3
	now := time.Now()
	a, b, c, d, e := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	strong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), d: loc(d), e: loc(e)},
		Edges: map[uuid.UUID][]Edge{
			a: {strong(a, b), strong(a, c)},
			b: {strong(b, c), strong(b, d)},
			c: {strong(c, d), strong(c, e)},
			d: {strong(d, e)},
			e: {strong(e, d)},
		},
	}
	for _, p := range ShortestPaths(g, cfg, a, e, 5, now) {
		if len(p.Nodes)-1 > cfg.MaxHops {
			t.Errorf("path exceeds MaxHops: %d hops", len(p.Nodes)-1)
		}
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
				{From: a, To: b, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now, Neighbor: true, DirectLastSeen: now},
				{From: a, To: d, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now},
			},
			b: {{From: b, To: c, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now, Neighbor: true, DirectLastSeen: now}},
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
		Direct: true, DirectLastSeen: ts(now),
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

func TestBuildGraph_NodeStaleFromNodeLastSeen(t *testing.T) {
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	// A fresh located node pair connected by an unmeasured edge (no SNR at
	// all): staleness must come from node last_seen, so neither node is stale
	// merely because SNR is absent.
	fresh := db.GetRoutePlanGraphRow{
		FromID: a, FromPubkey: a[:], FromType: 2,
		FromLat: f64(59.6), FromLng: f64(16.5),
		ToID: b, ToPubkey: b[:], ToType: 2,
		ToLat: f64(59.61), ToLng: f64(16.52),
		ObservationCount: 2, FirstSeen: ts(now), LastSeen: ts(now),
		SnrWeightedSum: 0, SnrSampleCount: 0,
		FromLastSeen: ts(now), ToLastSeen: ts(now),
		EdgeLastSeen: ts(now),
	}
	g := BuildGraph([]db.GetRoutePlanGraphRow{fresh}, 24*time.Hour, 0, now)
	if g.Nodes[a].Stale || g.Nodes[b].Stale {
		t.Error("fresh nodes on an unmeasured edge must not be stale for lack of SNR")
	}
	// A genuinely stale node (last_seen past the threshold) is marked stale,
	// matching the normal node API semantics.
	old := now.Add(-72 * time.Hour)
	staleRow := fresh
	staleRow.FromLastSeen = ts(old)
	staleRow.ToLastSeen = ts(old)
	staleRow.EdgeLastSeen = ts(old)
	staleRow.SnrLastSeen = ts(old)
	g2 := BuildGraph([]db.GetRoutePlanGraphRow{staleRow}, 24*time.Hour, 0, now)
	if !g2.Nodes[a].Stale || !g2.Nodes[b].Stale {
		t.Error("nodes past the stale threshold must be marked stale")
	}
}

func TestBuildGraph_DirectionalDirect(t *testing.T) {
	// Direct evidence is directional: a reverse (B,A) mark must not set
	// Neighbor on the (A,B) edge.
	now := time.Now()
	a, b := uuid.New(), uuid.New()
	mkrow := func(from, to uuid.UUID, direct bool) db.GetRoutePlanGraphRow {
		var dls pgtype.Timestamptz
		if direct {
			dls = ts(now)
		}
		return db.GetRoutePlanGraphRow{
			FromID: from, FromPubkey: from[:], FromType: 2,
			FromLat: f64(59.6), FromLng: f64(16.5),
			ToID: to, ToPubkey: to[:], ToType: 2,
			ToLat: f64(59.61), ToLng: f64(16.52),
			ObservationCount: 2, FirstSeen: ts(now), LastSeen: ts(now),
			SnrWeightedSum: 16, SnrSampleCount: 2, SnrLastSeen: ts(now),
			FromLastSeen: ts(now), ToLastSeen: ts(now),
			EdgeLastSeen: ts(now),
			Direct:       direct, DirectLastSeen: dls,
		}
	}
	g := BuildGraph([]db.GetRoutePlanGraphRow{
		mkrow(a, b, false),
		mkrow(b, a, true),
	}, 24*time.Hour, 0, now)
	if len(g.Edges[a]) != 1 || len(g.Edges[b]) != 1 {
		t.Fatalf("expected one edge per direction, got %+v", g.Edges)
	}
	if g.Edges[a][0].Neighbor {
		t.Error("(A,B) must not gain Neighbor from reverse (B,A) evidence")
	}
	if !g.Edges[b][0].Neighbor {
		t.Error("(B,A) explicit mark must survive")
	}
}
