// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package config loads the Beacon configuration file and seeds the database
// with regions, IATA overrides, and channel keys on startup.
package config

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

// Config is the top-level structure of the Beacon config file.
type Config struct {
	IATAs       map[string]IATAConfig `yaml:"iatas"`
	Regions     []RegionConfig        `yaml:"regions"`
	ChannelKeys ChannelKeysConfig     `yaml:"channel_keys"`
	Telemetry   TelemetryConfig       `yaml:"telemetry"`
	WebSocket   WebSocketConfig       `yaml:"websocket"`
	Packets     PacketsConfig         `yaml:"packets"`
	Routes      RoutesConfig          `yaml:"routes"`
	RoutePlan   RoutePlanConfig       `yaml:"routeplan"`
	Neighbors   NeighborsConfig       `yaml:"neighbors"`
	Observers   ObserversConfig       `yaml:"observers"`
	Ingest      IngestFilterConfig    `yaml:"ingest"`
	Scopes      []ScopeConfig         `yaml:"scopes"`
	Cache       CacheConfig           `yaml:"cache"`
	CORS        CORSConfig            `yaml:"cors"`
	Background  BackgroundConfig      `yaml:"background"`
	Presence    PresenceConfig        `yaml:"presence"`
	Nodes       NodesConfig           `yaml:"nodes"`
}

// ResolvedConfig holds all runtime configuration with defaults applied.
type ResolvedConfig struct {
	TelemetryResolution  time.Duration
	TelemetryRetention   time.Duration
	PacketRetention      time.Duration
	RouteRetention       time.Duration
	NeighborRetention    time.Duration
	NeighborMaxKm        float64
	RouteGrace           time.Duration
	RouteMinObservations int
	MaxConnsPerIP        int
	ViewRefreshInterval  time.Duration
	ReconfirmInterval    time.Duration
	CleanupInterval      time.Duration

	PresenceFlushInterval time.Duration
	PresencePacketTTL     time.Duration

	// ClockDriftThreshold is the |device clock - server clock| magnitude, measured from a
	// node's ADVERT timestamp, above which the node API reports clockOutOfSync=true for
	// that node. Only meaningful for repeaters/room servers (nodeType 2/3).
	ClockDriftThreshold time.Duration

	// NodeStaleThreshold and NodeDeleteAfter mirror ClockDriftThreshold's "0 means unset,
	// resolve to a default" pattern -- see NodesConfig.
	NodeStaleThreshold time.Duration
	NodeDeleteAfter    time.Duration
	// NodeIATAMembershipTTL bounds current node-to-IATA membership; see NodesConfig.
	NodeIATAMembershipTTL time.Duration
	// ObserverDeleteAfter is how long an observer can go unheard before the cleanup job
	// deletes it; see ObserversConfig.
	ObserverDeleteAfter time.Duration
	// MeshCoreRegionFreshness is how long a MeshCore region-scope confirmation counts as
	// fresh; see NeighborsConfig.
	MeshCoreRegionFreshness time.Duration
	// RoutePlan* mirrors the routeplan: config block (see RoutePlanConfig);
	// resolve to defaults when unset.
	RoutePlanUnmeasuredPenalty float64
	RoutePlanSNRGoodDB         float64
	RoutePlanSNRBadDB          float64
	RoutePlanSNRMaxPenalty     float64
	RoutePlanNeighborBonus     float64
	RoutePlanSNRFreshness      time.Duration
	RoutePlanMaxHops           int
	RoutePlanMaxAlternatives   int
}

// PresenceConfig controls coalescing of presence bookkeeping writes
// (observer last_seen, observer_brokers, packet last_heard_at bumps).
type PresenceConfig struct {
	// FlushInterval is how often coalesced bumps are flushed to Postgres.
	// Defaults to 30s if not set.
	FlushInterval duration `yaml:"flush_interval"`

	// PacketTTL is how long a packet hash with no re-observations stays
	// coalesced before the next observation writes through again.
	// Defaults to 30s if not set.
	PacketTTL duration `yaml:"packet_ttl"`
}

