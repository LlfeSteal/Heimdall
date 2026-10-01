# Backend conformance checklist

Scope: SPEC Amendment A (A.2–A.5), §4.4, §5.1, §5.2, §6 (server-side windows), §7.1, §13/§14.3 (error
messages), §14.1, §14.2, §15.2, §15.9, and the "Implementation notes" HTTP contract.
Everything else (§7.2–§12 algorithms, wording, screens) is frontend scope.

Run: `cd backend && GOFLAGS=-buildvcs=false go vet ./... && GOFLAGS=-buildvcs=false go test ./...`

---

## Builder brief

### Package layout (module `heimdall`, Go 1.22, Gin v1.10.0)

| Package | Status | Role |
|---|---|---|
| `internal/api` | `types.go` existing (DO NOT rename fields); `router.go` **stub** | HTTP contract + Gin router |
| `internal/config` | existing, done | env → `Config` |
| `internal/gitlab` | `types.go` done; `http.go` **stub** | raw GraphQL types, `Client` interface, `HTTPClient` |
| `internal/cache` | **stub** | generic TTL + LRU + single-flight cache (§14.1) |
| `internal/iterations` | **stub** | §5.1 newest-first ordering |
| `internal/reports` | **stub** | GitLab → contract normalisation (§7.1) |
| `internal/groups` | **stub** | A.3 candidates, §4.4 data check, card folding |
| `internal/service` | **stub** | composes client + caches + pure packages; implements `api.Service` |
| `internal/mock` | **done** (do not change behaviour) | in-memory `gitlab.Client` fake with counters + A.5 fixture estate |
| `cmd/heimdall` | placeholder | wire it (see below) |

Dependency graph: `api` ← `service` → {`cache`, `gitlab`, `groups`, `iterations`, `reports`}; `groups`,
`iterations`, `reports` depend only on `api` types (+ `gitlab` types). `api` must NOT import `service`.

### Stub APIs to implement (signatures are fixed by the tests)

```go
// internal/gitlab (http.go)
func NewHTTPClient(baseURL, token string, hc *http.Client) *HTTPClient   // hc nil → http.DefaultClient; tolerate trailing "/"
func (c *HTTPClient) DescendantGroups(ctx, rootFullPath string) ([]Group, error)        // paginate via $after until hasNextPage=false
func (c *HTTPClient) Iterations(ctx, groupFullPath string) ([]Iteration, error)         // ONE request, includeAncestors: true
func (c *HTTPClient) Reports(ctx, groupFullPath string) ([]IterationReport, error)      // ONE request, first: 50, report(fullPath: $fullPath)

// internal/cache
func New[V any](ttl time.Duration, capacity int, now func() time.Time) *Cache[V]        // 0/nil → DefaultTTL(5m)/DefaultCapacity(256)/time.Now
func (c *Cache[V]) Get(ctx, key string, refresh bool, fetch func(ctx) (V, error)) (V, error)
func (c *Cache[V]) Len() int
func Key(op string, params ...string) string                                            // injective

// internal/iterations
func IIDNumber(iid string) int            // strconv.Atoi, failure → 0
func Less(a, b api.Iteration) bool
func Sort(its []api.Iteration)            // stable
func SortReports(rs []api.IterationReport)

// internal/reports
func NormalizeOne(in gitlab.IterationReport) api.IterationReport
func Normalize(in []gitlab.IterationReport) []api.IterationReport   // never nil
func Iteration(in gitlab.Iteration) api.Iteration

// internal/groups
const MaxInFlight = 8
func Depth(root, fullPath string) int        // 0 root, n>0 under root, -1 otherwise (prefix root+"/")
func LastSegment(fullPath string) string
func ComparePaths(a, b string) int           // locale-aware (x/text/collate, language.Und) + bytewise tiebreak
func Candidates(root string, descendants []gitlab.Group) []Candidate   // depth 1–2, dedupe by ID keep first, input order
func HasCurve(reports []api.IterationReport) bool
func CheckData(ctx, paths []string, maxInFlight int, read ReadFunc) []bool  // ≤8, input order, fail-open
func BuildCards(candidates []Candidate, passed []bool) []api.GroupCard

// internal/service
func New(client gitlab.Client, opts Options) *Service    // Options{RootGroup, Now, TTL, CacheCapacity}
func (s *Service) Groups(ctx, refresh bool) ([]api.GroupCard, error)
func (s *Service) Iterations(ctx, group string) ([]api.Iteration, error)          // no refresh, ever
func (s *Service) Reports(ctx, group string, refresh bool) ([]api.IterationReport, error)

// internal/api
type Service interface { Groups(...); Iterations(...); Reports(...) }
func NewRouter(cfg AppConfig, svc Service) *gin.Engine
```

Doc comments on each stub are normative; read them.

### Key design points

- **One cached read per question.** Service holds caches keyed `Key("descendants", root)`,
  `Key("iterations", group)`, `Key("reports", group)`; the reports cache stores the *normalised, sorted*
  `[]api.IterationReport`. The §4.4 data check calls the same `s.Reports(ctx, path, refresh)`, so
  `/api/groups` warms `/api/reports`.
- **Return copies** of cached slices (a shallow `append([]T{}, v...)` is enough) so callers cannot mutate
  the remembered answer (`TestReports_CallersCannotCorruptCache`).
- **Errors are never wrapped** anywhere between the GraphQL response and `{"error": ...}`.
- HTTP status codes: 400 for missing/empty `group`, 502 for any Service error, 200 otherwise.
- Empty successful results must encode as `[]`, never `null` (`children` too).
- `cmd/heimdall/main.go`: `config.Load()`; client = `mock.Fixture(time.Now().UTC())` when `cfg.Mock`, else
  `gitlab.NewHTTPClient(cfg.GitLabURL, cfg.GitLabToken, &http.Client{Timeout: 30 * time.Second})`;
  `service.New(client, service.Options{RootGroup: cfg.RootGroup})`;
  `api.NewRouter(api.AppConfig{GroupTerm: cfg.GroupTerm, RootGroup: cfg.RootGroup}, svc)`; optionally serve
  `cfg.StaticDir` via `NoRoute`; listen on `:cfg.Port`.
