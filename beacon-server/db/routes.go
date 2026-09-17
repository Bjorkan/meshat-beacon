// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"strings"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/api/routeplan"
	"github.com/MeshCore-Beacon/beacon-server/internal/config"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// RoutePlanConfig carries the planner cost model and staleness window into the
// store. Wired from config.ResolvedConfig in main; tests construct it directly.
type RoutePlanConfig struct {
	Cost           routeplan.Config
	StaleThreshold time.Duration
}

// DefaultRoutePlanConfig mirrors the server defaults for tests and callers
// without a resolved config.
func DefaultRoutePlanConfig() RoutePlanConfig {
	return RoutePlanConfig{
		Cost:           routeplan.FromResolved(config.Resolve(&config.Config{})),
		StaleThreshold: 24 * time.Hour,
	}
}

// SetRoutePlanConfig installs the planner cost model. Must be called before
// PlanBestRoute; the zero value falls back to server defaults.
func (s *Store) SetRoutePlanConfig(c RoutePlanConfig) {
	s.routePlan = c
	s.routePlanSet = true
}

func (s *Store) routePlanOrDefault() RoutePlanConfig {
	if s.routePlanSet {
		return s.routePlan
	}
	return DefaultRoutePlanConfig()
}

// routePathKey is the route's identity digest: md5 over the comma-joined
// node UUIDs, matching Postgres's decode(md5(array_to_string(node_ids, ',')), 'hex').
func routePathKey(nodeIDs []uuid.UUID) []byte {
	parts := make([]string, len(nodeIDs))
	for i, id := range nodeIDs {
		parts[i] = id.String()
	}
	sum := md5.Sum([]byte(strings.Join(parts, ",")))
	return sum[:]
}

func (s *Store) UpsertKnownRoute(ctx context.Context, nodeIDs []uuid.UUID, hashPrefix [][]byte, iata string, hopCount int32) error {
	return s.q.UpsertKnownRoute(ctx, sqlc.UpsertKnownRouteParams{
		PathKey:    routePathKey(nodeIDs),
		NodeIds:    nodeIDs,
		HashPrefix: hashPrefix,
		Iata:       iata,
		HopCount:   hopCount,
	})
}

func (s *Store) ListKnownRoutes(ctx context.Context, params api.RouteListParams) (api.Page[api.KnownRoute], error) {
	if params.Sort == "" {
		params.Sort = api.RouteSortLastSeen
	}
	if params.Direction == "" {
		params.Direction = api.SortDesc
	}
	var cursorTS pgtype.Timestamptz
	if !params.LegacyCursor.IsZero() {
		cursorTS = pgtype.Timestamptz{Time: params.LegacyCursor, Valid: true}
	}
	cursorValid := params.PageToken != nil
	var cursorKey string
	var cursorID int64
	if params.PageToken != nil {
		cursorKey = params.PageToken.Key
		cursorID = params.PageToken.NumericID
	}
	sqlRows, err := s.q.ListKnownRoutes(ctx, sqlc.ListKnownRoutesParams{
		Column1: params.IATAs,
		Column2: params.HopCount,
		Column3: cursorTS,
		Column4: params.Sort,
		Column5: string(params.Direction),
		Column6: cursorValid,
		Column7: cursorKey,
		Column8: cursorID,
		Limit:   params.Limit + 1,
	})
	if err != nil {
		return api.Page[api.KnownRoute]{}, err
	}
	hasMore := len(sqlRows) > int(params.Limit)
	if hasMore {
		sqlRows = sqlRows[:params.Limit]
	}
	rows := make([]knownRouteRow, len(sqlRows))
	for i, r := range sqlRows {
		rows[i] = knownRouteRow{ID: r.ID, NodeIds: r.NodeIds, HashPrefix: r.HashPrefix, Iata: r.Iata, HopCount: r.HopCount, FirstSeen: r.FirstSeen, LastSeen: r.LastSeen, ObservationCount: r.ObservationCount}
	}
	ids := collectNodeIDs(rows)
	nodes, err := s.GetNodesByIDs(ctx, ids)
	if err != nil {
		return api.Page[api.KnownRoute]{}, err
	}
	items := toKnownRoutes(rows, nodes)
	var nextToken *string
	var nextCursor *int64
	if hasMore && len(sqlRows) > 0 {
		last := sqlRows[len(sqlRows)-1]
		token := api.EncodePageToken(api.PageToken{
			Version: api.PageTokenVersion, Collection: api.PageCollectionRoutes,
			Sort: params.Sort, Direction: params.Direction, Key: last.PageSortKey, NumericID: last.ID,
		})
		nextToken = &token
		if params.Sort == api.RouteSortLastSeen && params.Direction == api.SortDesc {
			legacy := last.LastSeen.Time.UnixMilli()
			nextCursor = &legacy
		}
	}
	return api.Page[api.KnownRoute]{Items: items, NextCursor: nextCursor, NextPageToken: nextToken, HasMore: hasMore}, nil
}

