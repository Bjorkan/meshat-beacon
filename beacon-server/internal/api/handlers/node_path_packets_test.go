// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"context"
	"errors"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestNodePathPacketsValidation(t *testing.T) {
	id := uuid.New()
	valid := api.PageToken{Version: 1, Collection: api.NodePathCollection([]string{"YVR"}), Sort: "first_match", Direction: api.SortDesc, ID: id, NumericID: 5, Key: "10"}
	for _, tc := range []struct {
		name, suffix string
		edit         func(*api.PageToken)
	}{
		{name: "malformed", suffix: "?pageToken=bad"},
		{name: "zero limit", suffix: "?limit=0"},
		{name: "oversized limit", suffix: "?limit=1001"},
		{name: "different node", edit: func(p *api.PageToken) { p.ID = uuid.New() }},
		{name: "different region", edit: func(p *api.PageToken) { p.Collection = api.NodePathCollection([]string{"YYJ"}) }},
		{name: "different sort", edit: func(p *api.PageToken) { p.Sort = "name" }},
		{name: "invalid snapshot", edit: func(p *api.PageToken) { p.Key = "4" }},
		{name: "invalid position", edit: func(p *api.PageToken) { p.NumericID = -1 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			suffix := tc.suffix
			if tc.edit != nil {
				p := valid
				tc.edit(&p)
				suffix = "?iatas=YVR&pageToken=" + api.EncodePageToken(p)
			}
			r := chi.NewRouter()
			r.Get("/nodes/{nodeId}/path-packets", listNodePathPackets(stubReader{listNodePathPackets: func(context.Context, uuid.UUID, []string, *api.PageToken, int32) (api.Page[api.PacketSummary], error) {
				t.Fatal("invalid request reached reader")
				return api.Page[api.PacketSummary]{}, nil
			}}))
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest("GET", "/nodes/"+id.String()+"/path-packets"+suffix, nil))
			if w.Code != 400 {
				t.Fatalf("status %d: %s", w.Code, w.Body.String())
			}
		})
	}
}

func TestNodePathPacketsRegionAndCursor(t *testing.T) {
	id := uuid.New()
	token := api.PageToken{Version: 1, Collection: api.NodePathCollection([]string{"YYJ", "YVR", "YVR"}), Sort: "first_match", Direction: api.SortDesc, ID: id, NumericID: 5, Key: "10"}
	called := false
	reader := stubReader{
		getRegionBySlug: func(_ context.Context, slug string) (*api.Region, error) {
			if slug != "bc" {
				t.Fatalf("slug %s", slug)
			}
			return &api.Region{IATAs: []string{"YVR", "YYJ"}}, nil
		},
		listNodePathPackets: func(_ context.Context, gotID uuid.UUID, iatas []string, cursor *api.PageToken, limit int32) (api.Page[api.PacketSummary], error) {
			called = true
			if gotID != id || !reflect.DeepEqual(iatas, []string{"YVR", "YYJ"}) || cursor == nil || cursor.NumericID != 5 || limit != 50 {
				t.Fatalf("unexpected reader args: %v %v %+v %d", gotID, iatas, cursor, limit)
			}
			return api.Page[api.PacketSummary]{Items: []api.PacketSummary{}}, nil
		},
	}
	r := chi.NewRouter()
	r.Get("/nodes/{nodeId}/path-packets", listNodePathPackets(reader))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/nodes/"+id.String()+"/path-packets?region=bc&pageToken="+api.EncodePageToken(token), nil))
	if w.Code != 200 || !called {
		t.Fatalf("status %d: %s", w.Code, w.Body.String())
	}
}

func TestNodePathPacketsReaderErrors(t *testing.T) {
	for _, tc := range []struct {
		err    error
		status int
	}{{pgx.ErrNoRows, 404}, {errors.New("db unavailable"), 500}} {
		r := chi.NewRouter()
		r.Get("/nodes/{nodeId}/path-packets", listNodePathPackets(stubReader{listNodePathPackets: func(context.Context, uuid.UUID, []string, *api.PageToken, int32) (api.Page[api.PacketSummary], error) {
			return api.Page[api.PacketSummary]{}, tc.err
		}}))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", "/nodes/"+uuid.NewString()+"/path-packets", nil))
		if w.Code != tc.status {
			t.Fatalf("status %d, want %d", w.Code, tc.status)
		}
	}
}