- Dependencies: Gin v1.10.0 is in go.mod. If you want `golang.org/x/sync` (errgroup/semaphore/singleflight)
  use **`golang.org/x/sync@v0.8.0`** — newer versions require Go ≥ 1.26 and break the 1.22 toolchain.
  `golang.org/x/text` (for `collate`) is already in the module graph at v0.15.0; `go mod tidy` will promote it.
- The mock package tests already pass; all other packages currently panic with `not implemented`.
  Every test was validated against a throwaway reference implementation (incl. `-race`), so a failing test
  means the implementation, not the test, is wrong.

### Fixture estate (`mock.Fixture(today)`, ROOT_GROUP `org/delivery`)

Descendants (unsorted, include the root, a depth-3 group, `org/other/zeta`, and a duplicate of team-1 with
the same ID listed last). Data-bearing groups have 9 iterations stored oldest-first: iid 1–6 closed (alpha
iid 1 `report: null`; iid 3/6 series end before due; iid 5 over-delivered), iid 9 closed with the **same
start date as iid 4**, iid 7 current (series ends yesterday), iid 8 upcoming (empty series). Expected
newest-first iid order: `8 7 6 5 9 4 3 2 1`. team-2 and beta: all series empty; gamma: no iterations;
delta: every read fails with `mock.DeltaError`.

---

## Checklist

