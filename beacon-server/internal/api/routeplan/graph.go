// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package routeplan computes best routes between two mesh nodes over the
// observed neighbor graph, preferring legs with known signal strength and
// proven traffic history.
//
// Cost model (all weights from config, see internal/config.RoutePlanConfig):
// each leg costs a signal term minus a traffic-evidence discount, floored per
// leg at SNRStrongCap. A fresh SNR reading at/above goodDB costs the cap
// (no extra cost); between goodDB and badDB the signal term interpolates
// linearly up to maxPenalty, with a kink at 0 dB: readings below zero degrade
// faster per dB than readings above zero, so every step down into the
// negative costs more than a step down while still positive. Unmeasured or
// stale-SNR legs pay unmeasuredPenalty as their signal term instead, which
// must exceed maxPenalty so a speculative leg (no traffic) always costs more
// than any measured leg and the graph never fragments for lack of
// measurements.
//
// Traffic evidence (the directed pair's merged observation_count: every
// packet that demonstrably crossed the hop) discounts the signal term on a
// log scale: discount(obs) = trafficMaxDiscount *
// log10(1+obs) / log10(1+trafficFullCount). Hundreds of passed packets
// (HuskvarnaS -> Gisebo ~1000) therefore discount far more than a handful
// (3 packets), letting a proven-but-SNR-less hop outrank a weak measured
// hop with thin history. ONLY legs with unambiguous provenance earn the
// discount (see Edge.discountableProvenance): exact identity or a 2+ byte
// hash that resolved to exactly one node globally -- the same uniqueness
// rule the rest of the system already holds. A 1-byte hash never discounts
// (any node could have been the hop: ~1/256 of the fleet shares any
// 1-byte prefix), and legacy rows without provenance fail closed.
// Speculative legs (obs ~ 1) keep almost no discount, so they still lose
// to every measured leg. Discounts never apply to the strong cap itself:
// the cheapest possible leg cost is exactly SNRStrongCap, keeping the
// Dijkstra positivity invariant trivially checkable.
//
// Unseen legs: an edge exists in node_neighbors (topologically possible --
// a /neighbors claim, TRACE pair, or path adjacency) but no packet was EVER
// observed crossing it in THIS direction (merged observation_count == 0).
// Such a hop is plausible but unproven, so it pays UnseenPenalty on top of
// everything and is flagged for the UI (Edge.Unseen, "unconfirmed
// possible"). The penalty dwarfs every modeled difference, so any route
// avoiding the unseen hop wins unless no alternative exists within MaxHops
// -- and the hop stays usable, so the graph never fragments for lack of
// traffic. Directional: reverse traffic never confirms this direction.
// Zero disables the penalty (the flag is still reported).
//
// Because the strong-leg cap sits well below 1.0 while a weak measured leg
// costs ~1.0, several strong measured hops can together cost less than one
// weak measured hop: the planner prefers more hops when every hop has a
// strong signal, instead of minimizing the hop count first.
//
// A leg whose reporter explicitly marked the peer as a neighbor (a DIRECT
// neighbor edge in node_neighbors for that directed pair, as opposed to a
// purely overheard third-party observation) earns neighborBonus off its cost:
// an explicit mark is the reporter's own statement that the hop is real, so it
// outranks an equally-measured overheard leg. The bonus must stay below
// the unmeasured/measured gap (see Validate) so it can never promote an
// unmeasured leg above a measured one, and below the strong cap so costs
// stay positive. Reverse evidence does not mark this
// direction: the semantic is directional, OR-merged only across IATA rows of
// the same (reporter, peer) pair.
//
// The bonus additionally requires a fresh direct confirmation
// (direct_last_seen within DirectFreshness): overheard traffic keeps the row
// alive under retention but never refreshes the direct confirmation.
//
// The graph is directed (each stored node_neighbors row is one directed edge)
// and merged across IATAs exactly like GetNodeNeighbors: SNR is the
// sample-weighted mean, observation counts sum, timestamps take min/max.
package routeplan

