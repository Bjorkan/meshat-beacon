# Beacon API generation

`beacon-server.swagger.json` is a pinned copy of `beacon-server/docs/swagger.json` from the server revision used by this web checkout. It is the deterministic input for the generated REST transport layer.

When the server API changes:

1. copy the reviewed server `docs/swagger.json` to `openapi/beacon-server.swagger.json`;
2. run `npm run api:generate`;
3. review the schema and generated diff together;
4. run `npm run api:check`, tests, lint, and build.

Generated files under `src/api/generated/` are never edited manually. Normal builds do not fetch a schema or require a running server/network connection. TanStack Query keys, cache policy, pagination adapters, and feature projections remain hand-written in `src/api/queries.ts` and `src/api/client.ts`.

Response DTOs in `beacon-server/internal/api` mark always-serialized fields with
`binding:"required"`; fields tagged `omitempty` remain optional. Required nullable
pointers use `extensions:"x-nullable"`, which the generator preserves as `| null`.
Enum tags describe the actual status/confidence/trace values. These annotations
describe serialization and do not change the server's runtime validation behavior.
`json.RawMessage` payloads use an object/unknown schema, not an array-of-bytes model.

Feature types alias the generated models. Only deliberate UI differences remain:
nullable names/locations, missing telemetry measurements as chart gaps, partial
WebSocket list state, pagination cursors, and narrowed dynamic metadata/payloads.
`src/api/client.ts` projects these values without asserting endpoint responses into
unrelated domain types. Unchanged wire/domain shapes pass through directly, so a
schema field rename/type change reaches the consuming UI at compile time. Scope
names and GeoJSON borders retain explicit runtime guards because their generated
transport contracts are intentionally dynamic.
