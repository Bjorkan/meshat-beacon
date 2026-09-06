// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
)

func TestListMessages_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{
		listChannelMessages: func(_ context.Context, _ *int32, _ time.Time, _ int32, _ []string, _ string, _ int64) (api.Page[api.ChannelMessage], error) {
			return api.Page[api.ChannelMessage]{Items: []api.ChannelMessage{{ID: 1}}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/messages", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestListMessages_ByChannelID_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{
		listChannelMessages: func(_ context.Context, _ *int32, _ time.Time, _ int32, _ []string, _ string, _ int64) (api.Page[api.ChannelMessage], error) {
			return api.Page[api.ChannelMessage]{Items: []api.ChannelMessage{{ID: 1}}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelID=1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestListMessages_ByChannelHash_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{
		listChannelMessagesByHash: func(_ context.Context, _ []byte, _ time.Time, _ int32, _ []string, _ string, _ int64) (api.Page[api.ChannelMessage], error) {
			return api.Page[api.ChannelMessage]{Items: []api.ChannelMessage{{ID: 1}}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelHash=ab", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestListMessages_BothChannelIDAndHash_BadRequest(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelID=1&channelHash=ab", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_InvalidChannelID(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelID=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_InvalidChannelHash(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelHash=nothex!!", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_ChannelHashNotSingleByte(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?channelHash=aabb", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_InvalidLimit(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?limit=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_InvalidSince(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?since=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessages_InvalidCursor(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages", listMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages?cursor=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessagesBackfill_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages/backfill", listMessagesBackfill(stubReader{
		listMessagesAfterID: func(_ context.Context, _ int64, _ []string, _ string, _ int32) ([]api.ChannelMessage, error) {
			return []api.ChannelMessage{{ID: 1}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/messages/backfill?afterId=1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestListMessagesBackfill_MissingAfterID(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages/backfill", listMessagesBackfill(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages/backfill", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListMessagesBackfill_InvalidAfterID(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/messages/backfill", listMessagesBackfill(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/messages/backfill?afterId=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestMessageListsResolveRegions(t *testing.T) {
	for _, path := range []string{"/messages", "/messages?channelID=1", "/messages?channelHash=ab", "/channels/1/messages"} {
		for _, filter := range []string{"region=west", "regionId=7"} {
			t.Run(path+"/"+filter, func(t *testing.T) {
				called := false
				check := func(iatas []string) {
					called = true
					if len(iatas) != 2 || iatas[0] != "YYC" || iatas[1] != "YVR" {
						t.Errorf("unexpected regional filter: %v", iatas)
					}
				}
				reader := stubReader{
					getRegion: func(_ context.Context, id int32) (*api.Region, error) {
						if id != 7 {
							t.Errorf("region ID = %d", id)
						}
						return &api.Region{IATAs: []string{"YVR"}}, nil
					},
					getRegionBySlug: func(_ context.Context, slug string) (*api.Region, error) {
						if slug != "west" {
							t.Errorf("region slug = %s", slug)
						}
						return &api.Region{IATAs: []string{"YVR"}}, nil
					},
					listChannelMessages: func(_ context.Context, _ *int32, _ time.Time, _ int32, iatas []string, _ string, _ int64) (api.Page[api.ChannelMessage], error) {
						check(iatas)
						return api.Page[api.ChannelMessage]{}, nil
					},
					listChannelMessagesByHash: func(_ context.Context, _ []byte, _ time.Time, _ int32, iatas []string, _ string, _ int64) (api.Page[api.ChannelMessage], error) {
						check(iatas)
						return api.Page[api.ChannelMessage]{}, nil
					},
				}
				router := chi.NewRouter()
				router.Get("/messages", listMessages(reader))
				router.Get("/channels/{channelID}/messages", listChannelMessages(reader))
				separator := "?"
				if strings.Contains(path, "?") {
					separator = "&"
				}
				w := httptest.NewRecorder()
				router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path+separator+filter+"&iatas=YYC", nil))
				if w.Code != http.StatusOK || !called {
					t.Fatalf("status %d, reader called %v", w.Code, called)
				}
			})
		}
	}
}
