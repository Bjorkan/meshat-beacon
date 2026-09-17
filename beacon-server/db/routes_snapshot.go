// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"log"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/api/routeplan"
	"github.com/google/uuid"
)

// This file is the Store's adapter over routeplan.Holder -- the single
// snapshot manager. PostgreSQL stays the source of truth; steady-state
// planning reads the Holder's immutable snapshot instead of rebuilding the
// global graph per request. Holder owns the concurrency/freshness logic
// (atomic swap, single-flight rebuilds, build/failure counters); the Store
// only adapts its querier as a SnapshotSource and logs the Holder's health
// stats on every refresh.

// storeSnapshotSource adapts the Store's sqlc querier to
// routeplan.SnapshotSource so Holder.rebuild reads through the same queries
// as the rest of the store.
type storeSnapshotSource struct {
	q sqlc.Querier
}

func (s storeSnapshotSource) GetRoutePlanGraph(ctx context.Context) ([]sqlc.GetRoutePlanGraphRow, error) {
	return s.q.GetRoutePlanGraph(ctx)
}

func (s storeSnapshotSource) GetNodesByIDs(ctx context.Context, ids []uuid.UUID) ([]sqlc.GetNodesByIDsRow, error) {
	return s.q.GetNodesByIDs(ctx, ids)
}

// routeSnapshotOrNil returns the current snapshot, or nil when none has been
// installed yet (startup/tests fall back to a single PostgreSQL dump).
func (s *Store) routeSnapshotOrNil() *routeplan.Snapshot {
	if s == nil {
		return nil
	}
	h := s.routeHolderOrNil()
	if h == nil {
		return nil
	}
	return h.Current()
}

func (s *Store) routeHolderOrNil() *routeplan.Holder {
	s.routeSnapMu.RLock()
	defer s.routeSnapMu.RUnlock()
	return s.routeHolder
}

// SetRouteSnapshot atomically installs a rebuilt snapshot. Build the
// replacement off to the side and swap only on success; readers never observe
// a partial graph and a failed rebuild leaves the previous snapshot serving.
// (Kept for tests/callers that construct snapshots directly; production
// refreshes through RefreshRouteSnapshot + Holder below.)
func (s *Store) SetRouteSnapshot(snap *routeplan.Snapshot) {
	s.routeSnapMu.Lock()
	defer s.routeSnapMu.Unlock()
	if s.routeHolder == nil {
		s.routeHolder = routeplan.NewHolderForTest(snap)
		return
	}
	s.routeHolder.SwapForTest(snap)
}

// RefreshRouteSnapshot rebuilds the snapshot through the Holder (single
// flight, atomic swap, counters) and logs freshness/health: age, node/edge
// counts, rebuild duration, success/failure counts. On error the previous
// snapshot keeps serving and the error is returned to the caller. The first
// call creates the Holder, whose initial build already is the refresh -- no
// second aggregate query follows.
func (s *Store) RefreshRouteSnapshot(ctx context.Context) error {
	h := s.routeHolderOrNil()
	if h == nil {
		s.routeSnapMu.Lock()
		if s.routeHolder == nil {
			cfg := s.routePlanOrDefault()
			nh, err := routeplan.NewHolder(ctx, storeSnapshotSource{q: s.q}, cfg.Cost, s.staleThresholdOrDefault(), s.neighborMaxKmOrDefault(cfg))
			if err != nil {
				s.routeSnapMu.Unlock()
				return err
			}
			s.routeHolder = nh
			h = nh
			s.routeSnapMu.Unlock()
			st := h.Stats(time.Now())
			log.Printf("routeplan: snapshot age=%s nodes=%d edges=%d rows=%d rebuild=%s builds=%d failures=%d",
				st.Age, st.Nodes, st.Edges, st.Rows, time.Duration(st.LastBuildNanos), st.Builds, st.Failures)
			return nil
		}
		h = s.routeHolder
		s.routeSnapMu.Unlock()
	} else {
		// Keep planner config/thresholds current across config reloads.
		cfg := s.routePlanOrDefault()
		h.SetConfig(cfg.Cost, s.staleThresholdOrDefault(), s.neighborMaxKmOrDefault(cfg))
	}
	if err := h.Refresh(ctx); err != nil {
		st := h.Stats(time.Now())
		log.Printf("routeplan: snapshot refresh failed (failures=%d lastErr=%d), serving previous snapshot age=%s",
			st.Failures, st.LastErrorSecs, st.Age)
		return err
	}
	st := h.Stats(time.Now())
	log.Printf("routeplan: snapshot age=%s nodes=%d edges=%d rows=%d rebuild=%s builds=%d failures=%d",
		st.Age, st.Nodes, st.Edges, st.Rows, time.Duration(st.LastBuildNanos), st.Builds, st.Failures)
	return nil
}

