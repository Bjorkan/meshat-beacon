// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

// SignalStats describes a materialized reception snapshot in [Since, Until).
// Since and Until are the effective UTC-hour boundaries, rounded down from input.
// A reception is a stored observation, not a unique packet or a lost-packet estimate.
type SignalStats struct {
	Since      int64        `json:"since" binding:"required"`
	Until      int64        `json:"until" binding:"required"`
	Receptions int64        `json:"receptions" binding:"required"`
	SNR        SignalMetric `json:"snr" binding:"required"`
	RSSI       SignalMetric `json:"rssi" binding:"required"`
	Hourly     []SignalHour `json:"hourly" binding:"required"`
}

// SignalMetric counts available finite samples; Average is null without samples.
type SignalMetric struct {
	Samples   int64       `json:"samples" binding:"required"`
	Average   *float64    `json:"average" binding:"required" extensions:"x-nullable"`
	Histogram []SignalBin `json:"histogram" binding:"required"`
}

// SignalBin includes Lower and excludes Upper. Null denotes an unbounded end.
// SNR uses 5 dB bins from -30 to 30; RSSI uses 10 dBm bins from -140 to 0,
// both with underflow and overflow bins. These are display bins, not quality ratings.
type SignalBin struct {
	Lower *float64 `json:"lower" binding:"required" extensions:"x-nullable"`
	Upper *float64 `json:"upper" binding:"required" extensions:"x-nullable"`
	Count int64    `json:"count" binding:"required"`
}

// SignalHour is a complete UTC bucket in the effective window. Missing hours are omitted.
type SignalHour struct {
	Hour        int64    `json:"hour" binding:"required"`
	Receptions  int64    `json:"receptions" binding:"required"`
	SNRSamples  int64    `json:"snrSamples" binding:"required"`
	SNRAverage  *float64 `json:"snrAverage" binding:"required" extensions:"x-nullable"`
	RSSISamples int64    `json:"rssiSamples" binding:"required"`
	RSSIAverage *float64 `json:"rssiAverage" binding:"required" extensions:"x-nullable"`
}
