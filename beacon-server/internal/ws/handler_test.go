// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package ws

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/hub"
	"github.com/coder/websocket"
)

func TestHandlerConcurrentEventsAndReplies(t *testing.T) {
	h := hub.New()
	go h.Run()
	server := httptest.NewServer(Handler(h, nil, 5, 60))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	read := func() map[string]any {
		t.Helper()
		_, data, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var msg map[string]any
		if err := json.Unmarshal(data, &msg); err != nil {
			t.Fatal(err)
		}
		return msg
	}
	if msg := read(); msg["type"] != "hello" {
		t.Fatalf("hello = %v", msg)
	}
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"subscribe","scope":{}}`)); err != nil {
		t.Fatal(err)
	}
	if msg := read(); msg["type"] != "subscribed" {
		t.Fatalf("subscribe = %v", msg)
	}
	// configure waits for the hub to apply the preceding subscription.
	if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"configure"}`)); err != nil {
		t.Fatal(err)
	}
	if msg := read(); msg["type"] != "configured" {
		t.Fatalf("configure = %v", msg)
	}
	for i := 0; i < 20; i++ {
		h.Broadcast(hub.Event{Type: hub.EventNodeUpdate, Payload: json.RawMessage(`{}`)})
		if err := conn.Write(ctx, websocket.MessageText, []byte(`{"type":"ping"}`)); err != nil {
			t.Fatal(err)
		}
		seen := map[string]bool{}
		for j := 0; j < 2; j++ {
			seen[read()["type"].(string)] = true
		}
		if !seen["event"] || !seen["pong"] {
			t.Fatalf("responses = %v", seen)
		}
	}
}

func TestWriteMessageTimesOutForStalledClient(t *testing.T) {
	result := make(chan error, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			result <- err
			return
		}
		defer conn.CloseNow()
		// Larger than the socket buffers: a peer that never reads stalls this write.
		result <- writeMessage(r.Context(), conn, make([]byte, 16<<20))
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), writeTimeout+5*time.Second)
	defer cancel()
	conn, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(server.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.CloseNow()
	select {
	case err := <-result:
		if !errors.Is(err, context.DeadlineExceeded) {
			t.Fatalf("write error = %v, want deadline exceeded", err)
		}
	case <-ctx.Done():
		t.Fatal("write did not honor its timeout")
	}
}
