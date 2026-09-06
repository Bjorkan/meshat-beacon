// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestListEndpointsRejectUnsafeLimits(t *testing.T) {
	r := chi.NewRouter()
	reader := stubReader{}
	r.Mount("/packets", PacketsRouter(reader))
	r.Mount("/nodes", NodesRouter(reader))
	r.Mount("/observers", ObserversRouter(reader))
	r.Mount("/channels", ChannelsRouter(reader))
	r.Mount("/messages", MessagesRouter(reader))
	r.Mount("/routes", RoutesRouter(reader))
	r.Mount("/traces", TracesRouter(reader))
	r.Mount("/stats", StatsRouter(reader))
	for _, path := range []string{
		"/packets?", "/packets/backfill?afterObservationId=1&", "/nodes?",
		"/nodes/00000000-0000-0000-0000-000000000001/observations?",
		"/observers?", "/observers/00000000-0000-0000-0000-000000000001/adverts?",
		"/channels?", "/channels/1/messages?", "/messages?", "/messages/backfill?afterId=1&",
		"/routes?", "/traces?", "/stats/top-nodes?", "/stats/top-observers?",
		"/stats/top-advertisers?", "/stats/top-talkers?", "/stats/clock-drift?",
	} {
		for _, limit := range []string{"-1", "0", "1001", "2147483647", "garbage"} {
			t.Run(path+limit, func(t *testing.T) {
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path+"limit="+limit, nil))
				if w.Code != http.StatusBadRequest {
					t.Fatalf("expected 400, got %d", w.Code)
				}
			})
		}
	}
}

func TestResultLimitBoundaries(t *testing.T) {
	for _, tc := range []struct {
		query string
		want  int32
	}{{"", 50}, {"?limit=1", 1}, {"?limit=1000", 1000}} {
		got, err := parseResultLimit(httptest.NewRequest(http.MethodGet, "/"+tc.query, nil), 50)
		if err != nil || got != tc.want {
			t.Errorf("%s: got %d, %v; want %d", tc.query, got, err, tc.want)
		}
	}
}