import (
	"math"
	"time"

	db "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// NodeTypeRepeater is the only routable node type in the planner: the route
// planner is a MeshCore repeater-route feature (repeater -> repeater -> ...),
// so BuildGraph drops non-repeater endpoints and dijkstra only transits
// repeaters. Node_short_ids covers infra types 2/3 for path resolution, but
// room servers never forward a planned repeater route.
const NodeTypeRepeater = 2

// NodeTypeRoomServer is retained for callers that classify node types outside
// the planner (path resolution covers infra types 2/3). It is NOT routable.
const NodeTypeRoomServer = 3

// Config is the planner's cost model. Build it from config.ResolvedConfig via
// FromResolved so defaults live in exactly one place.
type Config struct {
	UnmeasuredPenalty float64
	SNRGoodDB         float64
	SNRBadDB          float64
	SNRMaxPenalty     float64
	// SNRStrongCap is the maximum cost of a single strong leg (fresh SNR at
	// or above SNRGoodDB). Well below 1.0 so several strong hops beat one
	// weak hop; see the package doc.
	SNRStrongCap float64
	// TrafficMaxDiscount is the largest discount proven traffic can earn
	// (reached at TrafficFullCount observations). Log-scaled, so hundreds
	// of passed packets discount far more than a handful; see the package
	// doc. Zero disables traffic evidence entirely.
	TrafficMaxDiscount float64
	// TrafficFullCount is the observation count that earns the full traffic
	// discount. Must stay >= 1: below that the log scale is degenerate.
	TrafficFullCount float64
	// TrafficMeasuredShare is the fraction (0..1) of the traffic discount
	// that applies to measured legs. Unmeasured legs earn the full
	// discount (traffic is their only quality signal); measured legs earn
	// only this share, so SNR stays the primary signal where it exists.
	TrafficMeasuredShare float64
	// UnmeasuredFloor is the cheapest an unmeasured leg can get, no matter
	// how much traffic proves it. Keeps the cheapest speculative leg above
	// the strong cap so a fresh strong reading always wins per-leg.
	UnmeasuredFloor float64
	// UnseenPenalty is the extra cost of a leg no packet was ever observed
	// crossing in that direction (merged observation_count == 0). Added
	// last, after all floors, so it always bites. Zero disables the
	// penalty (the Unseen flag is still reported). See the package doc.
	UnseenPenalty float64
	NeighborBonus float64 // discount for explicitly marked neighbor legs (see package doc)
	SNRFreshness  time.Duration
	// DirectFreshness bounds how old a direct confirmation (direct_last_seen)
	// may be before the neighbor bonus/badge stops applying. Resolve defaults
	// unset to SNRFreshness; an explicit 0 disables the bonus (see
	// IsFreshNeighbor: DirectFreshness <= 0 is never fresh).
	DirectFreshness time.Duration
	MaxHops         int
	MaxAlternatives int
	MaxDistanceKm   float64 // legs longer than this are not radio hops; 0 = unlimited
}

// FromResolved maps the resolved server config onto the planner cost model.
// RoutePlanDirectFreshness is copied verbatim WITHOUT a zero fallback: nil
// (unset) already resolved to SNRFreshness in config.Resolve, while an
// explicit 0 means disabled and must reach the planner as 0 (see
// IsFreshNeighbor: DirectFreshness <= 0 grants no bonus).
func FromResolved(r config.ResolvedConfig) Config {
	return Config{
		UnmeasuredPenalty:    r.RoutePlanUnmeasuredPenalty,
		SNRGoodDB:            r.RoutePlanSNRGoodDB,
		SNRBadDB:             r.RoutePlanSNRBadDB,
		SNRMaxPenalty:        r.RoutePlanSNRMaxPenalty,
		SNRStrongCap:         r.RoutePlanSNRStrongCap,
		TrafficMaxDiscount:   r.RoutePlanTrafficMaxDiscount,
		TrafficFullCount:     r.RoutePlanTrafficFullCount,
		TrafficMeasuredShare: r.RoutePlanTrafficMeasuredShare,
		UnmeasuredFloor:      r.RoutePlanUnmeasuredFloor,
		UnseenPenalty:        r.RoutePlanUnseenPenalty,
		NeighborBonus:        r.RoutePlanNeighborBonus,
		SNRFreshness:         r.RoutePlanSNRFreshness,
		DirectFreshness:      r.RoutePlanDirectFreshness,
		MaxHops:              r.RoutePlanMaxHops,
		MaxAlternatives:      r.RoutePlanMaxAlternatives,
		MaxDistanceKm:        r.NeighborMaxKm,
	}
}

// Node is a located mesh node in the planning graph. The route planner is
// repeater-only end-to-end (MeshCore repeater routes): BuildGraph keeps
// repeater nodes, and only repeaters are routable as endpoints or transit.
type Node struct {
	ID       uuid.UUID
	Pubkey   string // lowercase hex
	Name     *string
	Type     int16 // always NodeTypeRepeater in planner graphs
	Lat, Lng float64
	Stale    bool
	// SupportsMultibytePaths mirrors nodes.supports_multibyte_paths: true
	// only when 3-byte forwarding is confirmed. False is "not confirmed
	// yet", never "known incompatible".
	SupportsMultibytePaths bool
}

// Edge is one directed, IATA-merged neighbor leg with its cost inputs.
type Edge struct {
	From, To       uuid.UUID
	SNR            *float32 // merged sample-weighted mean, nil when never measured
	SNRSampleCount int64
	SNRLastSeen    time.Time // zero when never measured
	Observations   int64
	// HashWidth is the widest provenance width (in bytes) that ever
	// confirmed this directed pair: 32 = exact pubkey identity (direct RF
	// evidence, always unambiguous), 2/3/4/8 = the path/trace hash width
	// that confirmed it (stored only for globally unique resolutions),
	// 1 = a 1-byte hash (never discountable: ~1/256 of the fleet shares
	// any 1-byte prefix). Zero/negative = legacy row predating provenance
	// tracking: fail-closed, never discounted. Merged with MAX across IATA
	// rows of the same directed pair, so one unambiguous confirmation keeps
	// the discount even if later traffic arrives narrower.
	HashWidth int16
	// Neighbor is true when the reporter explicitly marked the peer as a
	// neighbor (a DIRECT row in node_neighbors for this directed pair).
	// Overheard third-party legs leave it false. Directional: reverse evidence
	// does not mark this direction. Merged with OR across IATA rows of the
	// same directed pair. Only fresh confirmations count -- see DirectLastSeen.
	Neighbor bool
	// DirectLastSeen is the freshest explicit direct confirmation for this
	// directed pair; zero when never directly confirmed. Overheard traffic
	// never advances it. The planner grants the neighbor bonus only while it
	// is within Config.DirectFreshness.
	DirectLastSeen time.Time
}

// discountableProvenance reports whether the leg's evidence is unambiguous
// enough for the traffic-evidence discount: exact identity (32) or a 2+ byte
// hash that resolved to exactly one node globally. 1-byte hashes are never
// discountable (any node could have been the hop), and legacy rows without
// recorded provenance (<= 0) fail closed.
func (e Edge) discountableProvenance() bool {
	return e.HashWidth >= 2
}

// Unseen reports whether the leg exists topologically but no packet was EVER
// observed crossing it in this direction (merged observation_count == 0):
// the hop is plausible but unproven ("unconfirmed possible" in the UI).
// Directional by construction -- the count sums only this directed pair's
// IATA rows, so reverse traffic never confirms this direction. Negative
// counts cannot happen from SQL SUM (defensive: not unseen).
func (e Edge) Unseen() bool {
	return e.Observations == 0
}

// Graph is the directed planning graph: located nodes plus directed edges.
type Graph struct {
	Nodes map[uuid.UUID]Node
	Edges map[uuid.UUID][]Edge // adjacency by source node
}

// IsFreshNeighbor is the single shared definition of "fresh direct neighbor"
// used by both route cost (LegCost) and API projection (toPlannedRoute): the
// edge must be explicitly marked AND its confirmation must be within
// DirectFreshness. Freshness is independent of the size of the cost bonus:
// NeighborBonus == 0 disables only the routing discount, never the topology
// fact (or the badge). DirectFreshness <= 0 means no confirmation is ever
// fresh, i.e. the bonus/badge is disabled. A confirmation timestamp in the
// future (clock skew) is rejected, not treated as fresh. now anchors the
// check so tests pin time.
func (c Config) IsFreshNeighbor(e Edge, now time.Time) bool {
	if !e.Neighbor || e.DirectLastSeen.IsZero() {
		return false
	}
	if c.DirectFreshness <= 0 {
		return false
	}
	age := now.Sub(e.DirectLastSeen)
	return age >= 0 && age <= c.DirectFreshness
}

// LegCost returns the cost of traversing e plus whether the leg counts as
// unmeasured (no fresh SNR reading backs it). The cost has four parts:
//
//	signal term: strong legs (fresh SNR at/above SNRGoodDB) cost exactly
//	SNRStrongCap; weaker readings interpolate toward SNRMaxPenalty with a
//	kink at 0 dB (sub-zero degrades faster per dB); unmeasured legs pay
//	UnmeasuredPenalty. The kink makes every step down into the negative
//	cost more than a step down while still positive.
//	traffic discount: discount(obs) = TrafficMaxDiscount *
//	log10(1+obs)/log10(1+TrafficFullCount), log-scaled so hundreds of
//	passed packets discount far more than a handful. ONLY legs with
//	unambiguous provenance earn it (see Edge.discountableProvenance):
//	exact identity or a 2+ byte hash that resolved to exactly one node
//	globally. 1-byte evidence never discounts (any node could have been
//	the hop) and legacy rows without provenance fail closed. Unmeasured
//	legs earn the full discount (traffic is their only quality signal,
//	floored at UnmeasuredFloor); measured legs earn only
//	TrafficMeasuredShare of it, so SNR stays the primary signal where it
//	exists. Zero observations earn zero discount.
//	neighbor bonus: a freshly-confirmed neighbor leg (see IsFreshNeighbor)
//	earns the configured bonus -- zero is naturally a no-op so
//	NeighborBonus == 0 disables only the discount, never the topology
//	fact. The bonus applies to weak/interpolated legs (where it breaks ties
//	between equally-measured legs) but never to a capped strong leg,
//	keeping the cheapest possible cost exactly the strong cap.
//	unseen penalty: a leg no packet ever crossed in this direction (see
//	Edge.Unseen) pays UnseenPenalty on top, after all floors, so it always
//	bites. Zero disables the penalty but the flag is still reported.
//
// A node that moves (new advert with different lat/lon) deletes all its
// neighbor rows outright at ingest (see UpsertNode), so stale-position
// evidence can never discount -- the same invalidation rule as the
// neighbor system itself. The planner additionally drops legs longer than
// the distance cap at plan time (BuildGraph maxKm), so the "within 150km"
// rule holds end to end even for legacy rows.
//
// Costs stay positive for Dijkstra (ValidateResolved enforces bonus < gap,
// cap in (0, 1), non-negative unseen penalty, and the
// traffic/full-count/floor relations). now anchors
// the freshness checks so tests can pin time.
func (c Config) LegCost(e Edge, now time.Time) (cost float64, unmeasured bool) {
	bonus := 0.0
	if c.IsFreshNeighbor(e, now) {
		bonus = c.NeighborBonus
	}
	traffic := 0.0
	if e.discountableProvenance() {
		traffic = c.trafficDiscount(e.Observations)
	}
	measured := !(e.SNR == nil || e.SNRSampleCount == 0 || now.Sub(e.SNRLastSeen) > c.SNRFreshness)
	if measured {
		snr := float64(*e.SNR)
		if snr >= c.SNRGoodDB {
			return c.SNRStrongCap + c.unseenPenalty(e), false
		}
		signal := c.SNRMaxPenalty
		if snr > c.SNRBadDB {
			signal = c.interpolateSignal(snr)
		}
		cost := signal - traffic*c.TrafficMeasuredShare - bonus
		if cost < c.SNRStrongCap {
			cost = c.SNRStrongCap
		}
		return cost + c.unseenPenalty(e), false
	}
	cost = c.UnmeasuredPenalty - traffic - bonus
	if cost < c.UnmeasuredFloor {
		cost = c.UnmeasuredFloor
	}
	return cost + c.unseenPenalty(e), true
}

// unseenPenalty returns UnseenPenalty when the leg is unseen (see
// Edge.Unseen), else 0. Non-negative by validation, so it can only raise
// costs and never break the positivity invariant.
func (c Config) unseenPenalty(e Edge) float64 {
	if e.Unseen() {
		return c.UnseenPenalty
	}
	return 0
}

// interpolateSignal maps a fresh SNR strictly inside (SNRBadDB, SNRGoodDB)
// onto (0, SNRMaxPenalty] with a kink at 0 dB: positive readings degrade
// gently from the strong cap to the zero-penalty, negative readings degrade
// faster from the zero-penalty to the max. Callers handle the at/above-good
// (cap) and at/below-bad (max) endpoints; snr must be strictly inside.
func (c Config) interpolateSignal(snr float64) float64 {
	zeroPenalty := c.SNRStrongCap + (c.SNRMaxPenalty-c.SNRStrongCap)*
		(c.SNRGoodDB/(c.SNRGoodDB-c.SNRBadDB))
	if snr >= 0 {
		// GoodDB -> cap, 0 -> zeroPenalty (gentle positive slope).
		frac := (c.SNRGoodDB - snr) / c.SNRGoodDB
		return c.SNRStrongCap + frac*(zeroPenalty-c.SNRStrongCap)
	}
	// 0 -> zeroPenalty, BadDB -> maxPenalty (steeper negative slope).
	frac := -snr / -c.SNRBadDB
	return zeroPenalty + frac*(c.SNRMaxPenalty-zeroPenalty)
}

// trafficDiscount maps a directed pair's merged observation count onto
// [0, TrafficMaxDiscount] on a log10 scale: 0 observations earn nothing, the
// full count earns the max, and hundreds of packets sit far above a handful.
// Negative counts (cannot happen from SQL SUM, defensive only) earn nothing.
func (c Config) trafficDiscount(observations int64) float64 {
	if c.TrafficMaxDiscount <= 0 || observations <= 0 {
		return 0
	}
	return c.TrafficMaxDiscount * math.Log10(1+float64(observations)) / math.Log10(1+c.TrafficFullCount)
}

// haversineKm is the great-circle distance between two points. Kept local
// (rather than importing the api helper) so the planner has no HTTP-layer
// dependency; the formula is identical.
func haversineKm(lat1, lon1, lat2, lon2 float64) float64 {
	const r = 6371.0
	toRad := math.Pi / 180
	dLat := (lat2 - lat1) * toRad
	dLon := (lon2 - lon1) * toRad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*toRad)*math.Cos(lat2*toRad)*math.Sin(dLon/2)*math.Sin(dLon/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}

// BuildGraph folds directed neighbor rows into a repeater-only planning
// graph. Rows touching an unlocated endpoint are dropped (they cannot be
// drawn); rows touching a non-repeater endpoint are dropped (the planner is
// a MeshCore repeater-route feature: repeater -> repeater -> ...). Legs
// longer than maxKm between two located endpoints are dropped (not radio
// hops -- same sanity rule as ingest). Opposite directed rows stay separate
// edges; their SNR is merged per direction across IATA rows, while the direct
// mark is directional too: only this (reporter, peer) pair's own explicit
// marks set Neighbor, reverse evidence never does.
func BuildGraph(rows []db.GetRoutePlanGraphRow, staleThreshold time.Duration, maxKm float64, now time.Time) Graph {
	type dirKey struct {
		from, to uuid.UUID
	}
	nodes := make(map[uuid.UUID]Node)
	merged := make(map[dirKey]*Edge)
	order := make([]dirKey, 0)

	for _, r := range rows {
		if r.FromLat == nil || r.FromLng == nil || r.ToLat == nil || r.ToLng == nil {
			continue
		}
		if r.FromType != NodeTypeRepeater || r.ToType != NodeTypeRepeater {
			continue
		}
		if maxKm > 0 && haversineKm(*r.FromLat, *r.FromLng, *r.ToLat, *r.ToLng) > maxKm {
			continue
		}
		if _, ok := nodes[r.FromID]; !ok {
			nodes[r.FromID] = Node{
				ID: r.FromID, Pubkey: lowerHex(r.FromPubkey), Name: r.FromName,
				Type: r.FromType, Lat: *r.FromLat, Lng: *r.FromLng,
				SupportsMultibytePaths: r.FromSupportsMultibytePaths,
			}
		}
		if _, ok := nodes[r.ToID]; !ok {
			nodes[r.ToID] = Node{
				ID: r.ToID, Pubkey: lowerHex(r.ToPubkey), Name: r.ToName,
				Type: r.ToType, Lat: *r.ToLat, Lng: *r.ToLng,
				SupportsMultibytePaths: r.ToSupportsMultibytePaths,
			}
		}
		key := dirKey{from: r.FromID, to: r.ToID}
		e, ok := merged[key]
		if !ok {
			e = &Edge{From: r.FromID, To: r.ToID}
			merged[key] = e
			order = append(order, key)
		}
		e.Observations += r.ObservationCount
		// Provenance merges with MAX: the widest hash that ever confirmed
		// the pair, so one unambiguous confirmation keeps the discount even
		// if later traffic arrives narrower. Legacy rows (0) never upgrade
		// and never block a real width.
		if r.HashWidth > e.HashWidth {
			e.HashWidth = r.HashWidth
		}
		if r.Direct {
			e.Neighbor = true
		}
		if r.DirectLastSeen.Valid && r.DirectLastSeen.Time.After(e.DirectLastSeen) {
			e.DirectLastSeen = r.DirectLastSeen.Time
		}
		mergeEdgeSNR(e, r.SnrWeightedSum, r.SnrSampleCount, r.SnrLastSeen)
	}

	// Staleness is a node property: prefer the nodes' own last_seen (the dump
	// carries from/to last_seen), falling back to the freshest touching edge's
	// last_seen only when node timestamps are absent. Stale legs are flagged
	// in the response, never excluded.
	freshest := make(map[uuid.UUID]time.Time)
	for _, r := range rows {
		if r.FromLastSeen.Valid {
			if r.FromLastSeen.Time.After(freshest[r.FromID]) {
				freshest[r.FromID] = r.FromLastSeen.Time
			}
		}
		if r.ToLastSeen.Valid {
			if r.ToLastSeen.Time.After(freshest[r.ToID]) {
				freshest[r.ToID] = r.ToLastSeen.Time
			}
		}
		if r.EdgeLastSeen.Valid {
			for _, id := range [2]uuid.UUID{r.FromID, r.ToID} {
				if _, hasNode := freshest[id]; !hasNode {
					if r.EdgeLastSeen.Time.After(freshest[id]) {
						freshest[id] = r.EdgeLastSeen.Time
					}
				}
			}
		}
	}
	staleCutoff := now.Add(-staleThreshold)
	for id, n := range nodes {
		if freshest[id].Before(staleCutoff) {
			n.Stale = true
			nodes[id] = n
		}
	}

	g := Graph{Nodes: nodes, Edges: make(map[uuid.UUID][]Edge)}
	for _, key := range order {
		g.Edges[key.from] = append(g.Edges[key.from], *merged[key])
	}
	return g
}

// mergeEdgeSNR folds one aggregated dump row into the directed edge. The row
// carries the sample-weighted pieces (sum(snr*count), sum(count)) computed in
// SQL; the mean is sum/count, exactly like GetNodeNeighbors' Go merge. A zero
// sample count means no IATA row carried a reading: the edge stays unmeasured
// (nil SNR), never a fabricated 0 dB.
func mergeEdgeSNR(e *Edge, weightedSum float32, count int64, lastSeen pgtype.Timestamptz) {
	if count > 0 {
		mean := weightedSum / float32(count)
		if e.SNR == nil || e.SNRSampleCount == 0 {
			e.SNR = &mean
			e.SNRSampleCount = count
		} else {
			total := e.SNRSampleCount + count
			combined := (*e.SNR*float32(e.SNRSampleCount) + mean*float32(count)) / float32(total)
			e.SNR = &combined
			e.SNRSampleCount = total
		}
	}
	if lastSeen.Valid && lastSeen.Time.After(e.SNRLastSeen) {
		e.SNRLastSeen = lastSeen.Time
	}
}

// lowerHex encodes bytes as lowercase hex (pgx returns public_key raw).
func lowerHex(b []byte) string {
	const digits = "0123456789abcdef"
	out := make([]byte, 0, len(b)*2)
	for _, c := range b {
		out = append(out, digits[c>>4], digits[c&0xf])
	}
	return string(out)
}
