// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package routeplan

import (
	"math"
	"testing"
	"time"

	db "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func testCfg() Config {
	return Config{
		UnmeasuredPenalty: 2.5,
		SNRGoodDB:         5.0,
		SNRBadDB:          -15.0,
		SNRMaxPenalty:     2.0,
		SNRStrongCap:      0.25,
		// Traffic evidence (HuskvarnaS -> Gisebo style): hundreds of passed
		// packets discount far more than a handful; measured legs earn 1/8.
		TrafficMaxDiscount:   4.0,
		TrafficFullCount:     1000.0,
		TrafficMeasuredShare: 0.125,
		UnmeasuredFloor:      0.4,
		NeighborBonus:        0.4,
		SNRFreshness:         7 * 24 * time.Hour,
		DirectFreshness:      7 * 24 * time.Hour,
		MaxHops:              12,
		MaxAlternatives:      2,
		MaxDistanceKm:        150,
	}
}

// testCfgNoTraffic is the pure-SNR model (traffic evidence disabled): every
// expected value in the legacy tests below is computed against it, so the
// traffic tests pin the new behavior separately without churning the old.
func testCfgNoTraffic() Config {
	cfg := testCfg()
	cfg.TrafficMaxDiscount = 0
	return cfg
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
	if mc != cfg.SNRStrongCap {
		t.Errorf("strong SNR should cost the strong cap %v, got %v", cfg.SNRStrongCap, mc)
	}
	if uc != cfg.UnmeasuredPenalty {
		t.Errorf("speculative unmeasured (no traffic) should cost the penalty %v, got %v", cfg.UnmeasuredPenalty, uc)
	}
	if uc <= cfg.SNRMaxPenalty {
		t.Errorf("speculative unmeasured (%v) must stay costlier than any measured leg (max %v)", uc, cfg.SNRMaxPenalty)
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
	if c != cfg.UnmeasuredPenalty {
		t.Errorf("stale should pay unmeasured penalty, got %v", c)
	}
}

func TestLegCost_Interpolation(t *testing.T) {
	cfg := testCfgNoTraffic()
	now := time.Now()
	// Kink at 0 dB: positive readings degrade gently (cap 0.25 -> 0.6875
	// at zero), negative readings degrade faster (0.6875 -> max 2.0).
	// zeroPenalty = 0.25 + 1.75 * (5/20) = 0.6875.
	mid := Edge{SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now}
	c, u := cfg.LegCost(mid, now)
	// frac = 5/15 below zero: 0.6875 + (5/15)*(2.0-0.6875) = 1.125
	if u || c != 1.125 {
		t.Errorf("mid SNR should cost 1.125 measured, got %v unmeasured=%v", c, u)
	}
	pos := Edge{SNR: f32(3), SNRSampleCount: 2, SNRLastSeen: now}
	pc, _ := cfg.LegCost(pos, now)
	// frac = (5-3)/5 above zero: 0.25 + 0.4*(0.6875-0.25) = 0.425
	// (float64 arithmetic: compare with tolerance, not ==).
	if math.Abs(pc-0.425) > 1e-9 {
		t.Errorf("+3 dB should cost 0.425, got %v", pc)
	}
	worst := Edge{SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now}
	wc, _ := cfg.LegCost(worst, now)
	if wc != cfg.SNRMaxPenalty {
		t.Errorf("worst SNR should cap at maxPenalty %v, got %v", cfg.SNRMaxPenalty, wc)
	}
}

func TestLegCost_SubZeroCostsMorePerDB(t *testing.T) {
	// The user's rule: every step down into the negative costs more than a
	// step down while still positive. +1 -> 0 must be cheaper than 0 -> -1.
	cfg := testCfgNoTraffic()
	now := time.Now()
	mk := func(snr float32) Edge { return Edge{SNR: f32(snr), SNRSampleCount: 2, SNRLastSeen: now} }
	cPos1, _ := cfg.LegCost(mk(1), now)
	cZero, _ := cfg.LegCost(mk(0), now)
	cNeg1, _ := cfg.LegCost(mk(-1), now)
	if !(cZero-cPos1 < cNeg1-cZero) {
		t.Errorf("sub-zero step must cost more: +1->0 = %v, 0->-1 = %v", cZero-cPos1, cNeg1-cZero)
	}
}

func TestLegCost_NeighborBonusBeatsOverheard(t *testing.T) {
	cfg := testCfgNoTraffic()
	now := time.Now()
	// Same WEAK reading (so the strong cap does not swallow the bonus):
	// the explicitly marked neighbor leg must win. (A fresh direct
	// confirmation is required for the bonus.)
	marked := Edge{Neighbor: true, DirectLastSeen: now, SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	overheard := Edge{SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	mc, mu := cfg.LegCost(marked, now)
	oc, ou := cfg.LegCost(overheard, now)
	if mu || ou {
		t.Errorf("both measured: marked unmeasured=%v, overheard unmeasured=%v", mu, ou)
	}
	if mc != oc-cfg.NeighborBonus {
		t.Errorf("marked should discount overheard %v by %v; got %v / %v", oc, cfg.NeighborBonus, mc, oc)
	}
	// ...but the bonus must never promote a SPECULATIVE unmeasured leg
	// above a measured one (proven unmeasured legs may win: that is the
	// traffic-evidence feature, covered separately).
	unmarkedWorst := Edge{SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now}
	markedUnmeasured := Edge{Neighbor: true, DirectLastSeen: now}
	wc, _ := cfg.LegCost(unmarkedWorst, now)
	uc, uu := cfg.LegCost(markedUnmeasured, now)
	if !uu {
		t.Error("marked leg without readings must still count as unmeasured")
	}
	if uc <= wc {
		t.Errorf("marked speculative unmeasured (%v) must stay costlier than worst measured (%v)", uc, wc)
	}
}

func TestLegCost_StaleDirectLosesBonus(t *testing.T) {
	cfg := testCfgNoTraffic()
	now := time.Now()
	// One old direct observation plus fresh overheard traffic: the row stays
	// alive (last_seen fresh) but the direct confirmation is stale, so the
	// bonus must stop applying -- and the shared helper agrees. Weak SNR
	// (-5 dB) so the strong cap does not swallow the bonus.
	staleDirect := Edge{
		Neighbor: true, DirectLastSeen: now.Add(-30 * 24 * time.Hour),
		SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now,
	}
	overheard := Edge{SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	sc, _ := cfg.LegCost(staleDirect, now)
	oc, _ := cfg.LegCost(overheard, now)
	if sc != oc {
		t.Errorf("stale direct (%v) must cost the same as overheard (%v)", sc, oc)
	}
	if cfg.IsFreshNeighbor(staleDirect, now) {
		t.Error("stale confirmation must not count as a fresh neighbor")
	}
	// A new direct confirmation restores the bonus.
	fresh := staleDirect
	fresh.DirectLastSeen = now
	fc, _ := cfg.LegCost(fresh, now)
	if fc != oc-cfg.NeighborBonus {
		t.Errorf("fresh direct should discount overheard %v by %v, got %v", oc, cfg.NeighborBonus, fc)
	}
	if !cfg.IsFreshNeighbor(fresh, now) {
		t.Error("fresh confirmation must count as a fresh neighbor")
	}
}

func TestIsFreshNeighbor_ZeroBonusKeepsIdentity(t *testing.T) {
	// NeighborBonus == 0 disables only the routing discount, never the
	// topology fact: a freshly confirmed direct edge is still a neighbor
	// (badge true) but earns no cost discount. Weak SNR so the strong cap
	// does not hide the (absent) discount.
	cfg := testCfgNoTraffic()
	cfg.NeighborBonus = 0
	now := time.Now()
	e := Edge{Neighbor: true, DirectLastSeen: now, SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	if !cfg.IsFreshNeighbor(e, now) {
		t.Error("fresh direct must stay a neighbor even with NeighborBonus=0")
	}
	plain := Edge{SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	c, _ := cfg.LegCost(e, now)
	pc, _ := cfg.LegCost(plain, now)
	if c != pc {
		t.Errorf("zero bonus must grant no discount (cost %v), got %v", pc, c)
	}
}

func TestIsFreshNeighbor_FutureConfirmationRejected(t *testing.T) {
	// A DirectLastSeen in the future (clock skew) must not count as fresh:
	// negative age is rejected rather than treated as "within window".
	cfg := testCfg()
	now := time.Now()
	e := Edge{Neighbor: true, DirectLastSeen: now.Add(time.Hour), SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	if cfg.IsFreshNeighbor(e, now) {
		t.Error("future DirectLastSeen must not count as a fresh neighbor")
	}
}

func TestIsFreshNeighbor_DisabledFreshness(t *testing.T) {
	// DirectFreshness <= 0 disables the bonus/badge entirely, even with a
	// brand-new confirmation -- this is what explicit direct_freshness: 0
	// resolves to end-to-end. Weak SNR so the strong cap does not hide
	// the (absent) discount.
	cfg := testCfgNoTraffic()
	cfg.DirectFreshness = 0
	now := time.Now()
	e := Edge{Neighbor: true, DirectLastSeen: now, SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	if cfg.IsFreshNeighbor(e, now) {
		t.Error("zero DirectFreshness must never report a fresh neighbor")
	}
	plain := Edge{SNR: f32(-5), SNRSampleCount: 5, SNRLastSeen: now}
	c, _ := cfg.LegCost(e, now)
	pc, _ := cfg.LegCost(plain, now)
	if c != pc {
		t.Errorf("zero DirectFreshness must grant no bonus, got cost %v vs %v", c, pc)
	}
}

func TestFromResolved_NoDirectFreshnessFallback(t *testing.T) {
	// routeplan.FromResolved must copy verbatim: an explicit 0 (disabled)
	// reaches the planner as 0. config.Resolve already maps unset -> SNR
	// freshness upstream (covered in the config package); here we pin the
	// planner side with a plain ResolvedConfig literal.
	r := config.ResolvedConfig{
		RoutePlanUnmeasuredPenalty: 2.5,
		RoutePlanSNRGoodDB:         5.0,
		RoutePlanSNRBadDB:          -15.0,
		RoutePlanSNRMaxPenalty:     2.0,
		RoutePlanNeighborBonus:     0.4,
		RoutePlanSNRFreshness:      7 * 24 * time.Hour,
		RoutePlanDirectFreshness:   0, // explicit disable
		RoutePlanMaxHops:           12,
		RoutePlanMaxAlternatives:   2,
	}
	pc := FromResolved(r)
	if pc.DirectFreshness != 0 {
		t.Errorf("explicit 0 must reach routeplan.Config as 0, got %v", pc.DirectFreshness)
	}
	now := time.Now()
	e := Edge{Neighbor: true, DirectLastSeen: now, SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	if pc.IsFreshNeighbor(e, now) {
		t.Error("explicit 0 must never grant the neighbor bonus/badge")
	}
}

func TestLegCost_AllBranchesPositive(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	// Traffic-heavy variants: even maximally discounted legs must stay
	// positive (measured floor at the strong cap, unmeasured at the floor).
	cases := map[string]Edge{
		"strong":            {SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now},
		"strong+bonus":      {Neighbor: true, DirectLastSeen: now, SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now},
		"mid":               {SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now},
		"mid+bonus":         {Neighbor: true, DirectLastSeen: now, SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now},
		"bad":               {SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now},
		"bad+bonus":         {Neighbor: true, DirectLastSeen: now, SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now},
		"unmeasured":        {},
		"unmeasured+bonus":  {Neighbor: true, DirectLastSeen: now},
		"stale":             {SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now.Add(-30 * 24 * time.Hour)},
		"proven-unmeasured": {Observations: 100000},
		"proven-mid":        {SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now, Observations: 100000},
		"proven-bad+bonus":  {Neighbor: true, DirectLastSeen: now, SNR: f32(-20), SNRSampleCount: 1, SNRLastSeen: now, Observations: 100000},
	}
	for name, e := range cases {
		c, _ := cfg.LegCost(e, now)
		if c <= 0 {
			t.Errorf("%s: cost must be strictly positive for Dijkstra, got %v", name, c)
		}
	}
}

func TestLegCost_TrafficEvidence(t *testing.T) {
	cfg := testCfg()
	now := time.Now()
	// The user's core rule: more passed packets = heavier weight. A
	// proven-but-SNR-less hop (HuskvarnaS -> Gisebo ~1000 obs) must beat a
	// 3-packet hop, and ~400 obs must beat ~3 obs.
	proven := Edge{Observations: 1000}
	thin := Edge{Observations: 3}
	pc, pu := cfg.LegCost(proven, now)
	tc, tu := cfg.LegCost(thin, now)
	if !pu || !tu {
		t.Errorf("both must count as unmeasured, proven=%v thin=%v", pu, tu)
	}
	if pc >= tc {
		t.Errorf("proven traffic (1000 obs: %v) must beat thin traffic (3 obs: %v)", pc, tc)
	}
	// The log scale separates thin from moderate traffic; heavily proven
	// legs both bottom out at the floor (that IS the point: proven is
	// proven). Use counts on the slope for the ordering check.
	light := Edge{Observations: 3}
	moderate := Edge{Observations: 30}
	lc, _ := cfg.LegCost(light, now)
	mc, _ := cfg.LegCost(moderate, now)
	if mc >= lc {
		t.Errorf("30 obs (%v) must beat 3 obs (%v)", mc, lc)
	}
	if mc <= pc {
		t.Errorf("30 obs (%v) must stay costlier than 1000 obs (%v)", mc, pc)
	}
	// Proven traffic bottoms out at the floor, never below: it must not
	// beat a fresh strong reading per-leg.
	huge := Edge{Observations: 1000000}
	hc, _ := cfg.LegCost(huge, now)
	if hc != cfg.UnmeasuredFloor {
		t.Errorf("maximally proven unmeasured must cost the floor %v, got %v", cfg.UnmeasuredFloor, hc)
	}
	strong := Edge{SNR: f32(10), SNRSampleCount: 5, SNRLastSeen: now}
	sc, _ := cfg.LegCost(strong, now)
	if hc <= sc {
		t.Errorf("proven unmeasured (%v) must stay costlier than strong measured (%v)", hc, sc)
	}
	// Zero traffic earns zero discount: the bare penalty.
	bare := Edge{}
	bc, _ := cfg.LegCost(bare, now)
	if bc != cfg.UnmeasuredPenalty {
		t.Errorf("zero observations must pay the bare penalty %v, got %v", cfg.UnmeasuredPenalty, bc)
	}
}

func TestLegCost_TrafficStaysSecondaryToSNR(t *testing.T) {
	// Measured legs earn only TrafficMeasuredShare of the discount: two
	// equally-measured legs split on traffic, but traffic alone cannot
	// turn a weak measured leg strong.
	cfg := testCfg()
	now := time.Now()
	mk := func(obs int64) Edge {
		return Edge{SNR: f32(-5), SNRSampleCount: 2, SNRLastSeen: now, Observations: obs}
	}
	rich, _ := cfg.LegCost(mk(100000), now)
	poor, _ := cfg.LegCost(mk(1), now)
	if rich >= poor {
		t.Errorf("traffic must break ties between equally-measured legs: rich=%v poor=%v", rich, poor)
	}
	if rich < cfg.SNRStrongCap {
		t.Errorf("measured traffic discount must floor at the strong cap %v, got %v", cfg.SNRStrongCap, rich)
	}
	// ...and disabling traffic removes the split entirely.
	off := testCfgNoTraffic()
	oc1, _ := off.LegCost(mk(100000), now)
	oc2, _ := off.LegCost(mk(1), now)
	if oc1 != oc2 {
		t.Errorf("traffic_max_discount=0 must disable evidence: %v vs %v", oc1, oc2)
	}
}

func TestShortestPaths_PrefersProvenTraffic(t *testing.T) {
	// Live shape (Fagerslätt -> Hovslätt): the direct 2-hop route rides a
	// weak thin leg plus a speculative leg, while the 3-hop alternative
	// routes around via proven traffic. Proven must win despite more hops.
	// weak thin leg plus a speculative leg, while the 3-hop alternative
	// routes around via proven traffic. Proven must win despite more hops.
	cfg := testCfg()
	now := time.Now()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			// Direct: weak thin measured leg + speculative leg.
			a: {
				{From: a, To: d, SNR: f32(-13.5), SNRSampleCount: 1, SNRLastSeen: now, Observations: 1},
				{From: a, To: b, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now, Observations: 3000},
			},
			// Detour: strong proven leg + proven unmeasured leg.
			b: {{From: b, To: c, Observations: 1000}},
			c: {{From: c, To: d, SNR: f32(3), SNRSampleCount: 5, SNRLastSeen: now, Observations: 500}},
		},
	}
	paths := ShortestPaths(g, cfg, a, d, 1, now)
	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d", len(paths))
	}
	got := paths[0].Nodes
	if len(got) != 4 || got[1] != b || got[2] != c {
		t.Errorf("best path should route via proven traffic A->B->C->D, got %v", got)
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
			// A->B cap 0.25, B->X cap 0.25 (2 hops, budget exhausted at X),
			// A->X speculative unmeasured 1.5, X->D cap 0.25:
			// valid A->X->D costs 1.75.
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
	// within 3 hops: A->B->D (2 hops, cost 0.5). Alternatives: Yen splits
	// best at i=0 (root [A], spur A, remaining 3): bans A->B, spur A->...
	// nothing else from A -> no candidate. At i=1 (root [A,B], spur B,
	// remaining 2): bans B->D, spur B->C->? C->X->D is 3 hops > 2 (skip),
	// C->D pricey 1 hop fits -> candidate A->B->C->D (3 hops, cost
	// 0.25+0.25+2.5=3.0). With the OLD code (spur searched with full MaxHops=3),
	// Dijkstra from B would return B->C->X->D (3 hops, cost 0.75), combined
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

func TestShortestPaths_ZeroMaxHopsUsesDefaultEverywhere(t *testing.T) {
	// A programmatic zero Config must behave as the default bound (12) in
	// ALL three places: first search, spur remaining budget, combined guard.
	// Previously the first search used 12 while the guard compared against
	// raw 0, rejecting every non-zero-hop Yen alternative.
	cfg := testCfg()
	cfg.MaxHops = 0
	now := time.Now()
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	strong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c)},
		Edges: map[uuid.UUID][]Edge{
			a: {strong(a, b), strong(a, c)},
			b: {strong(b, c)},
		},
	}
	paths := ShortestPaths(g, cfg, a, c, 2, now)
	if len(paths) != 2 {
		t.Fatalf("zero MaxHops must act as default bound with k=2, got %d paths", len(paths))
	}
	for _, p := range paths {
		if len(p.Nodes)-1 > DefaultMaxHopsFallback {
			t.Errorf("path exceeds default bound: %v", p.Nodes)
		}
	}
}

func TestShortestPaths_PrefersMarkedNeighbor(t *testing.T) {
	cfg := testCfgNoTraffic()
	now := time.Now()
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	loc := func(id uuid.UUID) Node {
		return Node{ID: id, Pubkey: id.String(), Type: NodeTypeRepeater, Lat: 59.6, Lng: 16.5}
	}
	// Two equal-length (2-hop), equally-measured WEAK alternatives (the
	// strong cap takes no bonus, so weak legs pin the bonus semantics):
	// via-b uses explicitly marked neighbor legs, via-d merely overheard
	// ones. The bonus (0.4/leg) must break the tie toward the marked route.
	weak := func(from, to uuid.UUID, marked bool) Edge {
		return Edge{From: from, To: to, SNR: f32(-5), SNRSampleCount: 3, SNRLastSeen: now, Neighbor: marked, DirectLastSeen: now}
	}
	plain := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(-5), SNRSampleCount: 3, SNRLastSeen: now}
	}
	g := Graph{
		Nodes: map[uuid.UUID]Node{a: loc(a), b: loc(b), c: loc(c), d: loc(d)},
		Edges: map[uuid.UUID][]Edge{
			a: {weak(a, b, true), plain(a, d)},
			b: {weak(b, c, true)},
			d: {plain(d, c)},
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
			// direct leg exists but is speculative unmeasured (cost 2.5)
			a: {{From: a, To: c}, {From: a, To: b, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}},
			// two strong measured legs (cap 0.25 + 0.25)
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
	if paths[0].Cost != 2*cfg.SNRStrongCap {
		t.Errorf("best cost should be 2x cap = %v, got %v", 2*cfg.SNRStrongCap, paths[0].Cost)
	}
	if len(paths[0].Unmeasured) != 2 || paths[0].Unmeasured[0] || paths[0].Unmeasured[1] {
		t.Errorf("best path legs should be measured, got %v", paths[0].Unmeasured)
	}
	// alternative is the direct unmeasured leg
	if len(paths[1].Nodes) != 2 || !paths[1].Unmeasured[0] {
		t.Errorf("alternative should be the direct unmeasured leg, got %+v", paths[1])
	}
}

func TestShortestPaths_PrefersMoreStrongHopsOverOneWeakHop(t *testing.T) {
	// The strong-cap feature: four strong hops (4x0.25 = 1.0) must beat one
	// weak measured hop (~1.87 at -13.5 dB). The planner prefers more hops
	// when every hop has a strong signal.
	cfg := testCfgNoTraffic()
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
			a: {
				{From: a, To: e, SNR: f32(-13.5), SNRSampleCount: 1, SNRLastSeen: now},
				strong(a, b),
			},
			b: {strong(b, c)},
			c: {strong(c, d)},
			d: {strong(d, e)},
		},
	}
	paths := ShortestPaths(g, cfg, a, e, 1, now)
	if len(paths) != 1 {
		t.Fatalf("expected 1 path, got %d", len(paths))
	}
	if len(paths[0].Nodes) != 5 {
		t.Errorf("best path should take 4 strong hops, got %v", paths[0].Nodes)
	}
	if paths[0].Cost != 4*cfg.SNRStrongCap {
		t.Errorf("best cost should be 4x cap = %v, got %v", 4*cfg.SNRStrongCap, paths[0].Cost)
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
	a, mid, room, c := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	mk := func(id uuid.UUID, typ int16) Node {
		return Node{ID: id, Type: typ, Lat: 59.6, Lng: 16.5}
	}
	newStrong := func(from, to uuid.UUID) Edge {
		return Edge{From: from, To: to, SNR: f32(8), SNRSampleCount: 3, SNRLastSeen: now}
	}
	// Companion/sensor AND room_server mid-nodes must not transit: only
	// repeaters forward a planned MeshCore repeater route.
	g := Graph{
		Nodes: map[uuid.UUID]Node{
			a:    mk(a, NodeTypeRepeater),
			mid:  mk(mid, 1 /* companion */),
			room: mk(room, NodeTypeRoomServer),
			c:    mk(c, NodeTypeRepeater),
		},
		Edges: map[uuid.UUID][]Edge{
			a:    {newStrong(a, mid), newStrong(a, room)},
			mid:  {newStrong(mid, c)},
			room: {newStrong(room, c)},
		},
	}
	if paths := ShortestPaths(g, cfg, a, c, 2, now); len(paths) != 0 {
		t.Errorf("companion/room_server mid-nodes must not route, got %v", paths)
	}
}

func TestBuildGraph_DropsNonRepeaters(t *testing.T) {
	now := time.Now()
	a, room, comp := uuid.New(), uuid.New(), uuid.New()
	lat, lng := 59.6, 16.5
	lat2, lng2 := 59.61, 16.52
	mkrow := func(from, to uuid.UUID, ftype, ttype int16) db.GetRoutePlanGraphRow {
		return db.GetRoutePlanGraphRow{
			FromID: from, FromPubkey: from[:], FromType: ftype, FromLat: &lat, FromLng: &lng,
			ToID: to, ToPubkey: to[:], ToType: ttype, ToLat: &lat2, ToLng: &lng2,
			ObservationCount: 1, FirstSeen: ts(now), LastSeen: ts(now),
			FromLastSeen: ts(now), ToLastSeen: ts(now), EdgeLastSeen: ts(now),
		}
	}
	g := BuildGraph([]db.GetRoutePlanGraphRow{
		mkrow(a, room, 2, 3), // repeater -> room_server: dropped
		mkrow(a, comp, 2, 1), // repeater -> companion: dropped
		mkrow(room, a, 3, 2), // room_server -> repeater: dropped
	}, 24*time.Hour, 0, now)
	if len(g.Edges) != 0 {
		t.Errorf("non-repeater legs must not enter the planning graph, got %+v", g.Edges)
	}
	if _, ok := g.Nodes[room]; ok {
		t.Error("room_server must not enter the planning graph")
	}
	if _, ok := g.Nodes[comp]; ok {
		t.Error("companion must not enter the planning graph")
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
