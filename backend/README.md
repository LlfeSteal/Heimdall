# Heimdall backend

Go 1.22 + Gin. Holds the GitLab token, reads GitLab over GraphQL only, caches answers for 5 minutes
(SPEC §14.1) and serves the JSON contract in `../frontend/src/api/types.ts`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `ROOT_GROUP` | *(required)* | Full path of the parent GitLab group, e.g. `my-org/delivery` (any case; surrounding `/` ignored) |
| `GITLAB_URL` | *(required unless `GITLAB_MOCK=1`)* | GitLab's **canonical** base URL, e.g. `https://gitlab.example.com` (see below) |
| `GITLAB_TOKEN` | | Token sent as `Authorization: Bearer …`; read-only scope is enough. Never exposed or logged |
| `GROUP_TERM` | `ART` | Noun used for groups in the UI |
| `PORT` | `8080` | Listen port |
| `GITLAB_MOCK` | | `1` serves built-in fixture data (dates relative to today, UTC) instead of GitLab |
| `STATIC_DIR` | | Directory of the built SPA; non-`/api` paths are served from it, falling back to `index.html` |
| `GITLAB_MAX_CONCURRENCY` | `12` | Most GitLab requests in flight across the whole process (all groups share it; each group read also uses at most 4) |
| `GITLAB_READ_TIMEOUT` | `90s` | Deadline of one logical GitLab read (e.g. a group's whole report read); `90`, `90s`, `2m` accepted. Running out is a failed read, never cached |
| `GIN_MODE` | `debug` | Set to `release` in production |

**Redirects are refused.** Go would replay a redirected GraphQL `POST` as a body-less `GET`, which GitLab
answers with a confusing error. If `GITLAB_URL` redirects (e.g. `http://` → `https://`, or an old hostname),
every request fails with `GitLab redirected the request to "<target>"; set GITLAB_URL to GitLab's canonical
address…`. Set `GITLAB_URL` to that target's base URL.

## GitLab requirements

- GitLab Premium/Ultimate (iterations and burnup reports are EE features) with GraphQL enabled.
- The schema must have `TimeboxReport.error` (selected by every report request). Older versions reject every
  report request with "Field 'error' doesn't exist on type 'TimeboxReport'": every chart then errors and
  every group stays listed. The exact first version was not verified here (believed to be in the GitLab 15
  series). Check an instance with
  `{ __type(name: "TimeboxReport") { fields { name } } }` in GraphiQL (`/-/graphql-explorer`).
- A token with `read_api` scope that can read the groups under `ROOT_GROUP`.

## GitLab reads

- Group list: `descendantGroups` of `ROOT_GROUP`, every page.
- `/api/iterations`: one page of `iterations(includeAncestors: true)` (unpaginated by design, ledger #2).
- `/api/reports` (one cached read per group): every page of the lightweight iteration list → newest 50 by the
  §5.1 rule → one `iteration(id:) { report(fullPath:) }` request each (GitLab's query-complexity limit allows
  one report per query), at most 4 in flight. Any failed request (including an iteration GitLab returns as
  `null`) fails the whole read; nothing is cached.
- Busy answers (429/502/503/504) are retried, 3 attempts in total, waiting for `Retry-After` (capped at
  10 s) or a jittered backoff; other failures are not retried.

**Request budget** (each answer is reused for 5 minutes):

| Read | GitLab requests |
|---|---|
| Group list (`/api/groups`) | ⌈descendants / 100⌉ + the report read of every depth-1/2 candidate (below) |
| Report read of one group (`/api/reports`, and the group list's data check) | ⌈iterations / 100⌉ + min(50, iterations), i.e. about **1 + N** |
| `/api/iterations` | 1 |

E.g. 40 teams × 50 iterations ≈ 2,040 requests on a cold or refreshed group list, at most
`GITLAB_MAX_CONCURRENCY` at a time, which is close to GitLab.com's authenticated rate limit of
2,000 requests/min; 429s are retried as above.

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
| `GET /api/reports?group=<fullPath>[&refresh=1]` | `IterationReport[]` (≤ 50), newest first; `reportError` = GitLab's reason when it refused a report |

Errors: `400` for a missing `group`, `502` when GitLab fails; body `{"error":"<GitLab's message verbatim>"}`.
