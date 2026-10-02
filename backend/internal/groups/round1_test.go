package groups_test

import (
	"context"
	"testing"
	"time"

	"heimdall/internal/api"
	"heimdall/internal/groups"
)

// Row 7 / G13: ROOT_GROUP matches GitLab's canonical paths case-insensitively;
// roots of any depth work.
func TestDepth_CaseInsensitiveAndDeepRoot(t *testing.T) {
	cases := []struct {
		root, path string
		want       int
	}{
		{"Org/Delivery", "org/delivery", 0},
		{"Org/Delivery", "org/delivery/alpha", 1},
		{"ORG/DELIVERY", "org/delivery/alpha/Team-1", 2},
		{"Org/Delivery", "org/delivery-x/alpha", -1},
		{"Org/Delivery", "org/deliveryalpha", -1},
		{"Org/Delivery", "org/delivery/", -1},
		{"a/b/c", "a/b/c", 0},
		{"a/b/c", "a/b/c/x", 1},
		{"a/b/c", "a/b/c/x/y", 2},
		{"a/b/c", "a/b/c/x/y/z", 3},
		{"a/b/c", "a/b/cx/y", -1},
		{"a/b/c", "a/b", -1},
	}
	for _, tc := range cases {
		if got := groups.Depth(tc.root, tc.path); got != tc.want {
			t.Errorf("Depth(%q, %q) = %d, want %d", tc.root, tc.path, got, tc.want)
		}
	}
}

func errRep(msg string) api.IterationReport {
	return api.IterationReport{Report: &api.Report{Series: []api.SeriesPoint{}}, ReportError: &msg}
}

func TestHasReportError(t *testing.T) {
	if groups.HasReportError(nil) || groups.HasReportError([]api.IterationReport{rep(0), {}}) {
		t.Error("no reportError → false")
	}
	if !groups.HasReportError([]api.IterationReport{rep(0), errRep("too many events")}) {
		t.Error("one reportError → true")
	}
}

// Row 18 / G9: no series anywhere but a report GitLab refused → a FAILED read → kept.
func TestCheckData_ReportErrorIsAFailedRead(t *testing.T) {
	data := map[string][]api.IterationReport{
		"series":            {rep(2), errRep("x")},
		"refused":           {rep(0), errRep("Burnup chart could not be generated due to too many events"), {}},
		"empty":             {rep(0), {}},
		"refused-only-null": {errRep("x")},
	}
	paths := []string{"series", "refused", "empty", "refused-only-null"}
	got := groups.CheckData(context.Background(), paths, 8, func(_ context.Context, p string) ([]api.IterationReport, error) {
		return data[p], nil
	})
	want := []bool{true, true, false, true}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("%s: passed = %v, want %v", paths[i], got[i], want[i])
		}
	}
}

// §4.4 "fails for any reason": a panicking read and a timed-out read keep the group.
func TestCheckData_PanicAndTimeoutFailOpen(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	read := func(ctx context.Context, p string) ([]api.IterationReport, error) {
		switch p {
		case "panics":
			panic("boom")
		case "slow":
			<-ctx.Done()
			return nil, ctx.Err()
		}
		return []api.IterationReport{rep(0)}, nil
	}
	got := groups.CheckData(ctx, []string{"panics", "slow", "empty"}, 8, read)
	if want := []bool{true, true, false}; got[0] != want[0] || got[1] != want[1] || got[2] != want[2] {
		t.Errorf("CheckData = %v, want %v", got, want)
	}
}
