// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import "github.com/google/uuid"

// RouteHop is a single resolved hop in a known route.
type RouteHop struct {
	NodeID    uuid.UUID     `json:"nodeId" binding:"required"`
	HashBytes string        `json:"hashBytes" binding:"required"` // hex-encoded hash prefix
	Node      *ResolvedNode `json:"node,omitempty"`               // populated when node details are available
}

// KnownRoute is a fully resolved path through the mesh where all hops
// have been confirmed as high confidence.
type KnownRoute struct {
	ID               int64      `json:"id" binding:"required"`
	IATA             string     `json:"iata" binding:"required"`
	HopCount         int32      `json:"hopCount" binding:"required"`
	Hops             []RouteHop `json:"hops" binding:"required"`
	FirstSeen        int64      `json:"firstSeen" binding:"required"` // epoch ms
	LastSeen         int64      `json:"lastSeen" binding:"required"`  // epoch ms
	ObservationCount int64      `json:"observationCount" binding:"required"`
}

// PlannedRouteLeg is one directed hop of a computed best route.
type PlannedRouteLeg struct {
	From             string   `json:"from" binding:"required"` // full node public key, lowercase hex
	To               string   `json:"to" binding:"required"`   // full node public key, lowercase hex
	SNR              *float32 `json:"snr,omitempty"`           // merged sample-weighted SNR in dB: last-known reading, nil when never measured
	SNRSampleCount   int64    `json:"snrSampleCount" binding:"required"`
	SNRLastSeen      int64    `json:"snrLastSeen" binding:"required"` // epoch ms, 0 when never measured
	ObservationCount int64    `json:"observationCount" binding:"required"`
	Unmeasured       bool     `json:"unmeasured" binding:"required"` // true when no fresh SNR reading backs this leg; SNR then is a stale last-known value, not current quality
	Neighbor         bool     `json:"neighbor" binding:"required"`   // true when the reporter explicitly marked the peer as a neighbor (directional, freshly confirmed)
	// Unseen is true when no packet was ever observed crossing this hop in
	// this direction: topologically possible but unproven ("unconfirmed
	// possible" in the UI). The leg pays a large extra penalty, so any
	// route avoiding it wins unless no alternative exists.
	Unseen bool `json:"unseen" binding:"required"`
}

// PlannedRouteNode is a waypoint of a computed best route. ID feeds the
// existing node overlay (/nodes/$nodeId); PublicKey is the stable full-hex
// identity used in from/to URLs.
type PlannedRouteNode struct {
	ID           uuid.UUID `json:"id" binding:"required"`
	PublicKey    string    `json:"publicKey" binding:"required"` // full key, lowercase hex
	Name         *string   `json:"name,omitempty"`
	Latitude     *float64  `json:"latitude,omitempty"`
	Longitude    *float64  `json:"longitude,omitempty"`
	NodeType     int16     `json:"nodeType" binding:"required"`
	NodeTypeName string    `json:"nodeTypeName" binding:"required"`
	Stale        bool      `json:"stale" binding:"required"`
	// SupportsMultibytePaths reports confirmed 3-byte path-hash forwarding
	// (firmware 1.14+). False means "not confirmed yet", NOT "known
	// incompatible": the flag starts false on a cold deployment until enough
	// advert/path traffic has been observed. The MeshCore exporter warns
	// (without blocking the copy) when any repeater in the route is
	// unconfirmed. Tri-state (confirmed/unknown/unsupported) is future work;
	// today only confirmed-true is actionable.
	SupportsMultibytePaths bool `json:"supportsMultibytePaths" binding:"required"`
}

// PlannedRoute is one computed path between two nodes, best first.
type PlannedRoute struct {
	Nodes              []PlannedRouteNode `json:"nodes" binding:"required"`
	Legs               []PlannedRouteLeg  `json:"legs" binding:"required"`
	TotalCost          float64            `json:"totalCost" binding:"required"`
	HopCount           int                `json:"hopCount" binding:"required"`
	HasUnmeasuredLegs  bool               `json:"hasUnmeasuredLegs" binding:"required"`
	HasUnseenLegs      bool               `json:"hasUnseenLegs" binding:"required"` // true when any leg was never observed carrying traffic in its direction
	ContainsStaleNodes bool               `json:"containsStaleNodes" binding:"required"`
}

// BestRouteResult is the GET /routes/best response. Paths is empty (with
// Reason set) when no route exists -- never an error, so the planner UI can
// render "no route" instead of failing.
type BestRouteResult struct {
	Paths  []PlannedRoute `json:"paths" binding:"required"`
	Reason string         `json:"reason,omitempty"` // e.g. "no-route", "endpoint-missing-position"
}

// CrossIATAHop represents the boundary hop between two IATAs in a cross-IATA route.
type CrossIATAHop struct {
	FromNode ResolvedNode `json:"fromNode" binding:"required"` // last node in source IATA
	ToNode   ResolvedNode `json:"toNode" binding:"required"`   // first node in target IATA
	FromIATA string       `json:"fromIata" binding:"required"`
	ToIATA   string       `json:"toIata" binding:"required"`
	LastSeen int64        `json:"lastSeen" binding:"required"` // epoch ms
}

// CrossIATARoute is a route that crosses IATA boundaries.
type CrossIATARoute struct {
	SourceSegment []RouteHop   `json:"sourceSegment" binding:"required"` // route segment in source IATA
	CrossHop      CrossIATAHop `json:"crossHop" binding:"required"`      // the boundary hop
	TargetSegment []RouteHop   `json:"targetSegment" binding:"required"` // route segment in target IATA
	TotalHops     int          `json:"totalHops" binding:"required"`
}
