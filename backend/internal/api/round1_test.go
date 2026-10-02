package api_test

import (
	"testing"

	"heimdall/internal/mock"
)

// §14.2 over HTTP with warm caches: /api/reports?refresh=1 never re-reads the
// iteration list or the group list.
func TestReportsRefresh_LeavesWarmListsAlone(t *testing.T) {
	h := newHarness(t)
	h.getOK(t, "/api/iterations?group="+mock.PathAlpha)
	h.getOK(t, "/api/groups")
	h.getOK(t, "/api/reports?group="+mock.PathAlpha+"&refresh=1")
	h.getOK(t, "/api/iterations?group="+mock.PathAlpha)
	h.getOK(t, "/api/groups")
	if got := h.fake.Calls(mock.MethodIterations, mock.PathAlpha); got != 1 {
		t.Errorf("Iterations calls = %d, want 1", got)
	}
	if got := h.fake.Calls(mock.MethodDescendantGroups, mock.FixtureRoot); got != 1 {
		t.Errorf("DescendantGroups calls = %d, want 1", got)
	}
	if got := h.fake.Calls(mock.MethodReports, mock.PathAlphaTeam1); got != 1 {
		t.Errorf("Reports(team-1) calls = %d, want 1", got)
	}
}

// reportError is served verbatim on the refused iteration only.
func TestReports_ReportErrorOverHTTP(t *testing.T) {
	h := newHarness(t)
	raw := decode[[]map[string]any](t, h.getOK(t, "/api/reports?group="+mock.PathAlphaTeam1))
	for _, r := range raw {
		v, present := r["reportError"]
		if !present {
			t.Fatalf("reportError key missing: %v", r)
		}
		if r["iid"] == "1" && v != mock.Team1ReportError {
			t.Errorf("iid 1 reportError = %v, want %q", v, mock.Team1ReportError)
		}
		if r["iid"] != "1" && v != nil {
			t.Errorf("iid %v reportError = %v, want null", r["iid"], v)
		}
	}
}
