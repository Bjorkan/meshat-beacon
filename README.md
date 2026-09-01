# MeshCore Beacon

MeshCore Beacon is a real-time MeshCore network observer. This monorepo contains
the Go API, the React web application, and the deployment and architecture
documentation in one versioned workspace.

## Repository layout

| Path | Purpose |
| --- | --- |
| [`beacon-server/`](beacon-server/) | Go API, MQTT ingestion, PostgreSQL storage, and WebSocket streaming |
| [`beacon-web/`](beacon-web/) | React and TypeScript web application |
| [`beacon-docs/`](beacon-docs/) | Architecture, API, and Docker deployment documentation |

## Prerequisites

- Node.js 22 or newer and npm
- Go 1.26.6 or newer
- Docker and Docker Compose for local infrastructure and deployment

## Getting started

Install all dependencies from the repository root:

```bash
make install
```

Start the frontend development server:

```bash
make dev
```

The frontend can proxy API and WebSocket traffic to a separately running
backend. Copy the example configuration files before starting the backend:

```bash
cp beacon-server/env.example beacon-server/.env
cp beacon-server/config.yaml.example beacon-server/config.yaml
go -C beacon-server run ./cmd/beacon
```

See [`beacon-server/README.md`](beacon-server/README.md) and
[`beacon-web/README.md`](beacon-web/README.md) for component-specific setup.

## Commands

| Command | Purpose |
| --- | --- |
| `make install` | Install frontend and Go dependencies |
| `make dev` | Start the frontend development server |
| `make build` | Build the frontend and backend |
| `make lint` | Run ESLint and `go vet` |
| `make test` | Run frontend and backend tests |
| `make check` | Run lint, tests, and production builds |

Equivalent npm scripts are available for running individual components, for
example `npm run test:web` and `npm run build:server`.

## Containers and releases

Container builds use the monorepo root as their build context:

```bash
docker build -f beacon-web/.build/Dockerfile -t beacon-web .
docker build -f beacon-server/.build/Dockerfile -t beacon-server beacon-server
```

GitHub Actions publishes both images on pushes to `main` and version tags. The
deployment examples remain in [`beacon-docs/`](beacon-docs/).

## License

MeshCore Beacon is licensed under the GNU Affero General Public License v3.0 or
later. Component license and contributor files remain beside each component.