// BackgroundConfig controls the intervals for background maintenance tasks.
type BackgroundConfig struct {
	// ViewRefresh is how often materialized views are refreshed.
	// Defaults to 1h if not set.
	ViewRefresh duration `yaml:"view_refresh"`

	// Reconfirm prunes stale and ambiguous resolved paths and neigbors.
	Reconfirm duration `yaml:"reconfirm"`

	// Cleanup is how often old telemetry and packet rows are pruned.
	// Defaults to 1h if not set.
	Cleanup duration `yaml:"cleanup"`
}

// CORSConfig controls Cross-Origin Resource Sharing behaviour.
// If omitted, Beacon defaults to allowing all origins, which is appropriate
// for a public read-only API. Operators exposing write endpoints should
// restrict AllowedOrigins to known frontends.
type CORSConfig struct {
	// AllowedOrigins is the list of origins permitted to make cross-origin
	// requests. Use ["*"] to allow all origins (default if omitted).
	AllowedOrigins []string `yaml:"allowed_origins"`

	// AllowedMethods is the list of HTTP methods allowed in CORS requests.
	// Defaults to [GET, HEAD, OPTIONS] if omitted.
	AllowedMethods []string `yaml:"allowed_methods"`

	// AllowedHeaders is the list of request headers allowed in CORS requests.
	// Defaults to [Accept, Authorization, Content-Type] if omitted.
	AllowedHeaders []string `yaml:"allowed_headers"`

	// AllowCredentials indicates whether the request can include user
	// credentials (cookies, HTTP authentication). Defaults to false.
	AllowCredentials bool `yaml:"allow_credentials"`

	// MaxAge is the number of seconds the browser may cache a preflight
	// response. Defaults to 300 if omitted.
	MaxAge int `yaml:"max_age"`
}

// CacheConfig controls Redis caching behaviour.
// If Addr is not set (via REDIS_ADDR env var), caching is disabled entirely
// and Beacon falls back to querying PostgreSQL directly for all reads.
type CacheConfig struct {
	// TTL is the default cache entry lifetime applied to all categories
	// that do not have an explicit override in TTLs. Defaults to 1h if not set.
	TTL duration `yaml:"ttl"`

	// TTLs holds optional per-category TTL overrides. Any category left
	// at zero will fall back to TTL.
	TTLs CacheTTLsConfig `yaml:"ttls"`
}

// CacheTTLsConfig holds per-category TTL overrides for the cache layer.
// Each field is optional — omit it in config to inherit the global TTL.
type CacheTTLsConfig struct {
	// Stats controls the TTL for aggregated network statistics endpoints
	// (overview, observations, payload breakdown, top nodes/observers, radio presets, scope stats).
	// These are backed by materialized views refreshed hourly, so values under 1m are rarely useful.
	Stats duration `yaml:"stats"`

	// Reference controls the TTL for mostly-static reference data
	// (IATAs, regions, scopes). These change only when new observers
	// arrive or config is reseeded.
	Reference duration `yaml:"reference"`

	// Nodes controls the TTL for individual node detail responses.
	// Acts as a safety-net expiry alongside explicit invalidation on upsert.
	Nodes duration `yaml:"nodes"`

	// Observers controls the TTL for individual observer detail responses.
	// Acts as a safety-net expiry alongside explicit invalidation on upsert.
	Observers duration `yaml:"observers"`
}

// ScopeConfig defines a regional transport scope.
// Name can be provided with or without the # or $ prefix.
// Beacon normalizes plain names by prepending #.
type ScopeConfig struct {
	Name string `yaml:"name"` // e.g. "bc", "#west", "$private"
}

// TelemetryConfig controls observer telemetry storage behaviour.
type TelemetryConfig struct {
	// Retention is how long telemetry rows are kept before the cleanup job removes them.
	// Defaults to 672h (4 weeks) if not set.
	Retention duration `yaml:"retention"`

	// Resolution is how frequently a telemetry snapshot is stored per observer.
	// Status messages arriving within the same resolution window are deduplicated.
	// Defaults to 1h if not set.
	Resolution duration `yaml:"resolution"`
}

// WebSocketConfig controls WebSocket connection behaviour.
// Settings here apply to the /ws endpoint only.
type WebSocketConfig struct {
	// MaxConnectionsPerIP is the maximum number of concurrent WebSocket
	// connections allowed from a single IP address. Defaults to 5 if not set.
	MaxConnectionsPerIP int `yaml:"max_connections_per_ip"`
}

