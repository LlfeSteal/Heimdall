# Heimdall

Heimdall reads GitLab iteration data (read-only), draws each iteration's deviation curve, lets a team pin
short notes to the day the curve moved, and adds a forecast and a predictability score GitLab does not
provide. The full product specification is [`docs/SPEC.md`](docs/SPEC.md).

- `backend/` — Go 1.22 + Gin API. Holds the GitLab token and talks to GitLab over GraphQL only
  (details: [`backend/README.md`](backend/README.md)).
- `frontend/` — Vite + React + TypeScript SPA (Chart.js). All forecast / score algorithms live in
  `frontend/src/domain/`.

## Configuration

The backend is configured through environment variables. For `docker compose`, copy
[`.env.example`](.env.example) to `.env` (gitignored) and edit it.

| Variable | Default | Meaning |
|---|---|---|
| `ROOT_GROUP` | *(required; compose default `org/delivery`)* | Full path of the parent GitLab group, e.g. `my-org/delivery` |
| `GITLAB_URL` | *(required unless `GITLAB_MOCK=1`)* | GitLab base URL, e.g. `https://gitlab.example.com` |
| `GITLAB_TOKEN` | | Token sent as `Authorization: Bearer …`; read-only (`read_api`) scope is enough. Never sent to the browser or logged |
| `GROUP_TERM` | `ART` | Noun used for groups in the UI |
| `GITLAB_MOCK` | `0` | `1` serves built-in fixture data (dates relative to today, UTC) instead of calling GitLab |
| `PORT` | `8080` | API listen port (backend only) |
| `STATIC_DIR` | | Optional: directory of a built SPA for the backend to serve itself (not used by compose) |
| `GIN_MODE` | `debug` | `release` in production; the Docker image sets it |

## Development

Two terminals (the Vite dev server on `:5173` proxies `/api` to the API on `:8080`):

```sh
# 1. API with fixture data — no GitLab needed
cd backend && GOFLAGS=-buildvcs=false GITLAB_MOCK=1 ROOT_GROUP=org/delivery go run ./cmd/heimdall

# 2. SPA
cd frontend && npm install && npm run dev      # http://localhost:5173
```

Against a real GitLab, replace `GITLAB_MOCK=1` with `GITLAB_URL=… GITLAB_TOKEN=…` and your `ROOT_GROUP`.

## Tests

```sh
cd backend && GOFLAGS=-buildvcs=false go test ./...
cd frontend && npm test
cd frontend && npm run e2e    # Playwright, starts the mock backend + Vite itself
```

## Docker Compose

`docker-compose.yml` runs two containers: `backend` (the Go API, internal port 8080, health-checked on
`/api/health`) and `frontend` (nginx, published on host port **8090** — override with `HEIMDALL_PORT`, serving the built SPA and proxying `/api/` to the
backend).

```sh
# fixture data, no GitLab needed
GITLAB_MOCK=1 docker compose up -d --build      # http://localhost:8090/

# real GitLab: configure .env first
cp .env.example .env && $EDITOR .env
docker compose up -d --build

docker compose down
```

Variables exported in the shell override `.env`.

## Conformance docs

The implementation was built by several agents, each owning one area and checking it against the spec.
Their checklists map SPEC sections to the tests that cover them:

| Document | Scope |
|---|---|
| [`docs/conformance/backend.md`](docs/conformance/backend.md) | Amendment A, GitLab access, caching, HTTP contract, error messages |
| [`docs/conformance/domain.md`](docs/conformance/domain.md) | Pure TS algorithms in `frontend/src/domain/` (series, forecast, score, formatting) |
| [`docs/conformance/annotations.md`](docs/conformance/annotations.md) | Annotation model, storage and lifecycle in `frontend/src/annotations/` |
