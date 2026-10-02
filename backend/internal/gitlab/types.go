// Package gitlab is Heimdall's only door to GitLab. All access is GraphQL
// (POST {GITLAB_URL}/api/graphql, header "Authorization: Bearer <token>").
//
// The types below mirror the GitLab GraphQL schema 1:1 (field names are the
// GraphQL names, so a GraphQL node can be json-decoded straight into them).
// They are RAW: nullable GitLab fields are pointers; normalisation into the
// HTTP contract (heimdall/internal/api) happens in heimdall/internal/reports.
package gitlab

import "context"

// MaxReportIterations is the number of iterations the per-group report read
// returns (SPEC §5.2, §6: "up to 50"): the newest ones by the §5.1 rule.
const MaxReportIterations = 50

// ReportBatchSize is the most iteration reports requested in one GraphQL
// request. GitLab gives `Iteration.report` a complexity of 175 against a
// per-query maximum of 250 for authenticated users, so one report per request
// is all that reliably fits.
const ReportBatchSize = 1

// ReportConcurrency is the most report requests one report read keeps in
// flight.
const ReportConcurrency = 4

// IterationsPageSize is the page size of the lightweight iteration list.
const IterationsPageSize = 100

// DescendantsPageSize is the page size used while paginating descendantGroups
// (GitLab's maximum). Pagination continues until hasNextPage=false (A.3 #1,
// no cap).
const DescendantsPageSize = 100

// Group is a node of `group.descendantGroups`.
type Group struct {
	ID       string `json:"id"`
	FullPath string `json:"fullPath"`
	Name     string `json:"name"`
}

// Iteration is a node of `group.iterations` (without its report).
// GitLab may return a null title (automatic cadences); it decodes to "".
type Iteration struct {
	ID        string  `json:"id"`
	IID       string  `json:"iid"`
	Title     string  `json:"title"`
	StartDate *string `json:"startDate"`
	DueDate   *string `json:"dueDate"`
	State     string  `json:"state"`
}

// BurnupPoint is one element of `report.burnupTimeSeries`. Any nullable
// numeric field that is null normalises to 0.
type BurnupPoint struct {
	Date            string   `json:"date"`
	ScopeCount      *float64 `json:"scopeCount"`
	ScopeWeight     *float64 `json:"scopeWeight"`
	CompletedCount  *float64 `json:"completedCount"`
	CompletedWeight *float64 `json:"completedWeight"`
}

// CountWeight is `{ count weight }` inside report.stats.
type CountWeight struct {
	Count  *float64 `json:"count"`
	Weight *float64 `json:"weight"`
}

// ReportStats is `report.stats`.
type ReportStats struct {
	Total      *CountWeight `json:"total"`
	Complete   *CountWeight `json:"complete"`
	Incomplete *CountWeight `json:"incomplete"`
}

// ReportError is `report.error`: GitLab's reason for not building a report
// (e.g. code TOO_MANY_EVENTS). The series is then null.
type ReportError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// Report is `iteration.report(fullPath: $fullPath)`.
type Report struct {
	BurnupTimeSeries []BurnupPoint `json:"burnupTimeSeries"`
	Stats            *ReportStats  `json:"stats"`
	Error            *ReportError  `json:"error"`
}

// IterationReport is an iteration node that also carries its report.
// Report is nil when GitLab returned `report: null` (this MUST be tolerated).
type IterationReport struct {
	Iteration
	Report *Report `json:"report"`
}

// Client has exactly one method per logical GitLab read. Implementations:
// *HTTPClient (real GitLab) and *mock.Fake (tests, GITLAB_MOCK=1).
//
// Errors: the returned error's Error() string MUST be the underlying message
// verbatim (a GraphQL `errors[].message`, joined with "; " when there are
// several) — it travels unchanged to the HTTP `{ "error": ... }` body
// (SPEC §13 "underlying message quoted verbatim", §14.3).
type Client interface {
	// DescendantGroups returns ALL descendant groups of rootFullPath, following
	// pageInfo.endCursor until hasNextPage=false (A.3 #1). Nodes are returned in
	// the order GitLab sent them, unfiltered and not de-duplicated.
	// A missing/inaccessible root (`group: null`) → empty slice, nil error.
	DescendantGroups(ctx context.Context, rootFullPath string) ([]Group, error)

	// Iterations returns the group's iterations from ONE request (unpaginated,
	// SPEC §5.1 known limit / ledger #2), in GitLab's order (caller sorts).
	// A missing group (`group: null`) → empty slice, nil error (§5.1, §15.2).
	Iterations(ctx context.Context, groupFullPath string) ([]Iteration, error)

	// Reports is the ONE logical report read of a group (§5.2): its newest
	// MaxReportIterations iterations by the §5.1 rule, each with its report
	// scoped by `report(fullPath:)` to the same group. *HTTPClient performs it
	// as several small GraphQL requests (see HTTPClient.Reports); any failed
	// request fails the whole read. A missing group → empty slice, nil error.
	Reports(ctx context.Context, groupFullPath string) ([]IterationReport, error)
}
