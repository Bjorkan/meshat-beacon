// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package config

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

type stubSeeder struct {
	regions    map[string]int32
	regionMeta map[int32]struct {
		shortCode *string
		isRoot    bool
	}
	iatas        []string
	regionIATAs  map[int32][]string
	scopes       []string
	scopeDetails map[string]struct {
		name             string
		key, fingerprint []byte
	}
	borders   map[string]json.RawMessage
	upsertErr error
}

func newStubSeeder() *stubSeeder {
	return &stubSeeder{
		regions: make(map[string]int32),
		regionMeta: make(map[int32]struct {
			shortCode *string
			isRoot    bool
		}),
		regionIATAs: make(map[int32][]string),
		borders:     make(map[string]json.RawMessage),
	}
}

func (s *stubSeeder) UpsertIATA(_ context.Context, iata string) error {
	s.iatas = append(s.iatas, iata)
	return s.upsertErr
}

func (s *stubSeeder) UpsertIATADetails(_ context.Context, iata, _ string, _, _ *float64) error {
	s.iatas = append(s.iatas, iata)
	return s.upsertErr
}

func (s *stubSeeder) UpsertIATABorder(_ context.Context, iata string, border json.RawMessage) error {
	s.borders[iata] = border
	return s.upsertErr
}

func (s *stubSeeder) UpsertRegion(_ context.Context, slug, _, _ string, _ int, _, _ *float64, _ *int) (int32, error) {
	id := int32(len(s.regions) + 1)
	s.regions[slug] = id
	return id, s.upsertErr
}

func (s *stubSeeder) UpsertRegionMeta(_ context.Context, regionID int32, shortCode *string, isRoot bool) error {
	s.regionMeta[regionID] = struct {
		shortCode *string
		isRoot    bool
	}{shortCode: shortCode, isRoot: isRoot}
	return s.upsertErr
}

func (s *stubSeeder) UpsertRegionIATA(_ context.Context, regionID int32, iata string) error {
	s.regionIATAs[regionID] = append(s.regionIATAs[regionID], iata)
	return s.upsertErr
}

func (s *stubSeeder) UpsertTransportScope(_ context.Context, name, displayName string, key, fingerprint []byte) error {
	s.scopes = append(s.scopes, name)
	if s.scopeDetails == nil {
		s.scopeDetails = make(map[string]struct {
			name             string
			key, fingerprint []byte
		})
	}
	s.scopeDetails[name] = struct {
		name             string
		key, fingerprint []byte
	}{displayName, key, fingerprint}
	return s.upsertErr
}

func TestSeedBuiltInMeshCoreRegions(t *testing.T) {
	db := newStubSeeder()
	cfg := &Config{Scopes: []ScopeConfig{{Name: "se0680"}}}
	for range 2 {
		if err := Seed(context.Background(), cfg, db); err != nil {
			t.Fatal(err)
		}
	}
	if len(db.scopeDetails) != 313 {
		t.Fatalf("expected 313 unique built-ins, got %d", len(db.scopeDetails))
	}
	if _, ok := db.scopeDetails["#*"]; ok {
		t.Fatal("unscoped traffic must not have a derived key")
	}
	entry := db.scopeDetails["se0680"]
	key := sha256.Sum256([]byte("#se0680"))
	fingerprint := sha256.Sum256(key[:16])
	if entry.name != "Jönköpings kommun" || !bytes.Equal(entry.key, key[:16]) || !bytes.Equal(entry.fingerprint, fingerprint[:8]) {
		t.Fatalf("wrong built-in metadata/key: %+v", entry)
	}
	if len(db.iatas) != 0 || len(db.regions) != 0 {
		t.Fatal("MeshCore catalogue must not seed IATA geography")
	}
}

func TestSeed_IATAsAndRegions(t *testing.T) {
	cfg := &Config{
		IATAs: map[string]IATAConfig{
			"YVR": {Name: "Vancouver"},
		},
		Regions: []RegionConfig{
			{Slug: "bc", Name: "British Columbia", IATAs: []string{"YVR", "YYJ"}},
		},
	}

	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := db.regions["bc"]; !ok {
		t.Error("expected bc region to be upserted")
	}
	if len(db.regionIATAs[1]) != 2 {
		t.Errorf("expected 2 IATAs for region 1, got %d", len(db.regionIATAs[1]))
	}
}

func TestSeed_RootRegionMeta(t *testing.T) {
	cfg := &Config{
		Regions: []RegionConfig{
			{Slug: "sweden", Name: "Sverige", ShortCode: "SWE", Root: true, IATAs: []string{"ARN"}},
		},
	}

	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	meta, ok := db.regionMeta[1]
	if !ok {
		t.Fatal("expected region meta to be upserted")
	}
	if meta.shortCode == nil || *meta.shortCode != "SWE" {
		t.Errorf("expected short code SWE, got %v", meta.shortCode)
	}
	if !meta.isRoot {
		t.Error("expected root to be true")
	}
}

func TestValidate_MultipleRoots(t *testing.T) {
	cfg := &Config{
		Regions: []RegionConfig{
			{Slug: "a", Name: "A", Root: true},
			{Slug: "b", Name: "B", Root: true},
		},
	}
	if err := cfg.Validate(); err == nil {
		t.Fatal("expected error for multiple root regions, got nil")
	}
}

