# Beacon API generation

`beacon-server.swagger.json` is a pinned copy of `beacon-server/docs/swagger.json` from the server revision used by this web checkout. It is the deterministic input for the generated REST transport layer.

When the server API changes:

1. copy the reviewed server `docs/swagger.json` to `openapi/beacon-server.swagger.json`;
2. run `npm run api:generate`;
3. review the schema and generated diff together;
4. run `npm run api:check`, tests, lint, and build.

Generated files under `src/api/generated/` are never edited manually. Normal builds do not fetch a schema or require a running server/network connection. TanStack Query keys, cache policy, pagination adapters, and feature projections remain hand-written in `src/api/queries.ts` and `src/api/client.ts`.
