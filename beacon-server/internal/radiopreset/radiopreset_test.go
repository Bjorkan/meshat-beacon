// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package radiopreset

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// The upstream catalogue really does assign several distinct titles to one
// frequency/bandwidth/SF triple (CR ignored), e.g. 869.618/62.5/SF7 has
// Hungary, Netherlands, Portugal 868 and Slovakia.
const fixture = `{"unrelated":{"ignored":true},"config":{"suggested_radio_settings":{"entries":[
 {"title":"EU/UK (Narrow)","frequency":"869.618","bandwidth":"62.500","spreading_factor":"8","coding_rate":"8"},
 {"title":"Switzerland","frequency":869.618,"bandwidth":62.5,"spreading_factor":8,"coding_rate":5},
 {"title":"EU/UK (Narrow)","frequency":"869.6180","bandwidth":"62.5","spreading_factor":"8.0"},
 {"title":"Portugal 868","frequency":"869.618","bandwidth":"62.5","spreading_factor":"7","coding_rate":"6"},
 {"title":"Invalid","frequency":"NaN","bandwidth":"62.5","spreading_factor":"8"},
 {"title":"Invalid","frequency":"869.618","bandwidth":"Inf","spreading_factor":"8"},
 {"title":"Invalid","frequency":"869.618","bandwidth":"62.5","spreading_factor":"8.5"}
]}}}`

func loadFixture(t *testing.T) *Catalogue {
	t.Helper()
	calls := 0
	cat := Load(context.Background(), func(ctx context.Context, url string) ([]byte, error) {
		calls++
		if url != MeshCoreConfigURL {
			t.Fatalf("unexpected url %s", url)
		}
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > fetchTimeout {
			t.Fatalf("missing finite startup deadline")
		}
		return []byte(fixture), nil
	})
	if calls != 1 {
		t.Fatalf("expected exactly one startup fetch, got %d", calls)
	}
	return cat
}

func TestMatch_IgnoresCodingRate(t *testing.T) {
	cat := loadFixture(t)
	// Switzerland and EU/UK (Narrow) share 869.618/62.5/SF8 with different coding
	// rates; both must resolve to the same joined title.
	if got := cat.Match(869.618, 62.5, 8); got != "EU/UK (Narrow) / Switzerland" {
		t.Fatalf("CR variants must share a title, got %q", got)
	}
	// float32 round-trips from the REAL columns must match the decimal catalogue text.
	if got := cat.Match(869.6179809570312, 62.5, 8); got != "EU/UK (Narrow) / Switzerland" {
		t.Fatalf("float32 precision must not break matching, got %q", got)
	}
	// SF distinguishes triples even when frequency/bandwidth agree.
	if got := cat.Match(869.618, 62.5, 7); got != "Portugal 868" {
		t.Fatalf("expected Portugal 868, got %q", got)
	}
}

func TestMatch_NumericNormalization(t *testing.T) {
	cat := loadFixture(t)
	if got := cat.Match(869.618, 62.500, 8); got == "" {
		t.Fatal("equivalent integer/decimal representations must match")
	}
	if cat.Len() != 4 {
		t.Fatalf("expected 4 valid entries, got %d", cat.Len())
	}
	if got := cat.Match(869.525, 62.5, 8); got != "" {
		t.Fatalf("expected no match, got %q", got)
	}
	if got := cat.Match(869.618, 62.5, 9); got != "" {
		t.Fatalf("expected no match, got %q", got)
	}
	if got := cat.Match(0, 0, 0); got != "" {
		t.Fatalf("expected no match, got %q", got)
	}
}

func TestLoad_FailureFallsBackToEmpty(t *testing.T) {
	for _, body := range []string{
		"invalid",
		"{}",
		`{"config":{"suggested_radio_settings":{"entries":null}}}`,
		strings.Repeat("x", maxConfigBytes+1),
	} {
		cat := Load(context.Background(), func(context.Context, string) ([]byte, error) {
			return []byte(body), nil
		})
		if cat.Len() != 0 || cat.Match(869.618, 62.5, 8) != "" {
			t.Fatalf("expected empty fallback for body of %d bytes", len(body))
		}
	}
	cat := Load(context.Background(), func(context.Context, string) ([]byte, error) {
		return nil, errors.New("offline")
	})
	if cat.Len() != 0 {
		t.Fatal("expected empty fallback")
	}
	var nilCat *Catalogue
	if nilCat.Match(869.618, 62.5, 8) != "" || nilCat.Len() != 0 {
		t.Fatal("nil catalogue must be safe")
	}
}

func TestHTTPFetcher(t *testing.T) {
	for _, status := range []int{200, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != "GET" {
					t.Error(r.Method)
				}
				w.WriteHeader(status)
				w.Write([]byte(fixture))
			}))
			defer server.Close()
			calls := 0
			cat := Load(context.Background(), func(ctx context.Context, _ string) ([]byte, error) {
				calls++
				return defaultFetch(ctx, server.URL)
			})
			if calls != 1 {
				t.Fatal(calls)
			}
			if (cat.Len() > 0) != (status == 200) {
				t.Fatal(cat.Len())
			}
		})
	}
}

func TestHTTPFetcherHonorsDeadline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-r.Context().Done()
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	cat := Load(ctx, func(ctx context.Context, _ string) ([]byte, error) {
		return defaultFetch(ctx, server.URL)
	})
	if cat.Len() != 0 {
		t.Fatal("expected timeout fallback")
	}
}
