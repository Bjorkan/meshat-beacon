// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package db

import (
	"context"
	"errors"
	"testing"
	"time"

	sqlc "github.com/MeshCore-Beacon/beacon-server/db/sqlc"
	mockdb "github.com/MeshCore-Beacon/beacon-server/db/sqlc/mock"
	"github.com/MeshCore-Beacon/beacon-server/internal/api"
	"github.com/MeshCore-Beacon/beacon-server/internal/keystore"
	"github.com/jackc/pgx/v5/pgtype"
	"go.uber.org/mock/gomock"
)

func TestListChannels_Empty(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	mock.EXPECT().
		ListChannels(gomock.Any(), sqlc.ListChannelsParams{
			ChannelHash: nil,
			Iatas:       nil,
			CursorTs:    pgtype.Timestamptz{},
			PageLimit:   11,
		}).
		Return([]sqlc.Channel{}, nil)

	store := &Store{q: mock}
	page, err := store.ListChannels(context.Background(), 10, nil, nil, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(page.Items) != 0 {
		t.Errorf("expected 0 items, got %d", len(page.Items))
	}
	if page.HasMore {
		t.Error("expected HasMore false")
	}
}

func TestListChannels_Pagination(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	isHashtag := false
	keyKnown := true
	lastSeen := pgtype.Timestamptz{Time: time.UnixMilli(1700000000000), Valid: true}

	// return limit+1 rows to trigger HasMore
	rows := make([]sqlc.Channel, 3)
	for i := range rows {
		rows[i] = sqlc.Channel{
			ID:          int32(i + 1),
			ChannelHash: []byte{0xab, 0xcd},
			LastSeen:    lastSeen,
			IsHashtag:   &isHashtag,
			KeyKnown:    &keyKnown,
		}
	}

	mock.EXPECT().
		ListChannels(gomock.Any(), sqlc.ListChannelsParams{
			ChannelHash: nil,
			Iatas:       nil,
			CursorTs:    pgtype.Timestamptz{},
			PageLimit:   3, // limit+1
		}).
		Return(rows, nil)

	store := &Store{q: mock}
	page, err := store.ListChannels(context.Background(), 2, nil, nil, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(page.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(page.Items))
	}
	if !page.HasMore {
		t.Error("expected HasMore true")
	}
	if page.NextCursor == nil {
		t.Error("expected NextCursor to be set")
	}
}

func TestListChannels_DBError(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	mock.EXPECT().
		ListChannels(gomock.Any(), gomock.Any()).
		Return(nil, errors.New("db error"))

	store := &Store{q: mock}
	_, err := store.ListChannels(context.Background(), 10, nil, nil, 0)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestListChannels_IATAFilter(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	mock.EXPECT().
		ListChannels(gomock.Any(), sqlc.ListChannelsParams{
			ChannelHash: nil,
			Iatas:       []string{"YOW", "YYZ"},
			CursorTs:    pgtype.Timestamptz{},
			PageLimit:   11,
		}).
		Return([]sqlc.Channel{}, nil)

	store := &Store{q: mock}
	_, err := store.ListChannels(context.Background(), 10, nil, []string{"YOW", "YYZ"}, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGetChannel_Basic(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	isHashtag := false
	keyKnown := true
	msgCount := int64(5)
	lastSeen := pgtype.Timestamptz{Time: time.UnixMilli(1700000000000), Valid: true}

	mock.EXPECT().
		GetChannelByID(gomock.Any(), int32(1)).
		Return(sqlc.Channel{
			ID:           1,
			ChannelHash:  []byte{0xab, 0xcd},
			LastSeen:     lastSeen,
			IsHashtag:    &isHashtag,
			KeyKnown:     &keyKnown,
			MessageCount: &msgCount,
		}, nil)

	store := &Store{q: mock}
	ch, err := store.GetChannel(context.Background(), 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ch.ID != 1 {
		t.Errorf("expected ID 1, got %d", ch.ID)
	}
	if ch.ChannelHash != "abcd" {
		t.Errorf("expected ChannelHash abcd, got %s", ch.ChannelHash)
	}
	if ch.MessageCount != 5 {
		t.Errorf("expected MessageCount 5, got %d", ch.MessageCount)
	}
	if ch.KeyFingerprint != nil {
		t.Errorf("expected nil KeyFingerprint for non-hashtag channel")
	}
}

func TestGetChannel_HashtagWithFingerprint(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	isHashtag := true
	keyKnown := true
	fp := []byte{0xde, 0xad, 0xbe, 0xef}
	lastSeen := pgtype.Timestamptz{Time: time.UnixMilli(1700000000000), Valid: true}

	mock.EXPECT().
		GetChannelByID(gomock.Any(), int32(2)).
		Return(sqlc.Channel{
			ID:             2,
			ChannelHash:    []byte{0x01, 0x02},
			LastSeen:       lastSeen,
			IsHashtag:      &isHashtag,
			KeyKnown:       &keyKnown,
			KeyFingerprint: fp,
		}, nil)

	store := &Store{q: mock}
	ch, err := store.GetChannel(context.Background(), 2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ch.KeyFingerprint == nil {
		t.Fatal("expected KeyFingerprint to be set for hashtag channel")
	}
	if *ch.KeyFingerprint != "deadbeef" {
		t.Errorf("expected KeyFingerprint deadbeef, got %s", *ch.KeyFingerprint)
	}
}

func TestGetChannel_DBError(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	mock.EXPECT().
		GetChannelByID(gomock.Any(), int32(1)).
		Return(sqlc.Channel{}, errors.New("db error"))

	store := &Store{q: mock}
	_, err := store.GetChannel(context.Background(), 1)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestListChannelMessages_AllChannels(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	sentAt := pgtype.Timestamptz{Time: time.UnixMilli(1700000000000), Valid: true}
	senderName := "Alice"
	content := "hello"

	mock.EXPECT().
		ListAllChannelMessages(gomock.Any(), sqlc.ListAllChannelMessagesParams{
			Column1: pgtype.Timestamptz{},
			Column2: []string{"YVR"},
			Column3: "",
			Column4: int64(0),
			Limit:   3,
		}).
		Return([]sqlc.ListAllChannelMessagesRow{
			{
				ID:               1,
				PacketHashHex:    "deadbeef",
				ChannelHash:      []byte{0xab},
				SenderName:       &senderName,
				Content:          &content,
				SentAt:           sentAt,
				ObservationCount: 2,
			},
			{
				ID:               2,
				PacketHashHex:    "cafebabe",
				ChannelHash:      []byte{0xcd},
				SenderName:       &senderName,
				Content:          &content,
				SentAt:           sentAt,
				ObservationCount: 1,
			},
			{
				ID:               3,
				PacketHashHex:    "deadcafe",
				ChannelHash:      []byte{0xef},
				SenderName:       &senderName,
				Content:          &content,
				SentAt:           sentAt,
				ObservationCount: 1,
			},
		}, nil)

	store := &Store{q: mock}
	page, err := store.ListChannelMessages(context.Background(), nil, time.Time{}, 2, []string{"YVR"}, "", 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(page.Items) != 2 {
		t.Errorf("expected 2 items, got %d", len(page.Items))
	}
	if !page.HasMore {
		t.Error("expected HasMore true")
	}
	if page.NextCursor == nil {
		t.Error("expected NextCursor to be set")
	}
}

func TestListChannelMessages_ByChannelID(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	channelID := int32(1)
	sentAt := pgtype.Timestamptz{Time: time.UnixMilli(1700000000000), Valid: true}
	senderName := "Bob"
	content := "world"

	mock.EXPECT().
		ListChannelMessages(gomock.Any(), sqlc.ListChannelMessagesParams{
			ChannelID: channelID,
			Column2:   pgtype.Timestamptz{},
			Column3:   []string{"YVR"},
			Column4:   "",
			Column5:   int64(0),
			Limit:     3,
		}).
		Return([]sqlc.ListChannelMessagesRow{
			{
				ID:               1,
				PacketHashHex:    "deadbeef",
				ChannelHash:      []byte{0xab},
				SenderName:       &senderName,
				Content:          &content,
				SentAt:           sentAt,
				ObservationCount: 1,
			},
		}, nil)

	store := &Store{q: mock}
	page, err := store.ListChannelMessages(context.Background(), &channelID, time.Time{}, 2, []string{"YVR"}, "", 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(page.Items) != 1 {
		t.Errorf("expected 1 item, got %d", len(page.Items))
	}
	if page.HasMore {
		t.Error("expected HasMore false")
	}
}

func TestListChannelMessages_DBError(t *testing.T) {
	ctrl := gomock.NewController(t)
	mock := mockdb.NewMockQuerier(ctrl)

	mock.EXPECT().
		ListAllChannelMessages(gomock.Any(), gomock.Any()).
		Return(nil, errors.New("db error"))

	store := &Store{q: mock}
	_, err := store.ListChannelMessages(context.Background(), nil, time.Time{}, 10, nil, "", 0)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
}

func TestChannelKinds_ListAndDetail(t *testing.T) {
	for _, tc := range []struct {
		name                   string
		known, hashtag, public bool
		want                   api.ChannelKind
	}{
		{"Renamed public channel", true, false, true, api.ChannelKindPublic},
		{"Public", true, false, false, api.ChannelKindPrivate},
		{"#weather", true, true, false, api.ChannelKindHashtag},
		{"Unknown", false, false, false, api.ChannelKindUnknown},
		{"Unknown with stale flags", false, true, true, api.ChannelKindUnknown},
	} {
		t.Run(tc.name, func(t *testing.T) {
			mock := mockdb.NewMockQuerier(gomock.NewController(t))
			row := sqlc.Channel{ID: 1, Name: &tc.name, KeyKnown: &tc.known, IsHashtag: &tc.hashtag, IsPublic: &tc.public}
			mock.EXPECT().ListChannels(gomock.Any(), gomock.Any()).Return([]sqlc.Channel{row}, nil)
			mock.EXPECT().GetChannelByID(gomock.Any(), int32(1)).Return(row, nil)
			store := &Store{q: mock}
			page, err := store.ListChannels(context.Background(), 10, nil, nil, 0)
			if err != nil {
				t.Fatal(err)
			}
			ch, err := store.GetChannel(context.Background(), 1)
			if err != nil {
				t.Fatal(err)
			}
			if page.Items[0].Kind != tc.want || ch.Kind != tc.want {
				t.Fatalf("list kind %q, detail kind %q; want %q", page.Items[0].Kind, ch.Kind, tc.want)
			}
		})
	}
}

func TestConfiguredChannelKindPersistence(t *testing.T) {
	for _, kind := range []keystore.ChannelKind{keystore.ChannelKindPublic, keystore.ChannelKindPrivate, keystore.ChannelKindHashtag} {
		t.Run(string(kind), func(t *testing.T) {
			mock := mockdb.NewMockQuerier(gomock.NewController(t))
			name, tag := "Renamed", ""
			if kind == keystore.ChannelKindHashtag {
				tag = "weather"
			}
			var tagPtr *string
			if tag != "" {
				tagPtr = &tag
			}
			hashtag, public := kind == keystore.ChannelKindHashtag, kind == keystore.ChannelKindPublic
			hash, fingerprint := []byte{0xab}, []byte{1, 2, 3, 4, 5, 6, 7, 8}
			mock.EXPECT().UpsertChannel(gomock.Any(), sqlc.UpsertChannelParams{
				ChannelHash: hash, KeyFingerprint: fingerprint, Name: &name, Hashtag: tagPtr, IsHashtag: &hashtag, IsPublic: &public,
			}).Return(sqlc.Channel{ID: 7}, nil)
			mock.EXPECT().UpdateConfiguredChannelMetadata(gomock.Any(), sqlc.UpdateConfiguredChannelMetadataParams{
				ChannelHash: hash, KeyFingerprint: fingerprint, Name: &name, Hashtag: tagPtr, IsHashtag: &hashtag, IsPublic: &public,
			}).Return(nil)
			store := &Store{q: mock}
			id, err := store.UpsertChannel(context.Background(), hash, fingerprint, name, tag, kind)
			if err != nil || id != 7 {
				t.Fatalf("id=%d err=%v", id, err)
			}
			if err := store.UpdateConfiguredChannelMetadata(context.Background(), hash, keystore.Entry{Fingerprint: fingerprint, Name: name, Hashtag: tag, Kind: kind}); err != nil {
				t.Fatal(err)
			}
		})
	}
}