// PacketsConfig controls packet retention behaviour.
type PacketsConfig struct {
	// Retention is how long packet and observation rows are kept.
	// Defaults to 720h (30 days) if not set.
	Retention duration `yaml:"retention"`
}

// RoutesConfig controls known-route retention behaviour.
type RoutesConfig struct {
	// Retention is how long a route is kept after it was last observed.
	// Defaults to 336h (14 days) if not set.
	Retention duration `yaml:"retention"`
	// Grace is how long a route observed fewer than MinObservations times is
	// kept. Defaults to 168h (7 days) if not set.
	Grace duration `yaml:"grace"`
	// MinObservations is the observation count below which Grace applies
	// instead of Retention. Defaults to 3 if not set.
	MinObservations int `yaml:"min_observations"`
}

// NeighborsConfig controls node_neighbors edges: how long they live and how
// far apart two nodes may be for a direct LoRa neighbor claim to be believed.
type NeighborsConfig struct {
	// Retention is how long a neighbor edge survives without a fresh
	// confirmation (a 3-byte-path packet or a /neighbors report).
	// Defaults to 168h (7 days) if not set.
	Retention duration `yaml:"retention"`
	// MaxDistanceKm is the great-circle distance beyond which two nodes with
	// known coordinates cannot be direct LoRa neighbors. Packets and /neighbors
	// reports cross IATA areas via MQTT interconnects, and those hops are not
	// radio hops — edges longer than this are refused, and a /neighbors report
	// containing even one such impossible pair is discarded whole.
	// Defaults to 150 km if not set.
	MaxDistanceKm float64 `yaml:"max_distance_km"`
	// RegionScopeFreshness is how long a MeshCore region-scope confirmation
	// (observer self-report or a neighbor entry answered with
	// status == "responded") keeps counting as current for the map's MeshCore
	// Region filter and discovery. A timeout/failure preserves the old value
	// and its old confirmation timestamp. Defaults to 168h (7 days) if not
	// set, matching the /neighbors retention window.
	RegionScopeFreshness duration `yaml:"region_scope_freshness"`
}

// RoutePlanConfig tunes the /routes/best route planner's edge cost model.
// Every leg costs a 1.0 base per hop plus a signal term: a fresh SNR reading
// between SNRGoodDB (no extra cost) and SNRBadDB (full SNRMaxPenalty) is
// linearly interpolated; unmeasured or stale-SNR legs pay UnmeasuredPenalty
// instead. UnmeasuredPenalty must be >= SNRMaxPenalty so a measured leg always
// beats an unmeasured one. SNRFreshness bounds how old an SNR reading may be
// before it counts as unmeasured.
//
// NeighborBonus discounts legs whose endpoints explicitly marked each other as
// neighbors (a DIRECT row in node_neighbors): the mesh's own statement that
// the hop is real outranks an equally-measured overheard leg. It must stay
// below (UnmeasuredPenalty - SNRMaxPenalty) so it can never promote an
// unmeasured leg above a measured one.
type RoutePlanConfig struct {
	UnmeasuredPenalty float64  `yaml:"unmeasured_penalty"`
	SNRGoodDB         float64  `yaml:"snr_good_db"`
	SNRBadDB          float64  `yaml:"snr_bad_db"`
	SNRMaxPenalty     float64  `yaml:"snr_max_penalty"`
	NeighborBonus     float64  `yaml:"neighbor_bonus"`
	SNRFreshness      duration `yaml:"snr_freshness"`
	MaxHops           int      `yaml:"max_hops"`
	MaxAlternatives   int      `yaml:"max_alternatives"`
}

// ObserversConfig controls observer row retention behaviour.
type ObserversConfig struct {
	// DeleteAfter is how long an observer can go without being heard (packet,
	// status, or neighbors traffic, all of which refresh observers.last_seen)
	// before the cleanup job deletes the observer row and its cascade-owned
	// metadata. Historical packet observations are preserved: they keep a
	// snapshot of the observer's identity and fall back to the packets'
	// separate 30-day retention window. Defaults to 336h (14 days) if not set.
	DeleteAfter duration `yaml:"delete_after"`
}

