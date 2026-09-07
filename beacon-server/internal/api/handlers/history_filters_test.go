// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
)

func TestHistoryFiltersRejectInvalidInput(t *testing.T) {
	for _, tc := range []struct {
		path    string
		handler func(api.Reader) http.HandlerFunc
	}{
		{"/traces?since=tomorrow", listTraceTags},
		{"/traces?until=1.5", listTraceTags},
		{"/traces?cursor=overflow99999999999999999999999", listTraceTags},
		{"/traces?since=2000&until=1000", listTraceTags},
		{"/traces?type=TYPO", listTraceTags},
		{"/routes?hopCount=two", listKnownRoutes},
		{"/routes?hopCount=-1", listKnownRoutes},
		{"/routes?hopCount=2147483648", listKnownRoutes},
		{"/routes?cursor=bad", listKnownRoutes},
	} {
		t.Run(tc.path, func(t *testing.T) {
			called := false
			reader := stubReader{
				listTraceTags: func(context.Context, []string, string, string, time.Time, time.Time, time.Time, int32) ([]api.TraceTagSummary, error) {
					called = true
					return nil, nil
				},
				listKnownRoutes: func(context.Context, api.RouteListParams) (api.Page[api.KnownRoute], error) {
					called = true
					return api.Page[api.KnownRoute]{}, nil
				},
			}
			w := httptest.NewRecorder()
			tc.handler(reader).ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
			if w.Code != 400 || called {
				t.Fatalf("status %d, reader called %v; expected 400 without a database query", w.Code, called)
			}
		})
	}
}

func TestHistoryFiltersPreserveValidValues(t *testing.T) {
	called := false
	reader := stubReader{listTraceTags: func(_ context.Context, _ []string, scope, kind string, since, until, cursor time.Time, limit int32) ([]api.TraceTagSummary, error) {
		called = true
		if scope != "" || kind != "PING" || since.UnixMilli() != 1000 || until.UnixMilli() != 2000 || cursor.UnixMilli() != 1500 || limit != 50 {
			t.Fatalf("unexpected filters %s %s %v %v %v %d", scope, kind, since, until, cursor, limit)
		}
		return []api.TraceTagSummary{}, nil
	}}
	w := httptest.NewRecorder()
	listTraceTags(reader).ServeHTTP(w, httptest.NewRequest("GET", "/traces?type=ping&since=1000&until=2000&cursor=1500", nil))
	if w.Code != 200 || !called {
		t.Fatalf("status %d called %v", w.Code, called)
	}
	reader = stubReader{listKnownRoutes: func(_ context.Context, p api.RouteListParams) (api.Page[api.KnownRoute], error) {
		if p.HopCount != 3 || p.LegacyCursor.UnixMilli() != 1500 {
			t.Fatalf("unexpected filters %+v", p)
		}
		return api.Page[api.KnownRoute]{}, nil
	}}
	w = httptest.NewRecorder()
	listKnownRoutes(reader).ServeHTTP(w, httptest.NewRequest("GET", "/routes?hopCount=3&cursor=1500", nil))
	if w.Code != 200 {
		t.Fatalf("status %d", w.Code)
	}
}