func (s *Store) SearchKnownRoutes(ctx context.Context, iata, fromHash, toHash string) ([]api.KnownRoute, error) {
	fromBytes, err := hex.DecodeString(fromHash)
	if err != nil {
		return nil, err
	}
	toBytes, err := hex.DecodeString(toHash)
	if err != nil {
		return nil, err
	}
	sqlRows, err := s.q.SearchKnownRoutes(ctx, sqlc.SearchKnownRoutesParams{
		Iata:    iata,
		Column2: fromBytes,
		Column3: toBytes,
	})
	if err != nil {
		return nil, err
	}
	rows := make([]knownRouteRow, len(sqlRows))
	for i, r := range sqlRows {
		rows[i] = knownRouteRow{ID: r.ID, NodeIds: r.NodeIds, HashPrefix: r.HashPrefix, Iata: r.Iata, HopCount: r.HopCount, FirstSeen: r.FirstSeen, LastSeen: r.LastSeen, ObservationCount: r.ObservationCount}
	}
	ids := collectNodeIDs(rows)
	nodes, err := s.GetNodesByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	items := make([]api.KnownRoute, 0, len(rows))
	for _, r := range rows {
		fromPos, toPos := -1, -1
		for i, h := range r.HashPrefix {
			if fromPos == -1 && hex.EncodeToString(h) == fromHash {
				fromPos = i
			}
			if fromPos != -1 && hex.EncodeToString(h) == toHash {
				toPos = i
				break
			}
		}
		if fromPos == -1 || toPos == -1 {
			continue
		}
		nodeIDs := r.NodeIds[fromPos : toPos+1]
		hashPrefix := r.HashPrefix[fromPos : toPos+1]
		hops := make([]api.RouteHop, 0, len(nodeIDs))
		for i, nodeID := range nodeIDs {
			hop := api.RouteHop{
				NodeID: nodeID,
				Node:   nodes[nodeID],
			}
			if i < len(hashPrefix) {
				hop.HashBytes = hex.EncodeToString(hashPrefix[i])
			}
			hops = append(hops, hop)
		}
		items = append(items, api.KnownRoute{
			ID:               r.ID,
			IATA:             r.Iata,
			HopCount:         int32(len(hops)),
			Hops:             hops,
			FirstSeen:        r.FirstSeen.Time.UnixMilli(),
			LastSeen:         r.LastSeen.Time.UnixMilli(),
			ObservationCount: r.ObservationCount,
		})
	}
	return items, nil
}

func (s *Store) GetKnownRoutesByNode(ctx context.Context, iata string, nodeID uuid.UUID) ([]api.KnownRoute, error) {
	sqlRows, err := s.q.GetKnownRoutesByNode(ctx, sqlc.GetKnownRoutesByNodeParams{
		Iata:    iata,
		Column2: nodeID,
	})
	if err != nil {
		return nil, err
	}
	rows := make([]knownRouteRow, len(sqlRows))
	for i, r := range sqlRows {
		rows[i] = knownRouteRow{ID: r.ID, NodeIds: r.NodeIds, HashPrefix: r.HashPrefix, Iata: r.Iata, HopCount: r.HopCount, FirstSeen: r.FirstSeen, LastSeen: r.LastSeen, ObservationCount: r.ObservationCount}
	}
	ids := collectNodeIDs(rows)
	nodes, err := s.GetNodesByIDs(ctx, ids)
	if err != nil {
		return nil, err
	}
	return toKnownRoutes(rows, nodes), nil
}

