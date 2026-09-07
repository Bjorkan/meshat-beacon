// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"encoding/hex"
	"strconv"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/google/uuid"
)

func (s *Store) ListNodePathPackets(ctx context.Context, nodeID uuid.UUID, iatas []string, cursor *api.PageToken, limit int32) (api.Page[api.PacketSummary], error) {
	page := api.Page[api.PacketSummary]{Items: []api.PacketSummary{}}
	key, err := s.q.GetNodePathPublicKey(ctx, nodeID)
	if err != nil {
		return page, err
	}
	// Reuse the same global resolver as packet detail. Prefix ambiguity anywhere
	// in the network disqualifies that width, even when the other node is outside iatas.
	prefixes := make([][]byte, 0, 4)
	for width := 1; width <= 4 && width <= len(key); width++ {
		prefix := key[:width]
		resolved, err := s.ResolvePathHashes(ctx, [][]byte{prefix})
		if err != nil {
			return page, err
		}
		candidates := resolved[hex.EncodeToString(prefix)]
		if len(candidates) == 1 && candidates[0].NodeID == nodeID {
			prefixes = append(prefixes, prefix)
		}
	}
	if len(prefixes) == 0 {
		return page, nil
	}
	params := sqlc.ListNodePathPacketsParams{Iatas: iatas, Prefixes: prefixes, PageLimit: limit + 1}
	if params.Iatas == nil {
		params.Iatas = []string{}
	}
	if cursor != nil {
		params.SnapshotID, err = strconv.ParseInt(cursor.Key, 10, 64)
		if err != nil {
			return page, err
		}
		params.BeforeID = cursor.NumericID
	}
	rows, err := s.q.ListNodePathPackets(ctx, params)
	if err != nil {
		return page, err
	}
	page.HasMore = len(rows) > int(limit)
	if page.HasMore {
		rows = rows[:limit]
	}
	for _, row := range rows {
		pathLength, pathBytes := buildLatestObserverPath(&row.PathLengthByte, &row.HashSize, &row.HopCount, row.PathBytes)
		page.Items = append(page.Items, api.PacketSummary{
			PacketHash: hex.EncodeToString(row.PacketHash), PayloadType: row.PayloadType, PayloadTypeName: api.PayloadTypeName(row.PayloadType),
			RouteType: row.RouteType, RouteTypeName: api.RouteTypeName(row.RouteType), Scope: row.ScopeName,
			FirstHeardAt: row.FirstHeardAt.Time.UnixMilli(), LastHeardAt: row.LastHeardAt.Time.UnixMilli(), ObservationCount: int32(row.MatchingObservations),
			LatestObserver: &api.PacketLatestObserver{ID: row.ObserverID, DisplayName: row.ObserverName, IATA: row.Iata, PathLength: pathLength, PathBytes: pathBytes},
		})
	}
	if err := s.resolvePacketSummaryPaths(ctx, page.Items); err != nil {
		return page, err
	}
	if page.HasMore && len(rows) > 0 {
		last := rows[len(rows)-1]
		token := api.EncodePageToken(api.PageToken{Version: api.PageTokenVersion, Collection: api.NodePathCollection(iatas), Sort: "first_match", Direction: api.SortDesc, ID: nodeID, NumericID: last.FirstMatchID, Key: strconv.FormatInt(last.SnapshotID, 10)})
		page.NextPageToken = &token
	}
	return page, nil
}
