// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package routeplan

import (
	"context"
	"log"
	"sync/atomic"
	"time"

	db "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/google/uuid"
)

// SnapshotSource abstracts the PostgreSQL reads a snapshot rebuild needs so
// tests can supply synthetic rows without a database.
type SnapshotSource interface {
	GetRoutePlanGraph(ctx context.Context) ([]db.GetRoutePlanGraphRow, error)
	GetNodesByIDs(ctx context.Context, ids []uuid.UUID) ([]db.GetNodesByIDsRow, error)
}

// Snapshot is one immutable point-in-time routing view: the planning graph
// plus the pubkey->node index and per-node location needed to classify
// endpoints without a database round trip. Readers hold the pointer and never
// mutate it; rebuilds construct a replacement off to the side and swap
// atomically, so readers never observe a partially updated graph and a failed
// refresh leaves the previous known-good snapshot in service.
type Snapshot struct {
	Graph Graph
	// ByPubkey maps lowercase full-hex public key to node ID for O(1) endpoint
	// resolution without a database round trip.
	ByPubkey map[string]uuid.UUID
	// Located reports whether a node ID has coordinates (graph members always
	// do; isolated located nodes are recorded here too so they classify as
	// no-route rather than missing-position).
	Located map[uuid.UUID]bool
	BuiltAt time.Time
	// Rows is the raw dump size behind this snapshot (observability).
	Rows int
}

// BuildSnapshot constructs a snapshot from one PostgreSQL dump plus endpoint
// metadata. now anchors staleness; staleThreshold and maxKm mirror the store
// wiring. isolated maps node IDs known+located but absent from the graph (the
// caller fetches those via GetNodesByIDs); they enter Located/ByPubkey but
// not the planning graph itself.
func BuildSnapshot(rows []db.GetRoutePlanGraphRow, isolated map[uuid.UUID]nodeMeta, cfg Config, staleThreshold time.Duration, maxKm float64, now time.Time) *Snapshot {
	g := BuildGraph(rows, staleThreshold, maxKm, now)
	snap := &Snapshot{
		Graph:    g,
		ByPubkey: make(map[string]uuid.UUID, len(g.Nodes)+len(isolated)),
		Located:  make(map[uuid.UUID]bool, len(g.Nodes)+len(isolated)),
		BuiltAt:  now,
		Rows:     len(rows),
	}
	for id, n := range g.Nodes {
		snap.ByPubkey[n.Pubkey] = id
		snap.Located[id] = true
	}
	for id, m := range isolated {
		snap.Located[id] = m.Located
		if m.Pubkey != "" {
			snap.ByPubkey[m.Pubkey] = id
		}
	}
	return snap
}

// nodeMeta is the minimal per-node metadata for isolated endpoints.
type nodeMeta struct {
	Pubkey  string
	Located bool
}

// Holder keeps the current routing snapshot behind an atomic pointer with a
// bounded periodic refresh from PostgreSQL (the source of truth). A short
// periodic refresh is the documented freshness bound: routing data may lag
// PostgreSQL by at most RefreshInterval plus one rebuild duration. Refresh
// failures are logged and counted; the previous snapshot keeps serving.
type Holder struct {
	src      SnapshotSource
	cfg      atomic.Pointer[holderConfig]
	cur      atomic.Pointer[Snapshot]
	mu       chan struct{} // single-flight rebuild gate (capacity 1)
	lastOK   atomic.Int64  // unix nano of last successful rebuild
	lastErr  atomic.Int64  // unix nano of last failed rebuild
	failures atomic.Uint64
	builds   atomic.Uint64
	lastDur  atomic.Int64 // last rebuild duration, nanoseconds
}

type holderConfig struct {
	planner        Config
	staleThreshold time.Duration
	maxKm          float64
	refresh        time.Duration
}

// DefaultSnapshotRefreshInterval bounds how long routing data may lag
// PostgreSQL in steady state. 30s keeps direct/SNR freshness semantics (days)
// far above the lag while a ~2000-node rebuild stays off the request path.
const DefaultSnapshotRefreshInterval = 30 * time.Second

// NewHolder builds the initial snapshot synchronously (failing the caller on
// error: no known-good snapshot exists yet) and returns a holder that serves
// it until Refresh or Run is called. The initial build counts toward Builds
// and LastSuccess so observability reflects reality from startup.
func NewHolder(ctx context.Context, src SnapshotSource, planner Config, staleThreshold time.Duration, maxKm float64) (*Holder, error) {
	h := &Holder{src: src, mu: make(chan struct{}, 1)}
	h.cfg.Store(&holderConfig{planner: planner, staleThreshold: staleThreshold, maxKm: maxKm, refresh: DefaultSnapshotRefreshInterval})
	start := time.Now()
	snap, err := h.rebuild(ctx)
	h.lastDur.Store(int64(time.Since(start)))
	if err != nil {
		h.lastErr.Store(time.Now().UnixNano())
		h.failures.Add(1)
		return nil, err
	}
	h.cur.Store(snap)
	h.lastOK.Store(time.Now().UnixNano())
	h.builds.Add(1)
	return h, nil
}

