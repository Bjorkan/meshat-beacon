// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
)

// RoutesRouter mounts all /routes routes onto a subrouter.
//
// GET /routes          → listKnownRoutes
// GET /routes/search   → searchKnownRoutes
// GET /routes/best     → bestRoute
func RoutesRouter(reader api.Reader) http.Handler {
	r := chi.NewRouter()
	r.Get("/", listKnownRoutes(reader))
	r.Get("/best", bestRoute(reader))
	r.Get("/cross", searchCrossIATARoutes(reader))
	r.Get("/search", searchKnownRoutes(reader))
	return r
}

// listKnownRoutes godoc
//
//	@Summary	List known routes
//	@Tags		Routes
//	@Produce	json
//	@Param		iata		query		string	false	"Filter by IATA code (legacy singular form)"
//	@Param		iatas		query		string	false	"Filter by IATA codes, comma-separated"
//	@Param		hopCount	query		int		false	"Filter by exact hop count"
//	@Param		cursor		query		int		false	"Epoch ms timestamp of last item for pagination"
//	@Param		pageToken	query		string	false	"Opaque keyset cursor returned as nextPageToken"
//	@Param		sort		query		string	false	"Sort by iata, hops, observations, first_seen or last_seen"
//	@Param		direction	query		string	false	"Sort direction: asc or desc"
//	@Param		limit		query		int		false	"Max results (1-1000, default 50)"
//	@Success	200			{object}	api.Page[api.KnownRoute]
//	@Failure	400			{object}	handlers.APIError
//	@Failure	500			{object}	handlers.APIError
//	@Router		/routes [get]
func listKnownRoutes(reader api.Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sort, direction, pageToken, err := parseSortablePage(r, api.PageCollectionRoutes, api.RouteSortLastSeen, api.SortDesc, api.ValidRouteSort)
		if err != nil {
			respondError(w, http.StatusBadRequest, err.Error())
			return
		}
		iatas := parseIATAs(r)
		var hopCount int32
		if v := r.URL.Query().Get("hopCount"); v != "" {
			h, err := strconv.ParseInt(v, 10, 32)
			if err != nil || h < 0 {
				respondError(w, http.StatusBadRequest, "invalid hopCount, expected a non-negative integer")
				return
			}
			hopCount = int32(h)
		}
		var cursor time.Time
		if v := r.URL.Query().Get("cursor"); v != "" {
			ms, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				respondError(w, http.StatusBadRequest, "invalid cursor, expected epoch milliseconds")
				return
			}
			cursor = time.UnixMilli(ms)
		}
		limit, limitErr := parseResultLimit(r, 50)
		if limitErr != nil {
			respondError(w, http.StatusBadRequest, limitErr.Error())
			return
		}
		routes, err := reader.ListKnownRoutes(r.Context(), api.RouteListParams{
			IATAs: iatas, HopCount: hopCount, LegacyCursor: cursor, PageToken: pageToken,
			Sort: sort, Direction: direction, Limit: limit,
		})
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		respond(w, http.StatusOK, routes)
	}
}