func (s *Store) GetCrossIATANeighbors(ctx context.Context, nodeID uuid.UUID, iata string) ([]api.NodeNeighbor, error) {
	rows, err := s.q.GetCrossIATANeighbors(ctx, sqlc.GetCrossIATANeighborsParams{
		NodeID: nodeID,
		Iata:   iata,
	})
	if err != nil {
		return nil, err
	}
	items := make([]api.NodeNeighbor, 0, len(rows))
	for _, r := range rows {
		items = append(items, api.NodeNeighbor{
			ID:               r.ID,
			Name:             r.Name,
			NodeType:         r.NodeType,
			NodeTypeName:     api.NodeTypeName(r.NodeType),
			Latitude:         r.Latitude,
			Longitude:        r.Longitude,
			IATA:             r.NeighborIata,
			ObservationCount: r.ObservationCount,
			LastSeen:         r.LastSeen.Time.UnixMilli(),
			SNR:              r.Snr,
		})
	}
	return items, nil
}

func (s *Store) SearchCrossIATARoutes(ctx context.Context, fromHash, fromIATA, toHash, toIATA string) ([]api.CrossIATARoute, error) {
	// 1. resolve fromHash in fromIATA
	fromBytes, err := hex.DecodeString(fromHash)
	if err != nil {
		return nil, err
	}
	fromResolved, err := s.ResolvePathHashes(ctx, [][]byte{fromBytes})
	if err != nil {
		return nil, err
	}
	fromEntries := fromResolved[fromHash]
	if len(fromEntries) != 1 {
		return nil, nil // not found or ambiguous
	}
	fromNodeID := fromEntries[0].NodeID

	// 2. resolve toHash in toIATA
	toBytes, err := hex.DecodeString(toHash)
	if err != nil {
		return nil, err
	}
	toResolved, err := s.ResolvePathHashes(ctx, [][]byte{toBytes})
	if err != nil {
		return nil, err
	}
	toEntries := toResolved[toHash]
	if len(toEntries) != 1 {
		return nil, nil // not found or ambiguous
	}
	toNodeID := toEntries[0].NodeID

	// 3. find routes in source IATA containing fromNode
	sourceRoutes, err := s.GetKnownRoutesByNode(ctx, fromIATA, fromNodeID)
	if err != nil {
		return nil, err
	}

	// 4. find routes in target IATA containing toNode
	targetRoutes, err := s.GetKnownRoutesByNode(ctx, toIATA, toNodeID)
	if err != nil {
		return nil, err
	}

	if len(sourceRoutes) == 0 || len(targetRoutes) == 0 {
		return nil, nil
	}

	// 5. find cross-IATA links — nodes at the boundary of source routes
	//    that have neighbors in the target IATA at the start of target routes
	var results []api.CrossIATARoute

	// build a set of node IDs that appear in target routes
	targetNodeSet := make(map[uuid.UUID][]api.RouteHop)
	for _, tr := range targetRoutes {
		for _, hop := range tr.Hops {
			if _, ok := targetNodeSet[hop.NodeID]; !ok {
				targetNodeSet[hop.NodeID] = tr.Hops
			}
		}
	}

	// for each source route, check if any node has a cross-IATA neighbor in targetNodeSet
	for _, sr := range sourceRoutes {
		for i, hop := range sr.Hops {
			crossNeighbors, err := s.GetCrossIATANeighbors(ctx, hop.NodeID, fromIATA)
			if err != nil {
				continue
			}
			for _, neighbor := range crossNeighbors {
				if neighbor.IATA != toIATA {
					continue
				}
				if targetHops, ok := targetNodeSet[neighbor.ID]; ok {
					// found a cross-IATA link — build the route
					sourceSegment := sr.Hops[:i+1]
					targetSegment := extractFromNode(targetHops, neighbor.ID)

					fromNode := api.ResolvedNode{
						ID:        hop.NodeID,
						Latitude:  fromEntries[0].Latitude,
						Longitude: fromEntries[0].Longitude,
						PublicKey: hex.EncodeToString(fromEntries[0].PublicKey),
					}
					toNode := api.ResolvedNode{
						ID:        neighbor.ID,
						Name:      neighbor.Name,
						Latitude:  neighbor.Latitude,
						Longitude: neighbor.Longitude,
					}

					results = append(results, api.CrossIATARoute{
						SourceSegment: sourceSegment,
						CrossHop: api.CrossIATAHop{
							FromNode: fromNode,
							ToNode:   toNode,
							FromIATA: fromIATA,
							ToIATA:   toIATA,
							LastSeen: neighbor.LastSeen,
						},
						TargetSegment: targetSegment,
						TotalHops:     len(sourceSegment) + 1 + len(targetSegment),
					})
				}
			}
		}
	}

	return results, nil
}

// ReconfirmRoutes checks the batchSize least-recently-reconfirmed routes,
// deleting stale or ambiguous ones and stamping the survivors.
func (s *Store) ReconfirmRoutes(ctx context.Context, batchSize int32) error {
	return s.q.ReconfirmRoutes(ctx, batchSize)
}

