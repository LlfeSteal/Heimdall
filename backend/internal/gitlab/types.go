// Package gitlab is Heimdall's only door to GitLab. All access is GraphQL
// (POST {GITLAB_URL}/api/graphql, header "Authorization: Bearer <token>").
//
// The types below mirror the GitLab GraphQL schema 1:1 (field names are the
// GraphQL names, so a GraphQL node can be json-decoded straight into them).
// They are RAW: nullable GitLab fields are pointers; normalisation into the
// HTTP contract (heimdall/internal/api) happens in heimdall/internal/reports.
package gitlab

import "context"

// MaxReportIterations is the number of iterations requested by the single
// per-group report read (SPEC §5.2, §6: "up to 50"). The GraphQL query MUST
// request `iterations(first: 50, ...)`.
const MaxReportIterations = 50

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

// Report is `iteration.report(fullPath: $fullPath)`.
type Report struct {
	BurnupTimeSeries []BurnupPoint `json:"burnupTimeSeries"`
	Stats            *ReportStats  `json:"stats"`
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

	// Reports returns up to MaxReportIterations iterations of the group, each
	// with its report, from ONE request (§5.2). `report(fullPath:)` is passed
	// the same group full path. A missing group → empty slice, nil error.
	Reports(ctx context.Context, groupFullPath string) ([]IterationReport, error)
}