// NodesConfig controls node-derived signal thresholds.
type NodesConfig struct {
	// ClockDriftThreshold is the |device clock - server clock| magnitude, measured from a
	// repeater/room server's ADVERT timestamp, above which the node API reports
	// clockOutOfSync=true for that node. Defaults to 5m if not set.
	ClockDriftThreshold duration `yaml:"clock_drift_threshold"`
	// StaleThreshold is how long since a node's last_seen before the node API reports
	// stale=true for it. Defaults to 24h if not set.
	StaleThreshold duration `yaml:"stale_threshold"`
	// DeleteAfter is how long since a node's last_seen before the cleanup job deletes the
	// node entirely. Defaults to the same 30-day default as packets.retention if not set --
	// independently configurable from it, just the same starting point.
	DeleteAfter duration `yaml:"delete_after"`
	// IATAMembershipTTL is how long a node_iatas row counts as current regional membership
	// after its last_heard. Stale rows remain stored for history but stop producing badges
	// and stop matching IATA-scoped queries. Defaults to 7 days if not set, matching the
	// neighbor retention window — a node not heard on an IATA for a week no longer counts
	// as a member of that IATA.
	IATAMembershipTTL duration `yaml:"iata_membership_ttl"`
}

// duration is a wrapper around time.Duration that supports YAML unmarshalling
// from human-readable strings like "24h", "7d", "30d".
type duration struct {
	time.Duration
}

func (d *duration) UnmarshalYAML(value *yaml.Node) error {
	var s string
	if err := value.Decode(&s); err != nil {
		return err
	}
	parsed, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	d.Duration = parsed
	return nil
}

// ChannelKeysConfig holds both hashtag-derived and explicit channel keys.
// Hashtag keys are derived automatically: secret = SHA256("#tag")[:16],
// channel_hash = SHA256(secret)[0]. Explicit keys are provided as hex strings
// keyed by the channel hash hex (e.g. "11" for 0x11).
type ChannelKeysConfig struct {
	// Hashtags is a list of hashtag names (without the # prefix).
	// Beacon derives the PSK and channel hash automatically.
	Hashtags []string `yaml:"hashtags"`

	// Keys maps channel hash hex → explicit key config.
	Keys map[string]ExplicitKeyConfig `yaml:"keys"`
}

// ExplicitKeyConfig holds an explicit channel key and its semantic metadata.
type ExplicitKeyConfig struct {
	Key    string `yaml:"key"`    // hex-encoded key bytes
	Name   string `yaml:"name"`   // optional display name
	Public bool   `yaml:"public"` // true only for the MeshCore public channel
}

// IATAConfig holds optional overrides for a known IATA code.
type IATAConfig struct {
	Name string   `yaml:"name"`
	Lat  *float64 `yaml:"lat"`
	Lng  *float64 `yaml:"lng"`
	// BorderFile is a path to a GeoJSON Feature file (Polygon or MultiPolygon geometry) for
	// this IATA's region border map. Relative paths are resolved against the directory
	// containing the main config file (see Load). Validated and bbox-computed at seed time --
	// see border.go.
	BorderFile string `yaml:"borderFile"`
}

// RegionConfig defines a super-region and its member IATAs.
type RegionConfig struct {
	Slug         string   `yaml:"slug"`
	Name         string   `yaml:"name"`
	Description  string   `yaml:"description"`
	DisplayOrder int      `yaml:"display_order"`
	CenterLat    *float64 `yaml:"center_lat"`
	CenterLng    *float64 `yaml:"center_lng"`
	ZoomLevel    *int     `yaml:"zoom_level"`
	IATAs        []string `yaml:"iatas"`
	// ShortCode is an optional compact display code for the region (e.g. "SWE").
	ShortCode string `yaml:"short_code"`
	// Root marks this region as the deployment's root scope: the selector's no-filter
	// state borrows this region's user-facing identity. At most one region may set it.
	Root bool `yaml:"root"`
}