// DeleteOldRoutes prunes routes per the retention rule: unconditionally past
// retentionCutoff, and past graceCutoff when observed fewer than minObservations times.
func (s *Store) DeleteOldRoutes(ctx context.Context, retentionCutoff time.Time, minObservations int64, graceCutoff time.Time) error {
	return s.q.DeleteOldRoutes(ctx, sqlc.DeleteOldRoutesParams{
		LastSeen:         pgtype.Timestamptz{Time: retentionCutoff, Valid: true},
		ObservationCount: minObservations,
		LastSeen_2:       pgtype.Timestamptz{Time: graceCutoff, Valid: true},
	})
}

// extractFromNode returns the portion of a route starting at the given node.
func extractFromNode(hops []api.RouteHop, nodeID uuid.UUID) []api.RouteHop {
	for i, hop := range hops {
		if hop.NodeID == nodeID {
			return hops[i:]
		}
	}
	return hops
}

// PlanBestRoute serves planning requests from the in-memory routing snapshot
// when one is installed (see SetRouteSnapshot); otherwise it falls back to a
// single PostgreSQL dump (startup/tests). Endpoints are resolved by UUID (the
// handler maps full pubkeys to IDs). Endpoint metadata is resolved
// independently of the neighbor graph, so a known + located but isolated
// endpoint yields "no-route" (200, empty paths) while a known endpoint
// without coordinates yields "endpoint-missing-position" (the handler maps
// that to 422). A pair with no connecting path also yields "no-route".
func (s *Store) PlanBestRoute(ctx context.Context, fromID, toID uuid.UUID, maxAlternatives int) (api.BestRouteResult, error) {
	cfg := s.routePlanOrDefault()
	if maxAlternatives < 0 {
		maxAlternatives = 0
	}
	if maxAlternatives > cfg.Cost.MaxAlternatives {
		maxAlternatives = cfg.Cost.MaxAlternatives
	}
	k := 1 + maxAlternatives
	now := time.Now()

	if snap := s.routeSnapshotOrNil(); snap != nil {
		return planOnSnapshot(ctx, s, snap, cfg, fromID, toID, k, now)
	}

	rows, err := s.q.GetRoutePlanGraph(ctx)
	if err != nil {
		return api.BestRouteResult{}, err
	}
	g := routeplan.BuildGraph(rows, s.staleThresholdOrDefault(), s.neighborMaxKmOrDefault(cfg), now)

	// Classify endpoints from node metadata, not from graph membership: a
	// located node with zero neighbor rows never enters g.Nodes but must not
	// be reported as missing its position.
	fromLoc, toLoc, err := s.routeEndpointLocations(ctx, fromID, toID, g)
	if err != nil {
		return api.BestRouteResult{}, err
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

// routeEndpointLocations reports whether each endpoint is located, resolving
// metadata independently of the neighbor graph. A node present in the graph
// is located by construction (BuildGraph drops unlocated rows). A node absent
// from the graph falls back to a GetNodesByIDs lookup: known + located but
// isolated still routes to "no-route", while unknown or unlocated yields
// "endpoint-missing-position".
func (s *Store) routeEndpointLocations(ctx context.Context, fromID, toID uuid.UUID, g routeplan.Graph) (bool, bool, error) {
	_, fromInGraph := g.Nodes[fromID]
	_, toInGraph := g.Nodes[toID]
	if fromInGraph && toInGraph {
		return true, true, nil
	}
	missing := make([]uuid.UUID, 0, 2)
	if !fromInGraph {
		missing = append(missing, fromID)
	}
	if !toInGraph && toID != fromID {
		missing = append(missing, toID)
	}
	nodes, err := s.GetNodesByIDs(ctx, missing)
	if err != nil {
		return false, false, err
	}
	located := func(id uuid.UUID, inGraph bool) bool {
		if inGraph {
			return true
		}
		n := nodes[id]
		return n != nil && n.Latitude != nil && n.Longitude != nil
	}
	return located(fromID, fromInGraph), located(toID, toInGraph), nil
}

func (s *Store) staleThresholdOrDefault() time.Duration {
	if s.staleThreshold != 0 {
		return s.staleThreshold
	}
	return 24 * time.Hour
}

func (s *Store) neighborMaxKmOrDefault(cfg RoutePlanConfig) float64 {
	if cfg.Cost.MaxDistanceKm != 0 {
		return cfg.Cost.MaxDistanceKm
	}
	if s.neighborMaxKm != 0 {
		return s.neighborMaxKm
	}
	return 150
}

// toPlannedRoute projects one node path onto the API shape. Edges are looked
// up from the graph (same merged values the cost used); ok=false when a leg
// vanished, which cannot happen for paths the search just produced.
func toPlannedRoute(g routeplan.Graph, p routeplan.Path, now time.Time, cfg RoutePlanConfig) (api.PlannedRoute, bool) {
	nodes := make([]api.PlannedRouteNode, 0, len(p.Nodes))
	legs := make([]api.PlannedRouteLeg, 0, len(p.Nodes)-1)
	hasUnmeasured := false
	hasStale := false
	for i, id := range p.Nodes {
		n, ok := g.Nodes[id]
		if !ok {
			return api.PlannedRoute{}, false
		}
		lat, lng := n.Lat, n.Lng
		nodes = append(nodes, api.PlannedRouteNode{
			ID: n.ID, PublicKey: n.Pubkey, Name: n.Name,
			Latitude: &lat, Longitude: &lng,
			NodeType: n.Type, NodeTypeName: api.NodeTypeName(n.Type), Stale: n.Stale,
		})
		if n.Stale {
			hasStale = true
		}
		if i+1 < len(p.Nodes) {
			var found *routeplan.Edge
			for _, e := range g.Edges[id] {
				if e.To == p.Nodes[i+1] {
					e := e
					found = &e
					break
				}
			}
			if found == nil {
				return api.PlannedRoute{}, false
			}
			var snr *float32
			var snrCount int64
			var snrSeen int64
			if found.SNR != nil {
				v := *found.SNR
				snr = &v
				snrCount = found.SNRSampleCount
			}
			if !found.SNRLastSeen.IsZero() {
				snrSeen = found.SNRLastSeen.UnixMilli()
			}
			unmeasured := i < len(p.Unmeasured) && p.Unmeasured[i]
			if unmeasured {
				hasUnmeasured = true
			}
			legs = append(legs, api.PlannedRouteLeg{
				From: n.Pubkey, To: g.Nodes[p.Nodes[i+1]].Pubkey,
				SNR: snr, SNRSampleCount: snrCount, SNRLastSeen: snrSeen,
				ObservationCount: found.Observations, Unmeasured: unmeasured, Neighbor: found.Neighbor,
			})
		}
	}
	_ = now
	_ = cfg
	return api.PlannedRoute{
		Nodes: nodes, Legs: legs, TotalCost: p.Cost, HopCount: len(legs),
		HasUnmeasuredLegs: hasUnmeasured, ContainsStaleNodes: hasStale,
	}, true
}

// knownRouteRow normalizes the per-query sqlc row structs (identical
// columns, distinct generated types) so the helpers below share one body.
type knownRouteRow struct {
	ID               int64
	NodeIds          []uuid.UUID
	HashPrefix       [][]byte
	Iata             string
	HopCount         int32
	FirstSeen        pgtype.Timestamptz
	LastSeen         pgtype.Timestamptz
	ObservationCount int64
}

func toKnownRoutes(rows []knownRouteRow, nodes map[uuid.UUID]*api.ResolvedNode) []api.KnownRoute {
	items := make([]api.KnownRoute, 0, len(rows))
	for _, r := range rows {
		hops := make([]api.RouteHop, 0, len(r.NodeIds))
		for i, nodeID := range r.NodeIds {
			hop := api.RouteHop{
				NodeID: nodeID,
				Node:   nodes[nodeID],
			}
			if i < len(r.HashPrefix) {
				hop.HashBytes = hex.EncodeToString(r.HashPrefix[i])
			}
			hops = append(hops, hop)
		}
		items = append(items, api.KnownRoute{
			ID:               r.ID,
			IATA:             r.Iata,
			HopCount:         r.HopCount,
			Hops:             hops,
			FirstSeen:        r.FirstSeen.Time.UnixMilli(),
			LastSeen:         r.LastSeen.Time.UnixMilli(),
			ObservationCount: r.ObservationCount,
		})
	}
	return items
}

func collectNodeIDs(rows []knownRouteRow) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{})
	var ids []uuid.UUID
	for _, r := range rows {
		for _, id := range r.NodeIds {
			if _, ok := seen[id]; !ok {
				seen[id] = struct{}{}
				ids = append(ids, id)
			}
		}
	}
	return ids
}
