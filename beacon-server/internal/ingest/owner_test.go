// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
package ingest

import (
	"bytes"
	"context"
	"encoding/hex"
	"fmt"
	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
	"strings"
	"testing"
	"time"
)

type ownerTestDB struct {
	stubDB
	owner      []byte
	source     string
	at         time.Time
	calls      int
	reconciled uuid.UUID
	related    []uuid.UUID
}

func (d *ownerTestDB) UpsertObserverOwner(_ context.Context, _ uuid.UUID, key []byte, source string, at time.Time) (bool, error) {
	d.calls++
	d.owner = key
	d.source = source
	d.at = at
	return true, nil
}
func (d *ownerTestDB) ReconcileObserverOwners(_ context.Context, id uuid.UUID) ([]uuid.UUID, error) {
	d.reconciled = id
	return d.related, nil
}

type ownerMessage struct {
	mqtt.Message
	topic   string
	payload []byte
}

func (m ownerMessage) Topic() string   { return m.topic }
func (m ownerMessage) Payload() []byte { return m.payload }

type ownerToken struct{ mqtt.Token }

func (ownerToken) Wait() bool   { return true }
func (ownerToken) Error() error { return nil }

type ownerClient struct {
	mqtt.Client
	topic string
}

func (c *ownerClient) Subscribe(topic string, _ byte, _ mqtt.MessageHandler) mqtt.Token {
	c.topic = topic
	return ownerToken{}
}

func TestOwnerMetadataTrustBoundary(t *testing.T) {
	observer := strings.Repeat("ab", 32)
	owner := strings.Repeat("CD", 32)
	for _, tc := range []struct {
		name, claims, origin, subtopic string
		enabled                        bool
		want                           int
	}{
		{"valid", `{"owner":"` + owner + `","email":"private@example.test"}`, observer, "internal", true, 1},
		{"no privileged feed", `{"owner":"` + owner + `"}`, observer, "internal", false, 0},
		{"wrong origin", `{"owner":"` + owner + `"}`, owner, "internal", true, 0},
		{"short key", `{"owner":"abcd"}`, observer, "internal", true, 0},
		{"long key", `{"owner":"` + owner + `00"}`, observer, "internal", true, 0},
		{"non hex", `{"owner":"` + strings.Repeat("z", 64) + `"}`, observer, "internal", true, 0},
		{"whitespace", `{"owner":" ` + owner + `"}`, observer, "internal", true, 0},
		{"wrong type", `{"owner":123}`, observer, "internal", true, 0},
		{"missing claims", `null`, observer, "internal", true, 0},
		{"removed", `{}`, observer, "internal", true, 1},
		{"empty", `{"owner":""}`, observer, "internal", true, 1},
		{"null owner", `{"owner":null}`, observer, "internal", true, 1},
		{"status ignored by privileged worker", `{"owner":"` + owner + `"}`, observer, "status", true, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := &ownerTestDB{}
			w := New(Config{BrokerName: "test", OwnerMetadataOnly: tc.enabled}, d, nil, nil, nil)
			invalidated := 0
			w.onObserverUpsert = func(context.Context, uuid.UUID) { invalidated++ }
			payload := []byte(fmt.Sprintf(`{"origin_id":%q,"timestamp":1700000000000,"jwt_payload":%s}`, tc.origin, tc.claims))
			w.handleMessage(ownerMessage{topic: "meshcore/YVR/" + observer + "/" + tc.subtopic, payload: payload})
			if d.calls != tc.want || invalidated != tc.want {
				t.Fatalf("writes=%d invalidations=%d", d.calls, invalidated)
			}
			if tc.name == "valid" {
				expected, _ := hex.DecodeString(owner)
				if !bytes.Equal(d.owner, expected) || d.source != "mqtt-internal:test" || d.at.UnixMilli() != 1700000000000 {
					t.Fatal("incorrect persisted fields")
				}
			}
			if tc.name == "removed" && len(d.owner) != 0 {
				t.Fatal("owner not cleared")
			}
		})
	}
}

func TestOwnerSubscriptionIsNarrowAndRegionFiltered(t *testing.T) {
	d := &ownerTestDB{}
	w := New(Config{OwnerMetadataOnly: true, AllowedIATAs: map[string]struct{}{"YVR": {}}}, d, nil, nil, nil)
	c := &ownerClient{}
	w.subscribe(c)
	if c.topic != "meshcore/+/+/internal" {
		t.Fatal(c.topic)
	}
	key := strings.Repeat("ab", 32)
	for _, topic := range []string{"meshcore/YYJ/" + key + "/internal", "meshcore/YVR/abcd/internal", "meshcore/TOOLONG/" + key + "/internal"} {
		w.handleMessage(ownerMessage{topic: topic, payload: []byte(fmt.Sprintf(`{"origin_id":%q,"timestamp":1,"jwt_payload":{}}`, key))})
	}
	if d.calls != 0 {
		t.Fatal("out-of-scope or malformed observer accepted")
	}
}

func TestAdvertReconcilesOwnersAndInvalidatesDetails(t *testing.T) {
	observerID, nodeID := uuid.New(), uuid.New()
	d := &ownerTestDB{stubDB: stubDB{upsertNodeID: nodeID}, related: []uuid.UUID{observerID}}
	base, _ := newTestWorker()
	base.db = d
	var invalidated uuid.UUID
	base.onObserverUpsert = func(_ context.Context, id uuid.UUID) { invalidated = id }
	base.handlePayloadTypeSideEffects(context.Background(), buildAdvertPacket(t, false), "YVR", []byte{1}, RadioSettings{}, nil, nil, nil, 0)
	if d.reconciled != nodeID || invalidated != observerID {
		t.Fatalf("reconciled=%v invalidated=%v", d.reconciled, invalidated)
	}
}
