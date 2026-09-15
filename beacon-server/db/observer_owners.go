// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package db

import (
	"context"
	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"time"
)

func (s *Store) UpsertObserverOwner(ctx context.Context, observerID uuid.UUID, ownerPubkey []byte, source string, metadataAt time.Time) (bool, error) {
	rows, err := s.q.UpsertObserverOwner(ctx, sqlc.UpsertObserverOwnerParams{ObserverID: observerID, OwnerPubkey: ownerPubkey, Source: &source, MetadataAt: pgtype.Timestamptz{Time: metadataAt, Valid: true}})
	return rows > 0, err
}
func (s *Store) ReconcileObserverOwners(ctx context.Context, nodeID uuid.UUID) ([]uuid.UUID, error) {
	return s.q.ReconcileObserverOwners(ctx, pgtype.UUID{Bytes: nodeID, Valid: true})
}
