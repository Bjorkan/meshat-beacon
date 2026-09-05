// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package meshmapper fetches MeshMapper Coverage API grid data server-side,
// validates it, and caches it in memory. The API key never leaves the server:
// it is read from the MESH_MAPPER_COVERAGE_API_KEY environment variable and is
// never logged, never returned, and never sent to browsers.
//
// Design constraints (see MESHMAPPER_COVERAGE.md):
//   - Regional keys allow 100 requests/day, and even 304s and cache hits count.
//   - Upstream caches ~15 min; Beacon polls at most every 15 min and reuses ETags.
//   - The grid carries no per-repeater association: this provider serves overall
//     effective coverage + ping age only.
package meshmapper

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
)

const endpoint = "https://meshmapper.net/coverage.php"

// pollInterval mirrors the upstream ~15 min cache: polling faster returns
// identical data while burning the 100/day budget.
const pollInterval = 15 * time.Minute

const httpTimeout = 30 * time.Second

// maxCellsPerResponse caps a single /coverage response. The full SWE grid is
// ~85k cells / ~26 MB decoded; clients should pass a viewport bbox and zoom
// in for full detail. Sampling prefers colored cells (effective > 0) over
// DROP cells, so a country-wide zoom still shows the colored mesh.
const maxCellsPerResponse = 20000

// maxBodyBytes bounds the decoded payload: the SWE region is ~26 MB decoded
// today; 256 MB leaves headroom without risking unbounded memory.
const maxBodyBytes = 256 << 20

var validCoverageTypes = map[string]bool{
	"BIDIR": true, "TX": true, "RX": true, "DISC": true, "DEAD": true, "DROP": true,
}

type upstreamBounds struct {
	South float64 `json:"south"`
	West  float64 `json:"west"`
	North float64 `json:"north"`
	East  float64 `json:"east"`
}

type upstreamCell struct {
	GridID       string         `json:"grid_id"`
	Bounds       upstreamBounds `json:"bounds"`
	CoverageType string         `json:"coverage_type"`
	Effective    float64        `json:"effective"`
	Count        int            `json:"count"`
	Timestamp    *int64         `json:"timestamp"`
	FirstSeen    *int64         `json:"first_seen"`
	SNR          *float64       `json:"snr"`
	SNRMin       *float64       `json:"snr_min"`
	SNRMax       *float64       `json:"snr_max"`
	StatusMask   int            `json:"status_mask"`
}

type upstreamResponse struct {
	Success          bool           `json:"success"`
	Region           string         `json:"region"`
	GeneratedAt      int64          `json:"generated_at"`
	DataAgeSeconds   *int64         `json:"data_age_seconds"`
	TotalSquares     int            `json:"total_squares"`
	PointCount       int64          `json:"point_count"`
	CoverageTypeCnts map[string]int `json:"coverage_type_counts"`
	GridSquares      []upstreamCell `json:"grid_squares"`
}

type snapshot struct {
	resp      api.CoverageResponse
	fetchedAt time.Time
	etag      string
}

// Provider fetches and caches MeshMapper coverage. Use New; a nil apiKey
// disables the provider (coverage endpoint reports disabled, no upstream
// calls are ever made). Fetch is injectable for tests.
type Provider struct {
	apiKey string
	region string
	client *http.Client
	fetch  func(ctx context.Context, url, etag string) (status int, body []byte, newETag string, err error)
	mu     sync.RWMutex
	cached *snapshot
}

// New builds a Provider. Empty apiKey disables it.
func New(apiKey, region string) *Provider {
	return &Provider{
		apiKey: apiKey,
		region: region,
		client: &http.Client{Timeout: httpTimeout},
	}
}

// NewForTest builds a Provider whose upstream is the given raw JSON body.
// Exported for handler tests; production code uses New.
func NewForTest(body string) *Provider {
	p := &Provider{apiKey: "test", region: "SWE", client: &http.Client{Timeout: httpTimeout}}
	raw := body
	p.fetch = func(_ context.Context, _ string, _ string) (int, []byte, string, error) {
		return http.StatusOK, []byte(raw), `"test-etag"`, nil
	}
	return p
}

