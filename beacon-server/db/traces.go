// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/jackc/pgx/v5/pgtype"
)

type tracePayload struct {
	PathHashes []string  `json:"pathHashes"`
	Flags      byte      `json:"flags"`
	SNRValues  []float32 `json:"snrValues"`
}

func (s *Store) UpsertTraceIATA(ctx context.Context, traceTag []byte, iata string, heardAt time.Time) error {
	return s.q.UpsertTraceIATA(ctx, sqlc.UpsertTraceIATAParams{
		TraceTag:  traceTag,
		Iata:      iata,
		LastHeard: pgtype.Timestamptz{Time: heardAt, Valid: true},
	})
}

func (s *Store) DeleteOldTraceIATAs(ctx context.Context, cutoff time.Time) error {
	return s.q.DeleteOldTraceIATAs(ctx, pgtype.Timestamptz{Time: cutoff, Valid: true})
}

func (s *Store) ListTraceTags(ctx context.Context, iatas []string, scope, traceType string, since, until time.Time, cursor time.Time, limit int32) ([]api.TraceTagSummary, error) {
	var sinceTS, untilTS, cursorTS pgtype.Timestamptz
	if !since.IsZero() {
		sinceTS = pgtype.Timestamptz{Time: since, Valid: true}
	}
	if !until.IsZero() {
		untilTS = pgtype.Timestamptz{Time: until, Valid: true}
	}
	if !cursor.IsZero() {
		cursorTS = pgtype.Timestamptz{Time: cursor, Valid: true}
	}
	rows, err := s.q.ListTraceTags(ctx, sqlc.ListTraceTagsParams{
		Column1: iatas,
		Column2: scope,
		Column3: sinceTS,
		Column4: untilTS,
		Column5: cursorTS,
		Limit:   limit,
		Column7: traceType,
	})
	if err != nil {
		return nil, err
	}
	items := make([]api.TraceTagSummary, 0, len(rows))
	// Batch global resolution across the page: one query per hash width, results mapped
	// back per tag. Resolution stays global (not IATA-local) so a prefix that looks unique
	// in one region but collides elsewhere still reports ambiguous.
	type tagPayload struct {
		idx  int
		best tracePayload
	}
	payloads := make([]tagPayload, 0, len(rows))
	uniqueByWidth := make(map[int]map[string][]byte)
	for i, r := range rows {
		var best tracePayload
		if len(r.BestPayload) > 0 {
			_ = json.Unmarshal(r.BestPayload, &best)
		}
		items = append(items, api.TraceTagSummary{
			TraceTag:     r.TraceTag,
			FirstHeardAt: r.FirstHeardAt.Time.UnixMilli(),
			LastHeardAt:  r.LastHeardAt.Time.UnixMilli(),
			PacketCount:  r.PacketCount,
			IATACount:    r.IataCount,
			TraceType:    r.TraceType,
			PathHashes:   best.PathHashes,
			SNRValues:    best.SNRValues,
		})
		if len(best.PathHashes) == 0 {
			continue
		}
		payloads = append(payloads, tagPayload{idx: i, best: best})
		hashSize := int(1 << (best.Flags & 0x03))
		if hashSize < 1 || hashSize > 4 {
			continue
		}
		if uniqueByWidth[hashSize] == nil {
			uniqueByWidth[hashSize] = make(map[string][]byte)
		}
		for _, h := range best.PathHashes {
			b, err := hex.DecodeString(h)
			if err != nil || len(b) < hashSize {
				continue
			}
			prefix := b[:hashSize]
			key := hex.EncodeToString(prefix)
			if _, exists := uniqueByWidth[hashSize][key]; !exists {
				cp := make([]byte, hashSize)
				copy(cp, prefix)
				uniqueByWidth[hashSize][key] = cp
			}
		}
	}
	resolvedByWidth := make(map[int]map[string][]api.ResolvedPathEntry, len(uniqueByWidth))
	for width := 1; width <= 4; width++ {
		unique := uniqueByWidth[width]
		if len(unique) == 0 {
			continue
		}
		hashes := make([][]byte, 0, len(unique))
		for _, h := range unique {
			hashes = append(hashes, h)
		}
		resolved, err := s.ResolvePathHashes(ctx, hashes)
		if err != nil {
			return nil, err
		}
		resolvedByWidth[width] = resolved
	}
	for _, tp := range payloads {
		hashSize := int(1 << (tp.best.Flags & 0x03))
		if hashSize < 1 || hashSize > 4 {
			continue
		}
		resolved := resolvedByWidth[hashSize]
		lite := make([]api.ResolvedHopLite, 0, len(tp.best.PathHashes))
		for _, h := range tp.best.PathHashes {
			b, err := hex.DecodeString(h)
			hop := api.ResolvedHopLite{Confidence: "none"}
			if err == nil && len(b) >= hashSize {
				key := hex.EncodeToString(b[:hashSize])
				entries := resolved[key]
				switch len(entries) {
				case 0:
					hop.Confidence = "none"
				case 1:
					hop.Confidence = "high"
					id := entries[0].NodeID.String()
					hop.NodeID = &id
					if entries[0].Name != nil {
						name := *entries[0].Name
						hop.NodeName = &name
					}
				default:
					hop.Confidence = "ambiguous"
				}
			}
			lite = append(lite, hop)
		}
		items[tp.idx].ResolvedPath = lite
	}
	return items, nil
}

