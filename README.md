# beacon-docs

Documentation, architecture, and **ready-to-run Docker deployments** for MeshCore Beacon.

This repo is the single place to:

1. **Grab a deployment** — copy the Docker Compose folder for the topology you want, fill in your variables, and `docker compose up -d`.
2. **Read the docs** — project-wide design and API documentation that describe how the whole system works.

---

## Deploy Beacon

Two deployment topologies are provided. Pick one, copy its folder to your server, set your variables, and bring it up.

| Type | Folder | What it is | Status |
|---|---|---|---|
| **Type 1 — All-in-One** | [`docker-deployment-type1/`](docker-deployment-type1/) | Full stack on a single server: API (`app`), Postgres (`db`), Redis (`redis`), web frontend (`web`), and Caddy reverse proxy with automatic TLS. | ✅ Ready |
| **Type 2 — Split Server + Web** | [`docker-deployment-type2/`](docker-deployment-type2/) | API backend on one server, web frontend on a dedicated server. | 🚧 Not done yet (WIP) |

### Step-by-step (Type 1)

**1. Get the files onto your server**

Clone the repo (you only need the deployment folder, but cloning is the simplest way to grab it):

```bash
git clone https://github.com/MeshCore-Beacon/beacon-docs.git
cd beacon-docs/docker-deployment-type1
```

The folder is self-contained:

```text
docker-deployment-type1/
├── docker-compose.yml          # the stack
├── .env                        # your secrets (you create this — see step 2)
└── data/                       # persistent state, bind-mounted into the containers
    ├── app/config.yaml         # Beacon app config (regions, channels, retention)
    ├── Caddy/CaddyFile/Caddyfile.proxy
    ├── postgres/               # ← Postgres database files live here (created on first run)
    └── redis/                  # ← Redis data lives here (created on first run)
```

> **`data/postgres/` and `data/redis/` are empty in git on purpose.** They're bind-mount targets: the `db` and `redis` containers write their data into them, so your database and cache **survive `docker compose down` and restarts**. Don't delete them unless you intend to wipe all data — `rm -rf data/postgres` resets the database. They populate automatically the first time you run `docker compose up -d`.

**2. Create and fill in your `.env`**

Copy the template from [`app_config/.env.example`](app_config/.env.example) and edit it:

```bash
cp ../app_config/.env.example .env
nano .env
```

Set every `CHANGE_*` value. The variables you must fill in:

| Variable | Service | What to set |
|---|---|---|
| `POSTGRES_DSN` | `app` | Database connection string. Change the password (`CHANGE_DB_PASS`) to a strong one. |
| `MQTT_BROKER_1_*` / `MQTT_BROKER_2_*` | `app` | URL, username, and password for your live MeshCore MQTT packet sources. |
| `DOMAIN` | `caddy` | Your public domain (e.g. `beacon.example.com`). Caddy auto-provisions a Let's Encrypt cert for it. |
| `VITE_API_BASE` | `web` | `https://<your-domain>/api/v1` — must be the **public** domain, never localhost. |
| `VITE_WS_URL` | `web` | `wss://<your-domain>/ws` |
| `VITE_MAP_CENTER` / `VITE_MAP_ZOOM` | `web` | *(Optional)* Fallback "All" map view. The app auto-fits the map to all IATA locations from `config.yaml`; these values are only used as a fallback when those IATAs have no location set. Omit for a world view. |

> ⚠️ **Password must match in two places.** The password inside `POSTGRES_DSN` (in `.env`) must equal `POSTGRES_PASSWORD` in `docker-compose.yml`. Update both before bringing the stack up.

**3. Fill in the app config**

Edit [`data/app/config.yaml`](docker-deployment-type1/data/app/config.yaml) to define your network:

```bash
nano data/app/config.yaml
```

- **`iatas`** — the airport-code anchor points for your coverage area (name + lat/lng).
- **`regions`** — map regions that group IATAs together.
- **`channel_keys`** — hashtag channels and/or explicit channel keys to decrypt.
- **`scopes`**, **`telemetry`**, **`packets`**, **`ingest`** — transport scopes, retention windows, and an optional geographic ingest filter.

**4. Point DNS at the server**

Create an `A`/`AAAA` record for your `DOMAIN` pointing at the server's public IP. Caddy needs ports **80** and **443** reachable to issue the TLS certificate.

**5. Bring it up**

```bash
docker compose up -d
```

Check it's healthy:

```bash
docker compose ps
docker compose logs -f
```

Visit `https://<your-domain>` and you're off to the races. 🚀

> After changing any `VITE_*` value later, recreate the web container so the new values get baked into the JS bundle:
> ```bash
> docker compose up -d --force-recreate web
> ```
> (then hard-refresh / use incognito, since `/assets/*` is cached immutable.)

### Type 2 — Split Server + Web

🚧 **Not done yet.** [`docker-deployment-type2/`](docker-deployment-type2/) is a placeholder; instructions and compose files will land here.

---

## Project documentation

Project-wide docs that describe the entire system live in [`app_documentation/`](app_documentation/):

- [**High Level Design**](app_documentation/high_level_design.md) — single source of truth. System overview, database schema, ingestion pipeline, and future features.
- [**API Contract**](app_documentation/api_contract.md) — REST endpoints, WebSocket protocol, search, backpressure/reconnection, and mobile-specific concerns.

## Source repositories

- **Beacon Server (API):** [github.com/MeshCore-Beacon/beacon-server](https://github.com/MeshCore-Beacon/beacon-server) — image `ghcr.io/meshcore-beacon/beacon-server`
- **Beacon Web (Frontend):** [github.com/MeshCore-Beacon/beacon-web](https://github.com/MeshCore-Beacon/beacon-web) — image `ghcr.io/meshcore-beacon/beacon-web`

## Repo structure

- `/docker-deployment-type1` — Single-server (all-in-one) Docker Compose deployment ✅
- `/docker-deployment-type2` — Split server/web Docker Compose deployment 🚧 WIP
- `/app_config` — Example `.env`, `config.yaml`, and Caddyfile templates
- `/app_documentation` — Project-wide design & API docs
- `/logos` — Brand assets

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the
workflow and the [Code of Conduct](CODE_OF_CONDUCT.md). Issues are disabled on
this repo; to discuss a change first, reach out on the
[MeshCore Canada Discord](https://discord.gg/Gz3KvJx2hf). Security reports go
through [SECURITY.md](SECURITY.md), not public channels.

## License

Beacon is licensed under the [GNU Affero General Public License v3.0](LICENSE)
(AGPL-3.0), the same license as [beacon-server](https://github.com/MeshCore-Beacon/beacon-server).