// Enabled reports whether an API key is configured.
func (p *Provider) Enabled() bool { return p.apiKey != "" }

// Get returns cached coverage, refreshing from upstream when stale.
// Callers pass bbox (minLat, minLon, maxLat, maxLon); nil bbox returns all
// cells. Filtering is server-side since upstream ignores bbox params.
func (p *Provider) Get(ctx context.Context, bbox *[4]float64) (api.CoverageResponse, bool, error) {
	if !p.Enabled() {
		return api.CoverageResponse{Disabled: true}, false, nil
	}
	p.mu.RLock()
	snap := p.cached
	p.mu.RUnlock()
	if snap == nil || time.Since(snap.fetchedAt) >= pollInterval {
		fresh, changed, err := p.refresh(ctx, snap)
		if err != nil {
			// Serve stale on transient upstream failure rather than 500ing the map.
			if snap != nil {
				return filterCells(snap.resp, bbox, true), true, nil
			}
			return api.CoverageResponse{}, false, err
		}
		if changed {
			snap = fresh
		} else if snap != nil {
			// 304: upstream unchanged; extend freshness without replacing data.
			p.mu.Lock()
			if p.cached != nil {
				p.cached.fetchedAt = time.Now()
			}
			snap = p.cached
			p.mu.Unlock()
		}
	}
	if snap == nil {
		return api.CoverageResponse{}, false, fmt.Errorf("meshmapper: no coverage available")
	}
	return filterCells(snap.resp, bbox, true), true, nil
}

// Status reports provider health for logs/debugging (no secrets).
func (p *Provider) Status() (enabled bool, cells int, age time.Duration) {
	p.mu.RLock()
	defer p.mu.RUnlock()
	if !p.Enabled() || p.cached == nil {
		return p.Enabled(), 0, 0
	}
	return true, p.cached.resp.TotalSquares, time.Since(p.cached.fetchedAt)
}

func filterCells(resp api.CoverageResponse, bbox *[4]float64, cached bool) api.CoverageResponse {
	out := resp
	out.Cached = cached
	if bbox == nil {
		return out
	}
	minLat, minLon, maxLat, maxLon := bbox[0], bbox[1], bbox[2], bbox[3]
	var colored []api.CoverageCell
	var drops []api.CoverageCell
	for _, c := range out.Cells {
		// Keep cells intersecting the bbox (bounds overlap, not center-in-box,
		// so edge cells at the viewport rim still draw).
		if c.Bounds.North < minLat || c.Bounds.South > maxLat ||
			c.Bounds.East < minLon || c.Bounds.West > maxLon {
			continue
		}
		if c.CoverageType == "DROP" || c.Effective <= 0 {
			drops = append(drops, c)
		} else {
			colored = append(colored, c)
		}
	}
	// Over budget: colored cells first (they render visible color), DROP cells
	// only top up the remainder. Interleave so a country-wide zoom shows the
	// mesh spread across the viewport instead of one corner.
	kept := make([]api.CoverageCell, 0, maxCellsPerResponse)
	di, ci := 0, 0
	for len(kept) < maxCellsPerResponse && (ci < len(colored) || di < len(drops)) {
		if ci < len(colored) {
			kept = append(kept, colored[ci])
			ci++
		}
		if len(kept) >= maxCellsPerResponse {
			break
		}
		if di < len(drops) {
			kept = append(kept, drops[di])
			di++
		}
	}
	out.Cells = kept
	out.TotalSquares = len(kept)
	return out
}

func (p *Provider) refresh(ctx context.Context, snap *snapshot) (*snapshot, bool, error) {
	var etag string
	if snap != nil {
		etag = snap.etag
	}
	var status int
	var body []byte
	var newETag string
	var err error
	if p.fetch != nil {
		status, body, newETag, err = p.fetch(ctx, endpoint+"?key="+p.apiKey, etag)
	} else {
		status, body, newETag, err = p.doFetch(ctx, etag)
	}
	if err != nil {
		return nil, false, err
	}
	if status == http.StatusNotModified {
		return nil, false, nil
	}
	if status != http.StatusOK {
		return nil, false, fmt.Errorf("meshmapper: upstream status %d", status)
	}
	up, err := parseAndValidate(body)
	if err != nil {
		return nil, false, err
	}
	now := time.Now()
	resp := toCoverageResponse(up, p.region, now)
	fresh := &snapshot{resp: resp, fetchedAt: now, etag: newETag}
	p.mu.Lock()
	p.cached = fresh
	p.mu.Unlock()
	return fresh, true, nil
}