func (s *Store) GetTraceByTag(ctx context.Context, tag string) (*api.TraceDetail, error) {
	rows, err := s.q.GetPacketsByTraceTag(ctx, tag)
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, nil
	}
	detail := &api.TraceDetail{
		TraceTag: tag,
		Packets:  make([]api.TracePacket, 0, len(rows)),
	}
	for _, r := range rows {
		packet := api.TracePacket{
			PacketHash:    r.PacketHashHex,
			RouteType:     r.RouteType,
			RouteTypeName: api.RouteTypeName(r.RouteType),
			Scope:         r.ScopeName,
			FirstHeardAt:  r.FirstHeardAt.Time.UnixMilli(),
			LastHeardAt:   r.LastHeardAt.Time.UnixMilli(),
		}
		var parsed tracePayload
		if err := json.Unmarshal(r.ParsedPayload, &parsed); err == nil {
			// build raw path
			rawPath := make([]api.RawHop, 0, len(parsed.PathHashes))
			for i, h := range parsed.PathHashes {
				hop := api.RawHop{Hash: h}
				if i < len(parsed.SNRValues) {
					snr := parsed.SNRValues[i]
					hop.SNR = &snr
				}
				rawPath = append(rawPath, hop)
			}
			packet.RawPath = rawPath
		}
		// Route resolution is global across all IATA areas, so no per-region
		// observation lookup is needed to scope it.
		packet.ResolvedRoute = s.resolveTraceRoute(ctx, &parsed)
		detail.Packets = append(detail.Packets, packet)
	}
	return detail, nil
}

func (s *Store) resolveTraceRoute(ctx context.Context, payload *tracePayload) []api.ResolvedHop {
	if payload == nil || len(payload.PathHashes) == 0 {
		return nil
	}
	hashSize := int(1 << (payload.Flags & 0x03))
	hashes := make([][]byte, 0, len(payload.PathHashes))
	for _, h := range payload.PathHashes {
		b, err := hex.DecodeString(h)
		if err == nil {
			hashes = append(hashes, b)
		}
	}
	resolved, err := s.ResolvePathHashes(ctx, hashes)
	if err != nil {
		return nil
	}
	route := make([]api.ResolvedHop, 0, len(hashes))
	for i, hash := range hashes {
		key := hex.EncodeToString(hash[:hashSize])
		entries := resolved[key]
		var confidence string
		switch len(entries) {
		case 0:
			confidence = "none"
		case 1:
			confidence = "high"
		default:
			confidence = "ambiguous"
		}
		hop := api.ResolvedHop{
			Confidence: confidence,
			Nodes:      make([]api.ResolvedNode, 0, len(entries)),
		}
		if i < len(payload.SNRValues) {
			snr := payload.SNRValues[i]
			hop.SNR = &snr
		}
		for _, e := range entries {
			hop.Nodes = append(hop.Nodes, api.ResolvedNode{
				ID:        e.NodeID,
				Name:      e.Name,
				Latitude:  e.Latitude,
				Longitude: e.Longitude,
				PublicKey: hex.EncodeToString(e.PublicKey),
			})
		}
		route = append(route, hop)
	}
	return route
}
