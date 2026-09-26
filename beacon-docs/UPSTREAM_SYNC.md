# Upstream integration — 2026-09-24

Integrated these snapshots using subtree merges, retaining the Meshat monorepo:

| Repository | Branch | Commit |
| --- | --- | --- |
| beacon-server | dev | `c02317a4ac7228d19cab498edfa1d61186c84626` |
| beacon-web | dev | `0f0a6ca51c7b2c3315db77954f61b30bbdeea5e2` |
| beacon-docs | main | `12997ae5ec6ecc99c2b160a9cf4d74e78d39ad57` |

The server and web `main` branches were already incorporated. New development work is on their `dev` branches. Web changes were reconciled against the already imported 1.3.1-era source as well as Git ancestry; otherwise the merge would revert later Meshat work.

## Included

- Observer activity and airtime in seconds, converted to percentages over the actual reporting interval in the UI.
- Traffic, signal, path/hash, regional scope analytics and observer comparison, integrated with TanStack routing, Swedish/English translations and the generated API client.
- Precise channel pagination, trace pagination, historical endpoint snapshots and packet summaries.
- Explicit location resets and foreign-node classification. Invalid coordinates are excluded from map markers and path candidates.
- REST throttling, WebSocket capacity limits/backoff, trusted proxy configuration, protected administration and backup export/verification.
- Migration index recovery, structured logging, observer presence cleanup and unique MQTT client identifiers.
- Deployment guidance, proxy header handling, optional fail2ban examples and CI coverage of database/backup integration tests.

## Meshat behavior retained

- Route planner, graph snapshots, directional/direct evidence, SNR sample weighting, hash-width provenance and geographic plausibility checks.
- Global relay resolution, multibyte capability attribution and fresh MeshCore region membership.
- Owner metadata privacy and the separate privileged worker; existing broker configuration.
- Seven-day node IATA membership, fourteen-day observer retention, and preserved packet history after an observer expires.
- Known/unknown channel classification and regional totals, sortable keyset pagination, node traversal history, and packet search across all observation paths and payloads.
- Meshat branding, Swedish default language, responsive shell, Radix controls, lazy TanStack routes, centralized live-query synchronization and generated API adapters.

## Deliberate differences from upstream

- Migrations 001–037 are unchanged. Upstream migrations were appended as 038–048 to avoid colliding with deployed Meshat migration names. Airtime renaming preserves stored values.
- Keep the existing validated 1–1000 result-limit contract. Do not replace it with upstream's 200-row clamp.
- Keep Meshat's sorted/filtered node, route and clock-drift queries where upstream optimizations would remove supported behavior.
- Keep MapLibre 5 and the existing map pipeline; upstream's MapLibre 6/worker migration needs separate compatibility work.
- Keep whole-history server-side packet path/payload search instead of upstream's latest-path-only client filter.
- Keep the existing desktop breakpoint and map path verification when adapting upstream mobile improvements.

## Deployment requirements

Back up the database before upgrading. This integration was tested against disposable PostgreSQL 18, including upgrade from schema 037 with owner links, route evidence and telemetry. It has not been deployed to a live installation.

**Configure `server.trusted_proxies` before enabling this build behind a reverse proxy.** Upstream's default trusts no proxy. Without a configured proxy CIDR, all visitors behind that proxy share one rate-limit bucket. Trust only the actual proxy address or its restricted network, and ensure the backend cannot be reached directly by untrusted clients. See `beacon-server/config.yaml.example` and the Caddy examples for header handling. Do not use `0.0.0.0/0` or `::/0` as a shortcut. For an existing Compose deployment, inspect its network/addressing and make the selected trusted CIDR stable across container recreation.

Administrative configuration, accounts and backups require the configured bearer token. Existing automated administrative clients must supply it. Public read-only API calls do not require it. Backup export uses a PostgreSQL 18 client in the server image.

CI runs both the Meshat database regression suite and upstream PostgreSQL tests, plus real backup export/download checks. Browser coverage runs the existing Chromium and Firefox suites against a production web build.

## Verification for this integration

- Web: 1,044 unit/component tests; production build, ESLint, Prettier and generated API drift checks pass.
- Browsers: 67 existing Chromium/Firefox cases pass, with 7 existing platform-specific skips; 4 new mobile/desktop cases verify Swedish analytics, regional queries and comparison deep links.
- Server: full Go test suite, vet and build pass. The full database suite also passes with both test DSNs pointing at one initialized PostgreSQL 18 database, matching CI.
- Upgrade: all 48 migrations apply; upgrading from 037 preserves owner links, direct-neighbor/hash-width evidence and airtime counter values; rerunning migrations is safe.
- Channel pagination: sub-millisecond ties, regional known/unknown-key filtering and scoped unknown counts pass together.
- Backup: real PostgreSQL 18 export, offline verification, restore and authenticated HTTP download tests pass.
- Race detector: hub, presence, ingest and API router packages pass.
