// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

func bestRouter(r stubReader) http.Handler {
	rt := chi.NewRouter()
	rt.Get("/routes/best", bestRoute(r))
	return rt
}

func decodeBest(t *testing.T, w *httptest.ResponseRecorder) api.BestRouteResult {
	t.Helper()
	var out api.BestRouteResult
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode best result: %v", err)
	}
	return out
}

func TestBestRoute_Validation(t *testing.T) {
	r := bestRouter(stubReader{})
	cases := map[string]int{
		"/routes/best":                                   http.StatusBadRequest, // missing from/to
		"/routes/best?from=zz&to=aabb":                   http.StatusBadRequest, // non-hex from
		"/routes/best?from=aabb&to=zz":                   http.StatusBadRequest, // non-hex to
		"/routes/best?from=aabb&to=ccdd&alternatives=5":  http.StatusBadRequest, // out of range
		"/routes/best?from=aabb&to=ccdd&alternatives=no": http.StatusBadRequest,
		"/routes/best?from=aabb&to=ccdd&alternatives=-1": http.StatusBadRequest,
	}
	for target, want := range cases {
		req := httptest.NewRequest(http.MethodGet, target, nil)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != want {
			t.Errorf("%s: expected %d, got %d", target, want, w.Code)
		}
	}
}

func TestBestRoute_UnknownFrom404(t *testing.T) {
	r := bestRouter(stubReader{
		getNodeIDByPubkey: func(context.Context, []byte) (*uuid.UUID, error) {
			return nil, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/routes/best?from=aabb&to=ccdd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestBestRoute_UnknownTo404(t *testing.T) {
	from := uuid.New()
	r := bestRouter(stubReader{
		getNodeIDByPubkey: func(_ context.Context, pubkey []byte) (*uuid.UUID, error) {
			if len(pubkey) == 2 && pubkey[0] == 0xaa {
				return &from, nil
			}
			return nil, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/routes/best?from=aabb&to=ccdd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", w.Code)
	}
}

func TestBestRoute_NoRoute200Empty(t *testing.T) {
	from, to := uuid.New(), uuid.New()
	r := bestRouter(stubReader{
		getNodeIDByPubkey: func(_ context.Context, pubkey []byte) (*uuid.UUID, error) {
			if len(pubkey) == 2 && pubkey[0] == 0xaa {
				return &from, nil
			}
			return &to, nil
		},
		planBestRoute: func(_ context.Context, _, _ uuid.UUID, _ int) (api.BestRouteResult, error) {
			return api.BestRouteResult{Paths: []api.PlannedRoute{}, Reason: "no-route"}, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/routes/best?from=aabb&to=ccdd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	out := decodeBest(t, w)
	if len(out.Paths) != 0 || out.Reason != "no-route" {
		t.Errorf("expected empty paths with reason, got %+v", out)
	}
}

func TestBestRoute_MissingPosition422(t *testing.T) {
	from, to := uuid.New(), uuid.New()
	r := bestRouter(stubReader{
		getNodeIDByPubkey: func(_ context.Context, pubkey []byte) (*uuid.UUID, error) {
			if len(pubkey) == 2 && pubkey[0] == 0xaa {
				return &from, nil
			}
			return &to, nil
		},
		planBestRoute: func(_ context.Context, _, _ uuid.UUID, _ int) (api.BestRouteResult, error) {
			return api.BestRouteResult{Paths: []api.PlannedRoute{}, Reason: "endpoint-missing-position"}, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/routes/best?from=aabb&to=ccdd", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnprocessableEntity {
		t.Errorf("expected 422, got %d", w.Code)
	}
}

func TestBestRoute_AlternativesCapped(t *testing.T) {
	from, to := uuid.New(), uuid.New()
	var gotAlt int
	r := bestRouter(stubReader{
		getNodeIDByPubkey: func(_ context.Context, pubkey []byte) (*uuid.UUID, error) {
			if len(pubkey) == 2 && pubkey[0] == 0xaa {
				return &from, nil
			}
			return &to, nil
		},
		planBestRoute: func(_ context.Context, _, _ uuid.UUID, alt int) (api.BestRouteResult, error) {
			gotAlt = alt
			return api.BestRouteResult{Paths: []api.PlannedRoute{}}, nil
		},
	})
	req := httptest.NewRequest(http.MethodGet, "/routes/best?from=aabb&to=ccdd&alternatives=0", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if gotAlt != 0 {
		t.Errorf("expected alternatives=0 forwarded, got %d", gotAlt)
	}
}
