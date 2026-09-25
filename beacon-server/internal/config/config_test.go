// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLoadLogConfig(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("log:\n  level: warn\n  format: json\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Log.Level != "warn" || cfg.Log.Format != "json" {
		t.Fatalf("log config ignored: %+v", cfg.Log)
	}
}

func TestLoadTrustedProxies(t *testing.T) {
	for _, tc := range []struct {
		name, yaml string
		count      int
		wantError  bool
	}{
		{"omitted", "{}", 0, false},
		{"empty", "server: {trusted_proxies: []}", 0, false},
		{"CIDRs", "server: {trusted_proxies: ['192.0.2.0/24', '2001:db8::/32']}", 2, false},
		{"bare IP", "server: {trusted_proxies: ['192.0.2.1']}", 0, true},
		{"invalid CIDR", "server: {trusted_proxies: ['192.0.2.0/99']}", 0, true},
		{"empty entry", "server: {trusted_proxies: ['', '192.0.2.0/24']}", 0, true},
		{"null entry", "server: {trusted_proxies: [null, '192.0.2.0/24']}", 0, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "config.yaml")
			if err := os.WriteFile(path, []byte(tc.yaml), 0600); err != nil {
				t.Fatal(err)
			}
			cfg, err := Load(path)
			if (err != nil) != tc.wantError {
				t.Fatalf("Load error = %v, want error = %v", err, tc.wantError)
			}
			if err == nil && len(cfg.Server.TrustedProxies) != tc.count {
				t.Fatalf("got %d proxy prefixes, want %d", len(cfg.Server.TrustedProxies), tc.count)
			}
		})
	}
}

func TestLoad_FileNotFound(t *testing.T) {
	cfg, err := Load("/nonexistent/path/config.yaml")
	if err != nil {
		t.Fatalf("expected nil error for missing file, got %v", err)
	}
	if cfg == nil {
		t.Fatal("expected empty config, got nil")
	}
}