// bestRoute godoc
//
//	@Summary	Plan the best route between two nodes
//	@Description	Computes best-first repeater routes between two repeater nodes over the observed neighbor graph, preferring legs with strong signal and unambiguously proven traffic history (exact identity or 2+ byte hashes resolving to one node; 1-byte evidence never discounts). A hop no packet ever crossed in its direction pays a large extra penalty and is flagged unseen ("unconfirmed possible"). Unmeasured legs pay a configured penalty discounted by passed-packet evidence but are still used, so the graph never fragments. Every node in a returned path is a repeater with coordinates. Non-repeater endpoints are rejected with 400. An unroutable pair returns 200 with an empty paths array and a reason, never an error.
//	@Tags		Routes
//	@Produce	json
//	@Param		from			query		string	true	"Source repeater full public key (hex)"
//	@Param		to				query		string	true	"Destination repeater full public key (hex)"
//	@Param		alternatives	query		int		false	"Alternatives beyond the best path (0-2, default 2)"
//	@Success	200				{object}	api.BestRouteResult
//	@Failure	400				{object}	handlers.APIError
//	@Failure	404				{object}	handlers.APIError
//	@Failure	422				{object}	handlers.APIError
//	@Failure	500				{object}	handlers.APIError
//	@Router		/routes/best [get]
func bestRoute(reader api.Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fromHex := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("from")))
		toHex := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("to")))
		if fromHex == "" || toHex == "" {
			respondError(w, http.StatusBadRequest, "from and to are required (full node public keys, hex)")
			return
		}
		fromBytes, err := hex.DecodeString(fromHex)
		if err != nil || len(fromBytes) != 32 {
			respondError(w, http.StatusBadRequest, "from must be a full node public key (64 hex characters)")
			return
		}
		toBytes, err := hex.DecodeString(toHex)
		if err != nil || len(toBytes) != 32 {
			respondError(w, http.StatusBadRequest, "to must be a full node public key (64 hex characters)")
			return
		}
		alternatives := 2
		if v := r.URL.Query().Get("alternatives"); v != "" {
			n, err := strconv.Atoi(v)
			if err != nil || n < 0 || n > 2 {
				respondError(w, http.StatusBadRequest, "alternatives must be an integer 0-2")
				return
			}
			alternatives = n
		}
		// The planner is repeater-only end-to-end (MeshCore repeater routes):
		// reject non-repeater endpoints with 400 before planning. The API can
		// be called directly and route URLs can be manipulated, so this stays
		// server-side even though the frontend picker filters to repeaters.
		for _, ep := range []struct {
			name   string
			pubkey []byte
		}{{"from", fromBytes}, {"to", toBytes}} {
			ntype, err := reader.GetNodeTypeByPubkey(r.Context(), ep.pubkey)
			if err != nil {
				respondError(w, http.StatusInternalServerError, "internal server error")
				return
			}
			if ntype == nil {
				respondError(w, http.StatusNotFound, "unknown "+ep.name+" node")
				return
			}
			if *ntype != 2 {
				respondError(w, http.StatusBadRequest, ep.name+" must be a repeater node for route planning")
				return
			}
		}
		// Pubkeys are globally unique: resolve both to node IDs first so the
		// planner works on stable identities and can 404 unknown keys.
		fromID, err := reader.GetNodeIDByPubkey(r.Context(), fromBytes)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if fromID == nil {
			respondError(w, http.StatusNotFound, "unknown from node")
			return
		}
		toID, err := reader.GetNodeIDByPubkey(r.Context(), toBytes)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if toID == nil {
			respondError(w, http.StatusNotFound, "unknown to node")
			return
		}
		result, err := reader.PlanBestRoute(r.Context(), *fromID, *toID, alternatives)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if result.Paths == nil {
			result.Paths = []api.PlannedRoute{}
		}
		if len(result.Paths) == 0 && result.Reason == "endpoint-missing-position" {
			respondError(w, http.StatusUnprocessableEntity, "one of the nodes has no known position and cannot be drawn on the map")
			return
		}
		respond(w, http.StatusOK, result)
	}
}

// @Summary	Search known routes by source and destination hash
// @Tags		Routes
// @Produce	json
// @Param		iata	query		string	true	"IATA code to search within"
// @Param		from	query		string	true	"Source node hash prefix (hex)"
// @Param		to		query		string	true	"Destination node hash prefix (hex)"
// @Success	200		{object}	[]api.KnownRoute
// @Failure	400		{object}	handlers.APIError
// @Failure	500		{object}	handlers.APIError
// @Router		/routes/search [get]
func searchKnownRoutes(reader api.Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		iata := strings.ToUpper(r.URL.Query().Get("iata"))
		from := strings.ToLower(r.URL.Query().Get("from"))
		to := strings.ToLower(r.URL.Query().Get("to"))
		if iata == "" || from == "" || to == "" {
			respondError(w, http.StatusBadRequest, "iata, from and to are required")
			return
		}
		routes, err := reader.SearchKnownRoutes(r.Context(), iata, from, to)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		respond(w, http.StatusOK, routes)
	}
}

// searchCrossIATARoutes godoc
//
//	@Summary	Search for routes that cross IATA boundaries
//	@Tags		Routes
//	@Produce	json
//	@Param		fromHash	query		string	true	"Source node hash prefix (hex)"
//	@Param		fromIata	query		string	true	"Source IATA code"
//	@Param		toHash		query		string	true	"Destination node hash prefix (hex)"
//	@Param		toIata		query		string	true	"Destination IATA code"
//	@Success	200			{object}	[]api.CrossIATARoute
//	@Failure	400			{object}	handlers.APIError
//	@Failure	500			{object}	handlers.APIError
//	@Router		/routes/cross [get]
func searchCrossIATARoutes(reader api.Reader) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		fromHash := strings.ToLower(r.URL.Query().Get("fromHash"))
		fromIATA := strings.ToUpper(r.URL.Query().Get("fromIata"))
		toHash := strings.ToLower(r.URL.Query().Get("toHash"))
		toIATA := strings.ToUpper(r.URL.Query().Get("toIata"))
		if fromHash == "" || fromIATA == "" || toHash == "" || toIATA == "" {
			respondError(w, http.StatusBadRequest, "fromHash, fromIata, toHash and toIata are required")
			return
		}
		routes, err := reader.SearchCrossIATARoutes(r.Context(), fromHash, fromIATA, toHash, toIATA)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if routes == nil {
			routes = []api.CrossIATARoute{}
		}
		respond(w, http.StatusOK, routes)
	}
}
