// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/go-chi/chi/v5"
)

func TestListChannels_InvalidLimit(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels", listChannels(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels?limit=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannels_InvalidCursor(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels", listChannels(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels?cursor=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannels_PageCursor(t *testing.T) {
	called := false
	r := ChannelsRouter(stubReader{listChannels: func(_ context.Context, limit int32, hash []byte, iatas []string, legacy int64, _ string, cursor *api.ChannelCursor) (api.ChannelPage, error) {
		called = true
		if limit != 2 || legacy != 0 || cursor == nil || cursor.ID != 9 || !cursor.LastSeen.Equal(time.UnixMicro(1700000000000123)) ||
			!reflect.DeepEqual(hash, []byte{0xaa}) || !reflect.DeepEqual(iatas, []string{"YOW"}) {
			t.Error("page cursor or filters did not reach the reader intact")
		}
		return api.ChannelPage{}, nil
	}})
	for _, legacy := range []string{"", "&cursor=0"} {
		called = false
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/?pageCursor=v1:1700000000000123:9&limit=2&hash=AA&iata=yow"+legacy, nil))
		if w.Code != http.StatusOK || !called {
			t.Fatalf("legacy %q: HTTP %d, reader called=%v", legacy, w.Code, called)
		}
	}
	for _, query := range []string{"pageCursor=bad", "cursor=1&pageCursor=v1:1700000000000123:9", "cursor=bad&pageCursor=v1:1700000000000123:9"} {
		called = false
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/?"+query, nil))
		if w.Code != http.StatusBadRequest || called {
			t.Errorf("HTTP %d, invalid request reached reader=%v", w.Code, called)
		}
	}
}

func TestListChannels_InvalidHash(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels", listChannels(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels?hash=nothex!!", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannels_HashNotSingleByte(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels", listChannels(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels?hash=aabb", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestGetChannel_InvalidID(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}", getChannel(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels/notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannelMessages_InvalidChannelID(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}/messages", listChannelMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels/notanint/messages", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannelMessages_InvalidLimit(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}/messages", listChannelMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels/1/messages?limit=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannelMessages_InvalidSince(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}/messages", listChannelMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels/1/messages?since=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannelMessages_InvalidCursor(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}/messages", listChannelMessages(stubReader{}))
	req := httptest.NewRequest(http.MethodGet, "/channels/1/messages?cursor=notanint", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", w.Code)
	}
}

func TestListChannels_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels", listChannels(stubReader{
		listChannels: func(_ context.Context, _ int32, _ []byte, _ []string, _ int64, _ string, _ *api.ChannelCursor) (api.ChannelPage, error) {
			return api.ChannelPage{Items: []api.ChannelSummary{{ID: 1, ChannelHash: "ab"}}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/channels", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestListChannels_IATAParsing(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  []string
	}{
		{"single lowercased", "?iata=yow", []string{"YOW"}},
		{"multi csv", "?iatas=yow,%20yyz", []string{"YOW", "YYZ"}},
		{"none", "", nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got []string
			r := chi.NewRouter()
			r.Get("/channels", listChannels(stubReader{
				listChannels: func(_ context.Context, _ int32, _ []byte, iatas []string, _ int64, _ string, _ *api.ChannelCursor) (api.ChannelPage, error) {
					got = iatas
					return api.ChannelPage{}, nil
				},
			}))
			req := httptest.NewRequest(http.MethodGet, "/channels"+tc.query, nil)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != http.StatusOK {
				t.Fatalf("expected 200, got %d", w.Code)
			}
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("expected iatas %v, got %v", tc.want, got)
			}
		})
	}
}

func TestGetChannel_OK(t *testing.T) {
	r := chi.NewRouter()
	r.Get("/channels/{channelID}", getChannel(stubReader{
		getChannel: func(_ context.Context, id int32) (*api.Channel, error) {
			return &api.Channel{ChannelSummary: api.ChannelSummary{ID: int(id)}}, nil
		},
	}))
	req := httptest.NewRequest(http.MethodGet, "/channels/1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", w.Code)
	}
}

func TestChannelListDiagnosticsAndCount(t *testing.T) {
	for _, tc := range []struct {
		query, key string
		status     int
	}{
		{"", "known", 200}, {"?hash=AB", "all", 200}, {"?key=unknown", "unknown", 200},
		{"?hash=ab&key=known", "known", 200}, {"?key=invalid", "", 400},
	} {
		t.Run(tc.query, func(t *testing.T) {
			reader := stubReader{listChannels: func(_ context.Context, _ int32, hash []byte, _ []string, _ int64, key string, _ *api.ChannelCursor) (api.ChannelPage, error) {
				if key != tc.key {
					t.Fatalf("key=%s want=%s", key, tc.key)
				}
				if len(hash) > 0 && !reflect.DeepEqual(hash, []byte{0xab}) {
					t.Fatalf("hash=%x", hash)
				}
				return api.ChannelPage{Items: []api.ChannelSummary{}, UnknownCount: 57}, nil
			}}
			w := httptest.NewRecorder()
			listChannels(reader)(w, httptest.NewRequest(http.MethodGet, "/channels"+tc.query, nil))
			if w.Code != tc.status {
				t.Fatalf("status=%d", w.Code)
			}
			if w.Code == 200 {
				var page api.ChannelPage
				if err := json.Unmarshal(w.Body.Bytes(), &page); err != nil {
					t.Fatal(err)
				}
				if page.UnknownCount != 57 {
					t.Fatalf("count=%d", page.UnknownCount)
				}
			}
		})
	}
}