func TestLoad_ValidFile(t *testing.T) {
	f, err := os.CreateTemp("", "beacon-config-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(f.Name())

	_, _ = f.WriteString(`
iatas:
  YVR:
    name: Vancouver
    lat: 49.1967
    lng: -123.1815
regions:
  - slug: bc
    name: British Columbia
    display_order: 1
    iatas: [YVR]
observers:
  delete_after: 720h
`)
	f.Close()

	cfg, err := Load(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := cfg.IATAs["YVR"]; !ok {
		t.Error("expected YVR in IATAs")
	}
	if len(cfg.Regions) != 1 {
		t.Errorf("expected 1 region, got %d", len(cfg.Regions))
	}
	if cfg.Regions[0].Slug != "bc" {
		t.Errorf("expected slug bc, got %s", cfg.Regions[0].Slug)
	}
	if Resolve(cfg).ObserverDeleteAfter != 30*24*time.Hour {
		t.Error("observers.delete_after was not loaded from YAML")
	}
}

func TestLoad_InvalidYAML(t *testing.T) {
	f, err := os.CreateTemp("", "beacon-config-*.yaml")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(f.Name())

	_, _ = f.WriteString(`not: valid: yaml: [`)
	f.Close()

	_, err = Load(f.Name())
	if err == nil {
		t.Fatal("expected error for invalid YAML, got nil")
	}
}

func TestResolve_Defaults(t *testing.T) {
	r := Resolve(&Config{})
	if r.TelemetryResolution != time.Hour {
		t.Errorf("expected TelemetryResolution 1h, got %v", r.TelemetryResolution)
	}
	if r.TelemetryRetention != 28*24*time.Hour {
		t.Errorf("expected TelemetryRetention 672h, got %v", r.TelemetryRetention)
	}
	if r.PacketRetention != 30*24*time.Hour {
		t.Errorf("expected PacketRetention 720h, got %v", r.PacketRetention)
	}
	if r.MaxConnsPerIP != 5 {
		t.Errorf("expected MaxConnsPerIP 5, got %d", r.MaxConnsPerIP)
	}
	if r.ViewRefreshInterval != time.Hour {
		t.Errorf("expected ViewRefreshInterval 1h, got %v", r.ViewRefreshInterval)
	}
	if r.ReconfirmInterval != time.Hour {
		t.Errorf("expected ReconfirmInterval 1h, got %v", r.ReconfirmInterval)
	}
	if r.CleanupInterval != time.Hour {
		t.Errorf("expected CleanupInterval 1h, got %v", r.CleanupInterval)
	}
	if r.ClockDriftThreshold != 5*time.Minute {
		t.Errorf("expected ClockDriftThreshold 5m, got %v", r.ClockDriftThreshold)
	}
	if r.NodeStaleThreshold != 24*time.Hour {
		t.Errorf("expected NodeStaleThreshold 24h, got %v", r.NodeStaleThreshold)
	}
	if r.NodeDeleteAfter != 30*24*time.Hour {
		t.Errorf("expected NodeDeleteAfter 720h (same default as PacketRetention), got %v", r.NodeDeleteAfter)
	}
	if r.NodeIATAMembershipTTL != 7*24*time.Hour {
		t.Errorf("expected NodeIATAMembershipTTL 168h (7 days), got %v", r.NodeIATAMembershipTTL)
	}
	if r.ObserverDeleteAfter != 14*24*time.Hour {
		t.Errorf("expected ObserverDeleteAfter 336h (14 days), got %v", r.ObserverDeleteAfter)
	}
	if r.MeshCoreRegionFreshness != 7*24*time.Hour {
		t.Errorf("expected MeshCoreRegionFreshness 168h (7 days), got %v", r.MeshCoreRegionFreshness)
	}
}

func TestResolve_ExplicitValues(t *testing.T) {
	cfg := &Config{}
	cfg.Telemetry.Resolution.Duration = 30 * time.Minute
	cfg.Telemetry.Retention.Duration = 14 * 24 * time.Hour
	cfg.Packets.Retention.Duration = 7 * 24 * time.Hour
	cfg.WebSocket.MaxConnectionsPerIP = 10
	cfg.Background.ViewRefresh.Duration = 2 * time.Hour
	cfg.Background.Reconfirm.Duration = 3 * time.Hour
	cfg.Background.Cleanup.Duration = 4 * time.Hour
	cfg.Observers.DeleteAfter.Duration = 21 * 24 * time.Hour

	r := Resolve(cfg)
	if r.TelemetryResolution != 30*time.Minute {
		t.Errorf("expected 30m, got %v", r.TelemetryResolution)
	}
	if r.MaxConnsPerIP != 10 {
		t.Errorf("expected 10, got %d", r.MaxConnsPerIP)
	}
	if r.ViewRefreshInterval != 2*time.Hour {
		t.Errorf("expected 2h, got %v", r.ViewRefreshInterval)
	}
	if r.ObserverDeleteAfter != 21*24*time.Hour {
		t.Errorf("expected ObserverDeleteAfter 504h (21 days), got %v", r.ObserverDeleteAfter)
	}
}

func TestResolvedConfig_String(t *testing.T) {
	r := Resolve(&Config{})
	s := r.String()
	if s == "" {
		t.Error("expected non-empty string")
	}
	if !strings.Contains(s, "telemetryResolution=") {
		t.Error("expected telemetryResolution in string")
	}
	if !strings.Contains(s, "maxConnsPerIP=") {
		t.Error("expected maxConnsPerIP in string")
	}
	if !strings.Contains(s, "observerDeleteAfter=") {
		t.Error("expected observerDeleteAfter in string")
	}
}

func TestResolve_RouteDefaults(t *testing.T) {
	r := Resolve(&Config{})
	if r.RouteRetention != 336*time.Hour {
		t.Errorf("RouteRetention = %s, want 336h", r.RouteRetention)
	}
	if r.RouteGrace != 168*time.Hour {
		t.Errorf("RouteGrace = %s, want 168h", r.RouteGrace)
	}
	if r.RouteMinObservations != 3 {
		t.Errorf("RouteMinObservations = %d, want 3", r.RouteMinObservations)
	}
}

func TestResolve_RoutePlanDefaults(t *testing.T) {
	r := Resolve(&Config{})
	if r.RoutePlanUnmeasuredPenalty != DefaultRoutePlanUnmeasuredPenalty {
		t.Errorf("RoutePlanUnmeasuredPenalty = %v, want %v", r.RoutePlanUnmeasuredPenalty, DefaultRoutePlanUnmeasuredPenalty)
	}
	if r.RoutePlanSNRGoodDB != DefaultRoutePlanSNRGoodDB {
		t.Errorf("RoutePlanSNRGoodDB = %v, want %v", r.RoutePlanSNRGoodDB, DefaultRoutePlanSNRGoodDB)
	}
	if r.RoutePlanSNRBadDB != DefaultRoutePlanSNRBadDB {
		t.Errorf("RoutePlanSNRBadDB = %v, want %v", r.RoutePlanSNRBadDB, DefaultRoutePlanSNRBadDB)
	}
	if r.RoutePlanSNRMaxPenalty != DefaultRoutePlanSNRMaxPenalty {
		t.Errorf("RoutePlanSNRMaxPenalty = %v, want %v", r.RoutePlanSNRMaxPenalty, DefaultRoutePlanSNRMaxPenalty)
	}
	if r.RoutePlanSNRStrongCap != DefaultRoutePlanSNRStrongCap {
		t.Errorf("RoutePlanSNRStrongCap = %v, want %v", r.RoutePlanSNRStrongCap, DefaultRoutePlanSNRStrongCap)
	}
	if r.RoutePlanTrafficMaxDiscount != DefaultRoutePlanTrafficMaxDiscount {
		t.Errorf("RoutePlanTrafficMaxDiscount = %v, want %v", r.RoutePlanTrafficMaxDiscount, DefaultRoutePlanTrafficMaxDiscount)
	}
	if r.RoutePlanTrafficFullCount != DefaultRoutePlanTrafficFullCount {
		t.Errorf("RoutePlanTrafficFullCount = %v, want %v", r.RoutePlanTrafficFullCount, DefaultRoutePlanTrafficFullCount)
	}
	if r.RoutePlanTrafficMeasuredShare != DefaultRoutePlanTrafficMeasuredShare {
		t.Errorf("RoutePlanTrafficMeasuredShare = %v, want %v", r.RoutePlanTrafficMeasuredShare, DefaultRoutePlanTrafficMeasuredShare)
	}
	if r.RoutePlanUnmeasuredFloor != DefaultRoutePlanUnmeasuredFloor {
		t.Errorf("RoutePlanUnmeasuredFloor = %v, want %v", r.RoutePlanUnmeasuredFloor, DefaultRoutePlanUnmeasuredFloor)
	}
	if r.RoutePlanUnseenPenalty != DefaultRoutePlanUnseenPenalty {
		t.Errorf("RoutePlanUnseenPenalty = %v, want %v", r.RoutePlanUnseenPenalty, DefaultRoutePlanUnseenPenalty)
	}
	if r.RoutePlanNeighborBonus != DefaultRoutePlanNeighborBonus {
		t.Errorf("RoutePlanNeighborBonus = %v, want %v", r.RoutePlanNeighborBonus, DefaultRoutePlanNeighborBonus)
	}
	if r.RoutePlanSNRFreshness != DefaultRoutePlanSNRFreshness {
		t.Errorf("RoutePlanSNRFreshness = %v, want %v", r.RoutePlanSNRFreshness, DefaultRoutePlanSNRFreshness)
	}
	if r.RoutePlanMaxHops != DefaultRoutePlanMaxHops {
		t.Errorf("RoutePlanMaxHops = %d, want %d", r.RoutePlanMaxHops, DefaultRoutePlanMaxHops)
	}
	if r.RoutePlanMaxAlternatives != DefaultRoutePlanMaxAlternatives {
		t.Errorf("RoutePlanMaxAlternatives = %d, want %d", r.RoutePlanMaxAlternatives, DefaultRoutePlanMaxAlternatives)
	}
}

func fptr(v float64) *float64 { return &v }
func iptr(v int) *int         { return &v }

func dptr(d time.Duration) *duration { return &duration{Duration: d} }

func TestRoutePlanConfig_Validate(t *testing.T) {
	good := RoutePlanConfig{
		UnmeasuredPenalty: fptr(2.5), SNRGoodDB: fptr(5.0), SNRBadDB: fptr(-15.0), SNRMaxPenalty: fptr(2.0),
		NeighborBonus: fptr(0.4),
	}
	if err := good.Validate(); err != nil {
		t.Errorf("expected valid config, got %v", err)
	}
	if err := (&Config{}).Validate(); err != nil {
		t.Errorf("expected zero routeplan block to validate, got %v", err)
	}
	inverted := good
	inverted.SNRGoodDB, inverted.SNRBadDB = fptr(-15.0), fptr(5.0)
	if err := inverted.Validate(); err == nil {
		t.Error("expected error when snr_good_db <= snr_bad_db")
	}
	negative := good
	negative.SNRMaxPenalty = fptr(-1.0)
	if err := negative.Validate(); err == nil {
		t.Error("expected error for negative penalty")
	}
	negativeBonus := good
	negativeBonus.NeighborBonus = fptr(-0.1)
	if err := negativeBonus.Validate(); err == nil {
		t.Error("expected error for negative neighbor_bonus")
	}
	for name, mutate := range map[string]func(*RoutePlanConfig){
		"bad strong cap":     func(c *RoutePlanConfig) { c.SNRStrongCap = fptr(1.5) },
		"negative traffic":   func(c *RoutePlanConfig) { c.TrafficMaxDiscount = fptr(-1) },
		"degenerate full":    func(c *RoutePlanConfig) { c.TrafficFullCount = fptr(0.5) },
		"share out of range": func(c *RoutePlanConfig) { c.TrafficMeasuredShare = fptr(1.5) },
		"negative floor":     func(c *RoutePlanConfig) { c.UnmeasuredFloor = fptr(-0.1) },
		"negative unseen":    func(c *RoutePlanConfig) { c.UnseenPenalty = fptr(-1) },
	} {
		bad := good
		mutate(&bad)
		if err := bad.Validate(); err == nil {
			t.Errorf("expected error for %s", name)
		}
	}
	// Raw validation only checks shape: partial configs pass here and are
	// rejected by ValidateResolved after defaults are applied (see below).
	partial := RoutePlanConfig{NeighborBonus: fptr(10)}
	if err := partial.Validate(); err != nil {
		t.Errorf("expected partial raw config to pass shape validation, got %v", err)
	}
}

func TestValidateResolved_PartialBonusRejected(t *testing.T) {
	// neighbor_bonus: 10 alone passes raw validation but resolves against
	// default penalties (unmeasured 2.5, max 2.0) into negative edge costs.
	cfg := &Config{}
	cfg.RoutePlan.NeighborBonus = fptr(10)
	if err := ValidateResolved(Resolve(cfg)); err == nil {
		t.Error("expected resolved rejection for lone neighbor_bonus: 10")
	}
}

func TestValidateResolved_PartialUnmeasuredRejected(t *testing.T) {
	// unmeasured_penalty: 1 alone resolves against the default max penalty
	// 2.0, violating unmeasured >= max.
	cfg := &Config{}
	cfg.RoutePlan.UnmeasuredPenalty = fptr(1)
	if err := ValidateResolved(Resolve(cfg)); err == nil {
		t.Error("expected resolved rejection for lone unmeasured_penalty: 1")
	}
}

func TestLoad_RoutePlanPartialRejected(t *testing.T) {
	for _, body := range []string{
		"routeplan:\n  neighbor_bonus: 10\n",
		"routeplan:\n  unmeasured_penalty: 1\n",
	} {
		path := t.TempDir() + "/config.yaml"
		if err := os.WriteFile(path, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := Load(path); err == nil {
			t.Errorf("expected Load to reject %q", body)
		}
	}
}

func TestResolve_RoutePlanExplicitZero(t *testing.T) {
	// Explicit 0 is distinct from unset: it disables the feature instead of
	// resolving back to the default.
	cfg := &Config{}
	cfg.RoutePlan.NeighborBonus = fptr(0)
	cfg.RoutePlan.MaxAlternatives = iptr(0)
	r := Resolve(cfg)
	if r.RoutePlanNeighborBonus != 0 {
		t.Errorf("explicit neighbor_bonus 0 resolved to %v", r.RoutePlanNeighborBonus)
	}
	if r.RoutePlanMaxAlternatives != 0 {
		t.Errorf("explicit max_alternatives 0 resolved to %v", r.RoutePlanMaxAlternatives)
	}
	if err := ValidateResolved(r); err != nil {
		t.Errorf("explicit-zero resolve should validate, got %v", err)
	}
}

func TestValidateResolved_PositiveCosts(t *testing.T) {
	if err := ValidateResolved(Resolve(&Config{})); err != nil {
		t.Fatalf("default resolve should validate, got %v", err)
	}
	// Bonus at the gap boundary must be rejected: it would zero out costs.
	cfg := &Config{}
	cfg.RoutePlan.NeighborBonus = fptr(0.5) // gap is 2.5-2.0 = 0.5
	if err := ValidateResolved(Resolve(cfg)); err == nil {
		t.Error("expected rejection when neighbor_bonus >= unmeasured - max gap")
	}
}

func TestValidateResolved_TrafficInvariants(t *testing.T) {
	if err := ValidateResolved(Resolve(&Config{})); err != nil {
		t.Fatalf("default resolve should validate, got %v", err)
	}
	cases := map[string]func(*Config){
		// Floor at/below the strong cap: a proven unmeasured leg could tie
		// or beat a fresh strong reading per-leg.
		"floor below cap": func(c *Config) { c.RoutePlan.UnmeasuredFloor = fptr(0.25) },
		// Degenerate log scale.
		"full count < 1": func(c *Config) { c.RoutePlan.TrafficFullCount = fptr(0.5) },
		// Share outside [0, 1].
		"share > 1": func(c *Config) { c.RoutePlan.TrafficMeasuredShare = fptr(2) },
		// Zero floor with penalties fully discountable to zero/negative.
		"zero floor, free unmeasured": func(c *Config) {
			c.RoutePlan.UnmeasuredFloor = fptr(0)
			c.RoutePlan.UnmeasuredPenalty = fptr(2.0)
			c.RoutePlan.TrafficMaxDiscount = fptr(2.0)
		},
		// Kink needs goodDB > 0 > badDB.
		"goodDB at zero": func(c *Config) { c.RoutePlan.SNRGoodDB = fptr(0) },
		"badDB at zero":  func(c *Config) { c.RoutePlan.SNRBadDB = fptr(0) },
	}
	for name, mutate := range cases {
		cfg := &Config{}
		mutate(cfg)
		if err := ValidateResolved(Resolve(cfg)); err == nil {
			t.Errorf("expected rejection for %s", name)
		}
	}
	// traffic_max_discount: 0 is valid: pure-SNR model (share irrelevant).
	off := &Config{}
	off.RoutePlan.TrafficMaxDiscount = fptr(0)
	if err := ValidateResolved(Resolve(off)); err != nil {
		t.Errorf("traffic_max_discount 0 should validate, got %v", err)
	}
}

func TestResolve_RoutePlanDirectFreshnessDefault(t *testing.T) {
	r := Resolve(&Config{})
	if r.RoutePlanDirectFreshness != r.RoutePlanSNRFreshness {
		t.Errorf("direct freshness should default to SNR freshness, got %v vs %v",
			r.RoutePlanDirectFreshness, r.RoutePlanSNRFreshness)
	}
}

func TestResolve_RoutePlanDirectFreshnessExplicitZero(t *testing.T) {
	// Explicit 0 is distinct from unset: it disables the fresh-direct
	// bonus/badge instead of falling back to SNR freshness. Resolve keeps
	// the 0; the no-fallback copy in routeplan.FromResolved is covered by
	// TestIsFreshNeighbor_DisabledFreshness on the planner side (config
	// cannot import routeplan: import cycle).
	cfg := &Config{}
	cfg.RoutePlan.DirectFreshness = dptr(0)
	r := Resolve(cfg)
	if r.RoutePlanDirectFreshness != 0 {
		t.Fatalf("explicit direct_freshness 0 resolved to %v", r.RoutePlanDirectFreshness)
	}
	if err := ValidateResolved(r); err != nil {
		t.Fatalf("explicit-zero direct freshness should validate, got %v", err)
	}
}

func TestLoad_RoutePlanDirectFreshnessZero(t *testing.T) {
	// End-to-end through YAML: direct_freshness: 0s disables the bonus.
	path := t.TempDir() + "/config.yaml"
	if err := os.WriteFile(path, []byte("routeplan:\n  direct_freshness: 0s\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	r := Resolve(cfg)
	if r.RoutePlanDirectFreshness != 0 {
		t.Fatalf("YAML direct_freshness: 0s resolved to %v", r.RoutePlanDirectFreshness)
	}
}

func TestChannelPublicFlagIsExplicit(t *testing.T) {
	path := t.TempDir() + "/config.yaml"
	err := os.WriteFile(path, []byte(`channel_keys:
  keys:
    "11":
      name: General
      public: true
    "22":
      name: Public
    "33":
      name: Public
      public: false
`), 0600)
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.ChannelKeys.Keys["11"].Public || cfg.ChannelKeys.Keys["22"].Public || cfg.ChannelKeys.Keys["33"].Public {
		t.Fatal("public channel classification must depend only on the explicit flag")
	}
}

func TestOwnerMetadataIsOptIn(t *testing.T) {
	cfg, err := Load(t.TempDir() + "/missing.yaml")
	if err != nil || cfg.Ingest.OwnerMetadata {
		t.Fatal("owner metadata must default off", err)
	}
	path := t.TempDir() + "/config.yaml"
	if err := os.WriteFile(path, []byte("ingest:\n  owner_metadata: true\n"), 0600); err != nil {
		t.Fatal(err)
	}
	cfg, err = Load(path)
	if err != nil || !cfg.Ingest.OwnerMetadata {
		t.Fatal("explicit opt in not loaded", err)
	}
}
