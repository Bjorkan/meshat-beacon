// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

// PathStats counts stored receptions in [Since, Until), not unique packets or nodes.
// Hashed + Empty + Trace + Unclassified partitions Receptions. Empty paths never
// vote for a hash width. TRACE header paths contain signal readings, not hashes.
// Since and Until are the effective UTC-hour boundaries of the materialized snapshot.
type PathStats struct {
	Since        int64           `json:"since" binding:"required"`
	Until        int64           `json:"until" binding:"required"`
	Receptions   int64           `json:"receptions" binding:"required"`
	Hashed       int64           `json:"hashed" binding:"required"`
	Empty        int64           `json:"empty" binding:"required"`
	Trace        int64           `json:"trace" binding:"required"`
	Unclassified int64           `json:"unclassified" binding:"required"`
	HashWidths   []PathHashWidth `json:"hashWidths" binding:"required"`
	PathLengths  []PathLengthBin `json:"pathLengths" binding:"required"`
	Hourly       []PathHour      `json:"hourly" binding:"required"`
}

type PathHashWidth struct {
	Bytes      int32 `json:"bytes" binding:"required"`
	Receptions int64 `json:"receptions" binding:"required"`
}

// PathLengthBin counts entries in validated ordinary header paths, including empty.
// Flood paths accumulate entries; direct paths contain remaining route entries.
// These counts cannot establish distance or a complete end-to-end hop count.
type PathLengthBin struct {
	Entries    int32 `json:"entries" binding:"required"`
	Receptions int64 `json:"receptions" binding:"required"`
}

// PathHour is a UTC hour clipped to the requested window. Missing hours are omitted.
type PathHour struct {
	Hour         int64 `json:"hour" binding:"required"`
	Receptions   int64 `json:"receptions" binding:"required"`
	OneByte      int64 `json:"oneByte" binding:"required"`
	TwoByte      int64 `json:"twoByte" binding:"required"`
	ThreeByte    int64 `json:"threeByte" binding:"required"`
	Empty        int64 `json:"empty" binding:"required"`
	Trace        int64 `json:"trace" binding:"required"`
	Unclassified int64 `json:"unclassified" binding:"required"`
}
