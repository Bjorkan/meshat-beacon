// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package meshmapper

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func sampleUpstream(t *testing.T, cells int) []byte {
	t.Helper()
	squares := make([]upstreamCell, 0, cells)
	for i := 0; i < cells; i++ {
		ts := int64(1788636304)
		squares = append(squares, upstreamCell{
			GridID:       "1_1",
			Bounds:       upstreamBounds{South: 59.0, West: 17.0, North: 59.01, East: 17.01},
			CoverageType: "BIDIR",
			Effective:    2.5,
			Count:        10,
			Timestamp:    &ts,
			StatusMask:   1,
		})
	}
	raw, err := json.Marshal(upstreamResponse{
		Success: true, Region: "SWE", TotalSquares: cells,
		GridSquares: squares,
	})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestDisabledWithoutKey(t *testing.T) {
	p := New("", "SWE")
	if p.Enabled() {
		t.Fatal("expected disabled provider")
	}
	resp, ok, err := p.Get(context.Background(), nil)
	if err != nil || ok || !resp.Disabled {
		t.Fatalf("expected disabled response, got %+v %v %v", resp, ok, err)
	}
}

func TestFetchValidateAndCache(t *testing.T) {
	raw := sampleUpstream(t, 3)
	calls := 0
	p := New("k", "SWE")
	p.fetch = func(_ context.Context, url, etag string) (int, []byte, string, error) {
		calls++
		return http.StatusOK, raw, `"etag-1"`, nil
	}
	resp, ok, err := p.Get(context.Background(), nil)
	if err != nil || !ok {
		t.Fatalf("unexpected: %v %v", err, ok)
	}
	if resp.TotalSquares != 3 || len(resp.Cells) != 3 {
		t.Fatalf("expected 3 cells, got %+v", resp)
	}
	if resp.Cells[0].CoverageType != "BIDIR" || resp.Cells[0].Effective != 2.5 {
		t.Fatalf("bad cell mapping: %+v", resp.Cells[0])
	}
	// Second call within poll interval must not refetch.
	if _, _, err := p.Get(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatalf("expected 1 upstream call, got %d", calls)
	}
}

func Test304KeepsCache(t *testing.T) {
	raw := sampleUpstream(t, 2)
	p := New("k", "SWE")
	p.fetch = func(_ context.Context, url, etag string) (int, []byte, string, error) {
		if etag == "" {
			return http.StatusOK, raw, `"e1"`, nil
		}
		return http.StatusNotModified, nil, etag, nil
	}
	if _, _, err := p.Get(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	// Force staleness by backdating, then expect a 304 path that keeps cells.
	p.mu.Lock()
	p.cached.fetchedAt = time.Now().Add(-time.Hour)
	p.mu.Unlock()
	resp, ok, err := p.Get(context.Background(), nil)
	if err != nil || !ok || len(resp.Cells) != 2 {
		t.Fatalf("expected cached cells via 304, got %+v %v %v", resp, ok, err)
	}
}

func TestStaleServedOnError(t *testing.T) {
	raw := sampleUpstream(t, 1)
	p := New("k", "SWE")
	first := true
	p.fetch = func(_ context.Context, url, etag string) (int, []byte, string, error) {
		if first {
			first = false
			return http.StatusOK, raw, `"e1"`, nil
		}
		return http.StatusInternalServerError, nil, "", nil
	}
	if _, _, err := p.Get(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	p.mu.Lock()
	p.cached.fetchedAt = time.Now().Add(-time.Hour)
	p.mu.Unlock()
	// Upstream 500 with warm cache must still serve stale cells, not error.
	resp, ok, err := p.Get(context.Background(), nil)
	if err != nil || !ok || len(resp.Cells) != 1 {
		t.Fatalf("expected stale cells, got %+v %v %v", resp, ok, err)
	}
}

func TestValidationRejectsGarbage(t *testing.T) {
	for name, body := range map[string]string{
		"bad json":    `{oops`,
		"no success":  `{"success":false,"grid_squares":[]}`,
		"no squares":  `{"success":true}`,
		"bad type":    `{"success":true,"grid_squares":[{"grid_id":"a","coverage_type":"NOPE","effective":1,"bounds":{}}]}`,
		"bad quality": `{"success":true,"grid_squares":[{"grid_id":"a","coverage_type":"BIDIR","effective":9,"bounds":{}}]}`,
		"bad bounds":  `{"success":true,"grid_squares":[{"grid_id":"a","coverage_type":"BIDIR","effective":1,"bounds":{"south":2,"north":1,"west":0,"east":1}}]}`,
	} {
		if _, err := parseAndValidate([]byte(body)); err == nil {
			t.Fatalf("%s: expected validation error", name)
		}
	}
}

func TestBboxFilter(t *testing.T) {
	raw := sampleUpstream(t, 4)
	p := New("k", "SWE")
	p.fetch = func(_ context.Context, url, etag string) (int, []byte, string, error) {
		return http.StatusOK, raw, `"e"`, nil
	}
	// All sample cells sit at 59.0-59.01 / 17.0-17.01.
	inBox := &[4]float64{58.9, 16.9, 59.1, 17.1}
	resp, _, err := p.Get(context.Background(), inBox)
	if err != nil || len(resp.Cells) != 4 {
		t.Fatalf("expected 4 cells in bbox, got %+v %v", resp, err)
	}
	outBox := &[4]float64{55.0, 11.0, 56.0, 12.0}
	resp, _, err = p.Get(context.Background(), outBox)
	if err != nil || len(resp.Cells) != 0 {
		t.Fatalf("expected 0 cells outside bbox, got %+v %v", resp, err)
	}
}

func TestOverBudgetPrefersColoredCells(t *testing.T) {
	// 3 DROP cells then 1 BIDIR: with a cap of maxCellsPerResponse the BIDIR
	// cell must survive via the DROP-swap, not be cut off.
	squares := []upstreamCell{
		{GridID: "d1", Bounds: upstreamBounds{South: 59, West: 17, North: 59.1, East: 17.1}, CoverageType: "DROP", Effective: 0, StatusMask: 32},
		{GridID: "d2", Bounds: upstreamBounds{South: 59, West: 17, North: 59.1, East: 17.1}, CoverageType: "DROP", Effective: 0, StatusMask: 32},
		{GridID: "c1", Bounds: upstreamBounds{South: 59, West: 17, North: 59.1, East: 17.1}, CoverageType: "BIDIR", Effective: 3, StatusMask: 1},
	}
	raw, _ := json.Marshal(upstreamResponse{Success: true, Region: "SWE", GridSquares: squares})
	p := New("k", "SWE")
	p.fetch = func(_ context.Context, url, etag string) (int, []byte, string, error) {
		return http.StatusOK, raw, `"e"`, nil
	}
	box := &[4]float64{58.9, 16.9, 59.2, 17.2}
	resp, _, err := p.Get(context.Background(), box)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, c := range resp.Cells {
		if c.GridID == "c1" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected BIDIR cell c1 to survive sampling, got %+v", resp.Cells)
	}
}
