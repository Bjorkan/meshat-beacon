// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

// CoverageCellBounds is the geographic rectangle of one MeshMapper grid cell
// in decimal degrees. Emitted as a GeoJSON-compatible polygon by the handler.
type CoverageCellBounds struct {
	South float64 `json:"south"`
	West  float64 `json:"west"`
	North float64 `json:"north"`
	East  float64 `json:"east"`
}

// CoverageCell is one MeshMapper grid square, trimmed to the fields Beacon
// renders: effective quality, ping age, and the dominant coverage type.
// SNR fields are nullable upstream (~45% of live SWE cells lack them).
type CoverageCell struct {
	GridID       string             `json:"gridId"`
	Bounds       CoverageCellBounds `json:"bounds"`
	CoverageType string             `json:"coverageType"`        // BIDIR/TX/RX/DISC/DEAD/DROP
	Effective    float64            `json:"effective"`           // 0-3 average quality
	Count        int                `json:"count"`               // pings aggregated (confidence)
	Timestamp    *int64             `json:"timestamp,omitempty"` // dominant (newest) ping, epoch s
	FirstSeen    *int64             `json:"firstSeen,omitempty"` // oldest ping, epoch s
	SNR          *float64           `json:"snr,omitempty"`
	SNRMin       *float64           `json:"snrMin,omitempty"`
	SNRMax       *float64           `json:"snrMax,omitempty"`
	StatusMask   int                `json:"statusMask"`
}

// CoverageResponse is Beacon's own cached view of the MeshMapper coverage
// grid for the configured region. PingAgeSeconds mirrors upstream
// data_age_seconds: seconds between the newest ping and the fetch.
type CoverageResponse struct {
	Region         string         `json:"region"`
	GeneratedAt    int64          `json:"generatedAt"` // epoch ms, when Beacon fetched upstream
	PingAgeSeconds *int64         `json:"pingAgeSeconds,omitempty"`
	TotalSquares   int            `json:"totalSquares"`
	PointCount     int64          `json:"pointCount"`
	TypeCounts     map[string]int `json:"typeCounts,omitempty"`
	Cells          []CoverageCell `json:"cells"`
	Cached         bool           `json:"cached"` // true when served from Beacon's cache
	UpstreamFresh  bool           `json:"upstreamFresh"`
	Disabled       bool           `json:"disabled,omitempty"` // true when no key configured
}
