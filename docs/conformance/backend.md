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

---

## Round 1 fixes (builder)

Verify: `cd backend && GOFLAGS=-buildvcs=false go vet ./... && go test -race -count=1 ./...` → 161 passed
(115 tests + 46 subtests), 10 packages, 0 failed; `gofmt -l .` clean. Mock smoke test with
`ROOT_GROUP=Org/Delivery/` → `alpha[team-1]`, `beta[x]`, `delta[]`; `/api/reports?group=org/delivery/alpha/team-1`
→ 9 items newest first, iid 1 `reportError` = "Burnup chart could not be generated due to too many events",
the others `null`.

| Finding | Fix | Pinned by (new tests) |
|---|---|---|
| Contract: `reportError` | `api.IterationReport.ReportError *string` `json:"reportError"` (always present, `null` when none). `gitlab.Report.Error {code message}`; `reports.NormalizeOne` copies the message verbatim (the code if the message is empty). A refused report keeps its normalised `report` (empty series). | `reports.TestNormalizeOne_ReportError`, `api.TestReports_ReportErrorOverHTTP`, `service.TestReports_FixtureReportErrorServed`; `api.TestReports_Contract` key list extended |
| Row 18 / G9 | Report requests select `error { code message }`. `groups.HasReportError`; `CheckData` keeps a group when `err ∥ HasCurve ∥ HasReportError` (refused report = failed read ⇒ fail open). | `groups.TestHasReportError`, `groups.TestCheckData_ReportErrorIsAFailedRead`, `service.TestGroups_RefusedReportKeepsGroup`, `gitlab.TestHTTPClient_Reports_DecodesReportError` |
| G10 / G12 / G3 | `HTTPClient.Reports` is still ONE logical read, cached once per group by the service (§5.2), done as: (a) every page of `iterations(first: 100, after:, includeAncestors: true)`; (b) §5.1 order (`iterations.Newer`), newest `MaxReportIterations` = 50; (c) `ReportBatchSize` = **1** aliased `iN: iteration(id: $idN) { id report(fullPath: $fullPath) {…} }` per request, at most `ReportConcurrency` = 4 in flight (`errgroup`, x/sync v0.8.0); (d) assembled newest first. Any failed request cancels the rest and fails the read (never cached). Batch size 1, not 5, because GitLab declares `report` with complexity 175 against an authenticated maximum of 250, so even two reports per query would be rejected. The builder supports any batch size. Each request scopes its own variables, so `$fullPath` is now `ID!` in list queries and `String` in report queries (the `$groupPath` workaround is gone). `/api/iterations` is unchanged: one request, first page only. | `gitlab.TestHTTPClient_Reports_ListThenBatchedReports` (**replaces** `TestHTTPClient_Reports_OneRequestFirst50`, which pinned the old single-query design; all of its decoding assertions are kept), `…_NewestFiftyAcrossPagesAndCadences` (120 iterations, 2 cadences, 3 pages: exact newest 50 incl. a start-date tie, every page read, no request > batch size, each chosen report fetched once, others never, ≤ 4 in flight and > 1), `…_OneFailedBatchFailsTheRead`, `…_ListFailureFailsTheRead`, `…_NoIterationsNoReportRequests`, `TestHTTPClient_Iterations_SinglePageEvenWhenMore` |
| Row 7 / G13 | `groups.Depth` compares the root prefix with `strings.EqualFold` (GitLab paths are ASCII); `service.New` trims `/` from `RootGroup`. | `groups.TestDepth_CaseInsensitiveAndDeepRoot`, `service.TestGroups_RootCaseAndSlashesIgnored` (`Org/Delivery`, `org/delivery/`, `/ORG/DELIVERY/`), `service.TestGroups_ThreeSegmentRoot` |
| G14 | `NewHTTPClient` copies the given `http.Client` and sets `CheckRedirect` → `ErrUseLastResponse`; a 3xx becomes `GitLab redirected the request to "<Location>"; set GITLAB_URL to GitLab's canonical address (redirects are not followed)`. Documented in `backend/README.md`. | `gitlab.TestHTTPClient_RefusesRedirects` (1 hit, message, caller's client untouched) |
| Fail-open: panic/timeout | `CheckData` workers `recover` (panic ⇒ kept), in addition to the cache's recover. | `groups.TestCheckData_PanicAndTimeoutFailOpen`, `service.TestGroups_PanicAndTimeoutFailOpen` (client panics for team-2, blocks for gamma under a 200 ms deadline: both offered, no crash) |
| Refresh scope (vacuity) | Added warm-cache variants; the originals are unchanged. | `service.TestReports_RefreshLeavesWarmListsAlone`, `api.TestReportsRefresh_LeavesWarmListsAlone` |
| Mock | `Fake` matches group paths case-insensitively (data and `SetError`; counters stay per path as called). `Reports` keeps the newest 50 by §5.1, like the client, in stored order. Fixture: alpha/team-1 iid 1 has `report.error` (`TOO_MANY_EVENTS`, `mock.Team1ReportError`) and a null series. A.5 outcomes are unchanged. | `mock.TestFake_ReportsKeepsNewest50`, `mock.TestFake_PathsCaseInsensitive`, `mock.TestFixture_Team1ReportError` |

Notes:
- The ≤ 4 report requests in flight apply per group read. During a §4.4 data check (≤ 8 groups in
  flight) this can reach 32 concurrent GitLab requests.
- With batch size 1, a 50-iteration group costs 1–2 list requests plus 50 report requests (≈ 13 rounds at
  concurrency 4). This cost is paid once per freshness window.
- The complexity figures (175 per `report`, 250 maximum) come from GitLab's source. They were not verified
  against a live instance.


---

## Conformance check (round 2)

Checker: independent spec-vs-code re-read of commit `5edbe7e` (2026-10-02). Code and tests not modified. Paths
are relative to `backend/`. Commands run: `GOFLAGS=-buildvcs=false go vet ./...` (clean); `go test -race
-count=1 ./...` (161 passed, 10 packages, 0 failed); `gofmt -l .` (clean). Mock smoke test (binary built from
`./cmd/heimdall`, `GITLAB_MOCK=1 ROOT_GROUP=org/delivery PORT=18082 GITLAB_TOKEN=<dummy>`, then killed):
`/api/groups` → `alpha[team-1]`, `beta[x]`, `delta[]` (also 3 with `?refresh=1`);
`/api/reports?group=org/delivery/alpha/team-1` → 200, 9 items in the order 8, 7, 6, 5, 9, 4, 3, 2, 1 (the
iid 9/4 start-date tie is broken by iid, descending). iid 1 has `reportError` = "Burnup chart could not be
generated due to too many events" with an empty series; every other item has `reportError: null`.
`/api/iterations?group=ORG/delivery/alpha/team-1` → same order. delta `/api/reports` → 502 with the verbatim
message. Missing `group` → 400. `/api/config` = `{"groupTerm":"ART","rootGroup":"org/delivery"}`. The dummy
token appears 0 times in the server log.

Extra probes ran through a `go test -overlay` scratch file outside the repo. Each one used the real
`HTTPClient` and `Service` against an `httptest` GitLab:
- **P1:** 12 candidate groups × 60 iterations → max **32** concurrent GitLab requests; 613 requests in total
  (12 descendants/list + 600 report requests).
- **P2:** every `iN` comes back `null` for one group → that group's read succeeds with `report: null,
  reportError: null` on all items, and the group is **hidden**.
- **P3:** a complexity error on one report request → `/api/reports` fails with GitLab's message verbatim.
  The group stays offered (fail open). After the error clears, the next read goes back to GitLab (4 requests),
  so the failed read was not cached.

### A. Round-1 findings re-verified

| # | Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| R1 | `reportError` contract field: always present, `null` when none, GitLab's `TimeboxReport.error.message` verbatim | Impl. notes, §14.3 | MATCH | `internal/api/types.go:52-58` (no `omitempty`); `internal/reports/normalize.go:31-37,79-88`; `internal/gitlab/types.go:75-87`; `internal/gitlab/http.go:88` (`error { code message }`) | Falls back to `code` when `message` is empty. That is an extension, and harmless. Smoke test + `api.TestReports_ReportErrorOverHTTP` |
| R2 | Data check: no series anywhere but ≥ 1 `reportError` → failed read → kept | Impl. notes, §4.4 | MATCH | `internal/groups/groups.go:108-117,149-157` (`err ∥ HasCurve ∥ HasReportError`) | Same outcome as the contract sentence: a curve or a refused report both keep the group. `groups.TestCheckData_ReportErrorIsAFailedRead`, `service.TestGroups_RefusedReportKeepsGroup` |
| R3 | Batched read (a): list **all** iteration pages | §5.2, §6 | MATCH | `internal/gitlab/http.go:175-188` (`first: 100`, `after`, stops on `hasNextPage=false` or an empty cursor `:102-108`) | `TestHTTPClient_Reports_NewestFiftyAcrossPagesAndCadences` asserts every page is read |
| R4 | Batched read (b): newest 50 by the §5.1 rule, across cadences | §5.1, §5.2 | MATCH | `internal/gitlab/http.go:190-197` (`iterations.Newer`, stable), `types.go:14` | Fixes round-1 G3. Same test: 120 iterations, 2 cadences, start-date tie |
| R5 | Batched read (c): small batches, bounded concurrency | §5.2 (as amended by the orchestrator) | MATCH | `internal/gitlab/http.go:199-214` (`errgroup.SetLimit(ReportConcurrency=4)`), `:218-249` (aliased `iN: iteration(id: $idN)`), `types.go:20,24` (`ReportBatchSize=1`) | Test asserts ≤ 4 and ≥ 2 in flight, ≤ batch size per request, each chosen report fetched once |
| R6 | Batched read (d): ONE cached answer per group; any failed request fails the whole read; failure never cached | §14.1, §5.2 | MATCH | `internal/service/service.go:130-141` (one key `reports/<group>`); `http.go:210-212` (first error returned, no partial data); `internal/cache/cache.go:129-136` (store only when `err == nil`) | `…_OneFailedBatchFailsTheRead` (verbatim, `got == nil`), `…_ListFailureFailsTheRead`; probe P3 confirms it is not cached end to end |
| R7 | Case-insensitive ROOT_GROUP | A.3 #2 | MATCH | `internal/groups/groups.go:39-48` (`EqualFold` on root prefix and equality) | `TestDepth_CaseInsensitiveAndDeepRoot`, `service.TestGroups_RootCaseAndSlashesIgnored` (`Org/Delivery`, `/ORG/DELIVERY/`). Cards carry GitLab's canonical paths |
| R8 | Trailing/leading slash on ROOT_GROUP | A.3 #2 | MATCH | `internal/config/config.go:24`; `internal/service/service.go:59` | Now normalised in `service.New` as well |
| R9 | 3-segment roots | A.3 #2 | MATCH | `groups.go:39-48` | `service.TestGroups_ThreeSegmentRoot` (depth 3 and the `a/b/cx` prefix trap are not data-checked) |
| R10 | Redirect refused with a clear message | (G14) | MATCH | `internal/gitlab/http.go:51-58` (copies the client, `ErrUseLastResponse`), `:304-307`; `README.md:19-22` | `TestHTTPClient_RefusesRedirects` (1 hit, message names `GITLAB_URL` and the target, caller's client untouched) |
| R11 | `recover` in data-check workers | §4.4 "fails for any reason" | MATCH | `internal/groups/groups.go:149-157` | `groups.TestCheckData_PanicAndTimeoutFailOpen`, `service.TestGroups_PanicAndTimeoutFailOpen` (panic + 200 ms deadline: both kept, no crash) |
| R12 | Refresh-scope tests no longer vacuous | §14.2 | MATCH | `internal/service/round1_test.go:168-205`, `internal/api/round1_test.go:11-27` | Both warm the iteration list and the group list first, then refresh reports, then read both lists again and assert no new read. An implementation that purges those caches would now fail |

### B. Regression sweep

| # | Item | Spec § | Verdict | Evidence | Note |
|---|---|---|---|---|---|
| S1 | Cache: 5 min TTL, single-flight, errors never remembered, refresh discards first, bounded LRU, per-parameter keys | §14.1, §15.9 | MATCH | `internal/cache/cache.go` unchanged since round 1 (`git diff ec7debc 5edbe7e` touches no cache file) | The batched sub-requests all run inside one `fetch`, so single-flight still covers the whole group read |
| S2 | Review Refresh re-reads only that group's reports; group Refresh forces descendants and every data-check read; `/api/iterations` ignores refresh | §14.2, §16 #16 | MATCH | `internal/api/router.go:43-62` (unchanged); `service.go:73-92,97,120-126` | R12 |
| S3 | ≤ 8 groups in flight, input order, fail-open (error / panic / timeout / refused report) | §4.4, A.3 #4 | MATCH | `groups.go:133-157` | Per-group sub-request concurrency is a separate dimension. See S11 |
| S4 | No separate health signal; the data check uses the chart's read | §4.4 | MATCH | `service.go:87-90` → `cachedReports` | |
| S5 | A.3 card rules (depth-1 cards, passing depth-2 tiles, beta kept, gamma hidden, synthetic parent, sort, labels) | A.3 #5–#8, A.5 | MATCH | `groups.go:173-232` (unchanged apart from `Depth`) | Smoke test = A.5 (3 cards) |
| S6 | §5.1 newest-first ordering + tie-break; missing group → `[]` | §5.1, §15.2 | MATCH | `internal/iterations/order.go:29-46` (refactor into `Newer` changes no behaviour); `http.go:169-171` | Smoke test: 9/4 tie handled |
| S7 | Opening a second iteration does not re-read | §5.2 | MATCH | `service.go:130-141` (cache hit on `reports/<group>`) | `api.TestReports_OneReadPerGroupAndRefresh` |
| S8 | "One read per group … not one per iteration" | §5.2 | MATCH (wire-level deviation, by orchestrator decision) | `http.go:155-161` | At the app level there is still one logical, cached read. On the wire it is now 1–2 list requests + up to 50 report requests (one per iteration), which GitLab's complexity limit forces. `SPEC.md` still says "a single read … returns all of its iterations at once"; nothing in the Implementation notes records the batched design. **Recommend** adding one implementation-note line. |
| S9 | Read-only (no mutations) | §1.4 | MATCH | Only `query(…)` documents (`http.go:63-90,237-249`); no "mutation" in any non-test file | |
| S10 | Token never logged or exposed | Impl. notes | MATCH | `http.go:292` (header only); `main.go:58-68`; `api/types.go:4-7` | Smoke log: 0 occurrences. Error strings carry at most the URL or the redirect `Location`, never headers |
| S11 | Worst-case concurrent GitLab requests | §4.4 (spirit), §14.3 | RISK (medium) | `groups.go:28` (8) × `gitlab/types.go:24` (4) | Probe P1: **32** in flight during a cold or refreshed group list, plus any concurrent `/api/reports` reads. Each request is an expensive burnup computation on GitLab. Request volume per group-list load/Refresh ≈ Σ over candidates of (⌈its/100⌉ + min(50, its)), e.g. 40 teams × 50 iterations ≈ 2,050 requests. That is at GitLab.com's authenticated API rate limit (2,000/min), and a 429 fails the read (fail open: groups stay, charts error). Cold group-list latency is about ⌈N/8⌉ × ⌈50/4⌉ report round-trips (≈ 65 s for 40 groups at 1 s per report). §4.4's "8 in flight" is met to the letter, but its load-bounding intent is not. **Fix (pick):** a process-wide limiter on report requests (e.g. 8–16 shared by every group read); retry 429/503 with `Retry-After` (bounded) before failing the read; `http.Transport{MaxIdleConnsPerHost: 32}` (the default of 2 causes connection churn at 32 in flight). |
| S12 | Batch size 1 justified by complexity | — | MATCH (based on GitLab source, unverified live) | `types.go:16-20` | Estimated cost of one aliased request: `iteration` 1 + `id` 1 + `report` 175 + burnupTimeSeries 6 + stats 10 + error 3 ≈ **196 ≤ 250** (authenticated max). Two reports ≈ 392 would be rejected, so 1 is the only safe value. `scopeCount`/`completedCount` are selected but unused (cost 2, harmless). Test gap: `TestHTTPClient_Reports_ListThenBatchedReports` accepts `ReportBatchSize` up to 5, so a change to 2 would pass the suite and then fail on a live GitLab. Pin it to 1, or add a complexity-budget test. |
| S13 | Null `iN` node (iteration not readable or deleted between the list and the report request) | §4.4, §14.3 | RISK (low) | `http.go:229-233` (a nil node leaves `Report` nil silently) | Probe P2: if every node is null, the group is **hidden**, which is exactly what §4.4 fail-open forbids for permission blips, and the chart gets no reason. It can happen because `Query.iteration(id:)` authorises `read_iteration` on the iteration's own (possibly ancestor, via `includeAncestors`) group. The round-0 design nested `report` under `group.iterations` and never hit this case. **Fix:** treat a null `iN` with no `errors` as a failed read (e.g. `GitLab returned no data for iteration <id>`), or fetch through `group(fullPath:){ iterations(id: $id, includeAncestors: true, first: 1){ nodes{ report(…) } } }`. |
| S14 | Total time of one group read is unbounded | §14.3 | RISK (low) | `main.go:27` (25 s per request), no overall deadline; the cache `fetch` runs under `WithoutCancel` | 13 sequential rounds × up to 25 s. The read is not cancelled when the browser gives up (intended, it is shared). Consider an overall deadline per group read (e.g. 2 min). |
| S15 | Chooser vs report coverage | §5.1 ledger #2, §6 | Note (pre-existing) | `/api/iterations` = first 100 by `CADENCE_AND_DUE_DATE_DESC`; `/api/reports` = global newest 50 | A listed iteration older than the newest 50 (or, with several cadences, missing from page 1) has no report entry. Already true in round 1; the frontend must show a placeholder or error rather than an empty chart frame. |

### C. GraphQL schema check (from GitLab's published schema/source; NOT verified against a live instance)

| # | Item | Verdict | Evidence | Note |
|---|---|---|---|---|
| Q1 | `group(fullPath: ID!)` with `$fullPath: ID!` (descendants, list) | OK | `http.go:63-79` | `find_by_full_path` is case-insensitive, so R7 works end to end |
| Q2 | `descendantGroups(first: 100, after: String)` → `nodes{id fullPath name}`, `pageInfo{hasNextPage endCursor}` | OK | `http.go:63-70` | 100 = GitLab's `max_page_size` |
| Q3 | `iterations(first: 100, after:, includeAncestors: true, sort: CADENCE_AND_DUE_DATE_DESC)` | OK | `http.go:72-79` | Valid `IterationSort` value. Order no longer matters for Reports (all pages are read and sorted locally); it still decides page 1 of `/api/iterations` (S15) |
| Q4 | `Query.iteration(id: IterationID!)` with `$idN: IterationID!` fed from the listed `id` (`gid://gitlab/Iteration/N`) | OK | `http.go:237-249` | EE query "Find an iteration". Nullable: unauthorised → `null` without `errors` (S13) |
| Q5 | `Iteration.report(fullPath: String)` with `$fullPath: String` | OK | `http.go:81,239` | Correct argument type (`String`, not `ID`); the variable is used only by `report` |
| Q6 | `TimeboxReport.error { code message }` (`TimeboxReportError`: `code: TimeboxReportErrorReason`, `message: String`) | OK, version-dependent RISK (low) | `http.go:88` | This field was added later than `burnupTimeSeries`. On a GitLab version that lacks it, every report request fails validation ("Field 'error' doesn't exist on type 'TimeboxReport'"): every chart errors and every group is kept. **Fix:** document the minimum GitLab version in `README.md`, or retry once without `error` when that exact validation error comes back. |
| Q7 | `burnupTimeSeries{date scopeCount scopeWeight completedCount completedWeight}`, `stats{total complete incomplete{count weight}}` | OK | `http.go:82-87` | Non-null `Int!` in GitLab; null is still tolerated |
| Q8 | Complexity per request ≈ 196 / 250; depth 5 / 15 | OK | S12 | |
| Q9 | Older GitLab raising report failures as GraphQL `errors` instead of `report.error` | Note | `http.go:320-322` | On such versions one bad iteration fails the whole group read (all 50 charts error, group kept). This follows the "any failure fails the whole read" rule, so it is accepted; it only matters together with Q6. |

### Verdict counts (round 2)

Section A (round-1 items, 12 rows): **MATCH 12**. All round-1 MISSING/RISK items (row 7/G13, row 18/G9,
G3, G10, G12, G14, panic `recover`, refresh-test vacuity) are resolved.
Section B (15 rows): MATCH 10 (S8 with a documentation note) · RISK 3 (S11 medium, S13 low, S14 low) · Note 1 (S15) ·
MISMATCH 0 · MISSING 0.
Section C (9 rows): OK 8 (Q6 OK with a low version risk) · Note 1.

**Remaining items and fixes**
1. **S11 (RISK, medium): load / rate limit / latency.** 32 concurrent and ≈ 50 requests per group per
   window. Fix: a process-wide report-request limiter, bounded retry on 429/503 honouring `Retry-After`,
   and `MaxIdleConnsPerHost ≥ 32`.
2. **S13 (RISK, low): null `iN` silently becomes `report: null`** and can hide a group. Fix: treat a null node
   as a failed read with a message, or nest the report under `group.iterations(id:)`.
3. **S12 (test gap): batch size not pinned.** Fix: assert `ReportBatchSize == 1`, or test a complexity budget.
4. **S14 (RISK, low): no overall deadline on a group read.** Fix: add a per-read deadline.
5. **Q6 (RISK, low): `TimeboxReport.error` needs a recent GitLab.** Fix: state the minimum version, or fall back.
6. **S8 (doc):** add an implementation note to `SPEC.md` describing the batched "one logical read".

---

## Round 2 fixes (builder)

Verify: `cd backend && GOFLAGS=-buildvcs=false go vet ./... && go test -race -count=1 ./...` → 177 passed
(127 tests + 50 subtests), 11 packages (now including `config`), 0 failed; `gofmt -l .` clean.
Mock smoke test (`GITLAB_MAX_CONCURRENCY=6 GITLAB_READ_TIMEOUT=30s GITLAB_TOKEN=dummy-secret`) gave:
- `alpha[team-1]`, `beta[x]`, `delta[]`;
- team-1 reports in the order `8 7 6 5 9 4 3 2 1`, with iid 1 `reportError`;
- delta → 502, message verbatim;
- `GITLAB_READ_TIMEOUT=soon` → startup error;
- 0 token occurrences in the log.

| Finding | Fix | Pinned by (new tests) |
|---|---|---|
| S11 limiter | `HTTPClient` holds one semaphore shared by **every** GitLab request it makes (reports, iteration lists, descendants), not only report requests, which is the simpler and stricter reading. Size `Options.MaxConcurrency`, default `DefaultMaxConcurrency` = 12, env `GITLAB_MAX_CONCURRENCY` → `config.MaxConcurrency` → `gitlab.NewHTTPClientWithOptions` (new constructor; `NewHTTPClient` is unchanged and uses the defaults). The per-group limit of 4 still applies. A slot is held per HTTP attempt and released while waiting to retry. | `gitlab.TestHTTPClient_GlobalLimitAcrossGroupReads` (8 simultaneous group reads; default 12 and configured 3; max in flight ≤ limit and ≥ min(limit, 5)) |
| S11 retry | `do` retries 429/502/503/504 up to `MaxAttempts` = 3 attempts. The wait is `Retry-After` (seconds or HTTP date) capped at `MaxRetryWait` = 10 s, else 300 ms·2^(n−1)·[0.5, 1.5). The wait gives up when the context ends. Other statuses and GraphQL `errors` are not retried. When attempts run out, the error is GitLab's message verbatim. | `gitlab.TestHTTPClient_RetriesBusyThenSucceeds` (429 + Retry-After; 503 backoff), `…_PersistentBusyFailsWithGitLabMessage` (exactly 3 requests, verbatim), `…_OtherFailuresNotRetried` (401 → 1 request), `…_RetryWaitHonoursContext`, internal `TestParseRetryAfter`, `TestBusyWait_CappedAndJittered` |
| S11 transport | When the given `http.Client` has no Transport, a clone of `http.DefaultTransport` is used with `MaxIdleConnsPerHost = max(32, limit)` and `MaxIdleConns = max(64, limit)`. `main.go` passes a client without a Transport (25 s timeout), so this applies in production. | covered by the suite (all client tests run through it unless they pass `srv.Client()`) |
| S13 null node | A null `iN` is now a failed read: `GitLab returned no data for iteration <id> (deleted, or not readable with this token)`. The whole read fails and is not cached, and §4.4 keeps the group. | `gitlab.TestHTTPClient_Reports_NullNodeIsFailedRead` |
| S12 | Pinned `ReportBatchSize == 1`; the comment cites ≈196 per report vs the maximum of 250. | `gitlab.TestReportBatchSizeIsOne` |
| S14 deadline | Every cache fetch in `service` (descendants, iterations, reports) runs under `context.WithTimeout(Options.ReadTimeout)`, default `DefaultReadTimeout` = 90 s, env `GITLAB_READ_TIMEOUT` (`90`, `90s`, `2m`). The fetch context is already detached from the caller, so this is the only deadline. Running out → `GitLab did not answer within <d>`, a failed read that is not cached. | `service.TestReadTimeout_FailedReadNotCached` (50 ms deadline: message, prompt return, group kept by the data check, next read fetches again), `service.TestDefaultReadTimeout`, `config.TestLoad_GitLabLimits` |
| Q6 / doc | `backend/README.md` now has: "GitLab requirements" (Premium/Ultimate; `TimeboxReport.error` required, plus what happens without it; the exact first version is **not verified**, believed to be the 15 series; an introspection query to check an instance; `read_api` token); the new env vars; the retry policy; a request-budget table (≈ 1 + N requests per group per 5 min, worked 40 × 50 example vs GitLab.com's 2,000/min). | — |

Not done (out of `backend/` scope): S8's `SPEC.md` implementation note describing the batched "one logical
read". Suggested wording: "`/api/reports` is one cached logical read per group, executed as the paginated
iteration list plus one `iteration(id:){report}` request per chosen iteration (GitLab's complexity limit)."
