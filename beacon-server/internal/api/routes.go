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