// Current returns the snapshot readers must use. Never nil after NewHolder.
func (h *Holder) Current() *Snapshot {
	return h.cur.Load()
}

// SetConfig installs a new planner config/thresholds; the next refresh (or an
// explicit Refresh call) rebuilds under it.
func (h *Holder) SetConfig(planner Config, staleThreshold time.Duration, maxKm float64) {
	old := h.cfg.Load()
	refresh := DefaultSnapshotRefreshInterval
	if old != nil {
		refresh = old.refresh
	}
	h.cfg.Store(&holderConfig{planner: planner, staleThreshold: staleThreshold, maxKm: maxKm, refresh: refresh})
}

// SetRefreshInterval overrides the periodic bound (0 disables Run ticking;
// explicit Refresh still works).
func (h *Holder) SetRefreshInterval(d time.Duration) {
	old := h.cfg.Load()
	if old == nil {
		h.cfg.Store(&holderConfig{refresh: d})
		return
	}
	cp := *old
	cp.refresh = d
	h.cfg.Store(&cp)
}

// Refresh rebuilds off to the side and swaps atomically on success. Concurrent
// callers coalesce: at most one rebuild runs at a time and losers keep
// serving the current snapshot. On failure the previous snapshot stays in
// service and the error is returned for logging/metrics.
func (h *Holder) Refresh(ctx context.Context) error {
	select {
	case h.mu <- struct{}{}:
		defer func() { <-h.mu }()
	default:
		return nil // a rebuild is already running; keep serving current
	}
	start := time.Now()
	snap, err := h.rebuild(ctx)
	h.lastDur.Store(int64(time.Since(start)))
	if err != nil {
		h.lastErr.Store(time.Now().UnixNano())
		h.failures.Add(1)
		return err
	}
	h.cur.Store(snap)
	h.lastOK.Store(time.Now().UnixNano())
	h.builds.Add(1)
	return nil
}

// Run ticks Refresh until ctx ends. A failed refresh never stops the loop.
func (h *Holder) Run(ctx context.Context) {
	cfg := h.cfg.Load()
	interval := DefaultSnapshotRefreshInterval
	if cfg != nil && cfg.refresh > 0 {
		interval = cfg.refresh
	}
	if interval <= 0 {
		return
	}
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := h.Refresh(ctx); err != nil {
				log.Printf("routeplan: snapshot refresh failed, serving previous snapshot: %v", err)
			}
		}
	}
}

// NewHolderForTest installs an already-built snapshot without touching a
// source. Test-only: production always builds through NewHolder/Refresh so
// counters and timestamps stay truthful.
func NewHolderForTest(snap *Snapshot) *Holder {
	h := &Holder{mu: make(chan struct{}, 1)}
	h.cfg.Store(&holderConfig{refresh: DefaultSnapshotRefreshInterval})
	if snap != nil {
		h.cur.Store(snap)
	}
	return h
}

// SwapForTest atomically replaces the current snapshot. Test-only.
func (h *Holder) SwapForTest(snap *Snapshot) {
	h.cur.Store(snap)
}

// Stats exposes snapshot age and rebuild health for metrics/logging.
type Stats struct {
	BuiltAt         time.Time
	Age             time.Duration
	Nodes           int
	Edges           int
	Rows            int
	Builds          uint64
	Failures        uint64
	LastBuildNanos  int64
	LastSuccessSecs int64
	LastErrorSecs   int64
}

// Stats snapshots current holder health. now is injected for tests.
func (h *Holder) Stats(now time.Time) Stats {
	snap := h.cur.Load()
	st := Stats{
		Builds:          h.builds.Load(),
		Failures:        h.failures.Load(),
		LastBuildNanos:  h.lastDur.Load(),
		LastSuccessSecs: h.lastOK.Load() / 1e9,
		LastErrorSecs:   h.lastErr.Load() / 1e9,
	}
	if snap != nil {
		st.BuiltAt = snap.BuiltAt
		st.Age = now.Sub(snap.BuiltAt)
		st.Nodes = len(snap.Graph.Nodes)
		st.Rows = snap.Rows
		for _, es := range snap.Graph.Edges {
			st.Edges += len(es)
		}
	}
	return st
}

func (h *Holder) rebuild(ctx context.Context) (*Snapshot, error) {
	cfg := h.cfg.Load()
	if cfg == nil {
		cfg = &holderConfig{refresh: DefaultSnapshotRefreshInterval}
	}
	rows, err := h.src.GetRoutePlanGraph(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	// Isolated endpoints: node IDs referenced nowhere in the dump cannot be
	// enumerated from it, so endpoint fallback still consults metadata at
	// request time (cheap indexed point lookups, never the global aggregate).
	// The snapshot therefore carries graph members only; isolation is decided
	// per request via Snapshot.Located plus a point lookup on miss.
	return BuildSnapshot(rows, nil, cfg.planner, cfg.staleThreshold, cfg.maxKm, now), nil
}