func (p *Provider) doFetch(ctx context.Context, etag string) (int, []byte, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?key="+p.apiKey, nil)
	if err != nil {
		return 0, nil, "", err
	}
	// Ask for gzip explicitly; Go adds it by default only when unhandled.
	// Explicit here documents the ~9x saving expectation.
	req.Header.Set("Accept-Encoding", "gzip")
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return 0, nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNotModified {
		return resp.StatusCode, nil, etag, nil
	}
	var reader io.Reader = resp.Body
	if resp.Header.Get("Content-Encoding") == "gzip" {
		gz, err := gzip.NewReader(resp.Body)
		if err != nil {
			return 0, nil, "", err
		}
		defer gz.Close()
		reader = gz
	}
	limited := io.LimitReader(reader, maxBodyBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return 0, nil, "", err
	}
	if len(raw) > maxBodyBytes {
		return 0, nil, "", fmt.Errorf("meshmapper: response exceeds %d bytes", maxBodyBytes)
	}
	// Capture ETag before body validation so 200s with bad bodies still rotate it.
	return resp.StatusCode, raw, resp.Header.Get("ETag"), nil
}

func parseAndValidate(raw []byte) (*upstreamResponse, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	var up upstreamResponse
	if err := dec.Decode(&up); err != nil {
		return nil, fmt.Errorf("meshmapper: invalid JSON: %w", err)
	}
	if !up.Success {
		return nil, fmt.Errorf("meshmapper: upstream reported success=false")
	}
	if up.GridSquares == nil {
		return nil, fmt.Errorf("meshmapper: missing grid_squares")
	}
	for i, c := range up.GridSquares {
		if c.GridID == "" {
			return nil, fmt.Errorf("meshmapper: cell %d missing grid_id", i)
		}
		if !validCoverageTypes[c.CoverageType] {
			return nil, fmt.Errorf("meshmapper: cell %d unknown coverage_type %q", i, c.CoverageType)
		}
		if c.Effective < 0 || c.Effective > 3 {
			return nil, fmt.Errorf("meshmapper: cell %d effective out of range: %v", i, c.Effective)
		}
		if c.Bounds.North < c.Bounds.South || c.Bounds.East < c.Bounds.West {
			return nil, fmt.Errorf("meshmapper: cell %d has inverted bounds", i)
		}
	}
	return &up, nil
}

func toCoverageResponse(up *upstreamResponse, fallbackRegion string, now time.Time) api.CoverageResponse {
	region := up.Region
	if region == "" {
		region = fallbackRegion
	}
	cells := make([]api.CoverageCell, 0, len(up.GridSquares))
	for _, c := range up.GridSquares {
		cells = append(cells, api.CoverageCell{
			GridID:       c.GridID,
			Bounds:       api.CoverageCellBounds{South: c.Bounds.South, West: c.Bounds.West, North: c.Bounds.North, East: c.Bounds.East},
			CoverageType: c.CoverageType,
			Effective:    c.Effective,
			Count:        c.Count,
			Timestamp:    c.Timestamp,
			FirstSeen:    c.FirstSeen,
			SNR:          c.SNR,
			SNRMin:       c.SNRMin,
			SNRMax:       c.SNRMax,
			StatusMask:   c.StatusMask,
		})
	}
	return api.CoverageResponse{
		Region:         region,
		GeneratedAt:    now.UnixMilli(),
		PingAgeSeconds: up.DataAgeSeconds,
		TotalSquares:   len(cells),
		PointCount:     up.PointCount,
		TypeCounts:     up.CoverageTypeCnts,
		Cells:          cells,
		Cached:         false,
		UpstreamFresh:  true,
	}
}

var _ = log.Printf
