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
	// resolve to defaults when unset. A nil pointer means "not configured" and
	// resolves to the default; an explicit value (including 0) is honored, so
	// operators can disable the neighbor bonus or alternatives with 0.
	RoutePlanUnmeasuredPenalty    float64
	RoutePlanSNRGoodDB            float64
	RoutePlanSNRBadDB             float64
	RoutePlanSNRMaxPenalty        float64
	RoutePlanSNRStrongCap         float64
	RoutePlanTrafficMaxDiscount   float64
	RoutePlanTrafficFullCount     float64
	RoutePlanTrafficMeasuredShare float64
	RoutePlanUnmeasuredFloor      float64
	// RoutePlanUnseenPenalty is the extra cost of a leg no packet was ever
	// observed crossing in that direction (see routeplan.Edge.Unseen): the
	// hop is topologically possible but never proven, so it pays a large
	// penalty and is flagged for the UI ("unconfirmed possible"). 0
	// disables the penalty (the flag is still reported).
	RoutePlanUnseenPenalty   float64
	RoutePlanNeighborBonus   float64
	RoutePlanSNRFreshness    time.Duration
	RoutePlanDirectFreshness time.Duration
	RoutePlanMaxHops         int
	RoutePlanMaxAlternatives int
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
// Each leg costs a signal term minus a traffic-evidence discount, floored
// per leg at SNRStrongCap: a fresh SNR reading at/above SNRGoodDB costs the
// cap; between SNRGoodDB and SNRBadDB the signal term interpolates toward
// SNRMaxPenalty with a kink at 0 dB (sub-zero readings degrade faster per
// dB, so every step down into the negative costs more than a step down
// while still positive); unmeasured or stale-SNR legs pay UnmeasuredPenalty
// as their signal term instead. UnmeasuredPenalty must be >= SNRMaxPenalty
// so a speculative leg (no traffic) always costs more than any measured leg.
// SNRFreshness bounds how old an SNR reading may be before it counts as
// unmeasured.
//
// Traffic evidence (the directed pair's merged observation_count) discounts
// the signal term on a log10 scale up to TrafficMaxDiscount at
// TrafficFullCount observations -- but ONLY for unambiguous evidence (see
// routeplan.Edge: exact pubkey identity or a 2+ byte hash that resolved to
// exactly one node globally, the same uniqueness rule the rest of the
// system holds). A 1-byte hash never discounts, legacy rows without
// provenance fail closed, a moved node deletes all its edges at ingest,
// and legs beyond the distance cap never plan. So hundreds of unambiguous
// passed packets discount far more than a handful, letting a
// proven-but-SNR-less hop outrank a weak measured hop with thin history.
// Unmeasured legs earn the full discount
// (traffic is their only quality signal, floored at UnmeasuredFloor);
// measured legs earn only TrafficMeasuredShare of it, so SNR stays the
// primary signal where it exists. TrafficMaxDiscount: 0 disables traffic
// evidence entirely (pure SNR model).
//
// UnseenPenalty is the extra cost of a leg no packet was ever observed
// crossing in that direction (merged observation_count == 0): the hop is
// topologically possible but unproven. The penalty (default 8.0) dwarfs
// every modeled difference, so any route avoiding the unseen hop wins
// unless no alternative exists within MaxHops -- the hop stays usable, so
// the graph never fragments. The leg is flagged for the UI ("unconfirmed
// possible"). 0 disables the penalty but keeps the flag.
//
// SNRStrongCap is the maximum cost of a single strong leg (fresh SNR at or
// above SNRGoodDB) and the floor for every discounted leg. Because it is
// well below 1.0, several strong measured hops can together cost less than
// one weak measured hop: the planner prefers more hops when each hop has a
// strong signal, instead of minimizing the hop count first. Must stay in
// (0, 1): non-positive would break Dijkstra, and >= 1 would restore
// hop-count dominance for strong legs. UnmeasuredFloor must stay above it
// so a fresh strong reading always wins per-leg.
//
// NeighborBonus discounts legs whose reporter explicitly marked the peer as a
// neighbor (a DIRECT row in node_neighbors for that directed pair): the
// reporter's own statement that the hop is real outranks an equally-measured
// overheard leg. It must stay below (UnmeasuredPenalty - SNRMaxPenalty) so it
// can never promote an unmeasured leg above a measured one. DirectFreshness
// bounds how old the direct confirmation may be before the bonus stops
// applying; it defaults to SNRFreshness (the neighbor retention window) when
// unset.
//
// All fields are pointers so "unset" (nil, resolve to default) is distinct
// from an explicit value: operators can disable the neighbor bonus or the
// alternatives with an explicit 0. Relation invariants are validated against
// the resolved values (see ValidateResolved), never against the raw partial
// config, so a partial block cannot pass validation and become invalid only
// after defaults are filled in.
type RoutePlanConfig struct {
	UnmeasuredPenalty *float64 `yaml:"unmeasured_penalty"`
	SNRGoodDB         *float64 `yaml:"snr_good_db"`
	SNRBadDB          *float64 `yaml:"snr_bad_db"`
	SNRMaxPenalty     *float64 `yaml:"snr_max_penalty"`
	SNRStrongCap      *float64 `yaml:"snr_strong_cap"`
	// TrafficMaxDiscount caps the traffic-evidence discount (see above).
	TrafficMaxDiscount *float64 `yaml:"traffic_max_discount"`
	// TrafficFullCount is the observation count earning the full discount.
	TrafficFullCount *float64 `yaml:"traffic_full_count"`
	// TrafficMeasuredShare is the 0..1 fraction of the traffic discount
	// applying to measured legs.
	TrafficMeasuredShare *float64 `yaml:"traffic_measured_share"`
	// UnmeasuredFloor is the cheapest an unmeasured leg can get.
	UnmeasuredFloor *float64 `yaml:"unmeasured_floor"`
	// UnseenPenalty is the extra cost of a never-observed directed hop.
	UnseenPenalty   *float64  `yaml:"unseen_penalty"`
	NeighborBonus   *float64  `yaml:"neighbor_bonus"`
	SNRFreshness    *duration `yaml:"snr_freshness"`
	DirectFreshness *duration `yaml:"direct_freshness"`
	MaxHops         *int      `yaml:"max_hops"`
	MaxAlternatives *int      `yaml:"max_alternatives"`
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
	// DefaultRoutePlanSNRStrongCap is the maximum cost of a single strong
	// leg (fresh SNR at/above goodDB). 0.25 means four strong hops cost the
	// same as one weak measured hop (1.0), so the planner routes around a
	// weak link via several strong ones instead of minimizing hop count.
	DefaultRoutePlanSNRStrongCap = 0.25
	// DefaultRoutePlanTrafficMaxDiscount is the largest discount proven
	// traffic can earn. 4.0 against the default unmeasured penalty 2.5
	// means a maximally proven unmeasured leg bottoms out at the
	// unmeasured floor instead of going free, while speculative legs
	// (a few observations) keep almost no discount.
	DefaultRoutePlanTrafficMaxDiscount = 4.0
	// DefaultRoutePlanTrafficFullCount earns the full traffic discount at
	// ~1000 observations (log10 scale: 100 obs earn ~2/3 of the max, 10
	// obs ~1/3). HuskvarnaS -> Gisebo style evidence (~1000+) discounts
	// nearly fully; a 3-packet leg barely moves.
	DefaultRoutePlanTrafficFullCount = 1000.0
	// DefaultRoutePlanTrafficMeasuredShare lets measured legs earn 1/8 of
	// the traffic discount: SNR stays the primary signal where it exists,
	// while traffic breaks ties between equally-measured legs.
	DefaultRoutePlanTrafficMeasuredShare = 0.125
	// DefaultRoutePlanUnmeasuredFloor is the cheapest an unmeasured leg can
	// get no matter the traffic. 0.4 sits above the strong cap (0.25) so a
	// fresh strong reading always wins per-leg, while proven traffic
	// (~1000+ obs) still beats any weak measured leg.
	DefaultRoutePlanUnmeasuredFloor = 0.4
	// DefaultRoutePlanUnseenPenalty is the extra cost of a leg no packet was
	// ever observed crossing in that direction. 8.0 dwarfs every modeled
	// difference (worst measured 2.0, bare unmeasured 2.5, full traffic
	// discount 4.0): any route avoiding the unseen hop wins unless no
	// alternative exists within MaxHops. The hop is still usable -- the
	// graph never fragments -- but flagged for the UI.
	DefaultRoutePlanUnseenPenalty = 8.0
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

// Validate checks the raw routeplan block for shape errors only (negative
// values, inverted good/bad). A nil field means "not configured" and is
// skipped here; relational invariants are enforced on the resolved values by
// ValidateResolved so partial configs cannot pass raw validation and become
// invalid only after defaults are applied. Load calls ValidateResolved on the
// resolved result, so callers get the full check.
func (c *RoutePlanConfig) Validate() error {
	if c.UnmeasuredPenalty != nil && *c.UnmeasuredPenalty < 0 {
		return fmt.Errorf("config: routeplan.unmeasured_penalty (%v) must be non-negative", *c.UnmeasuredPenalty)
	}
	if c.SNRMaxPenalty != nil && *c.SNRMaxPenalty < 0 {
		return fmt.Errorf("config: routeplan.snr_max_penalty (%v) must be non-negative", *c.SNRMaxPenalty)
	}
	if c.SNRStrongCap != nil && (*c.SNRStrongCap <= 0 || *c.SNRStrongCap >= 1) {
		return fmt.Errorf("config: routeplan.snr_strong_cap (%v) must be in (0, 1)", *c.SNRStrongCap)
	}
	if c.TrafficMaxDiscount != nil && *c.TrafficMaxDiscount < 0 {
		return fmt.Errorf("config: routeplan.traffic_max_discount (%v) must be non-negative", *c.TrafficMaxDiscount)
	}
	if c.TrafficFullCount != nil && *c.TrafficFullCount < 1 {
		return fmt.Errorf("config: routeplan.traffic_full_count (%v) must be >= 1", *c.TrafficFullCount)
	}
	if c.TrafficMeasuredShare != nil && (*c.TrafficMeasuredShare < 0 || *c.TrafficMeasuredShare > 1) {
		return fmt.Errorf("config: routeplan.traffic_measured_share (%v) must be in [0, 1]", *c.TrafficMeasuredShare)
	}
	if c.UnmeasuredFloor != nil && *c.UnmeasuredFloor < 0 {
		return fmt.Errorf("config: routeplan.unmeasured_floor (%v) must be non-negative", *c.UnmeasuredFloor)
	}
	if c.UnseenPenalty != nil && *c.UnseenPenalty < 0 {
		return fmt.Errorf("config: routeplan.unseen_penalty (%v) must be non-negative", *c.UnseenPenalty)
	}
	if c.NeighborBonus != nil && *c.NeighborBonus < 0 {
		return fmt.Errorf("config: routeplan.neighbor_bonus (%v) must be non-negative", *c.NeighborBonus)
	}
	if c.MaxHops != nil && *c.MaxHops < 0 {
		return fmt.Errorf("config: routeplan max_hops must be non-negative")
	}
	if c.MaxAlternatives != nil && *c.MaxAlternatives < 0 {
		return fmt.Errorf("config: routeplan max_alternatives must be non-negative")
	}
	if c.SNRGoodDB != nil && c.SNRBadDB != nil && *c.SNRGoodDB <= *c.SNRBadDB {
		return fmt.Errorf("config: routeplan.snr_good_db (%v) must exceed snr_bad_db (%v)", *c.SNRGoodDB, *c.SNRBadDB)
	}
	if c.SNRFreshness != nil && c.SNRFreshness.Duration < 0 {
		return fmt.Errorf("config: routeplan.snr_freshness must be non-negative")
	}
	if c.DirectFreshness != nil && c.DirectFreshness.Duration < 0 {
		return fmt.Errorf("config: routeplan.direct_freshness must be non-negative")
	}
	return nil
}

// ValidateResolved enforces every planner invariant against fully resolved
// values (defaults applied): good strictly beats bad, penalties and bonus are
// non-negative, a speculative unmeasured leg (no traffic) never beats the
// worst measured leg, the neighbor bonus fits strictly inside that gap, the
// strong-leg cap sits in (0, 1) so several strong hops can beat one weak
// hop, the unmeasured floor sits above the strong cap so a fresh strong
// reading always wins per-leg, traffic weights are shaped sanely, and every
// possible resulting edge cost is strictly positive for Dijkstra (measured
// strong/interpolated/bad plus unmeasured, each with and without the bonus).
// Limits must be consistent with the API behavior (non-negative;
// alternatives honor the handler cap).
func ValidateResolved(r ResolvedConfig) error {
	if r.RoutePlanSNRGoodDB <= r.RoutePlanSNRBadDB {
		return fmt.Errorf("config: routeplan.snr_good_db (%v) must exceed snr_bad_db (%v)", r.RoutePlanSNRGoodDB, r.RoutePlanSNRBadDB)
	}
	if r.RoutePlanSNRGoodDB <= 0 {
		return fmt.Errorf("config: routeplan.snr_good_db (%v) must be positive (the 0 dB kink needs a positive goodDB)", r.RoutePlanSNRGoodDB)
	}
	if r.RoutePlanSNRBadDB >= 0 {
		return fmt.Errorf("config: routeplan.snr_bad_db (%v) must be negative (the 0 dB kink needs a negative badDB)", r.RoutePlanSNRBadDB)
	}
	if r.RoutePlanUnmeasuredPenalty < 0 || r.RoutePlanSNRMaxPenalty < 0 || r.RoutePlanNeighborBonus < 0 {
		return fmt.Errorf("config: routeplan penalties and neighbor_bonus must be non-negative")
	}
	if r.RoutePlanSNRStrongCap <= 0 || r.RoutePlanSNRStrongCap >= 1 {
		return fmt.Errorf("config: routeplan.snr_strong_cap (%v) must be in (0, 1)", r.RoutePlanSNRStrongCap)
	}
	if r.RoutePlanTrafficMaxDiscount < 0 {
		return fmt.Errorf("config: routeplan.traffic_max_discount (%v) must be non-negative", r.RoutePlanTrafficMaxDiscount)
	}
	if r.RoutePlanTrafficFullCount < 1 {
		return fmt.Errorf("config: routeplan.traffic_full_count (%v) must be >= 1", r.RoutePlanTrafficFullCount)
	}
	if r.RoutePlanTrafficMeasuredShare < 0 || r.RoutePlanTrafficMeasuredShare > 1 {
		return fmt.Errorf("config: routeplan.traffic_measured_share (%v) must be in [0, 1]", r.RoutePlanTrafficMeasuredShare)
	}
	if r.RoutePlanUnmeasuredFloor < 0 {
		return fmt.Errorf("config: routeplan.unmeasured_floor (%v) must be non-negative", r.RoutePlanUnmeasuredFloor)
	}
	if r.RoutePlanUnseenPenalty < 0 {
		return fmt.Errorf("config: routeplan.unseen_penalty (%v) must be non-negative", r.RoutePlanUnseenPenalty)
	}
	if r.RoutePlanUnmeasuredFloor <= r.RoutePlanSNRStrongCap {
		return fmt.Errorf("config: routeplan.unmeasured_floor (%v) must exceed snr_strong_cap (%v) so a fresh strong reading always wins", r.RoutePlanUnmeasuredFloor, r.RoutePlanSNRStrongCap)
	}
	if r.RoutePlanUnmeasuredPenalty < r.RoutePlanSNRMaxPenalty {
		return fmt.Errorf("config: routeplan.unmeasured_penalty (%v) must be >= snr_max_penalty (%v)", r.RoutePlanUnmeasuredPenalty, r.RoutePlanSNRMaxPenalty)
	}
	gap := r.RoutePlanUnmeasuredPenalty - r.RoutePlanSNRMaxPenalty
	if r.RoutePlanNeighborBonus >= gap {
		return fmt.Errorf("config: routeplan.neighbor_bonus (%v) must be < unmeasured_penalty - snr_max_penalty (%v)", r.RoutePlanNeighborBonus, gap)
	}
	// Every resulting edge cost must be strictly positive. The cheapest
	// discounted legs: a weak measured leg pays maxPenalty minus the full
	// measured traffic share and the bonus (floored at the strong cap, so
	// positivity holds via the cap); an unmeasured leg pays the penalty
	// minus the full traffic discount and the bonus (floored at
	// unmeasured_floor, so positivity needs floor > 0 OR the unfloored
	// worst case positive). Strong capped legs never take discounts.
	if r.RoutePlanUnmeasuredFloor <= 0 &&
		r.RoutePlanUnmeasuredPenalty-r.RoutePlanTrafficMaxDiscount-r.RoutePlanNeighborBonus <= 0 {
		return fmt.Errorf("config: routeplan.unmeasured_penalty (%v) must exceed traffic_max_discount + neighbor_bonus (%v) when unmeasured_floor is 0, so every edge cost stays positive",
			r.RoutePlanUnmeasuredPenalty, r.RoutePlanTrafficMaxDiscount+r.RoutePlanNeighborBonus)
	}
	if r.RoutePlanSNRMaxPenalty-r.RoutePlanTrafficMaxDiscount*r.RoutePlanTrafficMeasuredShare-r.RoutePlanNeighborBonus <= 0 &&
		r.RoutePlanSNRStrongCap <= 0 {
		return fmt.Errorf("config: routeplan penalties minus traffic share and neighbor_bonus must stay positive (or snr_strong_cap must floor them)")
	}
	if r.RoutePlanMaxHops < 0 || r.RoutePlanMaxAlternatives < 0 {
		return fmt.Errorf("config: routeplan max_hops and max_alternatives must be non-negative")
	}
	if r.RoutePlanSNRFreshness < 0 || r.RoutePlanDirectFreshness < 0 {
		return fmt.Errorf("config: routeplan freshness windows must be non-negative")
	}
	return nil
}

// Load reads and parses the config file at path.
// Returns an empty Config (not an error) if the file does not exist,
// so Beacon starts cleanly without a config file. Validation runs against
// the resolved config (see ValidateResolved) so partial blocks that only
// become invalid once defaults are applied are still rejected.
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
	if err := ValidateResolved(Resolve(cfg)); err != nil {
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

// Resolve returns a ResolvedConfig with defaults applied for any unset
// (nil) routeplan value. An explicit value -- including 0 -- is always
// honored, so operators can disable the neighbor bonus or the alternatives
// with 0. Callers that need the invariant check should run ValidateResolved
// on the result (Load already does).
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

		RoutePlanUnmeasuredPenalty:    derefFloat(cfg.RoutePlan.UnmeasuredPenalty, DefaultRoutePlanUnmeasuredPenalty),
		RoutePlanSNRGoodDB:            derefFloat(cfg.RoutePlan.SNRGoodDB, DefaultRoutePlanSNRGoodDB),
		RoutePlanSNRBadDB:             derefFloat(cfg.RoutePlan.SNRBadDB, DefaultRoutePlanSNRBadDB),
		RoutePlanSNRMaxPenalty:        derefFloat(cfg.RoutePlan.SNRMaxPenalty, DefaultRoutePlanSNRMaxPenalty),
		RoutePlanSNRStrongCap:         derefFloat(cfg.RoutePlan.SNRStrongCap, DefaultRoutePlanSNRStrongCap),
		RoutePlanTrafficMaxDiscount:   derefFloat(cfg.RoutePlan.TrafficMaxDiscount, DefaultRoutePlanTrafficMaxDiscount),
		RoutePlanTrafficFullCount:     derefFloat(cfg.RoutePlan.TrafficFullCount, DefaultRoutePlanTrafficFullCount),
		RoutePlanTrafficMeasuredShare: derefFloat(cfg.RoutePlan.TrafficMeasuredShare, DefaultRoutePlanTrafficMeasuredShare),
		RoutePlanUnmeasuredFloor:      derefFloat(cfg.RoutePlan.UnmeasuredFloor, DefaultRoutePlanUnmeasuredFloor),
		RoutePlanUnseenPenalty:        derefFloat(cfg.RoutePlan.UnseenPenalty, DefaultRoutePlanUnseenPenalty),
		RoutePlanNeighborBonus:        derefFloat(cfg.RoutePlan.NeighborBonus, DefaultRoutePlanNeighborBonus),
		RoutePlanSNRFreshness:         derefDuration(cfg.RoutePlan.SNRFreshness, DefaultRoutePlanSNRFreshness),
		RoutePlanDirectFreshness:      derefDuration(cfg.RoutePlan.DirectFreshness, 0),
		RoutePlanMaxHops:              derefInt(cfg.RoutePlan.MaxHops, DefaultRoutePlanMaxHops),
		RoutePlanMaxAlternatives:      derefInt(cfg.RoutePlan.MaxAlternatives, DefaultRoutePlanMaxAlternatives),
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
	// RoutePlanDirectFreshness defaults to the SNR freshness (the neighbor
	// retention window) when unset; an explicit value -- including 0, which
	// disables the bonus -- is honored. Note this defaulting happens here in
	// Resolve (nil -> copy SNR freshness), so FromResolved must copy the
	// resolved value WITHOUT a fallback: an explicit 0 reaches the planner
	// as 0 and LegCost/IsFreshNeighbor treat DirectFreshness <= 0 as
	// "no confirmation is ever fresh".
	if cfg.RoutePlan.DirectFreshness == nil {
		r.RoutePlanDirectFreshness = r.RoutePlanSNRFreshness
	}
	return r
}

// derefFloat returns the pointed-to value, or def when the pointer is nil
// (unset). An explicit zero is honored.
func derefFloat(p *float64, def float64) float64 {
	if p == nil {
		return def
	}
	return *p
}

// derefInt returns the pointed-to value, or def when the pointer is nil
// (unset). An explicit zero is honored.
func derefInt(p *int, def int) int {
	if p == nil {
		return def
	}
	return *p
}

// derefDuration returns the pointed-to duration, or def when the pointer is
// nil (unset). An explicit zero is honored.
func derefDuration(p *duration, def time.Duration) time.Duration {
	if p == nil {
		return def
	}
	return p.Duration
}

func (r ResolvedConfig) String() string {
	return fmt.Sprintf(
		"telemetryResolution=%s telemetryRetention=%s packetRetention=%s routeRetention=%s routeGrace=%s routeMinObs=%d neighborRetention=%s neighborMaxKm=%.0f maxConnsPerIP=%d viewRefresh=%s reconfirm=%s cleanup=%s presenceFlush=%s presencePacketTTL=%s clockDriftThreshold=%s nodeStaleThreshold=%s nodeDeleteAfter=%s nodeIataMembershipTTL=%s observerDeleteAfter=%s meshcoreRegionFreshness=%s routePlanUnmeasured=%.2f routePlanGood=%.1f routePlanBad=%.1f routePlanMaxPen=%.2f routePlanStrongCap=%.2f routePlanTrafficMax=%.2f routePlanTrafficFull=%.0f routePlanTrafficShare=%.3f routePlanUnmeasFloor=%.2f routePlanUnseenPen=%.2f routePlanNeighborBonus=%.2f routePlanFresh=%s routePlanDirectFresh=%s routePlanMaxHops=%d routePlanMaxAlt=%d",
		r.TelemetryResolution, r.TelemetryRetention, r.PacketRetention, r.RouteRetention, r.RouteGrace, r.RouteMinObservations,
		r.NeighborRetention,
		r.NeighborMaxKm,
		r.MaxConnsPerIP, r.ViewRefreshInterval, r.ReconfirmInterval, r.CleanupInterval,
		r.PresenceFlushInterval, r.PresencePacketTTL, r.ClockDriftThreshold,
		r.NodeStaleThreshold, r.NodeDeleteAfter, r.NodeIATAMembershipTTL, r.ObserverDeleteAfter, r.MeshCoreRegionFreshness,
		r.RoutePlanUnmeasuredPenalty, r.RoutePlanSNRGoodDB, r.RoutePlanSNRBadDB, r.RoutePlanSNRMaxPenalty,
		r.RoutePlanSNRStrongCap,
		r.RoutePlanTrafficMaxDiscount, r.RoutePlanTrafficFullCount, r.RoutePlanTrafficMeasuredShare,
		r.RoutePlanUnmeasuredFloor,
		r.RoutePlanUnseenPenalty,
		r.RoutePlanNeighborBonus,
		r.RoutePlanSNRFreshness, r.RoutePlanDirectFreshness, r.RoutePlanMaxHops, r.RoutePlanMaxAlternatives,
	)
}
