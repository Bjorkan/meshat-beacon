// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"time"

	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/api/routeplan"
	"github.com/google/uuid"
)

// routeSnapshot is the store's immutable in-memory routing view. PostgreSQL
// stays the source of truth; the snapshot is a periodically refreshed copy
// holding only planner inputs plus the pubkey index and location flags, so
// steady-state planning needs no global graph aggregate and no endpoint
// database round trip on hits.
func (s *Store) routeSnapshotOrNil() *routeplan.Snapshot {
	if s == nil {
		return nil
	}
	s.routeSnapMu.RLock()
	defer s.routeSnapMu.RUnlock()
	return s.routeSnap
}

// SetRouteSnapshot atomically installs a rebuilt snapshot. Build the
// replacement off to the side and swap only on success; readers never observe
// a partial graph and a failed rebuild leaves the previous snapshot serving.
func (s *Store) SetRouteSnapshot(snap *routeplan.Snapshot) {
	s.routeSnapMu.Lock()
	defer s.routeSnapMu.Unlock()
	s.routeSnap = snap
}

// RefreshRouteSnapshot rebuilds the snapshot from one PostgreSQL dump and
// swaps it in atomically. On error the previous snapshot keeps serving and
// the error is returned for logging/metrics (age, counts, failures are the
// operator's staleness signal).
func (s *Store) RefreshRouteSnapshot(ctx context.Context) error {
	cfg := s.routePlanOrDefault()
	now := time.Now()
	rows, err := s.q.GetRoutePlanGraph(ctx)
	if err != nil {
		return err
	}
	snap := routeplan.BuildSnapshot(rows, nil, cfg.Cost, s.staleThresholdOrDefault(), s.neighborMaxKmOrDefault(cfg), now)
	s.SetRouteSnapshot(snap)
	return nil
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