// IngestFilterConfig restricts which packets Beacon stores based on the
// observer's IATA geographic location. Both filters are optional — if neither
// is set all IATAs are accepted. If both are set an IATA passes if it matches
// either (OR semantics).
//
// Country codes are ISO 3166-1 alpha-2 (e.g. "CA", "US").
// Continent codes are two-letter OurAirports codes: AF, AN, AS, EU, NA, OC, SA.
type IngestFilterConfig struct {
	OwnerMetadata bool `yaml:"owner_metadata"` // optional separate Role 1 subscription for owner claims
	// AllowCountries is a list of ISO 3166-1 alpha-2 country codes to accept.
	// Packets from observers in other countries are dropped at ingest.
	AllowCountries []string `yaml:"allow_countries"`

	// AllowContinents is a list of continent codes to accept.
	// Packets from observers in other continents are dropped at ingest.
	AllowContinents []string `yaml:"allow_continents"`
}

// Validate rejects configs that designate more than one root region: the selector's
// no-filter state can only borrow one region's user-facing identity.
func (c *Config) Validate() error {
	roots := 0
	for _, r := range c.Regions {
		if r.Root {
			roots++
		}
	}
	if roots > 1 {
		return fmt.Errorf("config: at most one region may set root: true (found %d)", roots)
	}
	if err := c.RoutePlan.Validate(); err != nil {
		return err
	}
	return nil
}

// Defaults for the route planner cost model; see RoutePlanConfig.
const (
	DefaultRoutePlanUnmeasuredPenalty = 2.5
	DefaultRoutePlanSNRGoodDB         = 5.0
	DefaultRoutePlanSNRBadDB          = -15.0
	DefaultRoutePlanSNRMaxPenalty     = 2.0
	// DefaultRoutePlanNeighborBonus discounts an explicitly marked neighbor
	// leg. 0.4 sits strictly inside the measured band (worst measured pays
	// 2.0): it outranks an equally-measured overheard leg but can never lift
	// an unmeasured leg (2.5) above even the worst measured one (2.5-0.4=2.1 > 2.0).
	DefaultRoutePlanNeighborBonus   = 0.4
	DefaultRoutePlanMaxHops         = 12
	DefaultRoutePlanMaxAlternatives = 2
)

// DefaultRoutePlanSNRFreshness is the default SNRFreshness (7 days, matching the
// neighbor retention window an SNR confirmation ages with).
var DefaultRoutePlanSNRFreshness = 7 * 24 * time.Hour

// Validate rejects incoherent planner weights: good must beat bad (strictly,
// otherwise the interpolation has no range), penalties must be non-negative,
// an unmeasured leg must never beat the worst measured one, and the neighbor
// bonus must fit strictly inside that gap so it reorders within the measured
// band (or within unmeasured) but never promotes unmeasured above measured.
func (c *RoutePlanConfig) Validate() error {
	if c.SNRGoodDB <= c.SNRBadDB && (c.SNRGoodDB != 0 || c.SNRBadDB != 0) {
		return fmt.Errorf("config: routeplan.snr_good_db (%v) must exceed snr_bad_db (%v)", c.SNRGoodDB, c.SNRBadDB)
	}
	if c.UnmeasuredPenalty < 0 || c.SNRMaxPenalty < 0 || c.NeighborBonus < 0 {
		return fmt.Errorf("config: routeplan penalties and neighbor_bonus must be non-negative")
	}
	if c.UnmeasuredPenalty != 0 && c.SNRMaxPenalty != 0 && c.UnmeasuredPenalty < c.SNRMaxPenalty {
		return fmt.Errorf("config: routeplan.unmeasured_penalty (%v) must be >= snr_max_penalty (%v)", c.UnmeasuredPenalty, c.SNRMaxPenalty)
	}
	gap := c.UnmeasuredPenalty - c.SNRMaxPenalty
	if c.NeighborBonus != 0 && gap != 0 && c.NeighborBonus >= gap {
		return fmt.Errorf("config: routeplan.neighbor_bonus (%v) must be < unmeasured_penalty - snr_max_penalty (%v)", c.NeighborBonus, gap)
	}
	if c.MaxHops < 0 || c.MaxAlternatives < 0 {
		return fmt.Errorf("config: routeplan max_hops and max_alternatives must be non-negative")
	}
	return nil
}

// Load reads and parses the config file at path.
// Returns an empty Config (not an error) if the file does not exist,
// so Beacon starts cleanly without a config file.
func Load(path string) (*Config, error) {
	cfg := &Config{}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return cfg, nil
		}
		return nil, err
	}
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, err
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	configDir := filepath.Dir(path)
	for iata, details := range cfg.IATAs {
		if details.BorderFile != "" && !filepath.IsAbs(details.BorderFile) {
			details.BorderFile = filepath.Join(configDir, details.BorderFile)
			cfg.IATAs[iata] = details
		}
	}
	return cfg, nil
}

