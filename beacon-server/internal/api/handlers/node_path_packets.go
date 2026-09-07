// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// listNodePathPackets godoc
// @Summary List packets reliably routed through a node (TRACE excluded)
// @Description Matches boundary-aligned hops with globally high-confidence identity. Observations are region-filtered and packets deduplicated. Snapshot cursors keep pagination stable as traffic arrives.
// @Tags Nodes
// @Produce json
// @Param nodeId path string true "Node UUID"
// @Param iatas query string false "Comma-separated IATA codes"
// @Param regionId query int false "Region ID, expands to member IATAs"
// @Param region query string false "Region slug, expands to member IATAs"
// @Param pageToken query string false "Opaque cursor returned as nextPageToken"
// @Param limit query int false "Max results (1-1000, default 50)"
// @Success 200 {object} api.Page[api.PacketSummary]
// @Failure 400 {object} handlers.APIError
// @Failure 404 {object} handlers.APIError
// @Failure 500 {object} handlers.APIError
// @Router /nodes/{nodeId}/path-packets [get]
func listNodePathPackets(reader api.Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id, err := uuid.Parse(chi.URLParam(r, "nodeId"))
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid node ID")
			return
		}
		iatas := parseIATAs(r)
		if regionID := r.URL.Query().Get("regionId"); regionID != "" || r.URL.Query().Get("region") != "" {
			codes, err := resolveRegionIATAs(r.Context(), regionID, r.URL.Query().Get("region"), reader)
			if err != nil {
				respondError(w, http.StatusBadRequest, err.Error())
				return
			}
			iatas = append(iatas, codes...)
		}
		limit, err := parseResultLimit(r, 50)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		cursor, err := api.DecodePageToken(r.URL.Query().Get("pageToken"))
		if err != nil {
			respondError(w, http.StatusBadRequest, "invalid pageToken")
			return
		}
		if cursor != nil {
			snapshot, err := strconv.ParseInt(cursor.Key, 10, 64)
			if err != nil || snapshot < cursor.NumericID || cursor.NumericID <= 0 || cursor.ID != id || cursor.Collection != api.NodePathCollection(iatas) || cursor.Sort != "first_match" || cursor.Direction != api.SortDesc {
				respondError(w, http.StatusBadRequest, "pageToken does not match node and region")
				return
			}
		}
		page, err := reader.ListNodePathPackets(r.Context(), id, iatas, cursor, limit)
		if errors.Is(err, pgx.ErrNoRows) {
			respondError(w, http.StatusNotFound, "node not found")
			return
		}
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		respond(w, http.StatusOK, page)
	}
}
