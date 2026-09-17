// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package routeplan computes best routes between two mesh nodes over the
// observed neighbor graph, preferring legs with known signal strength.
//
// Cost model (all weights from config, see internal/config.RoutePlanConfig):
// every leg costs a 1.0 base per hop plus a signal term. A fresh SNR reading
// between goodDB (no extra cost) and badDB (full maxPenalty) interpolates
// linearly; unmeasured or stale-SNR legs pay unmeasuredPenalty instead, which
// must exceed maxPenalty so a measured leg always beats an unmeasured one and
// the graph never fragments for lack of measurements.
//
// A leg whose reporter explicitly marked the peer as a neighbor (a DIRECT
// neighbor edge in node_neighbors for that directed pair, as opposed to a
// purely overheard third-party observation) earns neighborBonus off its cost:
// an explicit mark is the reporter's own statement that the hop is real, so it
// outranks an equally-measured overheard leg. The bonus must stay below
// the unmeasured/measured gap (see Validate) so it can never promote an
// unmeasured leg above a measured one. Reverse evidence does not mark this
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

// NodeTypeRepeater and NodeTypeRoomServer are the only routable mid-node types,
// mirroring path resolution (node_short_ids only covers infra types 2/3).
// Endpoints may be any type.
const (
	NodeTypeRepeater   = 2
	NodeTypeRoomServer = 3
)

// Config is the planner's cost model. Build it from config.ResolvedConfig via
// FromResolved so defaults live in exactly one place.
type Config struct {
	UnmeasuredPenalty float64
	SNRGoodDB         float64
	SNRBadDB          float64
	SNRMaxPenalty     float64
	NeighborBonus     float64 // discount for explicitly marked neighbor legs (see package doc)
	SNRFreshness      time.Duration
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
		UnmeasuredPenalty: r.RoutePlanUnmeasuredPenalty,
		SNRGoodDB:         r.RoutePlanSNRGoodDB,
		SNRBadDB:          r.RoutePlanSNRBadDB,
		SNRMaxPenalty:     r.RoutePlanSNRMaxPenalty,
		NeighborBonus:     r.RoutePlanNeighborBonus,
		SNRFreshness:      r.RoutePlanSNRFreshness,
		DirectFreshness:   r.RoutePlanDirectFreshness,
		MaxHops:           r.RoutePlanMaxHops,
		MaxAlternatives:   r.RoutePlanMaxAlternatives,
		MaxDistanceKm:     r.NeighborMaxKm,
	}
}

// Node is a located mesh node in the planning graph.
type Node struct {
	ID       uuid.UUID
	Pubkey   string // lowercase hex
	Name     *string
	Type     int16
	Lat, Lng float64
	Stale    bool
}

// Edge is one directed, IATA-merged neighbor leg with its cost inputs.
type Edge struct {
	From, To       uuid.UUID
	SNR            *float32 // merged sample-weighted mean, nil when never measured
	SNRSampleCount int64
	SNRLastSeen    time.Time // zero when never measured
	Observations   int64
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
// unmeasured (no fresh SNR reading backs it). A freshly-confirmed neighbor
// leg (see IsFreshNeighbor) earns the configured bonus -- zero is naturally
// a no-op so NeighborBonus == 0 disables only the discount, never the
// topology fact. The cost is floored at a small epsilon above zero so costs
// stay positive for Dijkstra. now anchors the freshness checks so tests can
// pin time.
func (c Config) LegCost(e Edge, now time.Time) (cost float64, unmeasured bool) {
	const base = 1.0
	bonus := 0.0
	if c.IsFreshNeighbor(e, now) {
		bonus = c.NeighborBonus
	}
	if e.SNR == nil || e.SNRSampleCount == 0 || now.Sub(e.SNRLastSeen) > c.SNRFreshness {
		return base + c.UnmeasuredPenalty - bonus, true
	}
	snr := float64(*e.SNR)
	if snr >= c.SNRGoodDB {
		cost := base - bonus
		if cost < 0.01 {
			cost = 0.01
		}
		return cost, false
	}
	if snr <= c.SNRBadDB {
		return base + c.SNRMaxPenalty - bonus, false
	}
	frac := (c.SNRGoodDB - snr) / (c.SNRGoodDB - c.SNRBadDB)
	return base + frac*c.SNRMaxPenalty - bonus, false
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

// BuildGraph folds directed neighbor rows into a planning graph. Rows
// touching an unlocated endpoint are dropped (they cannot be drawn); legs
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
		if maxKm > 0 && haversineKm(*r.FromLat, *r.FromLng, *r.ToLat, *r.ToLng) > maxKm {
			continue
		}
		if _, ok := nodes[r.FromID]; !ok {
			nodes[r.FromID] = Node{
				ID: r.FromID, Pubkey: lowerHex(r.FromPubkey), Name: r.FromName,
				Type: r.FromType, Lat: *r.FromLat, Lng: *r.FromLng,
			}
		}
		if _, ok := nodes[r.ToID]; !ok {
			nodes[r.ToID] = Node{
				ID: r.ToID, Pubkey: lowerHex(r.ToPubkey), Name: r.ToName,
				Type: r.ToType, Lat: *r.ToLat, Lng: *r.ToLng,
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