func TestValidate_SingleRoot(t *testing.T) {
	cfg := &Config{
		Regions: []RegionConfig{
			{Slug: "sweden", Name: "Sverige", ShortCode: "SWE", Root: true},
		},
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestSeed_BorderFile_ValidatesAndUpserts(t *testing.T) {
	dir := t.TempDir()
	borderPath := dir + "/yow.geojson"
	if err := os.WriteFile(borderPath, []byte(`{
		"type": "Feature",
		"properties": {"name": "Ottawa"},
		"geometry": {
			"type": "Polygon",
			"coordinates": [[[-76.4,45.0],[-75.2,45.0],[-75.2,45.6],[-76.4,45.6],[-76.4,45.0]]]
		}
	}`), 0o644); err != nil {
		t.Fatalf("failed to write test border file: %v", err)
	}

	cfg := &Config{
		IATAs: map[string]IATAConfig{
			"YOW": {Name: "Ottawa", BorderFile: borderPath},
		},
	}
	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	border, ok := db.borders["YOW"]
	if !ok {
		t.Fatal("expected a border to be upserted for YOW")
	}
	var feat map[string]any
	if err := json.Unmarshal(border, &feat); err != nil {
		t.Fatalf("stored border is not valid JSON: %v", err)
	}
	if _, ok := feat["bbox"]; !ok {
		t.Error("expected stored border to have a computed bbox")
	}
}

func TestSeed_BorderFile_InvalidGeometryFailsClosed(t *testing.T) {
	dir := t.TempDir()
	borderPath := dir + "/bad.geojson"
	// unclosed ring
	if err := os.WriteFile(borderPath, []byte(`{
		"type": "Feature",
		"properties": {},
		"geometry": {
			"type": "Polygon",
			"coordinates": [[[-76.4,45.0],[-75.2,45.0],[-75.2,45.6]]]
		}
	}`), 0o644); err != nil {
		t.Fatalf("failed to write test border file: %v", err)
	}

	cfg := &Config{
		IATAs: map[string]IATAConfig{
			"YOW": {Name: "Ottawa", BorderFile: borderPath},
		},
	}
	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err == nil {
		t.Fatal("expected Seed to fail on an invalid border file")
	}
	if _, ok := db.borders["YOW"]; ok {
		t.Error("expected no border to be upserted when validation fails")
	}
}

func TestSeed_BorderFile_MissingFileFailsClosed(t *testing.T) {
	cfg := &Config{
		IATAs: map[string]IATAConfig{
			"YOW": {Name: "Ottawa", BorderFile: "/nonexistent/path/border.geojson"},
		},
	}
	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err == nil {
		t.Fatal("expected Seed to fail when the border file doesn't exist")
	}
}

func TestSeed_Scopes(t *testing.T) {
	cfg := &Config{
		Scopes: []ScopeConfig{
			{Name: "bc"},
			{Name: "#west"},
		},
	}

	db := newStubSeeder()
	if err := Seed(context.Background(), cfg, db); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(db.scopes) != 315 {
		t.Fatalf("expected 2 configured and 313 built-in scopes, got %d", len(db.scopes))
	}
	if db.scopes[0] != "#bc" {
		t.Errorf("expected #bc, got %s", db.scopes[0])
	}
	if db.scopes[1] != "#west" {
		t.Errorf("expected #west, got %s", db.scopes[1])
	}
}

func TestSeed_DBError(t *testing.T) {
	cfg := &Config{
		IATAs: map[string]IATAConfig{
			"YVR": {Name: "Vancouver"},
		},
	}

	db := newStubSeeder()
	db.upsertErr = errors.New("db error")

	if err := Seed(context.Background(), cfg, db); err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestNormalizeScopeName_WithHash(t *testing.T) {
	if normalizeScopeName("#bc") != "#bc" {
		t.Error("expected #bc unchanged")
	}
}

func TestNormalizeScopeName_WithDollar(t *testing.T) {
	if normalizeScopeName("$bc") != "$bc" {
		t.Error("expected $bc unchanged")
	}
}

func TestNormalizeScopeName_WithoutPrefix(t *testing.T) {
	if normalizeScopeName("bc") != "#bc" {
		t.Error("expected bc to become #bc")
	}
}

func TestNormalizeScopeName_Empty(t *testing.T) {
	if normalizeScopeName("") != "#" {
		t.Error("expected empty string to become #")
	}
}

func TestDeriveScopeKey_Length(t *testing.T) {
	key := deriveScopeKey("#bc")
	if len(key) != 16 {
		t.Errorf("expected 16 bytes, got %d", len(key))
	}
}

func TestDeriveScopeKey_Deterministic(t *testing.T) {
	a := deriveScopeKey("#bc")
	b := deriveScopeKey("#bc")
	if hex.EncodeToString(a) != hex.EncodeToString(b) {
		t.Error("expected same key for same input")
	}
}

func TestDeriveScopeKey_KnownValue(t *testing.T) {
	// SHA256("#bc")[:16] — pin the exact derivation so changes are caught
	key := deriveScopeKey("#bc")
	got := hex.EncodeToString(key)
	// generate this once: echo -n "#bc" | sha256sum | cut -c1-32
	const want = "84509cfe73d94f7f6a8299e6bcdb8a3c"
	if got != want {
		t.Errorf("deriveScopeKey(\"#bc\") = %s, want %s", got, want)
	}
}

func TestDeriveScopeKey_DifferentInputs(t *testing.T) {
	a := deriveScopeKey("#bc")
	b := deriveScopeKey("#other")
	if hex.EncodeToString(a) == hex.EncodeToString(b) {
		t.Error("expected different keys for different inputs")
	}
}