// RouteSnapshotStats exposes Holder health for metrics/diagnostics. ok=false
// when no snapshot has been installed yet.
func (s *Store) RouteSnapshotStats(now time.Time) (routeplan.Stats, bool) {
	h := s.routeHolderOrNil()
	if h == nil {
		return routeplan.Stats{}, false
	}
	return h.Stats(now), true
}

// planOnSnapshot runs the whole request in memory: endpoint resolution from
// the snapshot index plus Dijkstra/Yen over the snapshot graph. A snapshot
// miss on an endpoint falls back to one indexed point lookup (never the
// global aggregate) to tell isolated-located from missing-position.
func planOnSnapshot(ctx context.Context, s *Store, snap *routeplan.Snapshot, cfg RoutePlanConfig, fromID, toID uuid.UUID, k int, now time.Time) (api.BestRouteResult, error) {
	g := snap.Graph
	_, fromIn := g.Nodes[fromID]
	_, toIn := g.Nodes[toID]
	fromLoc, toLoc := fromIn, toIn
	if !fromIn || !toIn {
		var err error
		fromLoc, toLoc, err = snapshotEndpointFallback(ctx, s, snap, fromID, toID, fromIn, toIn)
		if err != nil {
			return api.BestRouteResult{}, err
		}
	}
	if !fromLoc || !toLoc {
		return api.BestRouteResult{Paths: []api.PlannedRoute{}, Reason: "endpoint-missing-position"}, nil
	}
	paths := routeplan.ShortestPaths(g, cfg.Cost, fromID, toID, k, now)
	if len(paths) == 0 {
		return api.BestRouteResult{Paths: []api.PlannedRoute{}, Reason: "no-route"}, nil
	}
	out := make([]api.PlannedRoute, 0, len(paths))
	for _, p := range paths {
		route, ok := toPlannedRoute(g, p, now, cfg)
		if !ok {
			continue
		}
		out = append(out, route)
	}
	if len(out) == 0 {
		return api.BestRouteResult{Paths: []api.PlannedRoute{}, Reason: "no-route"}, nil
	}
	return api.BestRouteResult{Paths: out}, nil
}

// snapshotEndpointFallback resolves endpoints missing from the snapshot:
// snapshot flags first, then one indexed GetNodesByIDs point lookup.
func snapshotEndpointFallback(ctx context.Context, s *Store, snap *routeplan.Snapshot, fromID, toID uuid.UUID, fromIn, toIn bool) (bool, bool, error) {
	fromLoc, toLoc := fromIn, toIn
	need := make([]uuid.UUID, 0, 2)
	if !fromIn {
		if v, ok := snap.Located[fromID]; ok {
			fromLoc = v
		} else {
			need = append(need, fromID)
		}
	}
	if !toIn {
		if v, ok := snap.Located[toID]; ok {
			toLoc = v
		} else if toID != fromID {
			need = append(need, toID)
		} else {
			toLoc = fromLoc
		}
	}
	if len(need) > 0 {
		nodes, err := s.GetNodesByIDs(ctx, need)
		if err != nil {
			return false, false, err
		}
		for _, id := range need {
			n := nodes[id]
			loc := n != nil && n.Latitude != nil && n.Longitude != nil
			if id == fromID {
				fromLoc = loc
			}
			if id == toID {
				toLoc = loc
			}
		}
	}
	return fromLoc, toLoc, nil
}
