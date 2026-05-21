# MeshCore Tower: API Contract

The Go server exposes one HTTP base, one REST API namespace under `/api/v1/`, and one WebSocket endpoint at `/ws`. React (web) and Flutter (mobile) consume identical endpoints. All JSON is camelCase. Times are Unix epoch milliseconds as integers (e.g. `1747668456000`), bytes are hex strings, UUIDs are stringified.

**Why epoch ms:** smaller on the wire, no timezone or parser ambiguity, no string parsing in hot paths (chart axes, sorts, comparisons), and matches the units MeshCore uses internally (uint32 Unix seconds in adverts and traces). JS `new Date(ms)` and Dart `DateTime.fromMillisecondsSinceEpoch(ms)` consume it natively.

Query params follow the same convention: `since` and `until` are epoch ms integers. `range` is a human-friendly duration string (`24h`, `7d`, `30d`) for stats endpoints where the exact boundary doesn't matter.

---

## Auth

No authentication in v1. All endpoints are publicly readable. Operational configuration is managed via the config file described in the [High Level Design](high_level_design.md#operations-and-configuration).

## Versioning

Path is the contract: `/api/v1/`. Breaking changes get `/api/v2/`. Backward-compatible additions just expand the existing payloads. WebSocket messages include a `type` discriminator and a top-level `v: 1` field so we can evolve in place.

---

## REST endpoints

### Live Packets

```
GET /api/v1/packets?iata=YOW&payloadType=4&routeType=1&since=<ts>&until=<ts>&limit=50&cursor=<opaque>
```

Returns the most recent packets matching filters, newest first, with cursor-based pagination. Each row is a packet summary with the latest observation rolled in:

```json
{
  "packets": [
    {
      "packetHash": "9e9b7d6a91cab445",
      "payloadType": 4,
      "payloadTypeName": "ADVERT",
      "routeType": 1,
      "routeTypeName": "FLOOD",
      "firstHeardAt": 1747665456000,
      "lastHeardAt": 1747665462000,
      "observationCount": 15,
      "latestObserver": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "displayName": "FlightlessDt",
        "iata": "KEH"
      },
      "summary": "Advert \"WW7STR/PugetMesh Cougar\""
    },
    {
      "packetHash": "3c4f8a12b7e60d91",
      "payloadType": 5,
      "payloadTypeName": "GROUP_TEXT",
      "routeType": 1,
      "routeTypeName": "FLOOD",
      "firstHeardAt": 1747665440000,
      "lastHeardAt": 1747665455000,
      "observationCount": 8,
      "latestObserver": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "displayName": "Hull_Hospital",
        "iata": "YOW"
      },
      "summary": "Group text on #ottawa"
    }
  ],
  "nextCursor": "eyJsYXN0IjoiM2M0ZjhhMTJiN2U2MGQ5MSJ9"
}
```

### Packet detail

```
GET /api/v1/packets/{packetHash}
```

Full packet plus all observations, with each observation's resolved path inline.

```json
{
  "packetHash": "9e9b7d6a91cab445",
  "payloadType": 4,
  "payloadVersion": 0,
  "routeType": 1,
  "transportCodes": null,
  "originPubkey": "7e7662676f7f0850...",
  "parsedPayload": { "name": "WW7STR/PugetMesh Cougar", "deviceRole": 2, "location": {} },
  "rawPayload": "7e7662676f7f...",
  "decrypted": false,
  "channelHash": null,
  "firstHeardAt": 1747665456000,
  "lastHeardAt": 1747665462000,
  "observations": [
    {
      "id": 12345,
      "observerId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "observerName": "FlightlessDt",
      "iata": "KEH",
      "heardAt": 1747665462000,
      "pathLengthByte": 65,
      "hashSize": 2,
      "hopCount": 1,
      "pathBytes": "ae9b",
      "rssi": -98,
      "snr": 10.75,
      "propagationTimeMs": 1936,
      "radio": { "freqMhz": 910.525, "spreadFactor": 7, "bandwidthKhz": 62.5, "codingRate": 5 },
      "sourceBroker": "mqtt1",
      "resolvedPath": [
        { "confidence": "high", "node": { "id": "d4e5f6a7-b8c9-0123-def0-123456789abc", "name": "YOW_Kanata", "publicKey": "ae9b...", "latitude": 45.3, "longitude": -75.9 } }
      ]
    },
    {
      "id": 12346,
      "observerId": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "observerName": "Hull_Hospital",
      "iata": "YOW",
      "heardAt": 1747665464000,
      "pathLengthByte": 130,
      "hashSize": 2,
      "hopCount": 2,
      "pathBytes": "ae9bbf3c",
      "rssi": -105,
      "snr": 7.2,
      "propagationTimeMs": 4122,
      "radio": { "freqMhz": 910.525, "spreadFactor": 7, "bandwidthKhz": 62.5, "codingRate": 5 },
      "sourceBroker": "mqtt2",
      "resolvedPath": [
        { "confidence": "high", "node": { "id": "d4e5f6a7-b8c9-0123-def0-123456789abc", "name": "YOW_Kanata", "publicKey": "ae9b...", "latitude": 45.3, "longitude": -75.9 } },
        { "confidence": "ambiguous", "candidates": [{ "id": "e5f6a7b8-c9d0-1234-ef01-23456789abcd", "name": "YOW_Gatineau", "publicKey": "bf3c..." }, { "id": "f6a7b8c9-d0e1-2345-f012-3456789abcde", "name": "YOW_Hull_West", "publicKey": "bf3c..." }], "idBytes": "bf3c" }
      ]
    }
  ]
}
```

### Search

```
GET /api/v1/packets/search?q=<query>&field=<field>&iata=<iata>&limit=50
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | yes | Search query |
| `field` | `hash` \| `path` \| `payload` | yes | Which field to search |
| `iata` | string | no | Region filter (omit for all) |
| `limit` | number | no | Max results (default 50) |

Response uses the same `PacketSummary[]` shape as the existing packet list, plus a total count:

```json
{
  "packets": [
    {
      "packetHash": "9e9b7d6a91cab445",
      "payloadType": 4,
      "payloadTypeName": "ADVERT",
      "routeType": 1,
      "routeTypeName": "FLOOD",
      "firstHeardAt": 1747665456000,
      "lastHeardAt": 1747665462000,
      "observationCount": 15,
      "latestObserver": {
        "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "displayName": "FlightlessDt",
        "iata": "KEH"
      },
      "summary": "Advert \"WW7STR/PugetMesh Cougar\""
    },
    {
      "packetHash": "7a2e9b0c44df1583",
      "payloadType": 4,
      "payloadTypeName": "ADVERT",
      "routeType": 1,
      "routeTypeName": "FLOOD",
      "firstHeardAt": 1747664200000,
      "lastHeardAt": 1747664218000,
      "observationCount": 6,
      "latestObserver": {
        "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
        "displayName": "Hull_Hospital",
        "iata": "YOW"
      },
      "summary": "Advert \"VE3XYZ/Ottawa Repeater\""
    }
  ],
  "total": 42
}
```

Search behavior by field:
- `field=hash` -- substring match on packet_hash (case-insensitive)
- `field=path` -- match against resolved path node names across all observations for a packet
- `field=payload` -- match against raw_payload hex string (case-insensitive)

### Nodes

```
GET    /api/v1/nodes?type=2&iata=YOW&firmwareTier=1.14.0&limit=50&cursor=<opaque>
GET    /api/v1/nodes/{nodeId}
GET    /api/v1/nodes/{nodeId}/observations?since=<ts>&limit=50&cursor=<opaque>
```

The node detail includes `iatasHeardIn`, `supportsMultibytePaths`, `supportsMultibyteTraces`, `minFirmwareVersion`, and the latest advert payload.

### Observers

```
GET    /api/v1/observers?iata=YOW&type=meshcoretomqtt&broker=mqtt1&status=online
GET    /api/v1/observers/{observerId}
GET    /api/v1/observers/{observerId}/telemetry?range=24h
GET    /api/v1/observers/{observerId}/adverts?limit=50&cursor=<opaque>
```

Telemetry response is a time-bucketed array suitable for direct chart consumption:

```json
{
  "range": "24h",
  "interval": "5m",
  "points": [
    {
      "t": 1747612800000,
      "batteryMv": 4180,
      "airtimeTxPct": 0.37,
      "airtimeRxPct": 1.05,
      "noiseFloorDb": -103.2,
      "uptimeSeconds": 86400,
      "queueLength": 0,
      "receiveErrors": 3
    },
    {
      "t": 1747613100000,
      "batteryMv": 4175,
      "airtimeTxPct": 0.42,
      "airtimeRxPct": 1.12,
      "noiseFloorDb": -102.8,
      "uptimeSeconds": 86700,
      "queueLength": 1,
      "receiveErrors": 3
    }
  ]
}
```

### Channels

```
GET    /api/v1/channels?limit=50
GET    /api/v1/channels/{channelHash}
GET    /api/v1/channels/{channelHash}/messages?since=<ts>&limit=50&cursor=<opaque>
```

Channel keys are configured via the server config file.

### IATAs and regions

```
GET    /api/v1/iatas
GET    /api/v1/iatas/{iata}
GET    /api/v1/regions
GET    /api/v1/regions/{regionId}
```

Region creation, IATA assignment, and grouping are managed via the server config file.

### Stats

```
GET /api/v1/stats/overview?iata=YOW
GET /api/v1/stats/observations?iata=YOW&range=24h&interval=1h
GET /api/v1/stats/payloadBreakdown?iata=YOW&range=24h
GET /api/v1/stats/topNodes?iata=YOW&range=24h&limit=10
GET /api/v1/stats/topObservers?iata=YOW&range=24h&limit=10
```

All stats endpoints accept either `iata` (one or comma-separated) or `regionId` (expands to all IATAs in that super-region).

### Errors

All errors use a consistent shape:

```json
{ "error": { "code": "not_found", "message": "Packet not found" } }
```

Codes: `bad_request`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `rate_limited`, `internal`.

---

## WebSocket

Single endpoint at `/ws`. Bidirectional JSON messages. Subscription-based: the client tells the server what it wants, the server pushes matching events.

### Connection

```
GET /ws
```

On connect the server sends a `hello`:

```json
{ "v": 1, "type": "hello", "serverTime": 1747665456000, "connectionId": "uuid" }
```

### Client → Server messages

All client messages have a `type` and an optional `id` for request/ack correlation.

**`subscribe`**: add filters to this connection. Multiple subscriptions on one connection are unioned (OR semantics): an event matches if it matches any active subscription.

```json
{
  "v": 1,
  "type": "subscribe",
  "id": "sub-1",
  "scope": {
    "iatas": ["YOW"],
    "regionIds": [],
    "payloadTypes": [4, 5],
    "routeTypes": [],
    "channelHashes": [],
    "observerIds": [],
    "events": ["packetObservation", "observerStatus"]
  }
}
```

All scope fields are optional. Omitted = no filter on that dimension. Empty array = match nothing for that dimension. Server replies with `subscribed`:

```json
{ "v": 1, "type": "subscribed", "id": "sub-1", "subscriptionId": "uuid" }
```

**`unsubscribe`**:

```json
{ "v": 1, "type": "unsubscribe", "id": "unsub-1", "subscriptionId": "uuid" }
```

**`ping`**:

```json
{ "v": 1, "type": "ping", "id": "p-1" }
```

Server replies with `pong { id: "p-1" }`. Client should ping every 30s; server closes idle connections after 90s.

### Server → Client events

All server events have `v`, `type`, and `event` body. They carry no `id` since they're unsolicited (replies to client requests echo the original `id`).

**`packetObservation`**: emitted when a new observation hits the DB. This is the primary live event.

```json
{
  "v": 1,
  "type": "event",
  "event": "packetObservation",
  "data": {
    "packetHash": "9e9b7d6a91cab445",
    "packet": {
      "payloadType": 4,
      "payloadTypeName": "ADVERT",
      "routeType": 1,
      "isFirstObservation": false,
      "totalObservationCount": 16,
      "summary": "Advert \"WW7STR/PugetMesh Cougar\""
    },
    "observation": {
      "id": 12346,
      "observerId": "uuid",
      "observerName": "NodeRunner",
      "iata": "SEA",
      "heardAt": 1747665462000,
      "pathLengthByte": 130,
      "hashSize": 2,
      "hopCount": 2,
      "pathBytes": "ae9bbf3c",
      "rssi": -105,
      "snr": 7.2,
      "propagationTimeMs": 4122,
      "sourceBroker": "mqtt2",
      "resolvedPath": []
    }
  }
}
```

`isFirstObservation: true` means this is the first time this packet has been seen, so the UI should add a new row. `false` means UI should update the existing packet row's observation count and timestamp, and if the packet is currently expanded, append the new observation card.

**`observerStatus`**: emitted when an observer's `/status` message updates them. Used for the Observer Status grid (online/offline transitions, battery curves, etc.).

```json
{
  "v": 1,
  "type": "event",
  "event": "observerStatus",
  "data": {
    "observerId": "uuid",
    "displayName": "Hull_Hospital",
    "iata": "YOW",
    "online": true,
    "batteryMv": 4180,
    "uptimeSeconds": 86400,
    "lastStatusAt": 1747665462000,
    "fields": ["batteryMv", "uptimeSeconds", "lastStatusAt"]
  }
}
```

`fields` lists which keys actually changed in this update, so the client can do partial UI refreshes without diffing.

**`nodeUpdate`**: emitted when a node's capability flags flip, when a new IATA is added to its `node_iatas`, or when an advert refreshes its location/name.

```json
{
  "v": 1,
  "type": "event",
  "event": "nodeUpdate",
  "data": {
    "nodeId": "uuid",
    "publicKey": "...",
    "name": "YOW_Kanata",
    "supportsMultibytePaths": true,
    "supportsMultibyteTraces": true,
    "minFirmwareVersion": "1.14.0+",
    "iatasHeardIn": ["YOW", "YUL"],
    "reason": "capabilityUpgraded"
  }
}
```

`reason` is one of: `advertRefresh`, `capabilityUpgraded`, `newIataHeard`.

**`channelMessage`**: emitted when a group text packet is decrypted into a chat message. Only sent to subscribers including that `channelHash` in their scope.

```json
{
  "v": 1,
  "type": "event",
  "event": "channelMessage",
  "data": {
    "channelHash": "f3",
    "channelName": "#ottawa",
    "senderName": "Chris",
    "content": "anyone hear that trace?",
    "sentAt": 1747665462000,
    "packetHash": "..."
  }
}
```

**`error`**: server-side errors that aren't replies to a specific request.

```json
{ "v": 1, "type": "error", "code": "rate_limited", "message": "Subscription scope too broad" }
```

---

## Backpressure and reconnection

The server's write buffer per connection is bounded (default 256 events). If the client can't keep up, the server drops the oldest queued events and sends a `lagged` notice:

```json
{ "v": 1, "type": "lagged", "droppedCount": 47, "since": 1747665440000, "lastObservationId": 12340 }
```

Clients should react by re-fetching the relevant REST page using `afterId` to fill the gap deterministically, then resume normal streaming.

Reconnection is the client's responsibility. On any disconnect, the client should:
1. Reconnect with backoff (1s, 2s, 5s, 10s, 30s cap)
2. Re-issue all subscriptions
3. Hit the relevant REST endpoint with `afterId=<last observation id seen>` to backfill anything missed
4. Resume streaming

There's no replay buffer for missed events; REST is the source of truth for history. This keeps the server stateless per-connection (no per-client cursors held in memory waiting for slow consumers), and reconnection is cheap. Using `afterId` rather than timestamps avoids clock-skew edge cases between server and client.

REST endpoints support `afterId` as a query param on listing endpoints:

```
GET /api/v1/packets?iata=YOW&afterId=12345&limit=100
GET /api/v1/observers/{id}/telemetry?afterId=987&limit=100
```

---

## Mobile-specific concerns

Flutter on iOS background suspension and Android battery saver will kill the WebSocket. Pattern for the mobile app:

1. On foreground: open WS, subscribe.
2. On background: close WS gracefully (don't fight the OS).
3. On return to foreground: reopen, re-subscribe, and fire a REST refresh on whatever screen is active to backfill anything missed.

The protocol doesn't need to know about backgrounding; the client just treats reconnection as the recovery mechanism.

---

## Open questions

- **packetObservation payload size.** Currently fat: includes the full resolved path with node coordinates. Could be 1-2 KB per event in heavy traffic. Slim alternative would be `{packetHash, observationId, iata, heardAt}` only, with clients fetching details via REST when needed. Tradeoff is bandwidth vs round-trip count.

(See [Questions and Answers](high_level_design.md#questions-and-answers) in the high level design for resolved items: SSE fallback, rate limiting strategy, mobile push notifications, broker bundling, pprof protection, observationId backfill.)