// Resolve returns a ResolvedConfig with defaults applied for any zero values.
func Resolve(cfg *Config) ResolvedConfig {
	r := ResolvedConfig{
		TelemetryResolution:  cfg.Telemetry.Resolution.Duration,
		TelemetryRetention:   cfg.Telemetry.Retention.Duration,
		PacketRetention:      cfg.Packets.Retention.Duration,
		RouteRetention:       cfg.Routes.Retention.Duration,
		NeighborRetention:    cfg.Neighbors.Retention.Duration,
		NeighborMaxKm:        cfg.Neighbors.MaxDistanceKm,
		RouteGrace:           cfg.Routes.Grace.Duration,
		RouteMinObservations: cfg.Routes.MinObservations,
		MaxConnsPerIP:        cfg.WebSocket.MaxConnectionsPerIP,
		ViewRefreshInterval:  cfg.Background.ViewRefresh.Duration,
		ReconfirmInterval:    cfg.Background.Reconfirm.Duration,
		CleanupInterval:      cfg.Background.Cleanup.Duration,

		PresenceFlushInterval: cfg.Presence.FlushInterval.Duration,
		PresencePacketTTL:     cfg.Presence.PacketTTL.Duration,

		ClockDriftThreshold:     cfg.Nodes.ClockDriftThreshold.Duration,
		NodeStaleThreshold:      cfg.Nodes.StaleThreshold.Duration,
		NodeDeleteAfter:         cfg.Nodes.DeleteAfter.Duration,
		NodeIATAMembershipTTL:   cfg.Nodes.IATAMembershipTTL.Duration,
		ObserverDeleteAfter:     cfg.Observers.DeleteAfter.Duration,
		MeshCoreRegionFreshness: cfg.Neighbors.RegionScopeFreshness.Duration,

		RoutePlanUnmeasuredPenalty: cfg.RoutePlan.UnmeasuredPenalty,
		RoutePlanSNRGoodDB:         cfg.RoutePlan.SNRGoodDB,
		RoutePlanSNRBadDB:          cfg.RoutePlan.SNRBadDB,
		RoutePlanSNRMaxPenalty:     cfg.RoutePlan.SNRMaxPenalty,
		RoutePlanNeighborBonus:     cfg.RoutePlan.NeighborBonus,
		RoutePlanSNRFreshness:      cfg.RoutePlan.SNRFreshness.Duration,
		RoutePlanMaxHops:           cfg.RoutePlan.MaxHops,
		RoutePlanMaxAlternatives:   cfg.RoutePlan.MaxAlternatives,
	}
	if r.TelemetryResolution == 0 {
		r.TelemetryResolution = time.Hour
	}
	if r.TelemetryRetention == 0 {
		r.TelemetryRetention = 28 * 24 * time.Hour
	}
	if r.PacketRetention == 0 {
		r.PacketRetention = 30 * 24 * time.Hour
	}
	if r.RouteRetention == 0 {
		r.RouteRetention = 14 * 24 * time.Hour
	}
	if r.NeighborRetention == 0 {
		r.NeighborRetention = 7 * 24 * time.Hour
	}
	if r.NeighborMaxKm == 0 {
		r.NeighborMaxKm = 150
	}
	if r.RouteGrace == 0 {
		r.RouteGrace = 7 * 24 * time.Hour
	}
	if r.RouteMinObservations == 0 {
		r.RouteMinObservations = 3
	}
	if r.MaxConnsPerIP == 0 {
		r.MaxConnsPerIP = 5
	}
	if r.ViewRefreshInterval == 0 {
		r.ViewRefreshInterval = time.Hour
	}
	if r.ReconfirmInterval == 0 {
		r.ReconfirmInterval = time.Hour
	}
	if r.CleanupInterval == 0 {
		r.CleanupInterval = time.Hour
	}
	if r.PresenceFlushInterval == 0 {
		r.PresenceFlushInterval = 30 * time.Second
	}
	if r.PresencePacketTTL == 0 {
		r.PresencePacketTTL = 30 * time.Second
	}
	if r.ClockDriftThreshold == 0 {
		r.ClockDriftThreshold = 5 * time.Minute
	}
	if r.NodeStaleThreshold == 0 {
		r.NodeStaleThreshold = 24 * time.Hour
	}
	if r.NodeDeleteAfter == 0 {
		// Same default as packets.retention (30 days) -- independently configurable, just
		// the same starting point, not tied to whatever PacketRetention resolves to.
		r.NodeDeleteAfter = 30 * 24 * time.Hour
	}
	if r.NodeIATAMembershipTTL == 0 {
		r.NodeIATAMembershipTTL = 7 * 24 * time.Hour
	}
	if r.ObserverDeleteAfter == 0 {
		r.ObserverDeleteAfter = 14 * 24 * time.Hour
	}
	if r.MeshCoreRegionFreshness == 0 {
		// Same default as neighbors.retention (7 days) — independently configurable, just
		// the same starting point, so region confirmations age with the neighbor edges.
		r.MeshCoreRegionFreshness = 7 * 24 * time.Hour
	}
	if r.RoutePlanUnmeasuredPenalty == 0 {
		r.RoutePlanUnmeasuredPenalty = DefaultRoutePlanUnmeasuredPenalty
	}
	if r.RoutePlanSNRGoodDB == 0 {
		r.RoutePlanSNRGoodDB = DefaultRoutePlanSNRGoodDB
	}
	if r.RoutePlanSNRBadDB == 0 {
		r.RoutePlanSNRBadDB = DefaultRoutePlanSNRBadDB
	}
	if r.RoutePlanSNRMaxPenalty == 0 {
		r.RoutePlanSNRMaxPenalty = DefaultRoutePlanSNRMaxPenalty
	}
	if r.RoutePlanNeighborBonus == 0 {
		r.RoutePlanNeighborBonus = DefaultRoutePlanNeighborBonus
	}
	if r.RoutePlanSNRFreshness == 0 {
		r.RoutePlanSNRFreshness = DefaultRoutePlanSNRFreshness
	}
	if r.RoutePlanMaxHops == 0 {
		r.RoutePlanMaxHops = DefaultRoutePlanMaxHops
	}
	if r.RoutePlanMaxAlternatives == 0 {
		r.RoutePlanMaxAlternatives = DefaultRoutePlanMaxAlternatives
	}
	return r
}

