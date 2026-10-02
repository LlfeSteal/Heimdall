// Package iterations implements the SPEC §5.1 newest-first ordering.
//
//  1. primary key: startDate DESCENDING (ISO dates compare as text);
//  2. tie-break: iid as a number, DESCENDING; a non-numeric (or empty) iid
//     orders as 0;
//  3. otherwise the input order is kept (stable sort).
//
// Proposed resolution (not in the spec): a nil startDate orders as the empty
// string, i.e. AFTER every dated iteration.
package iterations

import (
	"sort"
	"strconv"

	"heimdall/internal/api"
)

// IIDNumber parses an iteration number; anything strconv.Atoi rejects → 0.
func IIDNumber(iid string) int {
	n, err := strconv.Atoi(iid)
	if err != nil {
		return 0
	}
	return n
}

// Less reports whether a must be listed before b in newest-first order.
func Less(a, b api.Iteration) bool {
	return Newer(a.StartDate, a.IID, b.StartDate, b.IID)
}

// Newer is Less on the raw ordering fields, for callers holding other
// iteration types (e.g. GitLab's).
func Newer(startA *string, iidA string, startB *string, iidB string) bool {
	sa, sb := deref(startA), deref(startB)
	if sa != sb {
		return sa > sb
	}
	return IIDNumber(iidA) > IIDNumber(iidB)
}

// Sort orders its in place, newest first (stable).
func Sort(its []api.Iteration) {
	sort.SliceStable(its, func(i, j int) bool { return Less(its[i], its[j]) })
}

// SortReports orders rs in place by the same rule applied to rs[i].Iteration.
func SortReports(rs []api.IterationReport) {
	sort.SliceStable(rs, func(i, j int) bool { return Less(rs[i].Iteration, rs[j].Iteration) })
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
