// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package radiopreset

import (
	"context"
	"errors"
	"testing"
)

func intPtr(v int) *int { return &v }

func testCatalogue() *Catalogue {
	return &Catalogue{entries: []Entry{
		{Title: "EU/UK (Narrow)", FrequencyMHz: 869.618, SpreadingFactor: 8, BandwidthKHz: 62.5, CodingRate: 8},
		{Title: "Hungary", FrequencyMHz: 869.618, SpreadingFactor: 7, BandwidthKHz: 62.5, CodingRate: 5},
		{Title: "Netherlands", FrequencyMHz: 869.618, SpreadingFactor: 7, BandwidthKHz: 62.5, CodingRate: 5},
		{Title: "Australia: SA, WA", FrequencyMHz: 923.125, SpreadingFactor: 8, BandwidthKHz: 62.5, CodingRate: 8},
		{Title: "Australia: QLD", FrequencyMHz: 923.125, SpreadingFactor: 8, BandwidthKHz: 62.5, CodingRate: 5},
	}}
}

func TestMatch_ExactWithCodingRate(t *testing.T) {
	cat := testCatalogue()
	got := cat.Match(869.618, 62.5, 8, intPtr(8))
	if got.Title != "EU/UK (Narrow)" || got.Ambiguous {
		t.Fatalf("expected exact title, got %+v", got)
	}
}

func TestMatch_MissingCodingRateAmbiguous(t *testing.T) {
	cat := testCatalogue()
	// 923.125/62.5/SF8 exists with CR 8 and CR 5 — without CR we must not guess.
	got := cat.Match(923.125, 62.5, 8, nil)
	if got.Title != "" || !got.Ambiguous {
		t.Fatalf("expected ambiguous, got %+v", got)
	}
	// With CR the match is exact again.
	got = cat.Match(923.125, 62.5, 8, intPtr(5))
	if got.Title != "Australia: QLD" || got.Ambiguous {
		t.Fatalf("expected Australia: QLD, got %+v", got)
	}
}

func TestMatch_IdenticalParametersJoinedDeterministically(t *testing.T) {
	cat := testCatalogue()
	got := cat.Match(869.618, 62.5, 7, intPtr(5))
	if got.Title != "Hungary / Netherlands" {
		t.Fatalf("expected grouped aliases, got %+v", got)
	}
}

func TestMatch_NoMatch(t *testing.T) {
	cat := testCatalogue()
	got := cat.Match(999.0, 125, 7, intPtr(5))
	if got.Title != "" || got.Ambiguous {
		t.Fatalf("expected no match, got %+v", got)
	}
}

func TestLoad_FailureFallsBackToEmpty(t *testing.T) {
	cat := Load(context.Background(), func(_ context.Context, _ string) ([]byte, error) {
		return nil, errors.New("boom")
	})
	if cat.Len() != 0 {
		t.Fatalf("expected empty catalogue on failure, got %d", cat.Len())
	}
	if got := cat.Match(869.618, 62.5, 8, intPtr(8)); got.Title != "" {
		t.Fatalf("expected no title from empty catalogue, got %+v", got)
	}
}

func TestLoad_ParsesEntries(t *testing.T) {
	raw := []byte(`[{"title":"X","frequency":"869.618","spreading_factor":"8","bandwidth":"62.5","coding_rate":"8"}]`)
	cat := Load(context.Background(), func(_ context.Context, _ string) ([]byte, error) {
		return raw, nil
	})
	if cat.Len() != 1 {
		t.Fatalf("expected 1 entry, got %d", cat.Len())
	}
}
