// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MeshCore-Beacon/beacon-server/internal/meshmapper"
	"github.com/go-chi/chi/v5"
)

const coverageTestCell = `{"grid_id":"1_1","bounds":{"south":59.0,"west":17.0,"north":59.01,"east":17.01},` +
	`"coverage_type":"BIDIR","effective":2.5,"count":10,"timestamp":1788636304,` +
	`"first_seen":1788600000,"snr":5.5,"status_mask":1}`

func coverageTestRouter(p *meshmapper.Provider) http.Handler {
	r := chi.NewRouter()
	r.Get("/coverage", getCoverage(p))
	return r
}

func TestGetCoverage_Disabled(t *testing.T) {
	p := meshmapper.New("", "SWE")
	req := httptest.NewRequest(http.MethodGet, "/coverage", nil)
	rec := httptest.NewRecorder()
	coverageTestRouter(p).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if resp["disabled"] != true {
		t.Fatalf("expected disabled:true, got %v", resp)
	}
}

func TestGetCoverage_BBoxValidation(t *testing.T) {
	p := meshmapper.New("", "SWE")
	for _, url := range []string{
		"/coverage?minLat=59",
		"/coverage?minLat=60&minLon=17&maxLat=59&maxLon=18",
		"/coverage?minLat=abc&minLon=17&maxLat=60&maxLon=18",
	} {
		req := httptest.NewRequest(http.MethodGet, url, nil)
		rec := httptest.NewRecorder()
		coverageTestRouter(p).ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: expected 400, got %d", url, rec.Code)
		}
	}
}

func TestGetCoverage_ServesCells(t *testing.T) {
	body := `{"success":true,"region":"SWE","total_squares":1,"point_count":10,` +
		`"data_age_seconds":300,"grid_squares":[` + coverageTestCell + `]}`
	p := meshmapper.NewForTest(body)
	req := httptest.NewRequest(http.MethodGet, "/coverage", nil)
	rec := httptest.NewRecorder()
	coverageTestRouter(p).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	cells, ok := resp["cells"].([]any)
	if !ok || len(cells) != 1 {
		t.Fatalf("expected 1 cell, got %v", resp["cells"])
	}
	cell := cells[0].(map[string]any)
	if cell["gridId"] != "1_1" || cell["coverageType"] != "BIDIR" {
		t.Fatalf("bad cell mapping: %v", cell)
	}
	if resp["pingAgeSeconds"] != float64(300) {
		t.Fatalf("expected pingAgeSeconds 300, got %v", resp["pingAgeSeconds"])
	}
}

func TestGetCoverage_BBoxFilters(t *testing.T) {
	body := `{"success":true,"region":"SWE","total_squares":1,"point_count":10,` +
		`"grid_squares":[` + coverageTestCell + `]}`
	p := meshmapper.NewForTest(body)
	// Cell sits at 59.0-59.01/17.0-17.01; query far away.
	req := httptest.NewRequest(http.MethodGet,
		"/coverage?minLat=55&minLon=11&maxLat=56&maxLon=12", nil)
	rec := httptest.NewRecorder()
	coverageTestRouter(p).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	var resp map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatal(err)
	}
	if n := resp["totalSquares"]; n != float64(0) {
		t.Fatalf("expected 0 cells outside bbox, got %v", n)
	}
}