func (r ResolvedConfig) String() string {
	return fmt.Sprintf(
		"telemetryResolution=%s telemetryRetention=%s packetRetention=%s routeRetention=%s routeGrace=%s routeMinObs=%d neighborRetention=%s neighborMaxKm=%.0f maxConnsPerIP=%d viewRefresh=%s reconfirm=%s cleanup=%s presenceFlush=%s presencePacketTTL=%s clockDriftThreshold=%s nodeStaleThreshold=%s nodeDeleteAfter=%s nodeIataMembershipTTL=%s observerDeleteAfter=%s meshcoreRegionFreshness=%s routePlanUnmeasured=%.2f routePlanGood=%.1f routePlanBad=%.1f routePlanMaxPen=%.2f routePlanNeighborBonus=%.2f routePlanFresh=%s routePlanMaxHops=%d routePlanMaxAlt=%d",
		r.TelemetryResolution, r.TelemetryRetention, r.PacketRetention, r.RouteRetention, r.RouteGrace, r.RouteMinObservations,
		r.NeighborRetention,
		r.NeighborMaxKm,
		r.MaxConnsPerIP, r.ViewRefreshInterval, r.ReconfirmInterval, r.CleanupInterval,
		r.PresenceFlushInterval, r.PresencePacketTTL, r.ClockDriftThreshold,
		r.NodeStaleThreshold, r.NodeDeleteAfter, r.NodeIATAMembershipTTL, r.ObserverDeleteAfter, r.MeshCoreRegionFreshness,
		r.RoutePlanUnmeasuredPenalty, r.RoutePlanSNRGoodDB, r.RoutePlanSNRBadDB, r.RoutePlanSNRMaxPenalty,
		r.RoutePlanNeighborBonus,
		r.RoutePlanSNRFreshness, r.RoutePlanMaxHops, r.RoutePlanMaxAlternatives,
	)
}
