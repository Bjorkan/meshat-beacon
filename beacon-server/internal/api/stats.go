// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

import "github.com/google/uuid"

// RadioPreset represents a unique radio configuration observed in a given IATA,
// aggregated from both observer status messages and node adverts.
type RadioPreset struct {
	Preset     string `json:"preset" binding:"required"` // "freqMhz,bwKhz,sf" e.g. "910.525,62.5,7"
	IATA       string `json:"iata" binding:"required"`
	SourceType string `json:"sourceType" binding:"required"` // "observer" or "node"
	Count      int64  `json:"count" binding:"required"`      // number of observers or nodes on this preset in this IATA
	// SuggestedTitle is the MeshCore suggested-settings title for the preset's
	// normalized (frequency, bandwidth, SF) triple. Coding rate never affects
	// naming. Absent for unknown or ambiguous configurations — callers keep
	// the raw label.
	SuggestedTitle *string `json:"suggestedTitle,omitempty"`
	CodingRate     *int16  `json:"codingRate,omitempty"`
}

// StatsOverview is the top-level network summary for the overview endpoint.
type StatsOverview struct {
	TotalPackets      int64 `json:"totalPackets" binding:"required"`
	TotalObservations int64 `json:"totalObservations" binding:"required"`
	ActiveObservers   int64 `json:"activeObservers" binding:"required"`
	ActiveIATAs       int64 `json:"activeIatas" binding:"required"`
	WindowHours       int   `json:"windowHours" binding:"required"` // always 24 for now
}

// ObservationPoint is a single time-bucketed observation count for charting.
type ObservationPoint struct {
	Hour             int64  `json:"hour" binding:"required"` // epoch ms, start of the 1-hour bucket
	IATA             string `json:"iata" binding:"required"`
	ObservationCount int64  `json:"observationCount" binding:"required"`
	UniquePackets    int64  `json:"uniquePackets" binding:"required"`
	ActiveObservers  int64  `json:"activeObservers" binding:"required"`
}

// PayloadBreakdownItem is a single payload type with its observation count.
type PayloadBreakdownItem struct {
	PayloadType     int16  `json:"payloadType" binding:"required"`
	PayloadTypeName string `json:"payloadTypeName" binding:"required"`
	Count           int64  `json:"count" binding:"required"`
}

// ScopeStats represents aggregate statistics for a single transport scope.
type ScopeStats struct {
	Name          string `json:"name" binding:"required"`          // normalized scope name e.g. "#bc"
	PacketCount   int64  `json:"packetCount" binding:"required"`   // distinct packets matched to this scope
	ObserverCount int64  `json:"observerCount" binding:"required"` // distinct observers that forwarded packets in this scope
	NodeCount     int64  `json:"nodeCount" binding:"required"`     // distinct nodes with this as their default scope
}

// TopNode is a node ranked by observation count from the mv_top_nodes_by_iata materialized view.
type TopNode struct {
	NodeID           uuid.UUID `json:"nodeId" binding:"required"`
	NodeName         *string   `json:"nodeName,omitempty"`
	NodeType         int16     `json:"nodeType" binding:"required"`
	NodeTypeName     string    `json:"nodeTypeName" binding:"required"`
	IATA             string    `json:"iata" binding:"required"`
	ObservationCount int64     `json:"observationCount" binding:"required"`
	LastHeard        int64     `json:"lastHeard" binding:"required"` // epoch ms
}

// TopObserver is an observer ranked by observation count.
type TopObserver struct {
	ObserverID       uuid.UUID `json:"observerId" binding:"required"`
	DisplayName      *string   `json:"displayName,omitempty"`
	ObserverType     *string   `json:"observerType,omitempty"`
	IATA             string    `json:"iata" binding:"required"`
	ObservationCount int64     `json:"observationCount" binding:"required"`
}

// TopAdvertiser is a node ranked by distinct ADVERT packet count within the requested
// window. Count is per-advert, not per-hearing -- see GetStatsTopAdvertisers.
type TopAdvertiser struct {
	NodeID       uuid.UUID `json:"nodeId" binding:"required"`
	NodeName     *string   `json:"nodeName,omitempty"`
	NodeType     int16     `json:"nodeType" binding:"required"`
	NodeTypeName string    `json:"nodeTypeName" binding:"required"`
	IATA         string    `json:"iata" binding:"required"`
	AdvertCount  int64     `json:"advertCount" binding:"required"`
	// FloodAdvertCount/DirectAdvertCount split AdvertCount by how the advert was routed:
	// flood = route type 0 (transport_flood) or 1 (flood), broadcast with no known path;
	// direct = route type 2 (direct) or 3 (transport_direct), routed along a known path.
	// FloodAdvertCount + DirectAdvertCount == AdvertCount.
	FloodAdvertCount  int64 `json:"floodAdvertCount" binding:"required"`
	DirectAdvertCount int64 `json:"directAdvertCount" binding:"required"`
	LastHeard         int64 `json:"lastHeard" binding:"required"` // epoch ms
}

// TopTalker is a companion name ranked by decrypted channel message count within the
// requested window. Grouped by sender name as decrypted from the message itself, not by
// node identity -- see GetStatsTopTalkers.
type TopTalker struct {
	SenderName   string `json:"senderName" binding:"required"`
	MessageCount int64  `json:"messageCount" binding:"required"`
	LastSent     int64  `json:"lastSent" binding:"required"` // epoch ms
}

// NodeTypeCount shows the count of nodes of a given type with the type name
type NodeTypeCount struct {
	NodeType     int16  `json:"nodeType" binding:"required"`
	NodeTypeName string `json:"nodeTypeName" binding:"required"`
	Count        int64  `json:"count" binding:"required"`
}

// ClockDriftEntry is a repeater or room server whose most recent advert-derived clock drift
// exceeds the configured threshold (nodes.clock_drift_threshold, default 5m) -- see
// GetStatsClockDrift. Ordered worst-drift-first. ClockDriftSeconds/ClockCheckedAt mirror the
// same-named fields on Node; unlike Node this list only ever contains out-of-sync nodes, so
// there's no ClockOutOfSync bool here -- being in the list already means true.
type ClockDriftEntry struct {
	NodeID            uuid.UUID  `json:"nodeId" binding:"required"`
	NodeName          *string    `json:"nodeName,omitempty"`
	NodeType          int16      `json:"nodeType" binding:"required"`
	NodeTypeName      string     `json:"nodeTypeName" binding:"required"`
	ClockDriftSeconds int        `json:"clockDriftSeconds" binding:"required"` // signed; +ve = device ahead of server
	ClockCheckedAt    int64      `json:"clockCheckedAt" binding:"required"`    // epoch ms
	IATAs             []NodeIATA `json:"iatas,omitempty"`                      // IATAs this node has been heard in
}
