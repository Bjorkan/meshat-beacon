// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package ingest

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"log"
	"strings"
	"time"
)

// The broker publishes a full authentication-claim snapshot, not a patch. Missing
// or empty owner therefore removes the mapping; a malformed envelope never does.
// Other JWT fields (including contact data) are intentionally neither retained nor logged.
func (w *Worker) handleOwnerMetadata(ctx context.Context, pubkeyHex string, payload []byte) {
	if !w.cfg.OwnerMetadataOnly {
		return
	}
	var envelope struct {
		OriginID  string `json:"origin_id"`
		Timestamp int64  `json:"timestamp"`
		Claims    *struct {
			Owner *string `json:"owner"`
		} `json:"jwt_payload"`
	}
	if json.Unmarshal(payload, &envelope) != nil || envelope.Claims == nil || envelope.Timestamp <= 0 {
		return
	}
	if !strings.EqualFold(envelope.OriginID, pubkeyHex) {
		return
	}
	pubkey, err := hex.DecodeString(pubkeyHex)
	if err != nil || len(pubkey) != 32 {
		return
	}
	var owner []byte
	if envelope.Claims.Owner != nil && *envelope.Claims.Owner != "" {
		owner, err = hex.DecodeString(*envelope.Claims.Owner)
		if err != nil || len(owner) != 32 {
			return
		}
	}
	observerID, _, err := w.db.UpsertObserver(ctx, pubkey)
	if err != nil {
		log.Printf("ingest[%s]: owner observer lookup failed", w.cfg.BrokerName)
		return
	}
	changed, err := w.db.UpsertObserverOwner(ctx, observerID, owner, "mqtt-internal:"+w.cfg.BrokerName, time.UnixMilli(envelope.Timestamp))
	if err != nil {
		log.Printf("ingest[%s]: owner metadata update failed", w.cfg.BrokerName)
		return
	}
	if changed && w.onObserverUpsert != nil {
		w.onObserverUpsert(ctx, observerID)
	}
}
