// Copyright 2026 Beacon Contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

type ChannelKind string

const (
	ChannelKindPublic  ChannelKind = "public"
	ChannelKindPrivate ChannelKind = "private"
	ChannelKindHashtag ChannelKind = "hashtag"
	ChannelKindUnknown ChannelKind = "unknown"
)

func ClassifyChannel(keyKnown, isHashtag, isPublic bool) ChannelKind {
	switch {
	case !keyKnown:
		return ChannelKindUnknown
	case isHashtag:
		return ChannelKindHashtag
	case isPublic:
		return ChannelKindPublic
	default:
		return ChannelKindPrivate
	}
}

// ChannelMessage represents a single decrypted channel message.
// Only messages for channels with a known key are stored and returned.
type ChannelMessage struct {
	ID               int64  `json:"id" binding:"required"`
	PacketHash       string `json:"packetHash" binding:"required"`       // hex-encoded packet hash for correlation with packet events
	ChannelHash      string `json:"channelHash" binding:"required"`      // hex-encoded single-byte channel hash
	SenderName       string `json:"senderName" binding:"required"`       // display name from the decrypted payload
	Content          string `json:"content" binding:"required"`          // decrypted message text
	SentAt           int64  `json:"sentAt" binding:"required"`           // epoch ms, from the sender's embedded timestamp
	ObservationCount int64  `json:"observationCount" binding:"required"` // number of packet_observations rows for this message's packet hash
}

// ChannelSummary is the minimal channel representation used in list responses.
type ChannelSummary struct {
	ID          int         `json:"id" binding:"required"`
	Name        *string     `json:"name,omitempty"`                 // display name from config or nil
	ChannelHash string      `json:"channelHash" binding:"required"` // hex-encoded single-byte hash
	LastSeen    int64       `json:"lastSeen" binding:"required"`    // epoch ms, time of most recent message
	IsHashtag   bool        `json:"isHashtag" binding:"required"`   // true if key was derived from a hashtag PSK
	KeyKnown    bool        `json:"keyKnown" binding:"required"`    // true if Beacon has a decryption key for this channel
	Kind        ChannelKind `json:"kind" enums:"public,private,hashtag,unknown" binding:"required"`
}

// Channel is the full channel representation including decryption metadata.
// KeyFingerprint is only populated for hashtag channels since their keys are
// publicly derivable from the tag name.
type Channel struct {
	ChannelSummary
	Hashtag        *string `json:"hashtag,omitempty"`        // tag name without # prefix; non-nil only for hashtag channels
	KeyFingerprint *string `json:"keyFingerprint,omitempty"` // first 8 bytes of SHA256(key), hex-encoded
	MessageCount   int64   `json:"messageCount" binding:"required"`
}

// ChannelPage contains a page of channels and the total undecryptable population
// matching the hash/IATA filters, independent of the page cursor and key filter.
type ChannelPage struct {
	Items        []ChannelSummary `json:"items" binding:"required"`
	NextCursor   *int64           `json:"nextCursor" binding:"required" extensions:"x-nullable"`
	HasMore      bool             `json:"hasMore" binding:"required"`
	UnknownCount int64            `json:"unknownCount" binding:"required"`
}
