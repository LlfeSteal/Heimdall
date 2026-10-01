# Heimdall backend

Go 1.22 + Gin. Holds the GitLab token, reads GitLab over GraphQL only, caches answers for 5 minutes
(SPEC §14.1) and serves the JSON contract in `../frontend/src/api/types.ts`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `ROOT_GROUP` | *(required)* | Full path of the parent GitLab group, e.g. `my-org/delivery` |
| `GITLAB_URL` | *(required unless `GITLAB_MOCK=1`)* | GitLab base URL, e.g. `https://gitlab.example.com` |
| `GITLAB_TOKEN` | | Token sent as `Authorization: Bearer …`; read-only scope is enough. Never exposed or logged |
| `GROUP_TERM` | `ART` | Noun used for groups in the UI |
| `PORT` | `8080` | Listen port |
| `GITLAB_MOCK` | | `1` serves built-in fixture data (dates relative to today, UTC) instead of GitLab |
| `STATIC_DIR` | | Directory of the built SPA; non-`/api` paths are served from it, falling back to `index.html` |
| `GIN_MODE` | `debug` | Set to `release` in production |

## Run

All Go commands need `GOFLAGS=-buildvcs=false` in this repository.

```sh
export GOFLAGS=-buildvcs=false

# against fixtures
GITLAB_MOCK=1 ROOT_GROUP=org/delivery go run ./cmd/heimdall

# against GitLab
GITLAB_URL=https://gitlab.example.com GITLAB_TOKEN=… ROOT_GROUP=my-org/delivery go run ./cmd/heimdall

# serve the built frontend too
STATIC_DIR=../frontend/dist GITLAB_MOCK=1 ROOT_GROUP=org/delivery go run ./cmd/heimdall

# checks
go vet ./... && go test -race ./... && go build ./...
```

## API

| Route | Response |
|---|---|
| `GET /api/health` | `{"status":"ok"}` |
| `GET /api/config` | `{ groupTerm, rootGroup }` |
| `GET /api/groups[?refresh=1]` | `GroupCard[]` |
| `GET /api/iterations?group=<fullPath>` | `Iteration[]`, newest first, upcoming included (`refresh` ignored) |
| `GET /api/reports?group=<fullPath>[&refresh=1]` | `IterationReport[]` (≤ 50), newest first |

Errors: `400` for a missing `group`, `502` when GitLab fails; body `{"error":"<GitLab's message verbatim>"}`.