| # | Requirement | § | Pinned by |
|---|---|---|---|
| **Configuration & contract** | | | |
| 1 | `ROOT_GROUP` is required | A.2 | manual (existing `config.Load`) |
| 2 | `GROUP_TERM` defaults to `ART` | A.2 | manual (existing `config.Load`); value served by `api.TestConfig` |
| 3 | `GET /api/config` → exactly `{ groupTerm, rootGroup }` (token never exposed) | Impl. notes, §1.4 | `api.TestConfig` |
| 4 | `GET /api/health` → 200 `{"status":"ok"}` | brief | `api.TestHealth` |
| 5 | GroupCard = `{fullPath,name,segment,children}`, GroupTile = `{fullPath,name,segment}` | Impl. notes | `api.TestGroups_ContractAndA5` |
| 6 | Iteration = `{id,iid,title,startDate,dueDate,state}` | Impl. notes | `api.TestIterations_ContractAndOrder` |
| 7 | IterationReport = Iteration + `report: Report \| null`; Report = `{series,totals}`; Totals = `{committed,delivered,inProgress}`; Total = `{weight,count}`; SeriesPoint = `{date,committed,delivered,remaining}` | Impl. notes | `api.TestReports_Contract` |
| 8 | Errors: non-2xx with body exactly `{"error":"<verbatim message>"}` | Impl. notes, §13, §14.3 | `api.TestErrorBodyVerbatim`, `api.TestGroups_ErrorBodyVerbatim` |
| 9 | Missing/empty `group` param → 400 `{error}` | brief | `api.TestMissingGroupParam_400` |
| 10 | Empty results encode as `[]` (never `null`), incl. `children` and `series` | contract types | `api.TestGroups_EmptyIsArray`, `api.TestIterations_MissingGroupIsEmptyArray`, `api.TestReports_MissingGroupIsEmptyArray`, `groups.TestBuildCards_JSONArraysNeverNull`, `reports.TestNormalizeOne_NullAndEmpty`, `api.TestReports_Contract` |
| **GitLab access (GraphQL only)** | | | |
| 11 | `POST {GITLAB_URL}/api/graphql`, JSON body, `Authorization: Bearer <token>` | Impl. notes | `gitlab.TestHTTPClient_RequestShape`, `gitlab.TestHTTPClient_TrailingSlashBaseURL` |
| 12 | GraphQL `errors` in a 200 response → error, message verbatim (several joined `"; "`), even with partial `data` | §14.1, §14.3 | `gitlab.TestHTTPClient_GraphQLErrorsSurfaceVerbatim` |
| 13 | Non-2xx / unreachable GitLab → error (carrying GitLab's message when present) | §14.1 "failed request" | `gitlab.TestHTTPClient_HTTPFailureIsError`, `gitlab.TestHTTPClient_ConnectionFailureIsError` |
| 14 | `group: null` → empty list, nil error (all three reads) | §5.1, §15.2 | `gitlab.TestHTTPClient_NullGroupIsEmptyNotError` |
| 15 | Read-only: queries only, never mutations | §1.4 | manual |
| **A.3 group selection** | | | |
| 16 | Read ALL descendants, paginate until `hasNextPage=false`, no cap (ledger #1 removed) | A.3 #1, A.1, §6 | `gitlab.TestHTTPClient_DescendantGroups_PaginatesUntilExhausted` |
| 17 | Depth relative to ROOT_GROUP; root (depth 0) never offered | A.3 #2, A.5 | `groups.TestDepth`, `groups.TestCandidates_A5`, `service.TestGroups_A5Table`, `api.TestGroups_FailOpenOverHTTP` |
| 18 | Depth ≥ 3 never offered (`alpha/team-1/sub`) | A.3 #2, A.5 | same as 17 + `service.TestGroups_DataCheckReadsEachCandidateOnce` (no read for sub) |
| 19 | Groups outside ROOT_GROUP never offered (`org/other/zeta`, prefix trap `org/delivery-x`) | A.5 | `groups.TestDepth`, `groups.TestCandidates_A5`, `api.TestGroups_FailOpenOverHTTP` |
| 20 | Duplicates removed by group identity (ID), keeping the FIRST | A.3 #3 | `groups.TestCandidates_DedupeByIDKeepsFirst`, `groups.TestCandidates_A5`, `service.TestGroups_A5Table` ("Team One") |
| 21 | §4.4 data check applied to every candidate, once | A.3 #4, §4.4 | `service.TestGroups_DataCheckReadsEachCandidateOnce` |
| 22 | At most **8** data-check reads in flight | A.3 #4, §4.4 | `groups.TestMaxInFlight`, `groups.TestCheckData_NeverMoreThan8InFlight`, `service.TestGroups_DataCheckAtMost8InFlight` |
| 23 | Data-check results kept in INPUT order | A.3 #4, §4.4 | `groups.TestCheckData_OutcomesInInputOrder` |
| 24 | Keep iff ANY iteration has a non-empty series | §4.4 | `groups.TestHasCurve` |
| 25 | Every series empty → hidden (team-2) | §4.4, A.5 | `groups.TestHasCurve`, `groups.TestBuildCards_A5`, `service.TestGroups_A5Table` |
| 26 | Read fails → **offered** (fail open) | §4.4, A.5 (delta) | `groups.TestCheckData_OutcomesInInputOrder`, `service.TestGroups_A5Table`, `api.TestGroups_FailOpenOverHTTP` |
| 27 | Data check uses the very same report read as the chart; no separate catalogue/health signal | §4.4 | `service.TestGroups_WarmsReportsCache`, `api.TestGroupsThenReports_SharedRead`, `service.TestGroups_DataCheckReadsEachCandidateOnce` (0 Iterations reads) |
| 28 | One card per depth-1 group; tiles = its depth-2 children that passed | A.3 #5 | `groups.TestBuildCards_A5` |
| 29 | Depth-1 passed → card with whatever tiles passed (delta: no tiles) | A.3 #5 | `groups.TestBuildCards_A5` |
| 30 | Depth-1 not passed but ≥1 passing child → card still shown (beta) | A.3 #5, A.5 | `groups.TestBuildCards_A5`, `service.TestGroups_A5Table` |
| 31 | Depth-1 not passed, no passing child → hidden (gamma) | A.3 #5, A.5 | `groups.TestBuildCards_Rules`, `groups.TestBuildCards_A5` |
| 32 | Cards ordered by full path ascending, locale-aware | A.3 #6 | `groups.TestComparePaths`, `groups.TestBuildCards_Rules` ("tiles sorted…"), `service.TestGroups_DataCheckAtMost8InFlight` |
| 33 | Tiles ordered by full path ascending, locale-aware | A.3 #6 | `groups.TestBuildCards_Rules` |
| 34 | Card label (`segment`) = group's own last path segment; then name; then full path | A.3 #7 | `groups.TestLastSegment`, `groups.TestBuildCards_Rules` ("card label…"), `api.TestGroups_ContractAndA5` |
| 35 | Tile shows name and its own last segment | A.3 #7 | `groups.TestBuildCards_A5`, `api.TestGroups_ContractAndA5` |
| 36 | Heading counts cards → A.5 gives 3 (alpha, beta, delta) | A.3 #8, A.5, ledger #3 | `groups.TestBuildCards_A5`, `service.TestGroups_A5Table`, `api.TestGroups_ContractAndA5` (rendering: frontend) |
| 37 | No eligible group → empty list (frontend shows "nothing eligible") | §4.4 table, A.4 | `service.TestGroups_NothingEligibleIsEmptyNotNil`, `api.TestGroups_EmptyIsArray` |
| 38 | *Proposed:* passing depth-2 group whose depth-1 parent is absent → synthetic parent card from the path | A.3 #5 spirit / old §4.3 #2 | `groups.TestBuildCards_Rules` ("proposed…") |
| 39 | Descendants read failure → `/api/groups` error, verbatim | §3.1 failure, §14.3 | `service.TestGroups_DescendantsErrorVerbatim`, `api.TestGroups_ErrorBodyVerbatim` |
| **§5 iterations** | | | |
| 40 | Order: startDate DESC | §5.1, §15.2 `(…,1)(…,3)(…,2)` → 3,2,1 | `iterations.TestSort` |
| 41 | Tie-break: iid numeric DESC | §5.1, §15.2 `7,9,8` → 9,8,7 | `iterations.TestSort`, `iterations.TestLess`, `service.TestIterations_OrderedNewestFirstUnfiltered` (iid 9 before 4) |
| 42 | Non-numeric iid orders as 0 | §5.1 | `iterations.TestIIDNumber`, `iterations.TestSort` |
| 43 | Missing group / no iterations → empty list, never an error | §5.1, §15.2 | `service.TestIterationsAndReports_MissingGroupEmpty`, `api.TestIterations_MissingGroupIsEmptyArray`, `gitlab.TestHTTPClient_NullGroupIsEmptyNotError` |
| 44 | Iteration read is unpaginated (one request) | §5.1 known limit, ledger #2 | `gitlab.TestHTTPClient_Iterations_DecodesNodesInOneRequest` |
| 45 | `/api/iterations` is UNFILTERED (upcoming included), newest first | Impl. notes, §5.3 | `service.TestIterations_OrderedNewestFirstUnfiltered`, `api.TestIterations_ContractAndOrder` |
| 46 | *Proposed:* nil startDate orders last; full ties keep input order | — | `iterations.TestSort`, `iterations.TestSort_StableForFullTies` |
| 47 | Single report read per group returns all iterations, up to **50** | §5.2, §6 | `gitlab.TestHTTPClient_Reports_OneRequestFirst50`, `mock.TestFake_CountersCapAndHold` |
| 48 | One read per group per freshness window; opening a 2nd iteration does not re-read | §5.2 | `service.TestReports_FreshnessRules`, `api.TestReports_OneReadPerGroupAndRefresh` |
| 49 | All slices (chart, history, score) served from that one response (backend serves every iteration's series+totals) | §5.2 | `api.TestReports_Contract` |
| 50 | `/api/reports` ordered newest-first | Impl. notes | `service.TestReports_NormalisedAndOrdered`, `api.TestReports_Contract` |
| **§7.1 series mapping** | | | |
| 51 | committed = `scopeWeight` | §7.1, Impl. notes | `reports.TestNormalizeOne_SeriesMapping` |
| 52 | delivered = `completedWeight` | §7.1 | `reports.TestNormalizeOne_SeriesMapping` |
| 53 | remaining = committed − delivered | §7.1 | `reports.TestNormalizeOne_SeriesMapping`, `service.TestReports_NormalisedAndOrdered` |
| 54 | remaining NOT clamped (negative when over-delivered) | §7.1, ledger #7 | `reports.TestNormalizeOne_SeriesMapping` ("over-delivered"), `service.TestReports_NormalisedAndOrdered` |
| 55 | Totals: committed=`stats.total`, delivered=`stats.complete`, inProgress=`stats.incomplete`, each `{weight,count}` | §7.1, Impl. notes | `reports.TestNormalizeOne_Totals` |
| 56 | Missing weights/counts/objects → 0 | brief | `reports.TestNormalizeOne_SeriesMapping`, `reports.TestNormalizeOne_Totals` |
| 57 | `report: null` tolerated and served as `null` | §5.2, Impl. notes | `reports.TestNormalizeOne_NullAndEmpty`, `service.TestReports_NormalisedAndOrdered`, `api.TestReports_Contract` |
| 58 | Server does not repair/sort series (§7.2 is frontend); iteration fields verbatim | §7.2 scope | `reports.TestNormalizeOne_SeriesOrderPreserved`, `reports.TestNormalizeOne_IterationFieldsVerbatim` |
| **§14.1 freshness** | | | |
| 59 | Freshness = **5 minutes**; stale at age ≥ 5 min | §2.3, §14.1 | `cache.TestDefaults`, `cache.TestGet_TTLExpiry`, `service.TestGroups_TTLExpiry`, `service.TestIterations_Cached`, `service.TestReports_FreshnessRules` |
| 60 | Same data twice within 5 min → GitLab consulted once | §14.1, §15.9 | `cache.TestGet_SameKeyTwice_OneFetch`, `service.TestReports_FreshnessRules`, `api.TestReports_OneReadPerGroupAndRefresh` |
| 61 | Simultaneous identical reads → one fetch, all get the same answer | §14.1, §15.9 | `cache.TestGet_Concurrent_SingleFlight`, `service.TestReports_ConcurrentSingleFlight`, `api.TestReports_ConcurrentRequestsOneRead` |
| 62 | A response that reported an error is never remembered (asked again immediately) | §14.1, §15.9 | `cache.TestGet_ErrorNeverRemembered`, `gitlab.TestHTTPClient_GraphQLErrorsSurfaceVerbatim`, `service.TestReports_ErrorVerbatimNotCached`, `api.TestErrorBodyVerbatim` |
| 63 | A failed request is never remembered | §14.1 | `cache.TestGet_Concurrent_SharedErrorNotRemembered`, `service.TestGroups_DescendantsErrorVerbatim`, `service.TestIterations_ErrorVerbatimNotCached`, `service.TestGroups_FreshnessAndRefresh` (delta) |
| 64 | Forced refresh discards the remembered answer and consults GitLab again | §14.1, §15.9 | `cache.TestGet_Refresh_Refetches`, `cache.TestGet_RefreshOnEmpty`, `cache.TestGet_FailedRefreshDiscardsOldAnswer` |
| 65 | Memory bounded to a fixed number of recent distinct answers; oldest dropped first (LRU) | §14.1 | `cache.TestGet_LRUBoundEvictsOldest`, `cache.TestGet_LRUHitRefreshesRecency`, `cache.TestGet_CapacityBound` |
| 66 | Keyed per question incl. parameters | §14.1 | `cache.TestGet_DifferentKeysAreDifferentQuestions`, `cache.TestKey_Injective`, `service.TestReports_DifferentGroupsDifferentQuestions`, `service.TestIterations_Cached` |
| 67 | *Design:* a hit does not extend TTL; one caller's cancellation does not fail the shared fetch | — | `cache.TestGet_HitDoesNotExtendTTL`, `cache.TestGet_CallerCancellationDoesNotFailOthers` |
| 68 | *Design:* cached answers cannot be mutated through returned slices | — | `service.TestReports_CallersCannotCorruptCache` |
| **§14.2 refresh** | | | |
| 69 | Review `Refresh` (= `/api/reports?refresh=1`) re-reads the curve/history/score data | §14.2 | `api.TestReports_OneReadPerGroupAndRefresh`, `service.TestReports_FreshnessRules` |
| 70 | Review `Refresh` never re-reads the iteration list → `/api/iterations` ignores `refresh` | §14.2, ledger #16 | `api.TestIterations_RefreshIgnored`, `service.TestReports_FreshnessRules` |
| 71 | Review `Refresh` never re-reads the group list | §14.2 | `service.TestReports_FreshnessRules`, `api.TestReports_OneReadPerGroupAndRefresh` |
| 72 | Group list `Refresh`/`Retry` (= `/api/groups?refresh=1`) re-reads groups AND their data check with freshness forced | §14.2, §3.1 | `service.TestGroups_FreshnessAndRefresh`, `api.TestGroups_RefreshHonoured` |
| 73 | `refresh` is on only for the value `1` | Impl. notes | `api.TestGroups_RefreshHonoured` (`refresh=0`) |
| **A.5 acceptance** | | | |
| 74 | Full A.5 table → cards alpha[team-1], beta[x], delta[]; heading 3 | A.5 | `service.TestGroups_A5Table`, `groups.TestBuildCards_A5`, `groups.TestCandidates_A5`, `api.TestGroups_ContractAndA5`, `api.TestGroups_FailOpenOverHTTP` |
| **Out of backend scope** | | | |
| 75 | A.4 wording, §3 states, §6 history windows (4 closed, 5 points, 21-point grid), §7.2–§12 | — | frontend |
| 76 | `GITLAB_MOCK=1` serves `mock.Fixture(time.Now().UTC())` | config | manual |

---

## Spec ambiguities and the resolutions pinned here

1. **Locale-aware path order** (A.3 #6): Go has no `localeCompare`. Pinned: case-insensitive primary order
   (`org/delivery/alpha` < `org/delivery/Beta`); recommended `x/text/collate` with `language.Und` plus a
   bytewise tiebreak. Non-letter punctuation edge cases are not pinned.
2. **Depth-2 group whose depth-1 parent is not in the descendants list** (e.g. no access to the parent):
   A.3 says nothing. Pinned: synthesise a parent card from the path (name = segment = parent's last
   segment), mirroring the "keep the child reachable" rule and old §4.3 #2.
3. **Null startDate in ordering** (§5.1 silent): treated as `""`, so it orders after all dated iterations;
   full ties keep input order (stable sort).
4. **"Non-numeric iid"**: pinned as "anything `strconv.Atoi` rejects" (so `"7a"` → 0, unlike JS `parseInt`).
5. **Several GraphQL errors**: messages joined with `"; "`. A single error is the message verbatim.
6. **Refresh while a fetch is in flight**: the refresh joins the in-flight fetch (it is not a remembered
   answer). A refresh that fails leaves nothing remembered (discard happens first).
7. **LRU vs FIFO**: §14.1 says "oldest dropped first"; the orchestrator asked for LRU. Pinned LRU (a hit
   counts as use); TTL is NOT extended by hits. Capacity 256 per cache instance.
8. **Which 50 iterations** the report read returns when a group has > 50: the spec is silent; GitLab's
   default order is ascending by due date, so `first: 50` would return the OLDEST 50. Not pinned. Builder
   MAY add `sort: CADENCE_AND_DUE_DATE_DESC` to the reports query (recommended); the tests accept either.
9. **HTTP status for upstream failures**: spec says only "non-2xx"; pinned 502 in the router doc comment,
   tests accept any 4xx/5xx except the 400 for a missing `group` param, which is pinned.
10. **Upstream iteration titles can be null** (automatic cadences): served as `""`; the frontend decides how
    to display it.

---

## Conformance check (round 1)

Checker: independent spec-vs-code read (2026-10-01). Code not modified. Paths are relative to `backend/`.
Commands run: `GOFLAGS=-buildvcs=false go vet ./...` (clean), `go test -race -count=1 ./...` (138 passed,
10 packages), `gofmt -l .` (clean). Smoke test: `GITLAB_MOCK=1 ROOT_GROUP=org/delivery PORT=18081 go run
./cmd/heimdall` → `/api/groups` = 3 cards `alpha[team-1]`, `beta[x]`, `delta[]` (also 3 with `?refresh=1`);
same binary with `ROOT_GROUP=org/delivery/` (trailing slash) → identical 3 cards; `/api/config` =
`{"groupTerm":"ART","rootGroup":"org/delivery"}`; delta `/api/reports` → 502 with the verbatim message; the
`GITLAB_TOKEN` value never appeared in the server log. Extra probes ran through a `go test -overlay`
scratch file outside the repo: 3-segment root, a panicking fetch, a request-context timeout, and a
mismatched-case root.

### A. Spec rules

| # | Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| 1 | Marker word, substring search, 100 cap removed | A.1 | MATCH | `internal/groups/groups.go:78-90`, `internal/gitlab/http.go:53-60` | Only depth/ID filtering; no `search:` argument |
| 2 | `ROOT_GROUP` required | A.2 | MATCH | `internal/config/config.go:30-32` | |
| 3 | `GROUP_TERM` default `ART` | A.2 | MATCH | `internal/config/config.go:25` | |
| 4 | Read ALL descendants, paginate until exhausted | A.3 #1, §6 | MATCH | `internal/gitlab/http.go:115-136` | `first: 100`, `after` cursor; also stops on an empty `endCursor` to avoid an infinite loop |
| 5 | Depth relative to ROOT_GROUP, incl. 2+ segment roots | A.3 #2 | MATCH | `internal/groups/groups.go:34-43` | Probe with root `a/b/c`: `a/b/c/x` depth 1, `a/b/c/x/y` depth 2, `a/b/c/x/y/z` excluded |
| 6 | ROOT_GROUP with trailing (or leading) slash | A.3 #2 | MATCH | `internal/config/config.go:24` (`strings.Trim(…, "/")`) | Smoke test with `org/delivery/` → 3 cards. `service.New` does not normalise by itself (probe: `a/b/c/` passed directly → 0 cards), but the only production path goes through `config.Load`. |
| 7 | ROOT_GROUP case vs GitLab's canonical path | A.3 #2 | AMBIGUOUS | `internal/groups/groups.go:35-38` (case-sensitive `==` / `CutPrefix`) | GitLab resolves `group(fullPath:)` case-insensitively but returns canonical-case `fullPath`s. So `ROOT_GROUP=Org/Delivery` silently gives 0 cards ("No ART found"); confirmed by probe. Fix: prefix-compare with `strings.EqualFold`, or select the root's own `fullPath` in the descendants query and use that as the root. |
| 8 | Root (depth 0), depth ≥ 3, and groups outside root never offered | A.3 #2, A.5 | MATCH | `internal/groups/groups.go:82-84`, `:38` (`root+"/"` prefix) | `org/delivery-x/…` correctly excluded |
| 9 | Dedupe by group identity, keep first | A.3 #3 | MATCH | `internal/groups/groups.go:80-87` | |
| 10 | Data check applied to every candidate, once | A.3 #4, §4.4 | MATCH | `internal/service/service.go:81-89` | |
| 11 | ≤ 8 reads in flight | §4.4, A.3 #4 | MATCH | `internal/groups/groups.go:118` (semaphore capacity `min(max(n,1),8)`), `internal/service/service.go:86` | Per data-check run; concurrent runs share flights through the cache |
| 12 | Results kept in input order | §4.4 | MATCH | `internal/groups/groups.go:117,126` (indexed write) | |
| 13 | Keep iff ANY iteration has a non-empty series | §4.4 | MATCH | `internal/groups/groups.go:94-101` | |
| 14 | Fail open: read error → keep | §4.4 | MATCH | `internal/groups/groups.go:126` (`err != nil \|\| HasCurve`) | |
| 15 | Fail open: panic → keep | §4.4 | MATCH | `internal/cache/cache.go:121-128` turns a fetch panic into an error that is not cached | Probe: a client panicking for one group → that group's card is still offered. Note: the `CheckData` worker goroutines (`groups.go:123-127`) have no `recover`, so a `ReadFunc` that panics outside the cache would crash the process. This cannot happen with the production wiring. |
| 16 | Fail open: timeout / cancellation → keep | §4.4 | MATCH | `cmd/heimdall/main.go:27,54` (25 s client timeout → error); `internal/cache/cache.go:111-113` (caller ctx → error) | Probe with a 50 ms request deadline: no error, group kept |
| 17 | Data check uses the SAME read as the chart; no separate health check | §4.4 | MATCH | `internal/service/service.go:86-89` → `cachedReports` (`:129-140`), the same key that `/api/reports` uses | No Iterations read and no extra query |
| 18 | GitLab report-level failure (`TimeboxReport.error`) counts as a failed read | §4.4 "fails for any reason", §14.3 | MISSING | `internal/gitlab/http.go:79-86` does not select `report.error`; `internal/reports/normalize.go:61` maps a null series to `[]` | On real GitLab, a report it refuses to build (e.g. too many events, missing dates) comes back as `report { error {code message} }` with a null series, not as a GraphQL error. The backend serves that as an empty curve. If every iteration errors, the group is HIDDEN instead of kept, and GitLab's reason is dropped (§14.3). See G9. |
| 19 | One card per depth-1 group; tiles = its passing depth-2 children | A.3 #5 | MATCH | `internal/groups/groups.go:157-172` | Order-independent: a child seen before its parent gets a draft card, which is replaced with the GitLab data when the parent arrives (`:162-164`) |
| 20 | Depth-1 group not passed, ≥ 1 passing child → card kept (beta) | A.3 #5, A.5 | MATCH | `internal/groups/groups.go:176` | Card carries the real group's `fullPath`/`name` |
| 21 | Depth-1 group not passed, no passing child → hidden (gamma) | A.3 #5 | MATCH | `internal/groups/groups.go:176` | |
| 22 | Passing depth-2 group whose parent is not among the descendants | A.3 #5 (silent) | AMBIGUOUS | `internal/groups/groups.go:149-156,167-170,195-198` | Builds a synthetic card from the path (analyst decision #2). Consistent with "keeps the child reachable". |
| 23 | Cards ordered by full path, ascending, locale-aware | A.3 #6 | MATCH | `internal/groups/groups.go:181`, `:59-66` (`collate` `language.Und` + bytewise tiebreak) | |
| 24 | Tiles ordered by full path, ascending | A.3 #6 | MATCH | `internal/groups/groups.go:177,204-206` | |
| 25 | Card: label = own last segment, then name, then full path | A.3 #7 | MATCH | `internal/groups/groups.go:191-193` | `name` comes from GitLab, `segment` = `LastSegment(fullPath)` |
| 26 | Tile: name + own last segment | A.3 #7 | MATCH | `internal/groups/groups.go:191-193` | |
| 27 | Heading counts cards (ledger #3) | A.3 #8 | MATCH | One array element per card (`groups.go:174-182`) | Smoke test: 3 elements. The heading itself is rendered by the frontend. |
| 28 | A.5 acceptance end to end | A.5 | MATCH | Smoke test (`go run`, mock): `alpha[team-1]`, `beta[x]`, `delta[]` → 3 | team-2, gamma, `alpha/team-1/sub`, root, and `org/other/zeta` all absent |
| 29 | No eligible group → `[]` | §4.4 table | MATCH | `internal/groups/groups.go:174`, `internal/api/router.go:86-88` | |
| 30 | Iterations ordered by start date, descending | §5.1 | MATCH | `internal/iterations/order.go:29-33` | ISO dates compared as text |
| 31 | Tie-break: iid numeric, descending; non-numeric → 0 | §5.1 | MATCH | `internal/iterations/order.go:20-26,34` | |
| 32 | Missing group → empty list, never an error | §5.1, §15.2 | MATCH | `internal/gitlab/http.go:124-126,142-145,152-154`; `internal/api/router.go:86-88` | Smoke test: `group=nope` → `[]` |
| 33 | Iteration read unpaginated (ledger #2) | §5.1, §16 #2 | MATCH | `internal/gitlab/http.go:62-68,139-146` | One request, GitLab's default page (100) |
| 34 | Null `startDate` ordering | §5.1 (silent) | AMBIGUOUS | `internal/iterations/order.go:47-52` | Sorted last (analyst decision #3) |
| 35 | §15.2 vectors (3,2,1 / 9,8,7 / missing → []) | §15.2 | MATCH | `order.go`; `iterations.TestSort` | |
| 36 | One read per group returns all of its iterations | §5.2 | MATCH | `internal/gitlab/http.go:74-90,149-156`; cache key `reports/<group>` (`service.go:130`) | |
| 37 | ≤ 50 iterations, newest | §5.2, §6 | MATCH | `internal/gitlab/http.go:76` (`first: 50, sort: CADENCE_AND_DUE_DATE_DESC`), re-sorted locally (`service.go:137`) | "Newest" is only approximate when there are several cadences; see G3 |
| 38 | Opening a 2nd iteration does not re-read | §5.2 | MATCH | Cache hit on the same key (`cache.go:96-98`) | |
| 39 | Descendants uncapped | §6, A.1 | MATCH | `internal/gitlab/http.go:115-136` | |
| 40 | committed = `scopeWeight`, delivered = `completedWeight` (null → 0) | §7.1, Impl. notes | MATCH | `internal/reports/normalize.go:63` | |
| 41 | remaining = committed − delivered, NOT clamped | §7.1, §16 #7 | MATCH | `internal/reports/normalize.go:68` | |
| 42 | Totals from `stats.total/complete/incomplete` `{weight,count}` | §7.1, Impl. notes | MATCH | `internal/reports/normalize.go:74-90` | |
| 43 | Freshness 5 min (stale at ≥ 5 min) | §2.3, §14.1 | MATCH | `internal/cache/cache.go:31,156`; `cmd/heimdall/main.go:35` (zero Options → default) | |
| 44 | Same data twice → GitLab consulted once | §14.1, §15.9 | MATCH | `internal/cache/cache.go:96-98` | |
| 45 | Simultaneous identical requests → one fetch, same answer | §14.1, §15.9 | MATCH | `internal/cache/cache.go:100-114` | Fetch runs under `context.WithoutCancel`, so one cancelled caller does not fail the others |
| 46 | Response reporting an error (GraphQL `errors` in a 200, incl. partial `data`) never remembered | §14.1 | MATCH | `internal/gitlab/http.go:222-225` → error; `internal/cache/cache.go:134-136` stores only when `err == nil` | |
| 47 | Failed request never remembered | §14.1 | MATCH | `internal/cache/cache.go:134-136`, panic path `:121-128` | |
| 48 | Refresh discards and refetches | §14.1, §15.9 | MATCH | `internal/cache/cache.go:94-95` (discard first), `:100-105` | A refresh that arrives during an in-flight fetch joins it (analyst decision #6) |
| 49 | Bounded memory, oldest dropped first | §14.1 | MATCH | `internal/cache/cache.go:35,165-177` | LRU, 256 entries × 3 caches (analyst decision #7); in-flight map bounded by live requests; response read capped at 64 MiB (`http.go:94,206`) |
| 50 | Key includes every parameter | §14.1 | MATCH | `internal/cache/cache.go:190-200` (length-prefixed, injective); `service.go:73,97,130` | The only variable input of each query is the path; `first`/`sort` are constants |
| 51 | Review `Refresh` re-reads the curve/history/score data | §14.2 | MATCH | `internal/api/router.go:55-62` → `service.go:119-125` | |
| 52 | Review `Refresh` never re-reads the iteration list | §14.2, §16 #16 | MATCH | `internal/api/router.go:47-54` ignores `refresh`; `service.go:97` hard-codes `false` | |
| 53 | Review `Refresh` never re-reads the group list | §14.2 | MATCH | `Reports` touches only `reports/<group>` | |
| 54 | Group-list `Refresh`/`Retry` forces descendants AND the data check | §14.2 | MATCH | `internal/service/service.go:73` (descendants), `:88` (data-check reads with `refresh`) | |
| 55 | Error bodies = GitLab message verbatim | §14.3, Impl. notes | MATCH | `internal/api/router.go:81-84`; `internal/gitlab/http.go:211-225,235-247` | Several messages joined with `"; "`. A non-2xx response with no GitLab message → `GitLab responded <status>`. |
| 56 | Read-only: GraphQL queries only, never mutations | §1.4 | MATCH | `internal/gitlab/http.go:53-90` (three `query(…)` documents); no "mutation" in any non-test file | |
| 57 | Token never logged or sent to the browser | Impl. notes | MATCH | `cmd/heimdall/main.go:57-64` (log omits it); `internal/api/types.go:4-7` (`AppConfig` = groupTerm, rootGroup); no request logger | Smoke log: 0 occurrences. `net/http` error strings carry the URL, never headers. |
| 58 | Contract: empty → `[]`, missing `group` → 400, refresh only on `"1"` | Impl. notes | MATCH | `internal/api/router.go:66-89` | |
| 59 | Ledger #2, #3, #4, #6, #16, #18 (#5 not applicable under A) | §16 | MATCH | rows 33, 27, 20/22, `router.go:47-54` (unfiltered), 52, 43 | |

### B. GitLab GraphQL schema check (based on known GitLab schema; NOT verified against a live instance)

| # | Item | Verdict | Evidence | Note / fix |
|---|---|---|---|---|
| G1 | `group(fullPath: ID!)` | OK | `http.go:53,62,74` | |
| G2 | `descendantGroups(first: 100, after: String)` + `nodes{id fullPath name}` + `pageInfo{hasNextPage endCursor}` | OK | `http.go:55-57` | `includeParentDescendants` defaults to true, so all levels are returned (visibility = token) |
| G3 | `iterations(includeAncestors: true, sort: CADENCE_AND_DUE_DATE_DESC)` | RISK (low/medium) | `http.go:64,76` | Arguments and enum value exist (GitLab ≥ 14.x). The enum sorts by **cadence id ASC**, then due date DESC. When a group sees several cadences (e.g. through `includeAncestors`), `first: 50` keeps cadence 1's iterations first, not the 50 newest overall. Fix: page the lightweight list, choose the newest 50 locally, and fetch reports for those. |
| G4 | `report(fullPath: String)` via a separate `$fullPath: String` | OK | `http.go:74,79,150` | Types are correct (`ID!` for group, `String` for report) |
| G5 | Iteration fields `id iid title startDate dueDate state` | OK | `types.go:31-38` | `iid` is `ID!` (string); `title` nullable → `""`; `startDate`/`dueDate` nullable → pointers; `state` lowercase `upcoming/current/closed` |
| G6 | `burnupTimeSeries{date scopeCount scopeWeight completedCount completedWeight}` | OK | `http.go:80`, `normalize.go:63,92-97` | Fields are non-null `Int!` in GitLab (an issue without weight contributes 0); null is still tolerated → 0 |
| G7 | `stats{total complete incomplete {count weight}}` | OK | `http.go:81-85`, `normalize.go:74-90` | Null objects/fields → 0 |
| G8 | `report: null` | OK | `normalize.go:58-60` | Served as JSON `null` |
| G9 | `TimeboxReport.error {code message}` not selected | RISK (medium) | `http.go:79-86` | See row 18. Fix: select `error { code message }`. If any (or every) iteration carries a report error, treat it as a failed read for §4.4 (keep the group) and surface the message, e.g. fail `/api/reports` with that message or add it to the contract. |
| G10 | Query complexity: 50 iterations × `report` in one query | RISK (high, verify) | `http.go:74-90` | GitLab declares `report` (TimeboxReportInterface) with complexity ≈175, and the iterations connection adds about +1 % per requested item (×1.5 for `first: 50`). The estimate is ≈300, above the 250 authenticated max, so GitLab would answer "Query has complexity of …, which exceeds max complexity of 250". **There is no fallback.** Every `/api/reports` would return 502 and every candidate would be kept by fail-open, so all groups are offered and every chart shows an error. Fix: read the ≤ 50 iteration list first, then fetch reports per iteration (or in small aliased batches that stay under the limit) with bounded concurrency. Assemble them into ONE cached answer, so it is still "one read per group" at the app level. Fall back to this path whenever GitLab returns a complexity error. Add a test with a recorded complexity-error response. |
| G11 | Query depth (7) < GitLab max depth (15) | OK | `http.go:74-90` | |
| G12 | Server-side cost: 50 burnup computations in one request | RISK (medium) | `http.go:74-90`, `main.go:27` (25 s client timeout) | On large groups this can hit GitLab's request timeout or the client's 25 s timeout, and the chart then errors every time. The G10 fix (smaller requests) also addresses this. |
| G13 | Root path casing | RISK (low/medium) | row 7 | See row 7 |
| G14 | HTTP redirect on `GITLAB_URL` (e.g. http→https) | RISK (low) | `http.go:201` (default redirect policy) | Go turns a 301/302 POST into a GET without a body, which GitLab rejects with a confusing message. Fix: document that `GITLAB_URL` must be the canonical https URL, or refuse redirects. |

### C. Test vacuity audit (key rules)

| Rule | Tests | Verdict | Note |
|---|---|---|---|
| Cache single-flight | `cache.TestGet_Concurrent_SingleFlight`, `service.TestReports_ConcurrentSingleFlight`, `api.TestReports_ConcurrentRequestsOneRead` | Non-vacuous | The fetch blocks until released, so a non-single-flight implementation would count more than 1 |
| Error not cached | `cache.TestGet_ErrorNeverRemembered`, `…SharedErrorNotRemembered`, `…FailedRefreshDiscardsOldAnswer`, `gitlab.TestHTTPClient_GraphQLErrorsSurfaceVerbatim` (200 + partial data → error) | Non-vacuous | Composition (HTTP 200 + `errors` → not cached) is only implied, never exercised end to end |
| Fail-open | `groups.TestCheckData_OutcomesInInputOrder`, `service.TestGroups_A5Table` (delta), `api.TestGroups_FailOpenOverHTTP` | Partial | Errors are covered. **Panics and timeouts are untested:** deleting the `recover` at `cache.go:121-128` keeps the suite green, but a panicking fetch would then crash the whole process instead of failing open. |
| Concurrency cap | `groups.TestCheckData_NeverMoreThan8InFlight` (40 instrumented reads), `service.TestGroups_DataCheckAtMost8InFlight`, `groups.TestCheckData_IsConcurrent` | Non-vacuous | An unbounded implementation would show 30–40 in flight. A serial implementation is caught by `IsConcurrent`. |
| Refresh scope | `service.TestGroups_FreshnessAndRefresh`, `api.TestGroups_RefreshHonoured`, `api.TestIterations_RefreshIgnored` | Non-vacuous | |
| Refresh scope (reports refresh leaves the iteration/group lists alone) | `service.TestReports_FreshnessRules`, `api.TestReports_OneReadPerGroupAndRefresh` | Partly vacuous | They assert 0 Iterations/Descendants calls, but nothing was cached beforehand, so an implementation that *purged* those caches on a reports refresh (without reading) would pass. Fix: warm `Iterations` and `Groups` first, then `Reports(refresh)`, then call both again and assert no new read. |
| Depth vs root | `groups.TestDepth`, `TestCandidates_A5` | Partial | Only a 2-segment root. No 3+-segment root, no trailing-slash or case-mismatched root. |
| GraphQL validity | `gitlab.*` (regex on query text) | Gap | Nothing checks the queries against the GitLab schema or its complexity limits, so G9 and G10 cannot show up in the suite |

### Verdict counts (section A, 59 rows)

MATCH 55 · MISMATCH 0 · MISSING 1 (row 18) · AMBIGUOUS 3 (rows 7, 22, 34; 22 and 34 are covered by analyst
decisions). Section B: 8 OK, 6 RISK (G3, G9, G10, G12, G13, G14).
