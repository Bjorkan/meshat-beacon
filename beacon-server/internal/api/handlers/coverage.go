// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"net/http"
	"strconv"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/meshmapper"
	"github.com/go-chi/chi/v5"
)

var _ = api.CoverageResponse{}

// CoverageRouter mounts the MeshMapper-backed coverage endpoint.
//
// GET /coverage → getCoverage
//
// Query params (all optional): minLat, minLon, maxLat, maxLon select a
// viewport bbox; filtering is server-side since upstream ignores bbox params.
// Without bbox the full regional grid is returned (large for SWE).
func CoverageRouter(provider *meshmapper.Provider) http.Handler {
	r := chi.NewRouter()
	r.Get("/", getCoverage(provider))
	return r
}

// getCoverage godoc
//
//	@Summary	MeshMapper coverage grid (effective quality + ping age)
//	@Tags		Coverage
//	@Produce	json
//	@Param		minLat	query		number	false	"Viewport south edge"
//	@Param		minLon	query		number	false	"Viewport west edge"
//	@Param		maxLat	query		number	false	"Viewport north edge"
//	@Param		maxLon	query		number	false	"Viewport east edge"
//	@Success	200		{object}	api.CoverageResponse
//	@Failure	502		{object}	handlers.APIError
//	@Router		/coverage [get]
func getCoverage(provider *meshmapper.Provider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		var bbox *[4]float64
		keys := []string{"minLat", "minLon", "maxLat", "maxLon"}
		vals := make([]float64, 4)
		any := false
		for i, k := range keys {
			raw := q.Get(k)
			if raw == "" {
				continue
			}
			v, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				respondError(w, http.StatusBadRequest, "invalid "+k)
				return
			}
			vals[i] = v
			any = true
		}
		if any {
			// Require the full box; a partial box is a client bug, fail loudly.
			for i, k := range keys {
				if q.Get(k) == "" {
					respondError(w, http.StatusBadRequest, "missing "+k)
					return
				}
				_ = i
			}
			if vals[2] < vals[0] || vals[3] < vals[1] {
				respondError(w, http.StatusBadRequest, "inverted bbox")
				return
			}
			bbox = &[4]float64{vals[0], vals[1], vals[2], vals[3]}
		}
		resp, ok, err := provider.Get(r.Context(), bbox)
		if err != nil {
			respondError(w, http.StatusBadGateway, "coverage unavailable")
			return
		}
		if !ok && resp.Disabled {
			respond(w, http.StatusOK, resp)
			return
		}
		respond(w, http.StatusOK, resp)
	}
}
